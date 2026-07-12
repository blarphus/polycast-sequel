"""
Fine-tune a multilingual reranker for WSD using grouped listwise loss.

Usage:
  python trainWsdReranker.py --data-dir ~/Desktop/wiktionary-test
"""

import argparse
import os
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch.optim import AdamW
from torch.utils.data import DataLoader
from tqdm.auto import tqdm
from transformers import AutoModelForSequenceClassification, AutoTokenizer, get_linear_schedule_with_warmup

from wsdBenchmarkCommon import load_jsonl, resolve_device, resolve_model_source, write_results_json


def format_query(sample):
    return f"{sample['sentence']}\nTarget word: {sample['word']}"


def build_question_pairs(samples):
    query_texts = []
    gloss_texts = []
    question_slices = []

    for sample in samples:
        start = len(query_texts)
        query = format_query(sample)
        for gloss in sample["glosses"]:
            query_texts.append(query)
            gloss_texts.append(gloss)
        end = len(query_texts)
        question_slices.append(
            {"start": start, "end": end, "correct_index": sample["correct_index"]}
        )

    return query_texts, gloss_texts, question_slices


def tokenize_pairs(tokenizer, query_texts, gloss_texts, device, max_length):
    features = tokenizer(
        query_texts,
        gloss_texts,
        padding=True,
        truncation=True,
        max_length=max_length,
        return_tensors="pt",
    )
    return {name: value.to(device) for name, value in features.items()}


def compute_batch_loss(model, tokenizer, samples, device, max_length, amp_enabled):
    query_texts, gloss_texts, question_slices = build_question_pairs(samples)
    features = tokenize_pairs(tokenizer, query_texts, gloss_texts, device, max_length)
    with torch.autocast(device_type=device, dtype=torch.float16, enabled=amp_enabled):
        logits = model(**features).logits.squeeze(-1)

    losses = []
    for question in question_slices:
        question_logits = logits[question["start"] : question["end"]]
        target = torch.tensor([question["correct_index"]], device=device)
        losses.append(F.cross_entropy(question_logits.unsqueeze(0), target))

    return torch.stack(losses).mean()


def evaluate_wsd_accuracy(model, tokenizer, eval_samples, device, max_length, amp_enabled):
    correct = 0
    total = 0
    per_lang = {}
    model.eval()

    for sample in eval_samples:
        query = format_query(sample)
        features = tokenize_pairs(
            tokenizer,
            [query] * len(sample["glosses"]),
            sample["glosses"],
            device,
            max_length,
        )

        with torch.no_grad():
            with torch.autocast(device_type=device, dtype=torch.float16, enabled=amp_enabled):
                logits = model(**features).logits.squeeze(-1)
        predicted = int(torch.argmax(logits).item())

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
        default=os.path.expanduser("~/Desktop/wiktionary-test/polycast-bge-reranker-finetuned"),
    )
    parser.add_argument("--base-model", default="BAAI/bge-reranker-v2-m3")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--question-batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--lr", type=float, default=1e-5)
    parser.add_argument("--max-length", type=int, default=192)
    parser.add_argument("--max-train-samples", type=int, default=None)
    parser.add_argument("--max-eval-samples", type=int, default=None)
    parser.add_argument("--model-work-dir", default="/tmp/wsd-model-cache")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--results-path", default=None)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    device = resolve_device(args.device)
    amp_enabled = device.startswith("cuda")
    print("RUN_MARKER: trainWsdReranker")
    print(f"Device: {device}")
    print(f"AMP enabled: {amp_enabled}")

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
    tokenizer = AutoTokenizer.from_pretrained(model_source)
    model = AutoModelForSequenceClassification.from_pretrained(model_source)
    if hasattr(model, "gradient_checkpointing_enable"):
        model.gradient_checkpointing_enable()
    model.to(device)
    scaler = torch.amp.GradScaler("cuda", enabled=amp_enabled)

    train_loader = DataLoader(
        train_samples,
        shuffle=True,
        batch_size=args.question_batch_size,
        collate_fn=lambda batch: batch,
    )

    print("\nStarting zero-shot evaluation...")
    baseline_metrics = evaluate_wsd_accuracy(
        model,
        tokenizer,
        eval_samples,
        device,
        args.max_length,
        amp_enabled,
    )

    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    total_optimizer_steps = max(1, (len(train_loader) * args.epochs + args.grad_accum - 1) // args.grad_accum)
    warmup_steps = int(total_optimizer_steps * 0.1)
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=warmup_steps,
        num_training_steps=total_optimizer_steps,
    )

    print(
        f"\nTraining for {args.epochs} epochs "
        f"({len(train_loader)} question batches/epoch, {warmup_steps} warmup steps)..."
    )
    model.train()
    started_at = time.time()
    epoch_losses = []
    for epoch in range(args.epochs):
        epoch_loss = 0.0
        optimizer.zero_grad(set_to_none=True)
        progress = tqdm(train_loader, desc=f"Epoch {epoch + 1}/{args.epochs}")

        for batch_index, batch in enumerate(progress, start=1):
            loss = compute_batch_loss(
                model,
                tokenizer,
                batch,
                device,
                args.max_length,
                amp_enabled,
            )
            loss_value = loss.item()
            epoch_loss += loss_value
            progress.set_postfix(loss=f"{loss_value:.4f}")

            scaler.scale(loss / args.grad_accum).backward()
            if batch_index % args.grad_accum == 0 or batch_index == len(train_loader):
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)

        average_loss = epoch_loss / len(train_loader)
        epoch_losses.append(average_loss)
        print(f"Epoch {epoch + 1} average loss: {average_loss:.4f}")

    elapsed = time.time() - started_at
    print(f"\nTraining finished in {elapsed:.0f}s ({elapsed / 60:.1f} min)")

    print("\nStarting post-training evaluation...")
    final_metrics = evaluate_wsd_accuracy(
        model,
        tokenizer,
        eval_samples,
        device,
        args.max_length,
        amp_enabled,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    print("\nSaving model...")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print("Model save complete")
    print(f"Model saved to {output_dir}")

    if args.results_path:
        payload = {
            "model_id": args.base_model,
            "resolved_model_source": model_source,
            "device": device,
            "epochs": args.epochs,
            "question_batch_size": args.question_batch_size,
            "grad_accum": args.grad_accum,
            "lr": args.lr,
            "max_length": args.max_length,
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
