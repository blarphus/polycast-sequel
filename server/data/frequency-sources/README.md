# Offline frequency sources

`buildFrequencyCatalog.js` reads the frozen wordfreq snapshots plus optional lemma-frequency
exports declared in `manifest.json`. Runtime requests never read these source files.

Each file is UTF-8 TSV with `lemma<TAB>frequency`, highest frequency first. Raw units
may differ between sources: the builder combines source ranks using weighted reciprocal-rank
fusion and retains each source's raw value for provenance.

The bundled TUBELEX 2025 snapshots for English, Spanish, and Japanese are pre-aggregated from
lemma/POS rows into one summed row per lemma. The manifest retains the top 200,000 lemmas per
language: below that point the video-web tail is mostly tokenization noise, while every
Wiktionary lemma and existing user sense still receives a deterministic catalog rank. This
keeps the one-time build below the Render Starter memory ceiling.

Recommended inputs are TUBELEX and SUBTLEX for English/Spanish, SUBTLEX-PT-BR and Corpus
Brasileiro for Brazilian Portuguese, Lexique for French, SUBTLEX-DE and Leipzig for German,
and TUBELEX/UniDic plus BCCWJ for Japanese. Record the exact release, license, checksum, and
weight in the manifest. Mark a source `required` only after its licensed local export exists.
