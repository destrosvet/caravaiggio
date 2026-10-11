"""Loopback-only SAM 3 mask service. No image generation or implicit weight downloads."""
import argparse
import base64
import gc
import json
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ORIGINS = {"http://localhost:1420", "http://127.0.0.1:1420", "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"}
SUBJECT_QUERIES = ("person", "cat", "dog", "animal", "bird", "flower", "building", "vehicle")
FACE_QUERIES = ("face", "animal head")
HUMAN_DETAIL_QUERIES = ("hair", "beard", "mustache", "eyeglasses", "sunglasses", "scarf", "hat", "cap", "headband", "hair accessory", "earring", "necklace", "tie", "bow tie", "smoking pipe", "cigarette", "cigar", "headphones", "hearing aid", "face mask", "handbag", "wristwatch", "bracelet", "gloves")
HAIR_QUERIES = {"hair", "beard", "mustache"}
ANALYSIS_VERSION = 5
FEATURE_QUERIES = ("eye", "mouth", "nose", "ear", "eyebrow", "muzzle", "whisker")


def face_boxes(masks, width, height):
    """Deduplicate overlapping head detections, while retaining separate faces."""
    import numpy as np
    boxes = []
    for mask in masks:
        ys, xs = np.where(mask)
        if not len(xs):
            continue
        box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        duplicate = False
        for other in boxes:
            intersection = max(0, min(box[2], other[2]) - max(box[0], other[0])) * max(0, min(box[3], other[3]) - max(box[1], other[1]))
            smaller = min((box[2]-box[0])*(box[3]-box[1]), (other[2]-other[0])*(other[3]-other[1]))
            if intersection > smaller * .75:
                duplicate = True
                break
        if not duplicate:
            boxes.append(box)
    return boxes


def feature_support(boxes, subjects, width, height):
    import numpy as np
    support = np.zeros((height, width), dtype=bool)
    for x0, y0, x1, y1 in boxes:
        px, py = max(2, int((x1-x0)*.15)), max(2, int((y1-y0)*.15))
        support[max(0,y0-py):min(height,y1+py), max(0,x0-px):min(width,x1+px)] = True
    # A missed head detection must not suppress otherwise detected animal eyes.
    if not boxes:
        support |= subjects
    return support


def protect_features(importance, recognition, masks, support):
    import numpy as np
    count = 0
    for mask in masks:
        clipped = mask & support
        if np.any(clipped):
            count += 1
            importance[clipped] = 255
            recognition[clipped] = 255
    return count



def human_detail_support(subjects, width, height):
    """Pad person silhouettes without importing a separate image-processing runtime."""
    import numpy as np
    radius = max(2, int(min(width, height) * .025))
    padded = np.pad(subjects.astype(np.int32), ((1, 0), (1, 0)))
    table = padded.cumsum(axis=0).cumsum(axis=1)
    x0, x1 = np.maximum(0, np.arange(width)-radius), np.minimum(width, np.arange(width)+radius+1)
    y0, y1 = np.maximum(0, np.arange(height)-radius), np.minimum(height, np.arange(height)+radius+1)
    return (table[y1[:,None], x1] - table[y0[:,None], x1] - table[y1[:,None], x0] + table[y0[:,None], x0]) > 0


def protect_human_details(importance, recognition, masks, support, outline_only=False):
    """Associate whole accessories with a person; keep protruding pipes/hair intact."""
    import numpy as np
    count = 0
    for mask in masks:
        size = np.count_nonzero(mask)
        if not size or np.count_nonzero(mask & support) < max(1, size * .1):
            continue
        count += 1
        importance[mask] = np.maximum(importance[mask], 230 if outline_only else 255)
        protected = mask
        if outline_only:
            interior = np.zeros_like(mask)
            interior[1:-1,1:-1] = mask[1:-1,1:-1] & mask[:-2,1:-1] & mask[2:,1:-1] & mask[1:-1,:-2] & mask[1:-1,2:]
            protected = mask & ~interior
        recognition[protected] = 255
        importance[protected] = 255
    return count


def decode_image(payload):
    width, height = payload.get("width"), payload.get("height")
    if type(width) is not int or type(height) is not int or not 1 <= width <= 1024 or not 1 <= height <= 1024:
        raise ValueError("Image dimensions must be integers between 1 and 1024.")
    raw = base64.b64decode(payload.get("rgba", ""), validate=True)
    if len(raw) != width * height * 4:
        raise ValueError("Invalid RGBA image length.")
    return width, height, raw


