"""
Batch-generate SRT subtitles from video files using mlx-whisper.

Usage:
    python3 server/scripts/generateSubtitles.py "/path/to/video/folder"
    python3 server/scripts/generateSubtitles.py "/path/to/video/folder" --language pt
"""

import sys
import os
import subprocess
import tempfile
import glob

import mlx_whisper


def format_timestamp(seconds):
    """Convert seconds to SRT timestamp format: HH:MM:SS,mmm"""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def segments_to_srt(segments):
    """Convert whisper segments to SRT formatted string."""
    lines = []
    for i, seg in enumerate(segments, 1):
        start = format_timestamp(seg["start"])
        end = format_timestamp(seg["end"])
        text = seg["text"].strip()
        lines.append(f"{i}\n{start} --> {end}\n{text}\n")
    return "\n".join(lines)


def extract_audio(video_path, wav_path):
    """Extract audio from video to WAV using ffmpeg."""
    cmd = [
        "ffmpeg", "-i", video_path,
        "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
        "-y", wav_path
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {result.stderr}")


def transcribe_file(video_path, language="pt"):
    """Transcribe a single video file and write .srt next to it."""
    srt_path = os.path.splitext(video_path)[0] + ".srt"

    if os.path.exists(srt_path):
        print(f"  Skipping (SRT exists): {os.path.basename(srt_path)}")
        return

    print(f"  Extracting audio...")
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = tmp.name

    try:
        extract_audio(video_path, wav_path)

        print(f"  Transcribing...")
        result = mlx_whisper.transcribe(
            wav_path,
            path_or_hf_repo="mlx-community/whisper-large-v3-turbo",
            language=language,
            word_timestamps=False,
        )

        srt_content = segments_to_srt(result["segments"])
        with open(srt_path, "w", encoding="utf-8") as f:
            f.write(srt_content)

        print(f"  Wrote: {os.path.basename(srt_path)}")
    finally:
        if os.path.exists(wav_path):
            os.remove(wav_path)


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 generateSubtitles.py <folder> [--language xx]")
        sys.exit(1)

    folder = sys.argv[1]
    language = "pt"

    if "--language" in sys.argv:
        idx = sys.argv.index("--language")
        language = sys.argv[idx + 1]

    video_files = sorted(
        glob.glob(os.path.join(folder, "*.avi"))
        + glob.glob(os.path.join(folder, "*.mp4"))
        + glob.glob(os.path.join(folder, "*.mkv"))
    )

    if not video_files:
        print(f"No video files found in: {folder}")
        sys.exit(1)

    print(f"Found {len(video_files)} video files. Language: {language}\n")

    for i, video in enumerate(video_files, 1):
        print(f"[{i}/{len(video_files)}] {os.path.basename(video)}")
        transcribe_file(video, language)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
