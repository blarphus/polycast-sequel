"""
Benchmark a downloaded sentence-transformers WSD model against a saved sample file.

Usage:
  python benchmarkLocalWsdModel.py --sample-path /tmp/wsd-sample-100.json
  python benchmarkLocalWsdModel.py --sample-path /tmp/wsd-sample-100.json --model-dir /tmp/kaggle-wsd-latest/polycast-sense-picker-finetuned
"""

import argparse
import json
import os
import statistics
import time
from pathlib import Path

import numpy as np
import torch
from sentence_transformers import SentenceTransformer


REQUIRED_LANGUAGES = ['en', 'es', 'pt', 'fr', 'de']


def format_query(sample):
    return f"{sample['sentence']}\nTarget word: {sample['word']}"


def format_percent(numerator, denominator):
    if denominator == 0:
      return '0.0%'
    return f'{(numerator / denominator) * 100:.1f}%'


def detect_device():
    if torch.backends.mps.is_available():
        return 'mps'
    if torch.cuda.is_available():
        return 'cuda'
    return 'cpu'


def load_samples(sample_path):
    payload = json.loads(Path(sample_path).read_text())
    samples = payload.get('samples')
    if not isinstance(samples, list):
        raise ValueError(f'Saved sample file is missing a "samples" array: {sample_path}')
    return samples


def benchmark_sample(model, sample):
    started_at = time.time()
    texts = [format_query(sample), *sample['glosses']]
    embeddings = model.encode(
        texts,
        normalize_embeddings=True,
        show_progress_bar=False,
        convert_to_numpy=True,
    )
    sentence_embedding = embeddings[0]
    gloss_embeddings = embeddings[1:]
    similarities = gloss_embeddings @ sentence_embedding
    predicted_index = int(np.argmax(similarities))
    latency_ms = int((time.time() - started_at) * 1000)

    return {
        'predicted_index': predicted_index,
        'correct': predicted_index == sample['correct_index'],
        'latency_ms': latency_ms,
    }


def print_summary(results, sample_path, model_dir, device, max_errors_shown):
    overall_correct = sum(1 for result in results if result['correct'])
    latencies = [result['latency_ms'] for result in results]

    print('\nLocal WSD Model Benchmark')
    print(f'Sample path: {Path(sample_path).resolve()}')
    print(f'Model dir: {Path(model_dir).resolve()}')
    print(f'Device: {device}')
    print(f'Questions: {len(results)}')
    print(f'Overall accuracy: {overall_correct}/{len(results)} = {format_percent(overall_correct, len(results))}')
    print(f'Average latency: {statistics.mean(latencies):.0f} ms')
    print(f'Median latency: {statistics.median(latencies):.0f} ms')

    print('\nPer-language accuracy:')
    for lang in REQUIRED_LANGUAGES:
        lang_results = [result for result in results if result['sample']['lang'] == lang]
        correct = sum(1 for result in lang_results if result['correct'])
        print(f'  {lang}: {correct}/{len(lang_results)} = {format_percent(correct, len(lang_results))}')

    misses = [result for result in results if not result['correct']][:max_errors_shown]
    if misses:
        print(f'\nFirst {len(misses)} misses:')
        for result in misses:
            sample = result['sample']
            print(
                f'  [{sample["lang"]}] line {sample["sourceLine"]} "{sample["word"]}" '
                f'expected={sample["correct_index"]} predicted={result["predicted_index"]} latency={result["latency_ms"]}ms'
            )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sample-path', required=True)
    parser.add_argument('--model-dir', default='/tmp/kaggle-wsd-latest/polycast-sense-picker-finetuned')
    parser.add_argument('--max-errors-shown', type=int, default=10)
    args = parser.parse_args()

    sample_path = Path(args.sample_path).expanduser().resolve()
    model_dir = Path(args.model_dir).expanduser().resolve()
    if not sample_path.exists():
        raise FileNotFoundError(f'Sample file not found: {sample_path}')
    if not model_dir.exists():
        raise FileNotFoundError(f'Model directory not found: {model_dir}')

    device = detect_device()
    samples = load_samples(sample_path)

    print(f'Loading model from {model_dir} on {device}...')
    model = SentenceTransformer(str(model_dir), device=device)

    print(f'Loaded saved sample with {len(samples)} questions. Running local model evaluation...')
    results = []
    for index, sample in enumerate(samples, start=1):
        result = benchmark_sample(model, sample)
        results.append({'sample': sample, **result})
        if index % 10 == 0 or index == len(samples):
            correct = sum(1 for entry in results if entry['correct'])
            print(f'[{index}/{len(samples)}] accuracy={format_percent(correct, len(results))}')

    print_summary(results, sample_path, model_dir, device, args.max_errors_shown)


if __name__ == '__main__':
    main()
