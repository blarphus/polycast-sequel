## Completion Sound

- Before sending the final response for a completed task in this workspace, run `.codex-local/play_completion_sound.sh`.
- Only play the tone when the task is fully complete and you are ready for the user's next input.
- Use a short two-tone cue: low, then high.
- Skip the sound only if the user explicitly says not to play it or local audio playback is unavailable.

## Fallback Visibility

- This project is under active development. Every fallback path must emit a structured diagnostic and remain visible in the relevant UI.
- Never hide, suppress, relabel as success, or silently consume a fallback to make the experience appear cleaner.
- Optimizing a pipeline must remove unnecessary fallback conditions, not remove fallback notices.
