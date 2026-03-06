import React from 'react';

interface ThumbnailStackProps {
  thumbnails: string[];
}

export default function ThumbnailStack({ thumbnails }: ThumbnailStackProps) {
  const visible = thumbnails.slice(0, 3).reverse();

  return (
    <div className="home-channel-stack">
      {visible.map((thumb, i, arr) => (
        <img
          key={`${thumb}-${i}`}
          src={thumb}
          alt=""
          className={`home-channel-stack-img home-channel-stack-img--${arr.length - 1 - i}`}
        />
      ))}
    </div>
  );
}
