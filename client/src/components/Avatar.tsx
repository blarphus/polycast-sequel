import React from 'react';

interface AvatarProps {
  name: string;
  className?: string;
  children?: React.ReactNode;
}

export default function Avatar({ name, className = '', children }: AvatarProps) {
  const letter = (name || '?').charAt(0).toUpperCase();
  return (
    <div className={className}>
      {letter}
      {children}
    </div>
  );
}
