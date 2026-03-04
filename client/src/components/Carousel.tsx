// ---------------------------------------------------------------------------
// components/Carousel.tsx -- Reusable horizontal carousel with scroll arrows
// ---------------------------------------------------------------------------

import React, { useRef, ReactNode } from 'react';

interface CarouselProps<T> {
  title: string;
  subtitle?: string;
  items: T[];
  renderItem: (item: T, index: number) => ReactNode;
  loading?: boolean;
  skeletonCount?: number;
  renderSkeleton?: (index: number) => ReactNode;
  maxVisible?: number;
  onOverflowClick?: () => void;
}

export default function Carousel<T>({
  title,
  subtitle,
  items,
  renderItem,
  loading,
  skeletonCount = 3,
  renderSkeleton,
  maxVisible = 10,
  onOverflowClick,
}: CarouselProps<T>) {
  const carouselRef = useRef<HTMLDivElement | null>(null);

  function scrollCarousel(direction: 'left' | 'right') {
    const el = carouselRef.current;
    if (!el) return;
    const amount = Math.max(220, Math.floor(el.clientWidth * 0.85));
    el.scrollBy({
      left: direction === 'left' ? -amount : amount,
      behavior: 'smooth',
    });
  }

  const visible = items.slice(0, maxVisible);
  const overflowCount = items.length - maxVisible;

  return (
    <section className="home-section">
      <div>
        <h2 className="home-section-title">{title}</h2>
        {subtitle && <p className="home-section-subtitle">{subtitle}</p>}
      </div>
      <div className="home-carousel-shell">
        <button
          className="home-carousel-arrow home-carousel-arrow--left"
          aria-label={`Scroll ${title} left`}
          onClick={() => scrollCarousel('left')}
        >
          &#8249;
        </button>
        <div className="home-carousel" ref={carouselRef}>
          {loading && renderSkeleton
            ? Array.from({ length: skeletonCount }, (_, i) => (
                <React.Fragment key={i}>{renderSkeleton(i)}</React.Fragment>
              ))
            : (
              <>
                {visible.map((item, i) => (
                  <React.Fragment key={i}>{renderItem(item, i)}</React.Fragment>
                ))}
                {overflowCount > 0 && (
                  <div
                    className="home-carousel-card home-carousel-card--clickable carousel-overflow-card"
                    onClick={onOverflowClick}
                  >
                    <div className="carousel-overflow-inner">
                      <span className="carousel-overflow-count">+{overflowCount}</span>
                      <span className="carousel-overflow-label">more lessons</span>
                    </div>
                  </div>
                )}
              </>
            )}
        </div>
        <button
          className="home-carousel-arrow home-carousel-arrow--right"
          aria-label={`Scroll ${title} right`}
          onClick={() => scrollCarousel('right')}
        >
          &#8250;
        </button>
      </div>
    </section>
  );
}
