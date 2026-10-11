param([string]$PythonExecutable = "python")
$ErrorActionPreference = "Stop"
$repoPath = (Resolve-Path (Join-Path $PSScriptRoot "../..")).Path
$venvPath = Join-Path $repoPath "artifacts/sam3/.venv"
New-Item -ItemType Directory -Force (Join-Path $repoPath "artifacts/sam3/models") | Out-Null
& $PythonExecutable -m venv $venvPath
if ($LASTEXITCODE -ne 0) { throw "Could not create the Python environment. Use Python 3.12 with -PythonExecutable PATH." }
$venvPython = Join-Path $venvPath "Scripts/python.exe"
& $venvPython -m pip install --upgrade pip "setuptools<81"
if ($LASTEXITCODE -ne 0) { throw "Could not prepare pip." }
& $venvPython -m pip install "torch==2.10.0" "torchvision==0.25.0" --index-url https://download.pytorch.org/whl/cu128
if ($LASTEXITCODE -ne 0) { throw "Could not install CUDA PyTorch." }
& $venvPython -m pip install "git+https://github.com/nusu-github/sam3-turing.git@080bec0b3a2f103787b6985c21bc51c9bb99aaa3" "Pillow>=10,<13" "einops>=0.8,<1" "decord>=0.6,<1" "hydra-core>=1.3,<2" "triton-windows==3.6.0.post26" "psutil>=5.9,<8" "pycocotools>=2.0.10,<3"
if ($LASTEXITCODE -ne 0) { throw "Could not install SAM 3." }
& $venvPython -c "import torch; from sam3.model_builder import build_sam3_image_model; from sam3.turing import apply_turing_patch, offload_text_encoder; print('CUDA available:', torch.cuda.is_available())"
if ($LASTEXITCODE -ne 0) { throw "SAM 3 dependency check failed." }
Write-Host "Dependencies installed. Put approved sam3.pt weights in artifacts/sam3/models, then run tools/sam3/start.ps1."
