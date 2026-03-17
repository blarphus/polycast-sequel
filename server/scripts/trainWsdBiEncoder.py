"""
Fine-tune a multilingual bi-encoder for WSD listwise ranking.

Usage:
  python trainWsdBiEncoder.py --data-dir ~/Desktop/wiktionary-test
"""

import argparse
import json
import os
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from sentence_transformers import SentenceTransformer
from torch.optim import AdamW
from torch.utils.data import DataLoader
from tqdm.auto import tqdm
from transformers import get_linear_schedule_with_warmup

from wsdBenchmarkCommon import load_jsonl, resolve_device, resolve_model_source, write_results_json


def format_query(sample):
    return f"query: {sample['sentence']}\nTarget word: {sample['word']}"


def format_gloss(gloss):
    return f"passage: {gloss}"


def move_features_to_device(features, device):
    return {name: value.to(device) for name, value in features.items()}


def build_question_texts(samples):
    texts = []
    question_slices = []

    for sample in samples:
        query_index = len(texts)
        texts.append(format_query(sample))

        gloss_start = len(texts)
        texts.extend(format_gloss(gloss) for gloss in sample["glosses"])
        gloss_end = len(texts)

        question_slices.append(
            {
                "query_index": query_index,
                "gloss_start": gloss_start,
                "gloss_end": gloss_end,
                "correct_index": sample["correct_index"],
            }
        )

    return texts, question_slices


def compute_batch_loss(model, samples, device, temperature):
    texts, question_slices = build_question_texts(samples)
    features = move_features_to_device(model.tokenize(texts), device)
    outputs = model(features)
    embeddings = F.normalize(outputs["sentence_embedding"], p=2, dim=1)

    losses = []
    for question in question_slices:
        query_embedding = embeddings[question["query_index"]]
        gloss_embeddings = embeddings[question["gloss_start"] : question["gloss_end"]]
        logits = torch.matmul(gloss_embeddings, query_embedding) / temperature
        target = torch.tensor([question["correct_index"]], device=device)
        losses.append(F.cross_entropy(logits.unsqueeze(0), target))

    return torch.stack(losses).mean()


def evaluate_wsd_accuracy(model, eval_samples):
    correct = 0
    total = 0
    per_lang = {}

    for sample in eval_samples:
        query = format_query(sample)
        glosses = [format_gloss(gloss) for gloss in sample["glosses"]]
        embeddings = model.encode(
            [query, *glosses],
            normalize_embeddings=True,
            show_progress_bar=False,
            convert_to_numpy=True,
        )
        similarities = embeddings[1:] @ embeddings[0]
        predicted = int(np.argmax(similarities))

        lang_stats = per_lang.setdefault(sample["lang"], {"correct": 0, "total": 0})
        lang_stats["total"] += 1
        total += 1
        if predicted == sample["correct_index"]:
            correct += 1
            lang_stats["correct"] += 1

    accuracy = (correct / total) if total else 0
    print(f"\n  Overall: {correct}/{total} = {accuracy:.1%}")
    for lang in sorted(per_lang):
        lang_correct = per_lang[lang]["correct"]
        lang_total = per_lang[lang]["total"]
        print(f"  {lang}: {lang_correct}/{lang_total} = {lang_correct / lang_total:.1%}")

    return {"correct": correct, "total": total, "accuracy": accuracy, "per_lang": per_lang}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=os.path.expanduser("~/Desktop/wiktionary-test"))
    parser.add_argument(
        "--output-dir",
        default=os.path.expanduser("~/Desktop/wiktionary-test/polycast-e5-small-finetuned"),
    )
    parser.add_argument("--base-model", default="intfloat/multilingual-e5-small")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=24)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--max-seq-length", type=int, default=128)
    parser.add_argument("--temperature", type=float, default=0.05)
    parser.add_argument("--max-train-samples", type=int, default=None)
    parser.add_argument("--max-eval-samples", type=int, default=None)
    parser.add_argument("--model-work-dir", default="/tmp/wsd-model-cache")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--results-path", default=None)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    device = resolve_device(args.device)
    print("RUN_MARKER: trainWsdBiEncoder")
    print(f"Device: {device}")

    train_samples = load_jsonl(data_dir / "wsd-train.jsonl")
    eval_samples = load_jsonl(data_dir / "wsd-eval.jsonl")
    if args.max_train_samples is not None:
        train_samples = train_samples[: args.max_train_samples]
    if args.max_eval_samples is not None:
        eval_samples = eval_samples[: args.max_eval_samples]
    print(f"Train samples: {len(train_samples)}")
    print(f"Eval samples: {len(eval_samples)}")

    model_source = resolve_model_source(args.base_model, args.model_work_dir)
    print(f"Data dir: {data_dir}")
    print(f"Model source: {model_source}")
    print(f"Output dir: {output_dir}")
    model = SentenceTransformer(model_source, device=device)
    model.max_seq_length = args.max_seq_length

    train_loader = DataLoader(
        train_samples,
        shuffle=True,
        batch_size=args.batch_size,
        collate_fn=lambda batch: batch,
    )

    print("\nStarting zero-shot evaluation...")
    baseline_metrics = evaluate_wsd_accuracy(model, eval_samples)

    warmup_steps = int(len(train_loader) * args.epochs * 0.1)
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=warmup_steps,
        num_training_steps=len(train_loader) * args.epochs,
    )

    print(
        f"\nTraining for {args.epochs} epochs "
        f"({len(train_loader)} steps/epoch, {warmup_steps} warmup steps)..."
    )
    model.train()
    started_at = time.time()
    epoch_losses = []
    for epoch in range(args.epochs):
        epoch_loss = 0.0
        progress = tqdm(train_loader, desc=f"Epoch {epoch + 1}/{args.epochs}")

        for batch in progress:
            optimizer.zero_grad(set_to_none=True)
            loss = compute_batch_loss(model, batch, device, args.temperature)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            scheduler.step()

            loss_value = loss.item()
            epoch_loss += loss_value
            progress.set_postfix(loss=f"{loss_value:.4f}")

        average_loss = epoch_loss / len(train_loader)
        epoch_losses.append(average_loss)
        print(f"Epoch {epoch + 1} average loss: {average_loss:.4f}")

    elapsed = time.time() - started_at
    print(f"\nTraining finished in {elapsed:.0f}s ({elapsed / 60:.1f} min)")

    print("\nStarting post-training evaluation...")
    model.eval()
    final_metrics = evaluate_wsd_accuracy(model, eval_samples)

    output_dir.mkdir(parents=True, exist_ok=True)
    print("\nSaving model...")
    model.save(str(output_dir))
    print("Model save complete")
    print(f"Model saved to {output_dir}")

    if args.results_path:
        payload = {
            "model_id": args.base_model,
            "resolved_model_source": model_source,
            "device": device,
            "epochs": args.epochs,
            "batch_size": args.batch_size,
            "lr": args.lr,
            "temperature": args.temperature,
            "max_seq_length": args.max_seq_length,
            "epoch_losses": epoch_losses,
            "training_seconds": elapsed,
            "baseline": baseline_metrics,
            "final": final_metrics,
            "output_dir": str(output_dir.resolve()),
        }
        write_results_json(args.results_path, payload)
        print(f"Results written to {Path(args.results_path).expanduser().resolve()}")


if __name__ == "__main__":
    main()
