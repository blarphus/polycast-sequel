// ---------------------------------------------------------------------------
// pages/LocalVideos.tsx — Browse and select local video files from a folder
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderIcon, CheckCircleIcon, CheckIcon } from '../components/icons';
import {
  setLocalVideos, getLocalVideos, LocalVideoEntry,
  saveDirHandle, loadDirHandle, loadFromDirHandle,
  generateThumbnail, getAllProgress, VideoProgress,
} from '../utils/localVideoStore';

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'webm', 'mov', 'ogv']);
const SRT_EXTENSION = 'srt';

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function getBaseName(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(0, dot) : name;
}

export default function LocalVideos() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<LocalVideoEntry[]>(() => getLocalVideos());
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<Record<string, VideoProgress>>(() => getAllProgress());
  const [restoring, setRestoring] = useState(false);

  const generateThumbnails = useCallback((entries: LocalVideoEntry[]) => {
    entries.forEach((entry) => {
      generateThumbnail(entry.videoFile)
        .then((dataUrl) => {
          setThumbnails((prev) => ({ ...prev, [entry.name]: dataUrl }));
        })
        .catch(() => {});
    });
  }, []);

  // Try to restore from saved directory handle on mount
  useEffect(() => {
    if (videos.length > 0) {
      generateThumbnails(videos);
      return;
    }
    let cancelled = false;
    (async () => {
      setRestoring(true);
      const handle = await loadDirHandle();
      if (!handle || cancelled) { setRestoring(false); return; }
      try {
        const restored = await loadFromDirHandle(handle);
        if (!cancelled && restored.length > 0) {
          setVideos(restored);
          generateThumbnails(restored);
        }
      } catch (err) {
        console.error('Failed to restore directory:', err);
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh progress when returning to this page
  useEffect(() => {
    setProgress(getAllProgress());
  }, []);

  const processEntries = useCallback((entries: LocalVideoEntry[]) => {
    setLocalVideos(entries);
    setVideos(entries);
    setProgress(getAllProgress());
    generateThumbnails(entries);
  }, [generateThumbnails]);

  const handleFolderSelect = useCallback(async () => {
    // Try File System Access API first (persists across refreshes)
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker();
        await saveDirHandle(handle);
        const entries = await loadFromDirHandle(handle);
        processEntries(entries);
        return;
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        console.error('showDirectoryPicker failed, falling back to input:', err);
      }
    }
    // Fallback to webkitdirectory input
    inputRef.current?.click();
  }, [processEntries]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);
    const videoFiles = fileArray.filter((f) => VIDEO_EXTENSIONS.has(getExtension(f.name)));
    const srtFiles = new Map<string, File>();

    for (const f of fileArray) {
      if (getExtension(f.name) === SRT_EXTENSION) {
        srtFiles.set(getBaseName(f.name).toLowerCase(), f);
      }
    }

    const entries: LocalVideoEntry[] = videoFiles
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((videoFile) => ({
        videoFile,
        srtFile: srtFiles.get(getBaseName(videoFile.name).toLowerCase()) ?? null,
        name: videoFile.name,
      }));

    processEntries(entries);
  }, [processEntries]);

  const handleVideoClick = useCallback(
    (entry: LocalVideoEntry) => {
      navigate(`/local-watch/${encodeURIComponent(entry.name)}`);
    },
    [navigate],
  );

  return (
    <div className="local-videos-page">
      <div className="local-videos-header">
        <h1 className="local-videos-title">Local Videos</h1>
        <button
          className="btn btn-primary local-videos-folder-btn"
          onClick={handleFolderSelect}
        >
          <FolderIcon size={18} />
          <span>{videos.length > 0 ? 'Change Folder' : 'Open Folder'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          /* @ts-expect-error webkitdirectory is a non-standard attribute */
          webkitdirectory=""
          directory=""
          multiple
          style={{ display: 'none' }}
          onChange={handleInputChange}
        />
      </div>

      {restoring ? (
        <div className="local-videos-empty">
          <p>Loading videos...</p>
        </div>
      ) : videos.length === 0 ? (
        <div className="local-videos-empty">
          <FolderIcon size={48} />
          <p>Select a folder containing video files (.mp4, .avi, .mkv, etc.)</p>
          <p className="local-videos-empty-sub">
            SRT subtitle files with matching names will be loaded automatically.
          </p>
        </div>
      ) : (
        <>
          <p className="local-videos-count">
            {videos.length} video{videos.length !== 1 ? 's' : ''} found
          </p>
          <div className="local-videos-list">
            {videos.map((entry) => {
              const prog = progress[entry.name];
              const pct = prog && prog.duration > 0
                ? Math.min(100, (prog.currentTime / prog.duration) * 100)
                : 0;
              return (
                <button
                  key={entry.name}
                  className="local-video-card"
                  onClick={() => handleVideoClick(entry)}
                >
                  <div className="local-video-card-thumb">
                    {thumbnails[entry.name] ? (
                      <img src={thumbnails[entry.name]} alt="" />
                    ) : (
                      <div className="local-video-card-thumb-placeholder" />
                    )}
                    {prog?.completed && (
                      <div className="local-video-card-check">
                        <CheckCircleIcon size={20} />
                      </div>
                    )}
                  </div>
                  <div className="local-video-card-info">
                    <span className="local-video-card-name">{entry.name}</span>
                    <span className="local-video-card-meta">
                      {(entry.videoFile.size / (1024 * 1024)).toFixed(0)} MB
                      {prog && prog.duration > 0 && (
                        <> &middot; {formatTime(prog.currentTime)} / {formatTime(prog.duration)}</>
                      )}
                    </span>
                    {pct > 0 && (
                      <div className="local-video-card-progress">
                        <div
                          className={`local-video-card-progress-fill${prog?.completed ? ' completed' : ''}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                  {entry.srtFile && (
                    <span className="local-video-card-srt" title="Subtitles available">
                      <CheckIcon size={14} />
                      SRT
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
