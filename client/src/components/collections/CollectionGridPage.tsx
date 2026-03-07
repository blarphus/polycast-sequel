import React from 'react';
import { ChevronLeftIcon } from '../icons';
import CollectionGrid, { type CollectionGridTileSize } from './CollectionGrid';

interface CollectionGridPageProps<T> {
  title: string;
  subtitle?: string;
  loading?: boolean;
  items: T[];
  emptyState: React.ReactNode;
  getKey: (item: T, index: number) => React.Key;
  getSize?: (item: T, index: number) => CollectionGridTileSize;
  getTileClassName?: (item: T, index: number, size: CollectionGridTileSize) => string | undefined;
  renderItem: (item: T, index: number, size: CollectionGridTileSize) => React.ReactNode;
  renderSkeleton?: (index: number) => React.ReactNode;
  skeletonCount?: number;
  backLabel?: string;
  onBack?: () => void;
  actions?: React.ReactNode;
}

export default function CollectionGridPage<T>({
  title,
  subtitle,
  loading = false,
  items,
  emptyState,
  getKey,
  getSize,
  getTileClassName,
  renderItem,
  renderSkeleton,
  skeletonCount = 8,
  backLabel = 'Back',
  onBack,
  actions,
}: CollectionGridPageProps<T>) {
  return (
    <div className="collection-page">
      <div className="collection-page-topbar">
        {onBack ? (
          <button className="collection-page-back" onClick={onBack} type="button">
            <ChevronLeftIcon size={18} />
            {backLabel}
          </button>
        ) : (
          <span />
        )}
        {actions ? <div className="collection-page-actions">{actions}</div> : null}
      </div>

      <div className="collection-page-header">
        <h1 className="collection-page-title">{title}</h1>
        {subtitle ? <p className="collection-page-subtitle">{subtitle}</p> : null}
      </div>

      {loading ? (
        <div className="collection-grid">
          {Array.from({ length: skeletonCount }, (_, index) => (
            <div
              key={index}
              className={`collection-grid-tile collection-grid-tile--${
                index % 5 === 0 ? 'feature' : index % 3 === 0 ? 'wide' : 'standard'
              }`}
            >
              {renderSkeleton ? renderSkeleton(index) : <div className="collection-tile-skeleton" />}
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="collection-empty-state">{emptyState}</div>
      ) : (
        <CollectionGrid
          items={items}
          getKey={getKey}
          getSize={getSize}
          getTileClassName={getTileClassName}
          renderItem={renderItem}
        />
      )}
    </div>
  );
}
