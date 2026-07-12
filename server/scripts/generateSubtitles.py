"""
Batch-generate SRT subtitles from video files using mlx-whisper.

Usage:
    python3 server/scripts/generateSubtitles.py "/path/to/video/folder"
    python3 server/scripts/generateSubtitles.py "/path/to/video/folder" --language pt
"""

import argparse
import os
import subprocess
import tempfile
import glob

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
        import mlx_whisper
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
    parser = argparse.ArgumentParser(description="Generate sidecar SRT subtitles with mlx-whisper.")
    parser.add_argument("folder")
    parser.add_argument("--language", default="pt")
    parser.add_argument("--dry-run", action="store_true", help="list candidate videos without ffmpeg, transcription, or writes")
    args = parser.parse_args()
    folder = args.folder
    language = args.language

    video_files = sorted(
        glob.glob(os.path.join(folder, "*.avi"))
        + glob.glob(os.path.join(folder, "*.mp4"))
        + glob.glob(os.path.join(folder, "*.mkv"))
    )

    if not video_files:
        print(f"No video files found in: {folder}")
        parser.error(f"No video files found in: {folder}")

    print(f"Found {len(video_files)} video files. Language: {language}\n")
    if args.dry_run:
        for video in video_files:
            print(f"DRY {os.path.basename(video)}")
        return

    for i, video in enumerate(video_files, 1):
        print(f"[{i}/{len(video_files)}] {os.path.basename(video)}")
        transcribe_file(video, language)
        print()

    print("Done!")


if __name__ == "__main__":
    main()
