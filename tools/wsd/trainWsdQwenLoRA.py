"""
Fine-tune Qwen2.5-1.5B-Instruct for WSD integer classification with LoRA.

Usage:
  python trainWsdQwenLoRA.py --data-dir ~/Desktop/wiktionary-test
"""

import argparse
import os
import time
from pathlib import Path

import torch
from torch.optim import AdamW
from torch.utils.data import DataLoader
from tqdm.auto import tqdm
from transformers import AutoModelForCausalLM, AutoTokenizer, get_linear_schedule_with_warmup

from wsdBenchmarkCommon import (
    build_sense_prompt,
    load_jsonl,
    parse_sense_index,
    resolve_device,
    resolve_model_source,
    write_results_json,
)


def build_training_example(tokenizer, sample, max_prompt_length, max_answer_length):
    prompt = build_sense_prompt(sample)
    prompt_ids = tokenizer.apply_chat_template(
        [{"role": "user", "content": prompt}],
        tokenize=True,
        add_generation_prompt=True,
    )
    prompt_ids = prompt_ids[:max_prompt_length]

    answer_ids = tokenizer(
        str(sample["correct_index"]),
        add_special_tokens=False,
        truncation=True,
        max_length=max_answer_length,
    ).input_ids
    answer_ids = answer_ids[:max_answer_length]
    answer_ids.append(tokenizer.eos_token_id)

    input_ids = prompt_ids + answer_ids
    labels = [-100] * len(prompt_ids) + answer_ids
    attention_mask = [1] * len(input_ids)
    return {"input_ids": input_ids, "labels": labels, "attention_mask": attention_mask}


def collate_training_examples(batch, pad_token_id):
    max_length = max(len(item["input_ids"]) for item in batch)
    input_ids = []
    attention_masks = []
    labels = []

    for item in batch:
        padding = max_length - len(item["input_ids"])
        input_ids.append(item["input_ids"] + [pad_token_id] * padding)
        attention_masks.append(item["attention_mask"] + [0] * padding)
        labels.append(item["labels"] + [-100] * padding)

    return {
        "input_ids": torch.tensor(input_ids, dtype=torch.long),
        "attention_mask": torch.tensor(attention_masks, dtype=torch.long),
        "labels": torch.tensor(labels, dtype=torch.long),
    }


