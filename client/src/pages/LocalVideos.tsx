// ---------------------------------------------------------------------------
// pages/LocalVideos.tsx — Browse and select local video files from a folder
// ---------------------------------------------------------------------------

import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderIcon, PlayCircleIcon, CheckIcon } from '../components/icons';
import { setLocalVideos, getLocalVideos, LocalVideoEntry } from '../utils/localVideoStore';

const VIDEO_EXTENSIONS = new Set(['mp4', 'avi', 'mkv', 'webm', 'mov', 'ogv']);
const SRT_EXTENSION = 'srt';

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

  const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
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

    setLocalVideos(entries);
    setVideos(entries);
  }, []);

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
          onClick={() => inputRef.current?.click()}
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
          onChange={handleFolderSelect}
        />
      </div>

      {videos.length === 0 ? (
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
            {videos.map((entry) => (
              <button
                key={entry.name}
                className="local-video-card"
                onClick={() => handleVideoClick(entry)}
              >
                <div className="local-video-card-icon">
                  <PlayCircleIcon size={24} />
                </div>
                <div className="local-video-card-info">
                  <span className="local-video-card-name">{entry.name}</span>
                  <span className="local-video-card-meta">
                    {(entry.videoFile.size / (1024 * 1024)).toFixed(0)} MB
                  </span>
                </div>
                {entry.srtFile && (
                  <span className="local-video-card-srt" title="Subtitles available">
                    <CheckIcon size={14} />
                    SRT
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
