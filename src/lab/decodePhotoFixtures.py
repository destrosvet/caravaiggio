"""Decode user photo fixtures for the trajectory lab; requires Pillow."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

root = Path(sys.argv[1] if len(sys.argv) > 1 else "references/image-test")
out = Path(sys.argv[2] if len(sys.argv) > 2 else "artifacts/photo-inputs")
out.mkdir(parents=True, exist_ok=True)
for path in sorted(root.iterdir()):
    if path.suffix.lower() not in (".png", ".jpg", ".jpeg", ".webp"):
        continue
    original = ImageOps.exif_transpose(Image.open(path)).convert("RGBA")
    def resized(edge):
        scale = min(1, edge / max(original.size))
        return original.resize(tuple(max(1, round(v * scale)) for v in original.size), Image.Resampling.BILINEAR)
    image, sample = resized(240), resized(160)
    (out / (path.stem + ".json")).write_text(json.dumps({
        "name": path.name, "width": image.width, "height": image.height,
        "rgba": list(image.tobytes()), "sample": list(sample.tobytes()),
    }), encoding="utf-8")
    print(path.name, original.size)
