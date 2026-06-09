// ---------------------------------------------------------------------------
// pages/Reader.tsx -- Paginated EPUB reader. Renders chapter text through the
// shared TokenizedText component (every word clickable -> WordPopup -> save),
// and paginates with a CSS multi-column + translateX technique so the clickable
// DOM stays real (no iframe). WordPopup is position:fixed, so the page transform
// never affects its anchoring.
// ---------------------------------------------------------------------------

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useSavedWords } from '../hooks/useSavedWords';
import TokenizedText from '../components/TokenizedText';
import WordPopup from '../components/WordPopup';
import { PopupState } from '../textTokens';
import { ChevronLeftIcon, ChevronRightIcon, BookOpenIcon, CloseIcon, TypeIcon, SunIcon, MoonIcon } from '../components/icons';
import { parseEpub, imageObjectUrl, type ParsedEpub } from '../utils/epub';
import { getBookData, getProgress, setProgress } from '../utils/bookStore';
import { READER_FONTS, fontStack, loadReaderPrefs, saveReaderPrefs, type ReaderTheme } from '../utils/readerPrefs';
import { getReaderSelectionDetails } from '../utils/readerSelection';
import { explainSelection } from '../api';

const GAP = 48;
const FONT_MIN = 0.8;
const FONT_MAX = 1.7;
type PendingPageTarget = number | 'start' | 'end';
interface SelectionPopupState {
  selection: string;
  context: string;
  rect: DOMRect;
  explanation: string;
  loading: boolean;
  error: string;
}

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { savedWordsSet, isWordSaved, isDefinitionSaved, addWord, addOptimistic } = useSavedWords();

  const [book, setBook] = useState<ParsedEpub | null>(null);
  const [loadError, setLoadError] = useState('');
  const [chapterIndex, setChapterIndex] = useState(0);
  const [pageIndex, setPageIndex] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [colW, setColW] = useState(0);
  const [fontScale, setFontScale] = useState(() => loadReaderPrefs().fontScale);
  const [fontId, setFontId] = useState(() => loadReaderPrefs().fontId);
  const [readerTheme, setReaderTheme] = useState<ReaderTheme>(() => loadReaderPrefs().theme);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [selectionPopup, setSelectionPopup] = useState<SelectionPopupState | null>(null);
  const [imgUrls, setImgUrls] = useState<Record<string, string>>({});
  const [imageLayoutTick, setImageLayoutTick] = useState(0);
  const [animatePage, setAnimatePage] = useState(false);
  const [chapterTurn, setChapterTurn] = useState<'next' | 'prev' | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pendingPageTargetRef = useRef<PendingPageTarget | null>(null);
  const touchStartX = useRef<number | null>(null);

  // Lock body scroll while reading (the reader owns the viewport height).
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Load + parse the book, restore saved position.
  useEffect(() => {
    if (!bookId) return;
    let cancelled = false;
    (async () => {
      try {
        const bytes = await getBookData(bookId);
        if (!bytes) { if (!cancelled) setLoadError('Book not found.'); return; }
        const parsed = parseEpub(bytes);
        const progress = await getProgress(bookId);
        if (cancelled) return;
        if (progress) {
          setChapterIndex(Math.min(progress.chapterIndex, parsed.chapters.length - 1));
          pendingPageTargetRef.current = progress.pageIndex;
        }
        setBook(parsed);
      } catch (err) {
        console.error('Failed to open book:', err);
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not open this book.');
      }
    })();
    return () => { cancelled = true; };
  }, [bookId]);

  const chapter = book?.chapters[chapterIndex] ?? null;

  // Resolve images for the current chapter; revoke on change/unmount.
  useEffect(() => {
    if (!book || !chapter) return;
    const map: Record<string, string> = {};
    for (const b of chapter.blocks) {
      if (b.type === 'img' && b.imgHref && !map[b.imgHref]) {
        const url = imageObjectUrl(book.files, b.imgHref);
        if (url) map[b.imgHref] = url;
      }
    }
    setAnimatePage(false);
    setImageLayoutTick(0);
    setImgUrls(map);
    return () => { Object.values(map).forEach((u) => URL.revokeObjectURL(u)); };
  }, [book, chapter]);

  // Track viewport width (drives column-width + page stride).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => {
      setAnimatePage(false);
      setColW(vp.clientWidth);
    });
    ro.observe(vp);
    setColW(vp.clientWidth);
    return () => ro.disconnect();
  }, [book]);

  // Recompute page count after layout (chapter / font / width changes), and
  // apply any pending restore-to-page.
  useLayoutEffect(() => {
    const ct = contentRef.current;
    if (!ct || !colW) return;
    const stride = colW + GAP;
    const pages = Math.max(1, Math.round((ct.scrollWidth + GAP) / stride));
    setNumPages(pages);
    setPageIndex((p) => {
      const target = pendingPageTargetRef.current;
      if (target != null) {
        if (target === 'start') {
          pendingPageTargetRef.current = null;
          return 0;
        }
        if (target === 'end') {
          return pages - 1;
        }

        const restored = Math.min(target, pages - 1);
        if (target <= pages - 1) {
          pendingPageTargetRef.current = null;
        }
        return Math.max(0, restored);
      }
      return Math.min(p, pages - 1);
    });
  }, [book, chapter, colW, fontScale, fontId, imageLayoutTick]);

  // Re-measure once web fonts settle.
  useEffect(() => {
    let cancelled = false;
    document.fonts?.ready.then(() => {
      const ct = contentRef.current;
      if (cancelled || !ct || !colW) return;
      setNumPages(Math.max(1, Math.round((ct.scrollWidth + GAP) / (colW + GAP))));
    });
    return () => { cancelled = true; };
  }, [chapter, colW]);

  // Persist reading position.
  useEffect(() => {
    if (!bookId || !book) return;
    void setProgress({ bookId, chapterIndex, pageIndex });
  }, [bookId, book, chapterIndex, pageIndex]);

  // Persist reader preferences (theme / font / text size) across sessions.
  useEffect(() => {
    saveReaderPrefs({ theme: readerTheme, fontId, fontScale });
  }, [readerTheme, fontId, fontScale]);

  // Changing font/size reflows the columns — clear any pending restore and
  // skip the slide animation so re-pagination is instant.
  const relayoutForTextChange = () => {
    pendingPageTargetRef.current = null;
    setAnimatePage(false);
  };

  const goNext = useCallback(() => {
    setPopup(null);
    setSelectionPopup(null);
    if (pageIndex < numPages - 1) {
      pendingPageTargetRef.current = null;
      setAnimatePage(true);
      setPageIndex((p) => p + 1);
      return;
    }
    if (book && chapterIndex < book.chapters.length - 1) {
      setAnimatePage(false);
      setChapterTurn('next');
      pendingPageTargetRef.current = 'start';
      setPageIndex(0);
      setChapterIndex((c) => c + 1);
    }
  }, [pageIndex, numPages, book, chapterIndex]);

  const goPrev = useCallback(() => {
    setPopup(null);
    setSelectionPopup(null);
    if (pageIndex > 0) {
      pendingPageTargetRef.current = null;
      setAnimatePage(true);
      setPageIndex((p) => p - 1);
      return;
    }
    if (chapterIndex > 0) {
      setAnimatePage(false);
      setChapterTurn('prev');
      pendingPageTargetRef.current = 'end';
      setChapterIndex((c) => c - 1);
    }
  }, [pageIndex, chapterIndex]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextInput = target && (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      );
      if (isTextInput) return;

      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
      } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        goPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goNext, goPrev]);

  const jumpToChapter = (i: number) => {
    setPopup(null);
    setSelectionPopup(null);
    setTocOpen(false);
    setAnimatePage(false);
    setChapterTurn(null);
    pendingPageTargetRef.current = 'start';
    setPageIndex(0);
    setChapterIndex(i);
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setSelectionPopup(null);
    setPopup({ word, sentence, rect });
  };

  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const content = contentRef.current;
    if (!content) return;
    const details = getReaderSelectionDetails(range, content);
    if (!details) return;

    setPopup(null);
    setSelectionPopup({
      selection: details.selection,
      context: details.context,
      rect: range.getBoundingClientRect(),
      explanation: '',
      loading: false,
      error: '',
    });
  };

  const requestSelectionExplanation = async () => {
    if (!selectionPopup || !user) return;
    const requestState = selectionPopup;
    setSelectionPopup({ ...requestState, loading: true, error: '' });
    try {
      const result = await explainSelection(
        requestState.selection,
        requestState.context,
        user.native_language || 'en',
        user.target_language || undefined,
      );
      setSelectionPopup((current) => current
        && current.selection === requestState.selection
        && current.context === requestState.context
        ? { ...current, explanation: result.explanation, loading: false }
        : current);
    } catch (err) {
      setSelectionPopup((current) => current
        && current.selection === requestState.selection
        && current.context === requestState.context
        ? { ...current, error: err instanceof Error ? err.message : 'Explanation failed', loading: false }
        : current);
    }
  };

  const atStart = chapterIndex === 0 && pageIndex === 0;
  const atEnd = book ? (chapterIndex === book.chapters.length - 1 && pageIndex >= numPages - 1) : true;

  // Two-page (book) spread on wide screens, single column otherwise. Each page
  // is still colW wide with a colW+GAP stride, so the pagination math is shared:
  // two columns of (colW-GAP)/2 fit exactly within one colW-wide page.
  const twoCol = colW >= 760;
  const effColWidth = twoCol ? Math.max(1, (colW - GAP) / 2) : colW;

  if (loadError) {
    return (
      <div className="epub-reader epub-reader--message">
        <p>{loadError}</p>
        <button className="epub-upload-btn" onClick={() => navigate('/books')}>Back to library</button>
      </div>
    );
  }
  if (!book) {
    return <div className="epub-reader epub-reader--message"><div className="loading-spinner" /></div>;
  }

  return (
    <div className="epub-reader" data-reader-theme={readerTheme}>
      <header className="epub-topbar">
        <button className="epub-topbar-btn" title="Library" onClick={() => navigate('/books')}>
          <ChevronLeftIcon size={20} />
        </button>
        <div className="epub-topbar-title" title={book.title}>{book.title}</div>
        <div className="epub-topbar-actions">
          <button
            className="epub-topbar-btn"
            title={readerTheme === 'dark' ? 'Light mode' : 'Dark mode'}
            aria-label={readerTheme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => setReaderTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
          >
            {readerTheme === 'dark' ? <SunIcon size={18} /> : <MoonIcon size={18} />}
          </button>
          <button className={`epub-topbar-btn${settingsOpen ? ' active' : ''}`} title="Display settings"
            onClick={() => setSettingsOpen((v) => !v)}>
            <TypeIcon size={18} />
          </button>
          <button className="epub-topbar-btn" title="Contents" onClick={() => setTocOpen(true)}>
            <BookOpenIcon size={18} />
          </button>
        </div>
      </header>

      {settingsOpen && (
        <>
          <div className="epub-settings-backdrop" onClick={() => setSettingsOpen(false)} />
          <aside className="epub-settings" role="dialog" aria-label="Display settings">
            <div className="epub-settings-row">
              <span className="epub-settings-label">Text size</span>
              <div className="epub-settings-size">
                <button className="epub-topbar-btn" title="Smaller text" disabled={fontScale <= FONT_MIN}
                  onClick={() => { relayoutForTextChange(); setFontScale((f) => Math.max(FONT_MIN, +(f - 0.1).toFixed(2))); }}>A−</button>
                <button className="epub-topbar-btn" title="Larger text" disabled={fontScale >= FONT_MAX}
                  onClick={() => { relayoutForTextChange(); setFontScale((f) => Math.min(FONT_MAX, +(f + 0.1).toFixed(2))); }}>A+</button>
              </div>
            </div>
            <div className="epub-settings-row epub-settings-row--col">
              <span className="epub-settings-label">Font</span>
              <div className="epub-settings-fonts">
                {READER_FONTS.map((f) => (
                  <button
                    key={f.id}
                    className={`epub-font-option${fontId === f.id ? ' active' : ''}`}
                    style={{ fontFamily: f.stack }}
                    onClick={() => { relayoutForTextChange(); setFontId(f.id); }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="epub-settings-row">
              <span className="epub-settings-label">Theme</span>
              <div className="epub-theme-toggle">
                <button className={`epub-theme-option${readerTheme === 'light' ? ' active' : ''}`}
                  onClick={() => setReaderTheme('light')}>Light</button>
                <button className={`epub-theme-option${readerTheme === 'dark' ? ' active' : ''}`}
                  onClick={() => setReaderTheme('dark')}>Dark</button>
              </div>
            </div>
          </aside>
        </>
      )}

      <div className="epub-stage">
        <button className="epub-flip epub-flip--prev" onClick={goPrev} disabled={atStart} aria-label="Previous page">
          <ChevronLeftIcon size={28} />
        </button>

        <div
          className="epub-viewport"
          ref={viewportRef}
          onTouchStart={(e) => { touchStartX.current = e.changedTouches[0].clientX; }}
          onTouchEnd={(e) => {
            if (touchStartX.current == null) return;
            const dx = e.changedTouches[0].clientX - touchStartX.current;
            touchStartX.current = null;
            if (window.getSelection() && !window.getSelection()!.isCollapsed) {
              window.setTimeout(handleTextSelection, 0);
              return;
            }
            if (dx < -40) goNext();
            else if (dx > 40) goPrev();
          }}
        >
          <div
            key={chapterIndex}
            className={`epub-content-shell${chapterTurn ? ` epub-content-shell--${chapterTurn}` : ''}`}
            onAnimationEnd={() => setChapterTurn(null)}
          >
          <div
            className="epub-content"
            ref={contentRef}
            onMouseUp={handleTextSelection}
            style={{
              width: colW ? `${colW}px` : '100%',
              columnWidth: colW ? `${effColWidth}px` : undefined,
              columnGap: `${GAP}px`,
              fontFamily: fontStack(fontId),
              fontSize: `${fontScale}rem`,
              transform: `translateX(-${pageIndex * (colW + GAP)}px)`,
              transition: animatePage ? undefined : 'none',
            }}
          >
            {chapter?.blocks.map((b, i) => {
              if (b.type === 'img') {
                const url = b.imgHref ? imgUrls[b.imgHref] : null;
                return url
                  ? (
                    <img
                      key={i}
                      className="epub-img"
                      src={url}
                      alt=""
                      onLoad={() => {
                        setImageLayoutTick((tick) => tick + 1);
                      }}
                    />
                  )
                  : null;
              }
              const Tag = (b.type === 'p' ? 'p' : b.type) as keyof React.JSX.IntrinsicElements;
              return (
                <Tag key={i} className={`epub-${b.type === 'p' ? 'p' : 'h'}`}>
                  {b.sentences?.map((s, j) => (
                    <React.Fragment key={j}>
                      <TokenizedText text={s} savedWords={savedWordsSet} onWordClick={handleWordClick} />
                      {' '}
                    </React.Fragment>
                  ))}
                </Tag>
              );
            })}
          </div>
          </div>
        </div>

        <button className="epub-flip epub-flip--next" onClick={goNext} disabled={atEnd} aria-label="Next page">
          <ChevronRightIcon size={28} />
        </button>
      </div>

      <footer className="epub-footer">
        <span className="epub-footer-chapter">{chapter?.label || `Chapter ${chapterIndex + 1}`}</span>
        <span className="epub-footer-page">{pageIndex + 1} / {numPages}</span>
      </footer>

      {tocOpen && (
        <>
          <div className="epub-toc-backdrop" onClick={() => setTocOpen(false)} />
          <aside className="epub-toc">
            <div className="epub-toc-header">
              <span>Contents</span>
              <button className="epub-topbar-btn" onClick={() => setTocOpen(false)}><CloseIcon size={18} /></button>
            </div>
            <ul className="epub-toc-list">
              {book.chapters.map((ch, i) => (
                <li key={i}>
                  <button
                    className={`epub-toc-item${i === chapterIndex ? ' active' : ''}`}
                    onClick={() => jumpToChapter(i)}
                  >
                    {ch.label || `Chapter ${i + 1}`}
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        </>
      )}

      {popup && user && (
        <WordPopup
          word={popup.word}
          sentence={popup.sentence}
          nativeLang={user.native_language || 'en'}
          targetLang={user.target_language || undefined}
          anchorRect={popup.rect}
          onClose={() => setPopup(null)}
          isWordSaved={isWordSaved}
          isDefinitionSaved={isDefinitionSaved}
          onSaveWord={addWord}
          onOptimisticSave={addOptimistic}
        />
      )}

      {selectionPopup && user && (
        <div
          className="epub-selection-popup"
          role="dialog"
          aria-label="Explain selected text"
          style={{
            left: `${Math.max(12, Math.min(selectionPopup.rect.left, window.innerWidth - 332))}px`,
            top: `${Math.max(68, Math.min(selectionPopup.rect.bottom + 10, window.innerHeight - 230))}px`,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="epub-selection-popup-header">
            <span>{selectionPopup.selection}</span>
            <button type="button" onClick={() => setSelectionPopup(null)} aria-label="Close">&times;</button>
          </div>
          {!selectionPopup.explanation && !selectionPopup.error && (
            <button
              type="button"
              className="epub-selection-explain-btn"
              disabled={selectionPopup.loading}
              onClick={() => void requestSelectionExplanation()}
            >
              {selectionPopup.loading ? 'Asking Gemini…' : 'Explain selection'}
            </button>
          )}
          {selectionPopup.explanation && (
            <p className="epub-selection-explanation">{selectionPopup.explanation}</p>
          )}
          {selectionPopup.error && (
            <div className="epub-selection-error">
              <span>{selectionPopup.error}</span>
              <button type="button" onClick={() => void requestSelectionExplanation()}>Try again</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
