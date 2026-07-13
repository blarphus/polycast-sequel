import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComicDocument } from '../utils/cbz';
import type { useSavedWords } from '../hooks/useSavedWords';
import WordPopup from './WordPopup';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import type { PopupState } from '../textTokens';
import { getProgress, setProgress } from '../utils/bookStore';

type SavedWordControls = ReturnType<typeof useSavedWords>;

interface ComicReaderProps {
  bookId: string;
  comic: ComicDocument;
  nativeLanguage: string | null;
  savedWords: SavedWordControls;
  onBack: () => void;
}

function cleanLookupWord(word: string): string {
  return word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’\-]+$/gu, '');
}

export default function ComicReader({ bookId, comic, nativeLanguage, savedWords, onBack }: ComicReaderProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const touchStartX = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  const pageUrls = useMemo(
    () => comic.pages.map((page) => URL.createObjectURL(new Blob([page.image as BlobPart], { type: page.mimeType }))),
    [comic],
  );

  useEffect(() => () => pageUrls.forEach((url) => URL.revokeObjectURL(url)), [pageUrls]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return undefined;
    const observer = new ResizeObserver(() => setViewportHeight(viewport.clientHeight));
    observer.observe(viewport);
    setViewportHeight(viewport.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getProgress(bookId).then((progress) => {
      if (!cancelled && progress) setPageIndex(Math.min(progress.pageIndex, comic.pages.length - 1));
    });
    return () => { cancelled = true; };
  }, [bookId, comic.pages.length]);

  useEffect(() => {
    void setProgress({ bookId, chapterIndex: 0, pageIndex });
  }, [bookId, pageIndex]);

  const goNext = useCallback(() => {
    setPopup(null);
    setPageIndex((current) => Math.min(comic.pages.length - 1, current + 1));
  }, [comic.pages.length]);

  const goPrev = useCallback(() => {
    setPopup(null);
    setPageIndex((current) => Math.max(0, current - 1));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      } else if (event.key === 'ArrowLeft' || event.key === 'Backspace') {
        event.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const page = comic.pages[pageIndex];
  const changeZoom = (next: number) => {
    setPopup(null);
    setZoom(Math.min(3, Math.max(0.75, next)));
  };

  return (
    <div className="epub-reader comic-reader">
      <header className="epub-topbar">
        <button className="epub-topbar-btn" title="Library" onClick={onBack}>
          <ChevronLeftIcon size={20} />
        </button>
        <div className="epub-topbar-title" title={comic.title}>{comic.title}</div>
        <div className="comic-topbar-actions">
          <div className="comic-zoom-controls" aria-label="Comic zoom controls">
            <button type="button" onClick={() => changeZoom(zoom - 0.25)} disabled={zoom <= 0.75} aria-label="Zoom out">−</button>
            <button type="button" onClick={() => changeZoom(1)} aria-label="Reset zoom to fit page">{Math.round(zoom * 100)}%</button>
            <button type="button" onClick={() => changeZoom(zoom + 0.25)} disabled={zoom >= 3} aria-label="Zoom in">+</button>
          </div>
          <div className="comic-reader-format">CBZ preview</div>
        </div>
      </header>

      <div className="comic-prototype-notice" role="status">
        <strong>[cbz_two_page_prototype]</strong> {comic.prototypeNotice}
      </div>

      <div className="comic-stage">
        <button className="epub-flip epub-flip--prev" onClick={goPrev} disabled={pageIndex === 0} aria-label="Previous page">
          <ChevronLeftIcon size={28} />
        </button>

        <div
          className="comic-viewport"
          ref={viewportRef}
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) return;
            event.preventDefault();
            changeZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
          }}
          onTouchStart={(event) => { touchStartX.current = event.changedTouches[0].clientX; }}
          onTouchEnd={(event) => {
            if (touchStartX.current == null) return;
            const delta = event.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (delta < -40) goNext();
            else if (delta > 40) goPrev();
          }}
        >
          <div className="comic-page-scroll-content">
            <div
              className="comic-page-frame"
              style={{
                aspectRatio: `${page.width} / ${page.height}`,
                height: viewportHeight ? `${Math.max(100, (viewportHeight - 32) * zoom)}px` : undefined,
              }}
            >
              <img className="comic-page-image" src={pageUrls[pageIndex]} alt={`Page ${pageIndex + 1} of ${comic.title}`} />
              <div className="comic-word-map" aria-label="Clickable dialogue text">
              {page.lines.map((textLine, lineIndex) => {
                const words = textLine.text.split(/\s+/).filter(Boolean);
                const totalWeight = words.reduce((sum, word) => sum + Math.max(1, cleanLookupWord(word).length), 0);
                return (
                  <div
                    className="comic-text-line"
                    key={`${lineIndex}-${textLine.text}`}
                    style={{
                      left: `${(textLine.x / page.width) * 100}%`,
                      top: `${(textLine.y / page.height) * 100}%`,
                      width: `${(textLine.width / page.width) * 100}%`,
                      height: `${Math.max(0.8, (textLine.height / page.height) * 100)}%`,
                    }}
                  >
                    {words.map((rawWord, wordIndex) => {
                      const word = cleanLookupWord(rawWord);
                      if (!word) return null;
                      const isSaved = savedWords.savedWordsSet.has(word.toLowerCase());
                      return (
                        <button
                          type="button"
                          key={`${wordIndex}-${rawWord}`}
                          className={`comic-word-hit${isSaved ? ' saved' : ''}`}
                          style={{ flexGrow: Math.max(1, word.length), flexBasis: `${(word.length / totalWeight) * 100}%` }}
                          aria-label={`Look up ${word}`}
                          title={word}
                          onClick={(event) => {
                            event.stopPropagation();
                            setPopup({ word, sentence: textLine.context, rect: event.currentTarget.getBoundingClientRect() });
                          }}
                        />
                      );
                    })}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </div>

        <button className="epub-flip epub-flip--next" onClick={goNext} disabled={pageIndex === comic.pages.length - 1} aria-label="Next page">
          <ChevronRightIcon size={28} />
        </button>
      </div>

      <footer className="epub-footer comic-footer">
        <span>Speech-bubble map · English</span>
        <span>{pageIndex + 1} / {comic.pages.length}</span>
      </footer>

      {popup && nativeLanguage && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={nativeLanguage}
          targetLang={comic.language}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={savedWords.isWordSaved}
          isDefinitionSaved={savedWords.isDefinitionSaved}
          onSaveWord={savedWords.addWord}
          onRemoveWord={savedWords.removeWord}
          onOptimisticSave={savedWords.addOptimistic}
          isNative={comic.language.toLowerCase() === nativeLanguage.toLowerCase()}
        />
      )}
    </div>
  );
}