def evaluate_wsd_accuracy(model, tokenizer, eval_samples, device):
    correct = 0
    total = 0
    invalid_outputs = 0
    per_lang = {}
    model.eval()

    for sample in eval_samples:
        prompt = build_sense_prompt(sample)
        encoded = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=True,
            add_generation_prompt=True,
            return_tensors="pt",
        )
        if hasattr(encoded, "input_ids"):
            prompt_ids = encoded["input_ids"]
            attention_mask = encoded.get("attention_mask")
        else:
            prompt_ids = encoded
            attention_mask = None
        if attention_mask is None:
            attention_mask = torch.ones_like(prompt_ids)
        prompt_ids = prompt_ids.to(device)
        attention_mask = attention_mask.to(device)

        with torch.no_grad():
            generated = model.generate(
                input_ids=prompt_ids,
                attention_mask=attention_mask,
                do_sample=False,
                temperature=None,
                top_p=None,
                max_new_tokens=4,
                pad_token_id=tokenizer.pad_token_id,
                eos_token_id=tokenizer.eos_token_id,
            )

        generated_tokens = generated[0, prompt_ids.shape[1] :]
        raw = tokenizer.decode(generated_tokens, skip_special_tokens=True).strip()
        parsed = parse_sense_index(raw, len(sample["glosses"]))
        predicted = parsed["parsed"] if parsed["valid"] else None

        lang_stats = per_lang.setdefault(sample["lang"], {"correct": 0, "total": 0})
        lang_stats["total"] += 1
        total += 1
        if not parsed["valid"]:
            invalid_outputs += 1
        elif predicted == sample["correct_index"]:
            correct += 1
            lang_stats["correct"] += 1

    accuracy = (correct / total) if total else 0
    print(f"\n  Overall: {correct}/{total} = {accuracy:.1%}")
    print(f"  Invalid outputs: {invalid_outputs}/{total} = {(invalid_outputs / total):.1%}")
    for lang in sorted(per_lang):
        lang_correct = per_lang[lang]["correct"]
        lang_total = per_lang[lang]["total"]
        print(f"  {lang}: {lang_correct}/{lang_total} = {lang_correct / lang_total:.1%}")

    return {
        "correct": correct,
        "total": total,
        "accuracy": accuracy,
        "invalid_outputs": invalid_outputs,
        "per_lang": per_lang,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", default=os.path.expanduser("~/Desktop/wiktionary-test"))
    parser.add_argument(
        "--output-dir",
        default=os.path.expanduser("~/Desktop/wiktionary-test/polycast-qwen15b-lora"),
    )
    parser.add_argument("--base-model", default="Qwen/Qwen2.5-1.5B-Instruct")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--micro-batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=16)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--max-prompt-length", type=int, default=768)
    parser.add_argument("--max-answer-length", type=int, default=4)
    parser.add_argument("--lora-r", type=int, default=16)
    parser.add_argument("--lora-alpha", type=int, default=32)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    parser.add_argument("--max-train-samples", type=int, default=None)
    parser.add_argument("--max-eval-samples", type=int, default=None)
    parser.add_argument("--model-work-dir", default="/tmp/wsd-model-cache")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--results-path", default=None)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)
    device = resolve_device(args.device)
    torch_dtype = torch.float16 if device in {"cuda", "mps"} else torch.float32
    print("RUN_MARKER: trainWsdQwenLoRA")
    print(f"Device: {device}")

    try:
        from peft import LoraConfig, get_peft_model
    except ImportError as exc:  # pragma: no cover - explicit startup failure path
        raise RuntimeError(
            "peft is required for trainWsdQwenLoRA.py. Install it before running this script."
        ) from exc

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
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token

    base_model = AutoModelForCausalLM.from_pretrained(
        model_source,
        torch_dtype=torch_dtype,
        low_cpu_mem_usage=True,
    )
    base_model.config.use_cache = False
    base_model.gradient_checkpointing_enable()

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        target_modules=[
            "q_proj",
            "k_proj",
            "v_proj",
            "o_proj",
            "gate_proj",
            "up_proj",
            "down_proj",
        ],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(base_model, lora_config)
    model.to(device)
    model.print_trainable_parameters()

    train_examples = [
        build_training_example(tokenizer, sample, args.max_prompt_length, args.max_answer_length)
        for sample in train_samples
    ]
    train_loader = DataLoader(
        train_examples,
        shuffle=True,
        batch_size=args.micro_batch_size,
        collate_fn=lambda batch: collate_training_examples(batch, tokenizer.pad_token_id),
    )

    print("\nStarting zero-shot evaluation...")
    baseline_metrics = evaluate_wsd_accuracy(model, tokenizer, eval_samples, device)

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
        f"({len(train_loader)} micro-batches/epoch, {warmup_steps} warmup steps)..."
    )
    started_at = time.time()
    epoch_losses = []
    optimizer.zero_grad(set_to_none=True)
    for epoch in range(args.epochs):
        model.train()
        epoch_loss = 0.0
        progress = tqdm(train_loader, desc=f"Epoch {epoch + 1}/{args.epochs}")
        for batch_index, batch in enumerate(progress, start=1):
            batch = {name: value.to(device) for name, value in batch.items()}
            outputs = model(**batch)
            loss = outputs.loss
            loss_value = loss.item()
            epoch_loss += loss_value
            progress.set_postfix(loss=f"{loss_value:.4f}")

            (loss / args.grad_accum).backward()
            if batch_index % args.grad_accum == 0 or batch_index == len(train_loader):
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad(set_to_none=True)

        average_loss = epoch_loss / len(train_loader)
        epoch_losses.append(average_loss)
        print(f"Epoch {epoch + 1} average loss: {average_loss:.4f}")

    elapsed = time.time() - started_at
    print(f"\nTraining finished in {elapsed:.0f}s ({elapsed / 60:.1f} min)")

    print("\nStarting post-training evaluation...")
    final_metrics = evaluate_wsd_accuracy(model, tokenizer, eval_samples, device)

    output_dir.mkdir(parents=True, exist_ok=True)
    print("\nSaving model...")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    print("Model save complete")
    print(f"Adapter saved to {output_dir}")

    if args.results_path:
        payload = {
            "model_id": args.base_model,
            "resolved_model_source": model_source,
            "device": device,
            "epochs": args.epochs,
            "micro_batch_size": args.micro_batch_size,
            "grad_accum": args.grad_accum,
            "lr": args.lr,
            "max_prompt_length": args.max_prompt_length,
            "max_answer_length": args.max_answer_length,
            "lora_r": args.lora_r,
            "lora_alpha": args.lora_alpha,
            "lora_dropout": args.lora_dropout,
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
