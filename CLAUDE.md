# Polycast Sequel — Project Rules

## No Fallbacks

**Never use fallbacks.** No silent `.catch(() => {})`, no `|| 'default'` strings, no try/catch that swallows errors and continues silently. If something breaks, it must be visible — `console.error` the failure, set error state, or let it throw.

Exceptions (these are NOT fallbacks):
- `display_name || username` — field preference, username always exists
- `event.candidate ?? null` — WebRTC spec (null = end of ICE gathering)
- `initialSaved ?? false` — optional boolean prop default
- Form initial values like `user?.native_language || ''` — empty string = "Select..." option
- `closePeerConnection` try/catch — `removeTrack` throws if connection already closed, this is cleanup

## File Organization

**Keep code in the right files.** When adding or editing features, put the code in the file where it logically belongs — not in one monolithic file. Components, utilities, routes, and styles each have their own files/directories. If a new feature spans multiple concerns, split it across the appropriate existing files rather than stuffing everything into one place. Follow the established project structure (e.g. `client/src/components/`, `client/src/pages/`, `server/routes/`, CSS partials).
