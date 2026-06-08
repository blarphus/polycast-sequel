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
import { ChevronLeftIcon, ChevronRightIcon, BookOpenIcon, CloseIcon } from '../components/icons';
import { parseEpub, imageObjectUrl, type ParsedEpub } from '../utils/epub';
import { getBookData, getProgress, setProgress } from '../utils/bookStore';

const GAP = 48;
const FONT_MIN = 0.8;
const FONT_MAX = 1.7;
type PendingPageTarget = number | 'start' | 'end';

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
  const [fontScale, setFontScale] = useState(1);
  const [tocOpen, setTocOpen] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
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
  }, [book, chapter, colW, fontScale, imageLayoutTick]);

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

  const goNext = useCallback(() => {
    setPopup(null);
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
    setTocOpen(false);
    setAnimatePage(false);
    setChapterTurn(null);
    pendingPageTargetRef.current = 'start';
    setPageIndex(0);
    setChapterIndex(i);
  };

  const handleWordClick = (e: React.MouseEvent<HTMLSpanElement>, word: string, sentence: string) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setPopup({ word, sentence, rect });
  };

  const atStart = chapterIndex === 0 && pageIndex === 0;
  const atEnd = book ? (chapterIndex === book.chapters.length - 1 && pageIndex >= numPages - 1) : true;

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
    <div className="epub-reader">
      <header className="epub-topbar">
        <button className="epub-topbar-btn" title="Library" onClick={() => navigate('/books')}>
          <ChevronLeftIcon size={20} />
        </button>
        <div className="epub-topbar-title" title={book.title}>{book.title}</div>
        <div className="epub-topbar-actions">
          <button className="epub-topbar-btn" title="Smaller text"
            onClick={() => {
              pendingPageTargetRef.current = null;
              setAnimatePage(false);
              setFontScale((f) => Math.max(FONT_MIN, +(f - 0.1).toFixed(2)));
            }}>A−</button>
          <button className="epub-topbar-btn" title="Larger text"
            onClick={() => {
              pendingPageTargetRef.current = null;
              setAnimatePage(false);
              setFontScale((f) => Math.min(FONT_MAX, +(f + 0.1).toFixed(2)));
            }}>A+</button>
          <button className="epub-topbar-btn" title="Contents" onClick={() => setTocOpen(true)}>
            <BookOpenIcon size={18} />
          </button>
        </div>
      </header>

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
            style={{
              width: colW ? `${colW}px` : '100%',
              columnWidth: colW ? `${colW}px` : undefined,
              columnGap: `${GAP}px`,
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
    </div>
  );
}
