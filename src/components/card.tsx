import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  hover = true,
  padding = 'p-6',
}: {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  padding?: string;
}) {
  return (
    <div className={`${hover ? 'card-base' : 'card-static'} ${padding} ${className}`}>
      {children}
    </div>
  );
}
