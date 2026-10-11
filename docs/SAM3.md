# Optional local SAM 3 posterization

Classical posterization remains the default and needs no Python, CUDA or model weights. In Palette / Posterization, choose **AI assisted · local SAM 3** to enable automatic segmentation. No clicks, boxes or manual prompts are required.

SAM 3 supplies masks, not a generated replacement image. The app blends physical median simplification with the original pixels according to detected subjects, details and outlines, then maps the result to the existing project palette. Recognized facial features are fully protected independently of the generic detail slider, with a modest 15% local contrast enhancement relative to the simplified image. The same preparation and masks drive stroke generation. A dedicated final recognition pass repaints each detected colour component in every stroke style, including tiny pupils that the ordinary seed lattice or minimum stroke length would miss. Brush-scale noise filtering preserves these components. The stroke ordering optimizer keeps this pass after fill, contours and shadows; machine joining never paints bridges between its separate strokes. Actual brush width and the selected palette still limit physical detail. Transparent/ignored areas remain masked. Background simplification and detail protection are adjustable. Model detection can miss details; it is not a guarantee of anatomical accuracy.

Analysis runs on a transformed image of at most 900 pixels on its longest side. The main image is encoded once and subject queries (person, cat, dog, animal, bird, flower, building, vehicle), head queries (face, animal head), recognition queries (eye, mouth, nose, ear, eyebrow, muzzle, whisker), and other detail queries (hand, text) run sequentially. Recognition masks are restricted to detected head neighbourhoods; if head detection fails, detected people/animals provide the fallback region. Small detected heads below 160 pixels in either dimension are additionally encoded as crops and queried for facial features. There is no largest-face-only selection. These queries are a heuristic, not a general scene parser. Displayed counts are mask/head-region counts and can include overlapping or repeated crop detections. Up to three importance masks are cached in memory, keyed by source, transform and canvas dimensions; they are recomputed after reopening a project. Palette/calibration adjustments reuse the masks. Analysis version 5 invalidates older cached masks; an older running service must be restarted before retrying. No pixels leave the local service.

## Windows setup

Use Python 3.12 and an NVIDIA GPU. From the project directory:

~~~powershell
./tools/sam3/setup.ps1 -PythonExecutable "C:/path/to/python.exe"
~~~

The script creates an isolated environment in ignored artifacts/sam3/.venv. CUDA PyTorch 2.10.0 / torchvision 0.25.0 use the cu128 wheels. The SAM 3 Turing fork is pinned at commit 080bec0b3a2f103787b6985c21bc51c9bb99aaa3 for its reduced-memory image inference patch; compilation is disabled and the text encoder is offloaded to the CPU. This third-party optimization is distinct from Meta's official SAM 3 distribution. 8 GB is the target; actual peak VRAM and performance still need measurement on a real input.

