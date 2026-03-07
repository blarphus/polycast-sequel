import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CollectionGridPage from '../../components/collections/CollectionGridPage';
import type { CollectionGridTileSize } from '../../components/collections/CollectionGrid';
import { getNews, type NewsArticle } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { LANGUAGES } from '../../components/classwork/languages';
import { CEFR_COLORS } from '../../utils/videoFormat';

interface NewsCollectionItem {
  article: NewsArticle;
  originalIndex: number;
}

function getNewsTileSize(_article: NewsArticle, index: number): CollectionGridTileSize {
  if (index === 0) return 'feature';
  return 'standard';
}

function getHeroPromotionScore(article: NewsArticle, index: number): number {
  const baseSize = getNewsTileSize(article, index);
  const sizeScore =
    baseSize === 'feature' ? 4 :
    baseSize === 'wide' ? 3 :
    baseSize === 'standard' ? 2 : 1;

  const imageScore = article.image ? 10 : 0;
  const wordScore = Math.min(article.words.length, 4) * 0.25;
  const titleScore = Math.min(article.simplified_title.length / 45, 2);

  return imageScore + sizeScore + wordScore + titleScore;
}

function getNewsTileClasses(article: NewsArticle): string | undefined {
  return article.image ? undefined : 'collection-grid-tile--text-only';
}

