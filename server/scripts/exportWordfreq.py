#!/usr/bin/env python3
"""Export wordfreq Zipf tables for the languages Polycast supports.

wordfreq blends several corpora (subtitles, Wikipedia, news, web, etc.) per language
and reports a Zipf value = log10(occurrences per billion words). We dump the top-N words
with their Zipf so the Node server can (a) look up any inflected form and (b) sum a lemma's
forms into a single, stable lemma frequency. Run once; the output files are committed.

Usage:  python3 exportWordfreq.py            # writes server/data/frequency/<lang>.txt
"""
import argparse
import os

parser = argparse.ArgumentParser(description="Export bounded wordfreq Zipf tables for Polycast languages.")
parser.add_argument("--output-dir", default=os.path.join(os.path.dirname(__file__), "..", "data", "frequency"))
parser.add_argument("--top-n", type=int, default=50000)
parser.add_argument("--dry-run", action="store_true", help="compute tables without writing files")
args = parser.parse_args()

from wordfreq import top_n_list, zipf_frequency

LANGS = ["en", "es", "pt", "fr", "de", "ja"]
TOP_N = args.top_n
OUT_DIR = args.output_dir

if not args.dry_run:
    os.makedirs(OUT_DIR, exist_ok=True)
for lang in LANGS:
    path = os.path.join(OUT_DIR, f"{lang}.txt")
    try:
        words = top_n_list(lang, TOP_N)
        lines = []
        for w in words:
            if " " in w:  # skip multi-token phrases
                continue
            z = zipf_frequency(w, lang)
            if z <= 0:
                continue
            lines.append(f"{w} {z:.2f}\n")
        if not args.dry_run:
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(lines)
        print(f"{lang}: {'would write' if args.dry_run else 'wrote'} {len(lines)} words -> {path}")
    except Exception as e:  # e.g. a language whose tokenizer isn't installed
        print(f"{lang}: SKIPPED ({type(e).__name__}: {e})")
