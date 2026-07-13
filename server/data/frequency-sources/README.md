# Offline frequency sources

`buildFrequencyCatalog.js` reads the frozen Spanish wordfreq snapshot plus the Spanish
lemma-frequency export declared in `manifest.json`. Runtime requests never read these files.

Each file is UTF-8 TSV with `lemma<TAB>frequency`, highest frequency first. Raw units
may differ between sources: the builder combines source ranks using weighted reciprocal-rank
fusion and retains each source's raw value for provenance.

The bundled Spanish TUBELEX 2025 snapshot is pre-aggregated from lemma/POS rows into one summed
row per lemma. The manifest retains the top 200,000 lemmas: below that point the video-web tail
is mostly tokenization noise, while every Spanish Wiktionary lemma and existing user sense still
receives a deterministic catalog rank. This keeps the one-time build below the Render Starter
memory ceiling.

The materialized catalog is intentionally Spanish-only. Any future language must add its own
licensed, frozen sources and a separately verified build rather than reusing Spanish ranks.
