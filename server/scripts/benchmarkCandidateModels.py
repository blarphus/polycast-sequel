"""
Benchmark three candidate local WSD models on a fixed saved sample.

Usage:
  python benchmarkCandidateModels.py
  python benchmarkCandidateModels.py --models qwen,bge,e5 --sample-path /tmp/wsd-sample-100.json
"""

import argparse
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer
from transformers import AutoModelForCausalLM, AutoModelForSequenceClassification, AutoTokenizer

from wsdBenchmarkCommon import (
    DEFAULT_SAMPLE_PATH,
    build_sense_prompt,
    load_saved_sample,
    parse_sense_index,
    print_results_summary,
    resolve_model_source,
    resolve_device,
    summarize_results,
    write_results_json,
)


MODEL_SPECS = {
    "qwen": {
        "model_id": "Qwen/Qwen2.5-1.5B-Instruct",
        "label": "Qwen2.5-1.5B-Instruct",
    },
    "bge": {
        "model_id": "BAAI/bge-reranker-v2-m3",
        "label": "bge-reranker-v2-m3",
    },
    "e5": {
        "model_id": "intfloat/multilingual-e5-small",
        "label": "multilingual-e5-small",
    },
}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--sample-path", default=str(DEFAULT_SAMPLE_PATH))
    parser.add_argument("--models", default="qwen,bge,e5")
    parser.add_argument("--max-errors-shown", type=int, default=10)
    parser.add_argument("--output-path", default=None)
    parser.add_argument("--model-work-dir", default="/tmp/wsd-model-cache")
    parser.add_argument("--device", default="auto")
    return parser.parse_args()


def dtype_for_device(device):
    return torch.float16 if device in {"cuda", "mps"} else torch.float32


def build_qwen_runner(model_id, device, model_work_dir):
    model_source = resolve_model_source(model_id, model_work_dir)
    torch_dtype = dtype_for_device(device)
    tokenizer = AutoTokenizer.from_pretrained(model_source)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    model = AutoModelForCausalLM.from_pretrained(
        model_source,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
    )
    model.to(device)
    model.eval()

    def normalize_chat_encoding(sample):
        prompt = build_sense_prompt(sample)
        messages = [{"role": "user", "content": prompt}]
        encoded = tokenizer.apply_chat_template(
            messages,
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        )
        if hasattr(encoded, "input_ids"):
            input_ids = encoded["input_ids"]
            attention_mask = encoded.get("attention_mask")
        else:
            input_ids = encoded
            attention_mask = None
        if attention_mask is None:
            attention_mask = torch.ones_like(input_ids)
        return input_ids.to(device), attention_mask.to(device)

    def run_sample(sample):
        input_ids, attention_mask = normalize_chat_encoding(sample)

        started_at = time.time()
        with torch.no_grad():
            generated = model.generate(
                input_ids=input_ids,
                attention_mask=attention_mask,
                do_sample=False,
                temperature=None,
                top_p=None,
                max_new_tokens=4,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )

        generated_tokens = generated[0, input_ids.shape[1] :]
        raw = tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()
        parsed = parse_sense_index(raw, len(sample["glosses"]))
        predicted_index = parsed["parsed"] if parsed["valid"] else None
        latency_ms = int((time.time() - started_at) * 1000)
        return {
            "latency_ms": latency_ms,
            "raw": raw,
            "predicted_index": predicted_index,
            "invalid_output": not parsed["valid"],
            "correct": parsed["valid"] and predicted_index == sample["correct_index"],
        }

    return run_sample


def build_bge_runner(model_id, device, model_work_dir):
    model_source = resolve_model_source(model_id, model_work_dir)
    tokenizer = AutoTokenizer.from_pretrained(model_source)
    model = AutoModelForSequenceClassification.from_pretrained(model_source)
    model.to(device)
    model.eval()

    def run_sample(sample):
        query = f"{sample['sentence']}\nTarget word: {sample['word']}"
        queries = [query] * len(sample["glosses"])
        started_at = time.time()
        features = tokenizer(
            queries,
            sample["glosses"],
            padding=True,
            truncation=True,
            max_length=256,
            return_tensors="pt",
        )
        features = {name: value.to(device) for name, value in features.items()}
        with torch.no_grad():
            logits = model(**features).logits.squeeze(-1)
        predicted_index = int(torch.argmax(logits).item())
        latency_ms = int((time.time() - started_at) * 1000)
        return {
            "latency_ms": latency_ms,
            "raw": str(predicted_index),
            "predicted_index": predicted_index,
            "invalid_output": False,
            "correct": predicted_index == sample["correct_index"],
        }

    return run_sample


def build_e5_runner(model_id, device, model_work_dir):
    model_source = resolve_model_source(model_id, model_work_dir)
    model = SentenceTransformer(model_source, device=device)

    def run_sample(sample):
        query = f"query: {sample['sentence']}\nTarget word: {sample['word']}"
        glosses = [f"passage: {gloss}" for gloss in sample["glosses"]]
        started_at = time.time()
        embeddings = model.encode(
            [query, *glosses],
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        similarities = embeddings[1:] @ embeddings[0]
        predicted_index = int(np.argmax(similarities))
        latency_ms = int((time.time() - started_at) * 1000)
        return {
            "latency_ms": latency_ms,
            "raw": str(predicted_index),
            "predicted_index": predicted_index,
            "invalid_output": False,
            "correct": predicted_index == sample["correct_index"],
        }

    return run_sample


def build_runner(model_key, device, model_work_dir):
    spec = MODEL_SPECS[model_key]
    if model_key == "qwen":
        return build_qwen_runner(spec["model_id"], device, model_work_dir)
    if model_key == "bge":
        return build_bge_runner(spec["model_id"], device, model_work_dir)
    if model_key == "e5":
        return build_e5_runner(spec["model_id"], device, model_work_dir)
    raise ValueError(f"Unsupported model key: {model_key}")


def main():
    args = parse_args()
    device = resolve_device(args.device)
    sample_path = Path(args.sample_path).expanduser().resolve()
    samples = load_saved_sample(sample_path)
    model_keys = [key.strip() for key in args.models.split(",") if key.strip()]

    invalid_keys = [key for key in model_keys if key not in MODEL_SPECS]
    if invalid_keys:
        raise ValueError(f"Unsupported model key(s): {', '.join(invalid_keys)}")

    payload = {
        "sample_path": str(sample_path),
        "device": device,
        "models": {},
    }

    print(f"Loaded saved sample with {len(samples)} questions from {sample_path}.")
    print(f"Device: {device}")

    for model_key in model_keys:
        spec = MODEL_SPECS[model_key]
        print(f"\nLoading {spec['label']} ({spec['model_id']})...")
        runner = build_runner(model_key, device, args.model_work_dir)
        results = []
        for index, sample in enumerate(samples, start=1):
            result = runner(sample)
            results.append({"sample": sample, **result})
            if index % 10 == 0 or index == len(samples):
                summary = summarize_results(results)
                print(
                    f"[{spec['label']}] {index}/{len(samples)} "
                    f"accuracy={(summary['accuracy'] * 100):.1f}% "
                    f"avg_latency={summary['avg_latency_ms']:.0f}ms"
                )

        print_results_summary(spec["label"], results, args.max_errors_shown)
        payload["models"][model_key] = {
            "model_id": spec["model_id"],
            "summary": summarize_results(results),
            "results": results,
        }

    if args.output_path:
        write_results_json(args.output_path, payload)
        print(f"\nWrote benchmark results to {Path(args.output_path).expanduser().resolve()}")


if __name__ == "__main__":
    main()