def combine_masks(importance, masks, weight):
    import numpy as np
    if len(masks) == 0:
        return
    union = np.any(masks, axis=0)
    importance[union] = np.maximum(importance[union], weight)
    # Protect both sides of a detected outline, including narrow features.
    edges = np.zeros_like(union)
    edges[1:] |= union[1:] != union[:-1]
    edges[:-1] |= union[1:] != union[:-1]
    edges[:, 1:] |= union[:, 1:] != union[:, :-1]
    edges[:, :-1] |= union[:, 1:] != union[:, :-1]
    importance[edges] = np.maximum(importance[edges], 230)


class Analyzer:
    def __init__(self, checkpoint):
        self.checkpoint = Path(checkpoint)
        self.processor = None
        self.lock = threading.Lock()

    def load(self):
        if not self.checkpoint.is_file():
            raise RuntimeError("SAM 3 weights are missing. Place sam3.pt in artifacts/sam3/models or start with --checkpoint PATH. Hugging Face access must be approved first.")
        try:
            import torch
            from sam3.model_builder import build_sam3_image_model
            from sam3.model.sam3_image_processor import Sam3Processor
            from sam3.turing import apply_turing_patch, offload_text_encoder
        except ImportError as error:
            raise RuntimeError("SAM 3 dependencies are missing. Run tools/sam3/setup.ps1 first.") from error
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA is unavailable. Install the CUDA PyTorch build and check the NVIDIA driver.")
        torch.set_num_threads(1)
        model = build_sam3_image_model(checkpoint_path=str(self.checkpoint), load_from_HF=False, device="cuda", compile=False, enable_inst_interactivity=False)
        torch.set_num_threads(4)
        self.processor = apply_turing_patch(Sam3Processor(model, confidence_threshold=0.4), compile=False)
        offload_text_encoder(self.processor, trim_padding=True)

    def detect(self, state, prompt, width, height):
        self.processor.reset_all_prompts(state)
        result = self.processor.set_text_prompt(prompt=prompt, state=state)
        masks = result.get("masks")
        if masks is None:
            import numpy as np
            return np.zeros((0, height, width), dtype=bool)
        return masks.detach().to("cpu").numpy().reshape(-1, height, width).astype(bool)

    def analyze(self, width, height, raw):
        import numpy as np
        import torch
        from PIL import Image
        if self.processor is None:
            self.load()
        rgba = Image.frombytes("RGBA", (width, height), raw)
        image = Image.new("RGB", rgba.size, "white")
        image.paste(rgba, mask=rgba.getchannel("A"))
        importance = np.zeros((height, width), dtype=np.uint8)
        recognition = np.zeros_like(importance)
        living_subjects = np.zeros((height, width), dtype=bool)
        human_subjects = np.zeros_like(living_subjects)
        counts = {"subjects": 0, "details": 0, "recognitionDetails": 0, "humanDetails": 0, "hairDetails": 0, "accessoryDetails": 0}
        human_detections = {}
        state = None
        try:
            with torch.inference_mode():
                state = self.processor.set_image(image)
                for prompt in SUBJECT_QUERIES:
                    masks = self.detect(state, prompt, width, height)
                    counts["subjects"] += len(masks)
                    combine_masks(importance, masks, 64)
                    if prompt in {"person", "cat", "dog", "animal", "bird"} and len(masks):
                        living_subjects |= np.any(masks, axis=0)
                    if prompt == "person" and len(masks):
                        human_subjects |= np.any(masks, axis=0)
                heads = []
                for prompt in FACE_QUERIES:
                    masks = self.detect(state, prompt, width, height)
                    counts["details"] += len(masks)
                    combine_masks(importance, masks, 200)
                    heads.extend(masks)
                face_mask = np.any(heads, axis=0).astype(np.uint8) * 255 if heads else np.zeros_like(importance)
                boxes = face_boxes(heads, width, height)
                support = feature_support(boxes, living_subjects, width, height)
                if np.any(support):
                    for prompt in FEATURE_QUERIES:
                        masks = self.detect(state, prompt, width, height)
                        count = protect_features(importance, recognition, masks, support)
                        counts["details"] += count
                        counts["recognitionDetails"] += count
                # Clothing and belongings need person association, not face-only clipping.
                if np.any(human_subjects):
                    human_support = human_detail_support(human_subjects, width, height)
                    for prompt in HUMAN_DETAIL_QUERIES:
                        masks = self.detect(state, prompt, width, height)
                        count = protect_human_details(importance, recognition, masks, human_support, prompt in HAIR_QUERIES)
                        counts["details"] += count
                        if count:
                            human_detections[prompt] = count
                        counts["humanDetails"] += count
                        counts["hairDetails" if prompt in HAIR_QUERIES else "accessoryDetails"] += count
                for prompt in ("hand", "text"):
                    masks = self.detect(state, prompt, width, height)
                    counts["details"] += len(masks)
                    combine_masks(importance, masks, 255)
                # Analyze small heads separately so distant faces also retain eyes.
                del state
                state = None
                for x0, y0, x1, y1 in boxes:
                    if x1-x0 >= 160 and y1-y0 >= 160:
                        continue
                    px, py = max(2, int((x1-x0)*.15)), max(2, int((y1-y0)*.15))
                    x0,y0,x1,y1 = max(0,x0-px),max(0,y0-py),min(width,x1+px),min(height,y1+py)
                    crop = image.crop((x0,y0,x1,y1))
                    state = self.processor.set_image(crop)
                    for prompt in ("eye", "mouth", "nose", "eyebrow", "muzzle", "whisker"):
                        masks = self.detect(state, prompt, crop.width, crop.height)
                        count = protect_features(importance[y0:y1,x0:x1], recognition[y0:y1,x0:x1], masks, support[y0:y1,x0:x1])
                        counts["details"] += count
                        counts["recognitionDetails"] += count
                    del state
                    state = None
            alpha = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 4)[:, :, 3]
            importance[alpha < 16] = 0
            recognition[alpha < 16] = 0
            face_mask[alpha < 16] = 0
            return {"width": width, "height": height,
                    "importance": base64.b64encode(importance.tobytes()).decode("ascii"),
                    "recognition": base64.b64encode(recognition.tobytes()).decode("ascii"),
                    "faceMask": base64.b64encode(face_mask.tobytes()).decode("ascii"),
                    "faces": len(boxes), "analysisVersion": ANALYSIS_VERSION, "humanDetections": human_detections, **counts}
        finally:
            del state
            gc.collect()
            torch.cuda.empty_cache()


