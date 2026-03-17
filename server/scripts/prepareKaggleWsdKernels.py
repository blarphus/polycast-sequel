"""
Create three Kaggle kernel directories for the WSD model bakeoff.

Usage:
  python prepareKaggleWsdKernels.py
  python prepareKaggleWsdKernels.py --output-root /tmp/wsd-kernels
"""

import argparse
import json
import shutil
from pathlib import Path


KERNEL_SPECS = [
    {
        "slug": "polycast-wsd-qwen15b",
        "title": "Polycast WSD Qwen 1.5B",
        "script": "trainWsdQwenLoRA.py",
        "model_slug": "qwen2-5-1-5b-instruct-zip",
        "output_dir": "/kaggle/working/polycast-qwen15b-output",
        "results_path": "/kaggle/working/polycast-qwen15b-results.json",
        "dataset_sources": [
            "josh123benja/wsd-training-data",
            "josh123benja/qwen2-5-1-5b-instruct-zip",
        ],
    },
    {
        "slug": "polycast-wsd-reranker",
        "title": "Polycast WSD Reranker",
        "script": "trainWsdReranker.py",
        "model_slug": "bge-reranker-v2-m3-zip",
        "output_dir": "/kaggle/working/polycast-reranker-output",
        "results_path": "/kaggle/working/polycast-reranker-results.json",
        "dataset_sources": [
            "josh123benja/wsd-training-data",
            "josh123benja/bge-reranker-v2-m3-zip",
        ],
    },
    {
        "slug": "polycast-wsd-e5-small",
        "title": "Polycast WSD E5 Small",
        "script": "trainWsdBiEncoder.py",
        "model_slug": "multilingual-e5-small-zip",
        "output_dir": "/kaggle/working/polycast-e5-small-output",
        "results_path": "/kaggle/working/polycast-e5-small-results.json",
        "dataset_sources": [
            "josh123benja/wsd-training-data",
            "josh123benja/multilingual-e5-small-zip",
        ],
    },
]


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", default="josh123benja")
    parser.add_argument("--output-root", default="/tmp/wsd-kernels")
    return parser.parse_args()


def main():
    args = parse_args()
    script_dir = Path(__file__).resolve().parent
    output_root = Path(args.output_root).expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)

    prepared = []
    for spec in KERNEL_SPECS:
        kernel_dir = output_root / spec["slug"]
        kernel_dir.mkdir(parents=True, exist_ok=True)

        source_script = script_dir / spec["script"]
        entrypoint_source = source_script.read_text()
        helper_source = (script_dir / "wsdBenchmarkCommon.py").read_text()
        target_entrypoint = kernel_dir / "entrypoint.py"
        shutil.copyfile(source_script, target_entrypoint)

        # Include the shared helper alongside the training entrypoint.
        shutil.copyfile(script_dir / "wsdBenchmarkCommon.py", kernel_dir / "wsdBenchmarkCommon.py")

        wrapper = f"""from pathlib import Path
import subprocess
import sys

ENTRYPOINT_SOURCE = {entrypoint_source!r}
HELPER_SOURCE = {helper_source!r}


def find_model_source(slug_fragment):
    input_root = Path("/kaggle/input")
    direct_dir = input_root / slug_fragment
    if direct_dir.exists():
        return direct_dir
    for candidate in input_root.rglob("*.zip"):
        if slug_fragment in str(candidate):
            return candidate
    for candidate in input_root.iterdir():
        if slug_fragment in candidate.name:
            return candidate
    raise FileNotFoundError(f"Unable to find model source for {{slug_fragment}} under /kaggle/input")


DATA_DIR = Path("/kaggle/input/datasets/josh123benja/wsd-training-data")
if not DATA_DIR.exists():
    DATA_DIR = Path("/kaggle/input/wsd-training-data")

SCRIPT_DIR = Path("/kaggle/working/polycast-kernel-src")
SCRIPT_DIR.mkdir(parents=True, exist_ok=True)
(SCRIPT_DIR / "entrypoint.py").write_text(ENTRYPOINT_SOURCE)
(SCRIPT_DIR / "wsdBenchmarkCommon.py").write_text(HELPER_SOURCE)
MODEL_SOURCE = find_model_source("{spec['model_slug']}")
print("DATA_DIR:", DATA_DIR)
print("MODEL_SOURCE:", MODEL_SOURCE)
print("SCRIPT_DIR:", SCRIPT_DIR)

command = [
    sys.executable,
    str(SCRIPT_DIR / "entrypoint.py"),
    "--data-dir",
    str(DATA_DIR),
    "--base-model",
    str(MODEL_SOURCE),
    "--model-work-dir",
    "/kaggle/working/model-cache",
    "--output-dir",
    "{spec['output_dir']}",
    "--results-path",
    "{spec['results_path']}",
]
subprocess.check_call(command)
"""
        (kernel_dir / "train.py").write_text(wrapper)

        metadata = {
            "id": f"{args.username}/{spec['slug']}",
            "title": spec["title"],
            "code_file": "train.py",
            "language": "python",
            "kernel_type": "script",
            "is_private": True,
            "enable_gpu": "true",
            "enable_internet": "false",
            "dataset_sources": spec["dataset_sources"],
            "kernel_sources": [],
            "competition_sources": [],
        }

        metadata_path = kernel_dir / "kernel-metadata.json"
        metadata_path.write_text(f"{json.dumps(metadata, indent=2)}\n")
        prepared.append({"slug": spec["slug"], "path": str(kernel_dir)})

    print(json.dumps({"output_root": str(output_root), "kernels": prepared}, indent=2))


if __name__ == "__main__":
    main()
