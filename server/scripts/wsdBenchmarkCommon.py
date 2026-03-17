import json
import os
import statistics
import zipfile
from pathlib import Path

import torch


REQUIRED_LANGUAGES = ["en", "es", "pt", "fr", "de"]
DEFAULT_SAMPLE_PATH = Path("/tmp/wsd-sample-100.json")


def detect_device():
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def resolve_device(requested_device):
    if requested_device == "auto":
        return detect_device()
    if requested_device == "mps" and not torch.backends.mps.is_available():
        raise RuntimeError("Requested device=mps, but MPS is not available")
    if requested_device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("Requested device=cuda, but CUDA is not available")
    if requested_device not in {"cpu", "cuda", "mps"}:
        raise RuntimeError(f"Unsupported device: {requested_device}")
    return requested_device


def load_jsonl(path):
    rows = []
    with open(path, "r") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_saved_sample(sample_path):
    sample_path = Path(sample_path).expanduser().resolve()
    if not sample_path.exists():
        raise FileNotFoundError(f"Saved sample file not found: {sample_path}")

    payload = json.loads(sample_path.read_text())
    samples = payload.get("samples")
    if not isinstance(samples, list):
        raise ValueError(f'Saved sample file is missing a "samples" array: {sample_path}')

    return samples


def build_sense_prompt(sample):
    senses = []
    for index, gloss in enumerate(sample["glosses"]):
        separator = gloss.find(":")
        if separator == -1:
            pos = "unknown"
            definition = gloss.strip()
        else:
            pos = gloss[:separator].strip()
            definition = gloss[separator + 1 :].strip()
        senses.append(f"{index}: [{pos}] {definition}")

    return (
        f'The word "{sample["word"]}" appears in: "{sample["sentence"]}" ({sample["lang"]}).\n'
        "Pick the sense index that best matches. Return ONLY the integer.\n"
        + "\n".join(senses)
    )


def parse_sense_index(raw, sense_count):
    trimmed = raw.strip()
    if not trimmed or not trimmed.lstrip("-").isdigit():
        return {"valid": False, "parsed": None}

    parsed = int(trimmed, 10)
    if parsed < 0 or parsed >= sense_count:
        return {"valid": False, "parsed": parsed}

    return {"valid": True, "parsed": parsed}


def format_percent(numerator, denominator):
    if denominator == 0:
        return "0.0%"
    return f"{(numerator / denominator) * 100:.1f}%"


def mean(values):
    return 0 if not values else statistics.mean(values)


def median(values):
    return 0 if not values else statistics.median(values)


def summarize_results(results):
    overall_correct = sum(1 for result in results if result["correct"])
    invalid_outputs = sum(1 for result in results if result.get("invalid_output"))
    latencies = [result["latency_ms"] for result in results]

    per_lang = {}
    for lang in REQUIRED_LANGUAGES:
        lang_results = [result for result in results if result["sample"]["lang"] == lang]
        correct = sum(1 for result in lang_results if result["correct"])
        per_lang[lang] = {
            "correct": correct,
            "total": len(lang_results),
            "accuracy": (correct / len(lang_results)) if lang_results else 0,
        }

    return {
        "total": len(results),
        "correct": overall_correct,
        "accuracy": (overall_correct / len(results)) if results else 0,
        "invalid_outputs": invalid_outputs,
        "avg_latency_ms": mean(latencies),
        "median_latency_ms": median(latencies),
        "per_lang": per_lang,
    }


def print_results_summary(title, results, max_errors_shown):
    summary = summarize_results(results)
    print(f"\n{title}")
    print(
        f"Overall accuracy: {summary['correct']}/{summary['total']} = "
        f"{format_percent(summary['correct'], summary['total'])}"
    )
    print(
        f"Invalid outputs: {summary['invalid_outputs']}/{summary['total']} = "
        f"{format_percent(summary['invalid_outputs'], summary['total'])}"
    )
    print(f"Average latency: {summary['avg_latency_ms']:.0f} ms")
    print(f"Median latency: {summary['median_latency_ms']:.0f} ms")

    print("\nPer-language accuracy:")
    for lang in REQUIRED_LANGUAGES:
        lang_summary = summary["per_lang"][lang]
        print(
            f"  {lang}: {lang_summary['correct']}/{lang_summary['total']} = "
            f"{format_percent(lang_summary['correct'], lang_summary['total'])}"
        )

    misses = [result for result in results if not result["correct"]][:max_errors_shown]
    if misses:
        print(f"\nFirst {len(misses)} misses:")
        for result in misses:
            sample = result["sample"]
            predicted = result.get("predicted_index")
            if result.get("invalid_output"):
                predicted = f"INVALID ({json.dumps((result.get('raw') or '').strip())})"
            print(
                f'  [{sample["lang"]}] line {sample.get("sourceLine", "?")} "{sample["word"]}" '
                f'expected={sample["correct_index"]} predicted={predicted} latency={result["latency_ms"]}ms'
            )


def write_results_json(output_path, payload):
    output_path = Path(output_path).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(payload, indent=2)}\n")


def resolve_model_source(model_source, extract_root=None):
    candidate = Path(model_source).expanduser()
    if not candidate.exists():
        return model_source

    candidate = candidate.resolve()
    if candidate.is_dir():
        return str(candidate)

    if candidate.is_file() and candidate.suffix.lower() == ".zip":
        if extract_root is None:
            extract_root = candidate.parent / ".unzipped-models"
        extract_root = Path(extract_root).expanduser().resolve()
        target_dir = extract_root / candidate.stem
        if not target_dir.exists():
            target_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(candidate) as archive:
                archive.extractall(target_dir)
        return str(target_dir)

    return str(candidate)
