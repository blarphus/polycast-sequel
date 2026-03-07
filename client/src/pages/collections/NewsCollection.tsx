import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import CollectionGridPage from '../../components/collections/CollectionGridPage';
import type { CollectionGridTileSize } from '../../components/collections/CollectionGrid';
import { getNews, type NewsArticle } from '../../api';
import { useAuth } from '../../hooks/useAuth';
import { LANGUAGES } from '../../components/classwork/languages';
import { useCollectionCardTextFit } from '../../hooks/useCollectionCardTextFit';

interface NewsCollectionItem {
  article: NewsArticle;
  originalIndex: number;
}

function getNewsTileSize(_article: NewsArticle, index: number): CollectionGridTileSize {
  if (index === 0) return 'feature';
  if (index === 1) return 'standard';
  // Repeating 7-item cycle: wide, std, std, std, std, std, wide
  // Rows: [8+4] [4+4+4] [4+8] — fills 12-col grid cleanly
  const pos = (index - 2) % 7;
  if (pos === 0 || pos === 6) return 'wide';
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
  const {
    bodyRef,
    textRef,
    titleRef,
    titleStyle,
    secondaryStyle,
    showSecondary,
  } = useCollectionCardTextFit({
    title: article.simplified_title,
    secondaryText: article.preview,
    variant: size,
  });

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
          <span className="collection-card-source">{article.source}</span>
        ) : null}

        <div className="collection-card-text" ref={textRef}>
          <h2 className="collection-card-title" ref={titleRef} style={titleStyle}>
            {article.simplified_title}
          </h2>

          {article.preview && showSecondary ? (
            <p className="collection-card-preview" style={secondaryStyle}>{article.preview}</p>
          ) : null}
        </div>

        <div className="collection-card-meta">
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

        if (heroCandidateIndex > 0) {
          const [heroCandidate] = collectionItems.splice(heroCandidateIndex, 1);
          collectionItems.unshift(heroCandidate);
        }

        // Ensure index 1 (beside hero) has an image
        if (collectionItems.length > 2 && !collectionItems[1].article.image) {
          const firstImageIdx = collectionItems.findIndex((item, i) => i > 1 && item.article.image);
          if (firstImageIdx !== -1) {
            const [imageItem] = collectionItems.splice(firstImageIdx, 1);
            collectionItems.splice(1, 0, imageItem);
          }
        }

        setArticles(collectionItems);
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
