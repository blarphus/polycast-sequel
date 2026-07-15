import React, { useCallback, useEffect, useRef, useState } from 'react';
import { openComicArchive, type ComicArchiveSession, type ComicDocument, type ComicOcrProgress } from '../utils/cbz';
import type { useSavedWords } from '../hooks/useSavedWords';
import WordPopup from './WordPopup';
import { ChevronLeftIcon, ChevronRightIcon } from './icons';
import type { PopupState } from '../textTokens';
import { getBookMeta, getComicPageResult, getProgress, setProgress, type ComicPageRecord } from '../utils/bookStore';
import { COMIC_OCR_PROGRESS_EVENT, startComicOcr, type ComicOcrProgressEvent } from '../utils/comicOcr';
import { createScopedRuntimeLogger } from '../utils/scopedRuntimeLogger';

const runtimeLog = createScopedRuntimeLogger('web.components.comicreader');

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
  const [pageImageUrl, setPageImageUrl] = useState('');
  const [pageImageSize, setPageImageSize] = useState({ width: 0, height: 0 });
  const [pageResult, setPageResult] = useState<ComicPageRecord | null>(null);
  const [pageLoadError, setPageLoadError] = useState('');
  const [ocrProgress, setOcrProgress] = useState<ComicOcrProgress | null>(comic.ocr || null);
  const [pageResultRevision, setPageResultRevision] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const archiveSessionRef = useRef<Promise<ComicArchiveSession> | null>(null);

  useEffect(() => {
    if (!comic.archive) return undefined;
    const sessionPromise = openComicArchive(comic.archive);
    archiveSessionRef.current = sessionPromise;
    return () => {
      archiveSessionRef.current = null;
      void sessionPromise.then((session) => session.close()).catch((error) => {
        runtimeLog.error('[cbz_reader_archive_close_failed] Comic reader cleanup failed:', error);
      });
    };
  }, [comic.archive]);

  useEffect(() => {
    void getBookMeta(bookId).then((meta) => {
      if (meta?.ocr) {
        setOcrProgress(meta.ocr);
        if (meta.ocr.status === 'queued' || meta.ocr.status === 'processing') startComicOcr(bookId);
      }
    });
    const handleProgress = (event: Event) => {
      const detail = (event as CustomEvent<ComicOcrProgressEvent>).detail;
      if (!detail || detail.bookId !== bookId) return;
      setOcrProgress(detail.progress);
      if (detail.progress.processedPages > pageIndex) setPageResultRevision((value) => value + 1);
    };
    window.addEventListener(COMIC_OCR_PROGRESS_EVENT, handleProgress);
    return () => window.removeEventListener(COMIC_OCR_PROGRESS_EVENT, handleProgress);
  }, [bookId, pageIndex]);

  useEffect(() => {
    const page = comic.pages[pageIndex];
    let cancelled = false;
    let objectUrl = '';
    setPopup(null);
    setPageResult(null);
    setPageLoadError('');
    setPageImageSize({ width: page.width, height: page.height });

    void (async () => {
      try {
        const [image, result] = await Promise.all([
          page.image
            ? Promise.resolve(new Blob([page.image as BlobPart], { type: page.mimeType }))
            : archiveSessionRef.current?.then((session) => session.getPageBlob(page.entryName)),
          comic.kind === 'ocr' ? getComicPageResult(bookId, pageIndex) : Promise.resolve(null),
        ]);
        if (!image) throw new Error('[cbz_page_data_missing] This comic page has no stored image source.');
        if (cancelled) return;
        objectUrl = URL.createObjectURL(image);
        setPageImageUrl(objectUrl);
        setPageResult(result);
        if (result) setPageImageSize({ width: result.width, height: result.height });
      } catch (error) {
        if (cancelled) return;
        runtimeLog.error('Comic page load failed:', error);
        setPageLoadError(error instanceof Error ? error.message : 'Could not load this comic page.');
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setPageImageUrl('');
    };
  }, [bookId, comic, pageIndex, pageResultRevision]);

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
  const pageWidth = pageResult?.width || pageImageSize.width || page.width || 1;
  const pageHeight = pageResult?.height || pageImageSize.height || page.height || 1;
  const pageLines = pageResult?.lines || page.lines;
  const waitingForPageText = comic.kind === 'ocr' && !pageResult;
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
          <div className="comic-reader-format">{comic.kind === 'ocr' ? 'CBZ OCR' : 'CBZ preview'}</div>
        </div>
      </header>

      {comic.prototypeNotice && (
        <div className="comic-prototype-notice" role="status">
          <strong>[cbz_two_page_prototype]</strong> {comic.prototypeNotice}
        </div>
      )}
      {comic.kind === 'ocr' && ocrProgress && (
        <div className={`comic-ocr-reader-notice comic-ocr-reader-notice--${ocrProgress.status}`} role="status" aria-live="polite">
          <strong>[cbz_ocr_{ocrProgress.status}]</strong>
          <span>Completed page {ocrProgress.processedPages}/{ocrProgress.totalPages}</span>
          <span>{ocrProgress.stage}</span>
          {ocrProgress.diagnosticDetail && <span>{ocrProgress.diagnosticDetail}</span>}
        </div>
      )}

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
                aspectRatio: `${pageWidth} / ${pageHeight}`,
                height: viewportHeight ? `${Math.max(100, (viewportHeight - 32) * zoom)}px` : undefined,
              }}
            >
              {pageImageUrl
                ? <img
                    className="comic-page-image"
                    src={pageImageUrl}
                    alt={`Page ${pageIndex + 1} of ${comic.title}`}
                    onLoad={(event) => {
                      if (!pageResult) setPageImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
                    }}
                  />
                : <div className="comic-page-loading"><div className="loading-spinner" />Opening page {pageIndex + 1}…</div>}
              <div className="comic-word-map" aria-label="Clickable selected text">
              {pageLines.map((textLine, lineIndex) => {
                if (textLine.words?.length) {
                  return textLine.words.map((sourceWord, wordIndex) => {
                    const word = cleanLookupWord(sourceWord.text);
                    if (!word) return null;
                    const isSaved = savedWords.savedWordsSet.has(word.toLowerCase());
                    return (
                      <button
                        type="button"
                        key={`${lineIndex}-${wordIndex}-${sourceWord.text}`}
                        className={`comic-word-hit comic-word-hit--exact${isSaved ? ' saved' : ''}`}
                        style={{
                          left: `${(sourceWord.x / pageWidth) * 100}%`,
                          top: `${(sourceWord.y / pageHeight) * 100}%`,
                          width: `${(sourceWord.width / pageWidth) * 100}%`,
                          height: `${Math.max(0.4, (sourceWord.height / pageHeight) * 100)}%`,
                        }}
                        aria-label={`Look up ${word}`}
                        title={`${word}${sourceWord.confidence == null ? '' : ` · OCR ${Math.round(sourceWord.confidence)}%`}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPopup({ word, sentence: textLine.context, rect: event.currentTarget.getBoundingClientRect() });
                        }}
                      />
                    );
                  });
                }
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
              {waitingForPageText && (
                <div className="comic-page-ocr-pending" role="status">
                  <strong>Page {pageIndex + 1} text is not ready yet</strong>
                  <span>Completed page {ocrProgress?.processedPages ?? 0}/{ocrProgress?.totalPages ?? comic.pages.length}.</span>
                  <span>The image is available now. Clickable text will appear automatically when this page finishes.</span>
                </div>
              )}
              {pageLoadError && (
                <div className="comic-page-ocr-pending comic-page-ocr-pending--error" role="alert">
                  <strong>[cbz_page_load_failed]</strong>
                  <span>{pageLoadError}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <button className="epub-flip epub-flip--next" onClick={goNext} disabled={pageIndex === comic.pages.length - 1} aria-label="Next page">
          <ChevronRightIcon size={28} />
        </button>
      </div>

      <footer className="epub-footer comic-footer">
        <span>{comic.kind === 'ocr' ? `Selected text · ${comic.language === 'es' ? 'Spanish' : 'English'}` : 'Speech-bubble map · English'}</span>
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