function NewsTile({
  article,
  size,
  onOpen,
}: {
  article: NewsArticle;
  size: CollectionGridTileSize;
  onOpen: () => void;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const sourceRef = useRef<HTMLSpanElement | null>(null);
  const metaRef = useRef<HTMLDivElement | null>(null);
  const [titleStyle, setTitleStyle] = useState<React.CSSProperties>({});

  useEffect(() => {
    let frame = 0;
    const bodyEl = bodyRef.current;
    const titleEl = titleRef.current;

    if (!bodyEl || !titleEl) return undefined;

    const measure = () => {
      frame = 0;
      try {
        const sourceEl = sourceRef.current;
        const metaEl = metaRef.current;
        const computedBody = window.getComputedStyle(bodyEl);
        const gap = parseFloat(computedBody.rowGap || computedBody.gap || '0') || 0;
        const nonTitleCount = [sourceEl, metaEl].filter(Boolean).length;
        const nonTitleHeight =
          (sourceEl?.offsetHeight || 0) +
          (metaEl?.offsetHeight || 0) +
          gap * nonTitleCount;
        const availableHeight = Math.max(48, bodyEl.clientHeight - nonTitleHeight);
        const availableWidth = Math.max(140, titleEl.clientWidth || bodyEl.clientWidth);
        const lineHeightRatio = size === 'feature' ? 1.05 : size === 'wide' ? 1.1 : 1.14;
        const maxFontSize = Math.min(
          size === 'feature' ? 56 : size === 'wide' ? 34 : 28,
          availableHeight / lineHeightRatio,
        );
        const minFontSize = size === 'feature' ? 20 : 16;

        const probe = document.createElement('div');
        const computedTitle = window.getComputedStyle(titleEl);
        probe.textContent = article.simplified_title;
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        probe.style.pointerEvents = 'none';
        probe.style.inset = '0 auto auto 0';
        probe.style.width = `${availableWidth}px`;
        probe.style.fontFamily = computedTitle.fontFamily;
        probe.style.fontWeight = computedTitle.fontWeight;
        probe.style.letterSpacing = computedTitle.letterSpacing;
        probe.style.whiteSpace = 'normal';
        probe.style.wordBreak = 'break-word';
        bodyEl.appendChild(probe);

        let low = minFontSize;
        let high = maxFontSize;
        let best = minFontSize;

        for (let i = 0; i < 10; i += 1) {
          const mid = (low + high) / 2;
          probe.style.fontSize = `${mid}px`;
          probe.style.lineHeight = String(lineHeightRatio);
          const measuredHeight = probe.getBoundingClientRect().height;
          if (measuredHeight <= availableHeight) {
            best = mid;
            low = mid;
          } else {
            high = mid;
          }
        }

        probe.remove();
        const nextStyle = {
          fontSize: `${best.toFixed(2)}px`,
          lineHeight: String(lineHeightRatio),
        };

        setTitleStyle((prev) => (
          prev.fontSize === nextStyle.fontSize &&
          prev.lineHeight === nextStyle.lineHeight
            ? prev
            : nextStyle
        ));
      } catch (error) {
        console.error('Failed to dynamically size news title:', error);
      }
    };

    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(bodyEl);
    const cardEl = bodyEl.closest('.collection-card');
    if (cardEl) resizeObserver.observe(cardEl);

    scheduleMeasure();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [article.simplified_title, size]);

  return (
    <button
      className={
        `collection-card collection-card--news collection-card--${size}` +
        `${article.image ? '' : ' collection-card--text-only'}`
      }
      onClick={onOpen}
      type="button"
    >
      {article.image ? (
        <div className={`collection-card-media collection-card-media--${size}`}>
          <img src={article.image} alt="" className="collection-card-media-img" />
          <div className="collection-card-media-overlay" />
          <span className="collection-card-source collection-card-source--overlay">{article.source}</span>
        </div>
      ) : null}

      <div className="collection-card-body" ref={bodyRef}>
        {!article.image ? (
          <span className="collection-card-source" ref={sourceRef}>{article.source}</span>
        ) : null}

        <h2 className="collection-card-title" ref={titleRef} style={titleStyle}>
          {article.simplified_title}
        </h2>

        <div className="collection-card-meta" ref={metaRef}>
          {article.difficulty ? (
            <span
              className="collection-card-pill"
              style={{ background: CEFR_COLORS[article.difficulty] || 'var(--accent)' }}
            >
              {article.difficulty}
            </span>
          ) : null}

          {article.words.slice(0, article.image ? 3 : 4).map((word) => (
            <span key={word.word} className="collection-card-tag">
              {word.word}
            </span>
          ))}
        </div>
      </div>
    </button>
  );
}

export default function NewsCollection() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [articles, setArticles] = useState<NewsCollectionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const targetLang = user?.target_language;
  const langName = LANGUAGES.find((entry) => entry.code === targetLang)?.name || targetLang || 'your language';
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/');
  };

  useEffect(() => {
    let cancelled = false;

    if (!targetLang) {
      setArticles([]);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    getNews(targetLang, user?.cefr_level)
      .then((items) => {
        if (cancelled) return;
        const collectionItems = items.map((article, originalIndex) => ({ article, originalIndex }));
        const heroCandidateIndex = collectionItems.reduce((bestIndex, item, index, list) => {
          if (!item.article.image) return bestIndex;
          if (bestIndex === -1) return index;
          const best = list[bestIndex];
          return getHeroPromotionScore(item.article, item.originalIndex) >
            getHeroPromotionScore(best.article, best.originalIndex)
            ? index
            : bestIndex;
        }, -1);

        if (heroCandidateIndex <= 0) {
          setArticles(collectionItems);
          return;
        }

        const [heroCandidate] = collectionItems.splice(heroCandidateIndex, 1);
        setArticles([heroCandidate, ...collectionItems]);
      })
      .catch((error) => {
        console.error('Failed to fetch news collection:', error);
        if (!cancelled) setArticles([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [targetLang, user?.cefr_level]);

  return (
    <CollectionGridPage
      title="News for You"
      subtitle={`Browse all available headlines in ${langName}.`}
      loading={loading}
      items={articles}
      emptyState={
        <p>{targetLang ? 'No news articles available right now.' : 'Set a target language in Settings to see news.'}</p>
      }
      onBack={handleBack}
      backLabel="Back"
      getKey={(item) => `${item.originalIndex}-${item.article.link}`}
      getSize={(item, index) => getNewsTileSize(item.article, index)}
      getTileClassName={(item) => getNewsTileClasses(item.article)}
      renderSkeleton={(index) => (
        <div className={`collection-card collection-card--skeleton collection-card--skeleton-${index % 2 === 0 ? 'media' : 'text'}`}>
          <div className="collection-card-skeleton-media" />
          <div className="collection-card-body">
            <div className="collection-card-skeleton-line collection-card-skeleton-line--short" />
            <div className="collection-card-skeleton-line" />
            <div className="collection-card-skeleton-line collection-card-skeleton-line--medium" />
          </div>
        </div>
      )}
      renderItem={(item, index, size) => (
        <NewsTile
          article={item.article}
          size={size}
          onOpen={() => navigate(`/read/${targetLang}/${item.originalIndex}`)}
        />
      )}
    />
  );
}
