import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface LazyOnVisibleProps {
  children: ReactNode;
  fallback?: ReactNode;
  rootMargin?: string;
  className?: string;
  minHeight?: CSSProperties['minHeight'];
}

export function LazyOnVisible({
  children,
  fallback = null,
  rootMargin = '320px 0px',
  className,
  minHeight,
}: LazyOnVisibleProps) {
  const [shouldRender, setShouldRender] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (shouldRender) return;

    const node = containerRef.current;
    if (!node) return;

    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
          setShouldRender(true);
          observer.disconnect();
        }
      },
      { rootMargin }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [rootMargin, shouldRender]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={!shouldRender && minHeight ? { minHeight } : undefined}
    >
      {shouldRender ? children : fallback}
    </div>
  );
}
