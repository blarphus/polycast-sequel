"""
Fine-tune paraphrase-multilingual-MiniLM-L12-v2 for Word Sense Disambiguation.

Training examples:
  query = sentence_with_lang_prefix + target word
  candidates = all candidate glosses for that word in that sentence
Loss:
  cross-entropy over the full candidate set for each WSD question

Usage:
  python trainWsdModel.py [--data-dir ~/Desktop/wiktionary-test] [--epochs 3] [--batch-size 64]
"""

import json
import argparse
import os
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from sentence_transformers import SentenceTransformer
from torch.utils.data import DataLoader
from torch.optim import AdamW
from tqdm.auto import tqdm
from transformers import get_linear_schedule_with_warmup


def load_jsonl(path):
    samples = []
    with open(path, 'r') as f:
        for line in f:
            line = line.strip()
            if line:
                samples.append(json.loads(line))
    return samples


def format_query(sample):
    """Match the real task: pick the right gloss for this target word in this sentence."""
    return f"{sample['sentence']}\nTarget word: {sample['word']}"


def move_features_to_device(features, device):
    return {name: value.to(device) for name, value in features.items()}


def build_question_texts(samples):
    texts = []
    question_slices = []

    for sample in samples:
        query_index = len(texts)
        texts.append(format_query(sample))

        gloss_start = len(texts)
        texts.extend(sample['glosses'])
        gloss_end = len(texts)

        question_slices.append({
            'query_index': query_index,
            'gloss_start': gloss_start,
            'gloss_end': gloss_end,
            'correct_index': sample['correct_index'],
        })

    return texts, question_slices


def compute_batch_loss(model, samples, device, temperature):
    texts, question_slices = build_question_texts(samples)
    features = move_features_to_device(model.tokenize(texts), device)
    outputs = model(features)
    embeddings = F.normalize(outputs['sentence_embedding'], p=2, dim=1)

    losses = []
    for question in question_slices:
        query_embedding = embeddings[question['query_index']]
        gloss_embeddings = embeddings[question['gloss_start']:question['gloss_end']]
        logits = torch.matmul(gloss_embeddings, query_embedding) / temperature
        target = torch.tensor([question['correct_index']], device=device)
        losses.append(F.cross_entropy(logits.unsqueeze(0), target))

    return torch.stack(losses).mean()


def evaluate_wsd_accuracy(model, eval_samples):
    """Compute WSD accuracy: encode sentence + all glosses, pick highest cosine sim."""
    correct = 0
    total = 0
    per_lang = {}

    for s in eval_samples:
        sentence = format_query(s)
        glosses = s['glosses']
        expected = s['correct_index']
        lang = s['lang']

        if lang not in per_lang:
            per_lang[lang] = {'correct': 0, 'total': 0}

        # Encode sentence and all glosses
        all_texts = [sentence] + glosses
        embeddings = model.encode(all_texts, normalize_embeddings=True, show_progress_bar=False)

        # Cosine similarity (embeddings are normalized, so dot product = cosine)
        sentence_emb = embeddings[0]
        similarities = [np.dot(sentence_emb, embeddings[i + 1]) for i in range(len(glosses))]
        predicted = int(np.argmax(similarities))

        if predicted == expected:
            correct += 1
            per_lang[lang]['correct'] += 1

        total += 1
        per_lang[lang]['total'] += 1

    overall = correct / total if total > 0 else 0
    print(f"\n  Overall WSD accuracy: {correct}/{total} = {overall:.1%}")
    for lang in sorted(per_lang.keys()):
        lc = per_lang[lang]['correct']
        lt = per_lang[lang]['total']
        print(f"  {lang}: {lc}/{lt} = {lc/lt:.1%}")

    return overall


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data-dir', default=os.path.expanduser('~/Desktop/wiktionary-test'))
    parser.add_argument('--output-dir', default=os.path.expanduser('~/Desktop/wiktionary-test/polycast-sense-picker-finetuned'))
    parser.add_argument('--base-model', default='sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')
    parser.add_argument('--epochs', type=int, default=3)
    parser.add_argument('--batch-size', type=int, default=24)
    parser.add_argument('--lr', type=float, default=2e-5)
    parser.add_argument('--max-seq-length', type=int, default=128)
    parser.add_argument('--temperature', type=float, default=0.05)
    parser.add_argument('--max-train-samples', type=int, default=None)
    parser.add_argument('--max-eval-samples', type=int, default=None)
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    output_dir = Path(args.output_dir)

    # Detect device
    if torch.backends.mps.is_available():
        device = 'mps'
    elif torch.cuda.is_available():
        device = 'cuda'
    else:
        device = 'cpu'
    print(f"Device: {device}")

    # Load data
    print("Loading training data...")
    train_samples = load_jsonl(data_dir / 'wsd-train.jsonl')
    eval_samples = load_jsonl(data_dir / 'wsd-eval.jsonl')
    if args.max_train_samples is not None:
        train_samples = train_samples[:args.max_train_samples]
    if args.max_eval_samples is not None:
        eval_samples = eval_samples[:args.max_eval_samples]
    print(f"  Train: {len(train_samples)}, Eval: {len(eval_samples)}")

    # Load model
    print(f"Loading base model: {args.base_model}")
    model = SentenceTransformer(args.base_model, device=device)
    model.max_seq_length = args.max_seq_length

    train_dataloader = DataLoader(
        train_samples,
        shuffle=True,
        batch_size=args.batch_size,
        collate_fn=lambda batch: batch,
    )

    # Evaluate before training
    print("\nBaseline accuracy (before training):")
    evaluate_wsd_accuracy(model, eval_samples)

    warmup_steps = int(len(train_dataloader) * args.epochs * 0.1)
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=warmup_steps,
        num_training_steps=len(train_dataloader) * args.epochs,
    )

    print(f"\nTraining for {args.epochs} epochs ({len(train_dataloader)} steps/epoch, {warmup_steps} warmup steps)...")
    t0 = time.time()

    model.train()
    for epoch in range(args.epochs):
        epoch_loss = 0.0
        progress = tqdm(train_dataloader, desc=f"Epoch {epoch + 1}/{args.epochs}")

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

        average_loss = epoch_loss / len(train_dataloader)
        print(f"Epoch {epoch + 1} average loss: {average_loss:.4f}")

    elapsed = time.time() - t0
    print(f"\nTraining complete in {elapsed:.0f}s ({elapsed/60:.1f} min)")

    # Evaluate after training
    print("\nPost-training accuracy:")
    accuracy = evaluate_wsd_accuracy(model, eval_samples)

    # Save final model
    model.save(str(output_dir))
    print(f"\nModel saved to {output_dir}")
    print(f"Final WSD accuracy: {accuracy:.1%}")


if __name__ == '__main__':
    main()
