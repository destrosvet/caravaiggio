"""Explicit download; requires previously approved Hugging Face access. Never accepts terms."""
from pathlib import Path
import sys
from huggingface_hub import hf_hub_download
from huggingface_hub.errors import GatedRepoError, HfHubHTTPError

try:
    path = hf_hub_download(
        repo_id="facebook/sam3",
        filename="sam3.pt",
        revision="3c879f39826c281e95690f02c7821c4de09afae7",
        local_dir=Path(__file__).resolve().parents[2] / "artifacts/sam3/models",
    )
    print("SAM 3 weights ready:", path)
except GatedRepoError:
    print("Approved Hugging Face access is required. Request access at https://huggingface.co/facebook/sam3 and log in with the Hugging Face CLI, or supply a local sam3.pt file.")
    sys.exit(2)
except HfHubHTTPError as error:
    print("Could not download SAM 3 weights. HTTP status:", error.response.status_code if error.response is not None else "unknown")
    sys.exit(2)
