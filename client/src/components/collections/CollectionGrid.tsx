import React from 'react';

export type CollectionGridTileSize = 'compact' | 'standard' | 'wide' | 'feature';

interface CollectionGridProps<T> {
  items: T[];
  getKey: (item: T, index: number) => React.Key;
  getSize?: (item: T, index: number) => CollectionGridTileSize;
  getTileClassName?: (item: T, index: number, size: CollectionGridTileSize) => string | undefined;
  renderItem: (item: T, index: number, size: CollectionGridTileSize) => React.ReactNode;
  className?: string;
}

export default function CollectionGrid<T>({
  items,
  getKey,
  getSize,
  getTileClassName,
  renderItem,
  className = '',
}: CollectionGridProps<T>) {
  return (
    <div className={`collection-grid ${className}`.trim()}>
      {items.map((item, index) => {
        const size = getSize ? getSize(item, index) : 'standard';
        const extraClassName = getTileClassName?.(item, index, size);
        return (
          <div
            key={getKey(item, index)}
            className={`collection-grid-tile collection-grid-tile--${size}${extraClassName ? ` ${extraClassName}` : ''}`}
          >
            {renderItem(item, index, size)}
          </div>
        );
      })}
    </div>
  );
}