Request and accept access to [Meta's SAM 3 weights](https://huggingface.co/facebook/sam3), then download sam3.pt. The service never downloads weights implicitly. If your approved Hugging Face login is already configured, you can explicitly run artifacts/sam3/.venv/Scripts/python.exe tools/sam3/download_weights.py to download the pinned official checkpoint. This script does not accept access terms on your behalf. Put the file in artifacts/sam3/models/sam3.pt or tools/sam3/model/sam3.pt (automatically detected), or pass its path when starting:

~~~powershell
./tools/sam3/start.ps1
# Alternatively:
./tools/sam3/start.ps1 -Checkpoint "D:/models/sam3.pt"
~~~

The service runs in a hidden process, bound only to 127.0.0.1:8766. Logs are in artifacts/sam3/server.out.log and server.err.log. Start it once per computer session; it loads the model on the first analysis. The /health endpoint reports weight availability and whether the model has been loaded. It accepts the local Vite/Tauri origins only, validates dimensions and payload size, and serializes inference to avoid concurrent GPU loads. If a previous request is still running, wait and retry. Aborting a frontend request does not cancel an in-progress CUDA kernel. No changes to FluidNC or the machine are involved.

When the service, dependencies or weights are unavailable, the UI reports the error, offers Retry, and prevents continuing with an uncomputed AI result. Choosing Classical immediately restores the original route and settings.

## Verification

~~~powershell
node --experimental-strip-types --test test/aiPosterization.test.ts
node node_modules/vitest/vitest.mjs run test/AiPosterizationControls.test.tsx --pool=threads --maxWorkers=1
artifacts/sam3/.venv/Scripts/python.exe tools/sam3/test_server.py
~~~

Tests cover detail preservation, background simplification, alpha, mask resizing, project compatibility, frontend response validation, controls, local HTTP errors and allowed origins. Real inference needs approved weights and must be checked separately for output quality and memory usage.

Sources: [SAM 3](https://github.com/facebookresearch/sam3), [SAM 3 Turing](https://github.com/nusu-github/sam3-turing).

Implementation verification on this computer: Python 3.12.14, torch 2.10.0+cu128; model/patch imports succeed and CUDA detects NVIDIA GeForce RTX 3060 Ti. HTTP service and missing-weight handling were verified. User-supplied tools/sam3/model/sam3.pt was subsequently loaded successfully. A real 710×900 family photograph returned 3 subject masks and 25 detail masks, visually matching people, faces, eyes, mouths, noses and hands. First-request duration including model loading was 44.61 seconds. NVIDIA memory sampling at 1-second intervals measured a whole-device peak of 5971 MiB out of 8192 MiB, with a baseline of 2129 MiB used by other applications. This verifies the tested image on this machine; it is not a general image-quality benchmark. The running service retains the loaded model for subsequent requests.

Recognition pipeline verification: family photograph (3 head regions, 40 facial feature masks), cat (1 head region, 6 facial feature masks), dog (1 head region, 8 facial feature masks). Resulting recognition masks were visually inspected. Whole-device VRAM sampled every second peaked at 6234 MiB of 8192 MiB in the latest run. Tests cover isolated pupils, preserving features through brush filtering, every stroke strategy, final phase ordering, avoiding machine joins between recognition strokes, and clipping false background features outside head regions.

### Additional face shades

In Palette, select AI assisted and set **Additional face shades** from 0 to 8. Zero retains the original palette. The application samples visible pixels from detected human faces and animal heads and chooses additional highlights and shadow colours in OKLab alongside the existing palette. The requested number is shared across all faces, with fewer colours when the detected regions contain fewer distinct shades or the palette is full. Background and transparent pixels do not contribute. These are real palette paints: Workspace creates their cups and stroke generation, machine paths and consumption estimates use them.

Unlocked automatic shades update when the image, face masks or count changes, and disappear when the count is zero or classic posterization is selected. Locked shades remain and count toward the selected number. Editing an automatic shade locks it. Existing manual paints are preserved. Save/load retains these settings and the origin of automatic shades. After a palette change, regenerate strokes and recalculate machine paths. Detection can miss or overestimate face regions; the feature does not invent facial anatomy.

With four additional shades, a 14-colour base palette (including white) reduced mean perceptual distance from source face pixels by 68% for the family photograph, 20% for the cat and 39% for the dog. This measures colour matching in detected face regions, not subjective likeness or physical paint accuracy. The latest first request including model loading took 82.33 seconds; warm cat/dog requests took 3.06/3.35 seconds. Raw summaries are in the ignored artifacts/sam3/faces-verification.json and palette-verification.json files.

### Gap filling

AI posterization defaults to **Fill gaps with an underpainting** for continuous styles. After generating artistic strokes, a conservative brush footprint finds material pixels without geometric coverage. A brush-scale colour map merges fur speckles for local fill paths following the tangents of nearby artistic strokes. These fills are painted first, followed by the original artistic, contour, shadow and recognition layers. Machine ordering preserves this sequence. Pointillism, dabs and decorative lines retain their intentional spaces. Classical generation remains unchanged.

Fill paths respect maximum length but can be shorter than the artistic minimum, because discarding clipped fills would recreate the holes. Transparent/canvas mask pixels cannot seed or connect fill paths; brush footprints can overlap neighbouring regions as in the existing painter. Coverage counts measure contact rather than opaque colour; bristles, pressure and wet mixing still affect the visible result. The Strokes status reports the additional gap fill strokes, and normal machine time/paint consumption calculations include them. Toggle the option in Palette and regenerate strokes to apply it.

Real-image verification with the local cat reference, eight paints, a 6 mm brush and 4 mm minimum: 1226 strokes before, 1724 after (498 fill strokes). The shared wet-paint renderer reduced completely unpainted pixels from 1.044% to 0.012%; conservative geometric gaps reached zero. This is one test image, not a guarantee for all brush and canvas settings.

Gap fills follow a smoothed direction field sampled from accepted artistic strokes. They curve along that field, stop at brush-scale colour boundaries and stop after reaching neighbouring painted footprints. The seed scan does not dictate path direction. Small isolated islands receive finite local dabs.

### Human hair and accessories

When people are detected, 24 additional sequential queries use the existing image encoding: hair, beard, mustache, eyeglasses, sunglasses, scarf, hat, cap, headband, hair accessory, earring, necklace, tie, bow tie, smoking pipe, cigarette, cigar, headphones, hearing aid, face mask, handbag, wristwatch, bracelet and gloves. Animal-only scenes skip these queries. A detected item must overlap a slightly padded person silhouette by at least 10% of its area; an associated item keeps its entire mask, including protruding pipes or hair. This reduces unrelated background detections without clipping belongings to the face.

Hair, beards and mustaches receive importance 230 throughout their region and recognition protection along their inner boundary. This preserves hairstyle shape and prioritizes the mass without treating every hair pixel as a separate critical feature. Accessories receive recognition protection throughout their mask, preserving small details through posterization, brush filtering and the final recognition stroke pass. Extra face palette shades still sample only the original face/head mask. Palette reports separate hair and accessory mask counts, which can overlap between categories. The API also exposes `humanDetections` for diagnostics. Segmentation quality depends on the photograph; supported categories are not a promise that every item will be detected.

Version 5 real-image verification on this machine: the man portrait detected hair and mustache; the woman portrait detected hair, hair accessories, an earring and a necklace; the family photograph detected three hair masks, beard/mustache and several accessory masks. Recognition overlays were visually checked on both individual portraits. Warm human analyses took 8.00–8.86 seconds; the animal-only cat took 3.14 seconds and returned no human masks. The first request including model loading took 115.46 seconds. Whole-device GPU sampling every second peaked at 6021 MiB of 8192 MiB. Counts are model detections, not ground-truth annotations; glasses, scarves and pipes are covered by prompt/association tests but were absent from these portrait references. Raw results and the diagnostic overlay are in ignored `artifacts/sam3/human-verification.json` and `human-protection.png`. All 156 core tests, 30 UI tests, five Python service tests, TypeScript checking and the production build passed.
