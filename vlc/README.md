# Polycast Clickable Subtitles for VLC

This is a first VLC Lua extension prototype. It does not replace VLC's subtitle renderer or draw directly on top of the video. Instead, it opens a small VLC extension panel that:

- auto-detects sidecar `.srt` files next to the current video
- parses subtitle cues locally
- reads the current VLC playback time
- shows the current subtitle line
- turns the words in that line into buttons
- opens Polycast Dictionary lookup for the clicked word

## Installed Location on macOS

The working copy is:

```text
vlc/polycast-clickable-subtitles.lua
```

The user-level VLC install location is:

```text
~/Library/Application Support/org.videolan.vlc/lua/extensions/polycast-clickable-subtitles.lua
```

## Use It

1. Restart VLC after copying the Lua file.
2. Open a video that has a matching sidecar subtitle file, for example:

```text
movie.mp4
movie.srt
```

3. In VLC, open the extension from the Extensions/View menu.
4. Click `Auto-detect` or paste an `.srt` path and click `Load .srt`.
5. While the video is playing, click `Sync now`.
6. Click a word button to open Polycast at `/dictionary?lookup=<word>`.

## Current Limits

- Sidecar `.srt` files only. Embedded subtitles and `.ass`/`.vtt` are not parsed yet.
- The panel updates when `Sync now` is pressed. It is not a transparent always-on overlay yet.
- Clicking a word opens the Polycast web dictionary lookup; saving still happens through the logged-in web app session.