class Handler(BaseHTTPRequestHandler):
    analyzer = None

    def log_message(self, format, *args):
        # Log request routes, never image bytes or credentials.
        print(format % args, flush=True)

    def permitted(self):
        return self.headers.get("Host") in {"127.0.0.1:8766", "localhost:8766"} and self.headers.get("Origin") in ORIGINS | {None}

    def reply(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        if self.headers.get("Origin") in ORIGINS:
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        if not self.permitted():
            self.reply(403, {"error": "Origin is not allowed."})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin", "http://localhost:1420"))
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if not self.permitted():
            self.reply(403, {"error": "Origin is not allowed."})
        elif self.path == "/health":
            self.reply(200, {"service": "caravaiggio-sam3", "checkpointAvailable": self.analyzer.checkpoint.is_file(), "modelLoaded": self.analyzer.processor is not None, "analysisVersion": ANALYSIS_VERSION})
        else:
            self.reply(404, {"error": "Unknown route."})

    def do_POST(self):
        if not self.permitted():
            self.reply(403, {"error": "Origin is not allowed."})
            return
        if self.path != "/analyze":
            self.reply(404, {"error": "Unknown route."})
            return
        if not self.analyzer.lock.acquire(blocking=False):
            self.reply(429, {"error": "SAM 3 is still processing an image. Wait for it to finish, then retry."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 6_000_000:
                raise ValueError("Image request is too large or empty.")
            self.connection.settimeout(30)
            payload = json.loads(self.rfile.read(length))
            width, height, raw = decode_image(payload)
            # Check the checkpoint before importing optional heavyweight packages.
            if self.analyzer.processor is None and not self.analyzer.checkpoint.is_file():
                self.analyzer.load()
            self.reply(200, self.analyzer.analyze(width, height, raw))
        except (ValueError, TypeError, AttributeError) as error:
            self.reply(400, {"error": str(error)})
        except Exception as error:
            message = str(error)
            if "out of memory" in message.lower():
                message = "Not enough GPU memory for SAM 3. Close other GPU applications and retry, or choose classical posterization."
            elif isinstance(error, ImportError):
                message = "SAM 3 dependencies are missing. Run tools/sam3/setup.ps1 first."
            self.reply(503, {"error": message})
        finally:
            self.analyzer.lock.release()


def main():
    parser = argparse.ArgumentParser()
    repo = Path(__file__).resolve().parents[2]
    standard = repo / "artifacts/sam3/models/sam3.pt"
    supplied = repo / "tools/sam3/model/sam3.pt"
    parser.add_argument("--checkpoint", default=str(standard if standard.is_file() else supplied))
    args = parser.parse_args()
    Handler.analyzer = Analyzer(args.checkpoint)
    server = ThreadingHTTPServer(("127.0.0.1", 8766), Handler)
    server.daemon_threads = True
    print("Caravaiggio SAM 3 service: http://127.0.0.1:8766", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
