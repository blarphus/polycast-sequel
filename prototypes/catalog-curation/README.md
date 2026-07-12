# Archived catalog curation passes

Status: historical one-time migration scripts, retained only to explain how the committed Portuguese catalog was curated.

`fix-categories.mjs` encodes title-specific moves that have already been applied. `recategorize-small.mjs` was an experimental Gemini reclassification pass. Neither is part of setup, generation, release, or maintained tooling, and neither should be run against current catalog state.

The maintained regeneration tools remain `scripts/categorize-lessons.mjs` and `scripts/build-catalog.mjs`, both of which require explicit credentials and support non-writing dry runs.
