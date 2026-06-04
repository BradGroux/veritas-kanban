import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

import { LazyOnVisible } from '@/components/shared/LazyOnVisible';

describe('LazyOnVisible', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders children only after the container enters the viewport', () => {
    let observerCallback: IntersectionObserverCallback | undefined;
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback;
      }

      observe = observe;
      disconnect = disconnect;
    }

    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);

    render(
      <LazyOnVisible fallback={<span>Deferred section</span>}>
        <span>Loaded section</span>
      </LazyOnVisible>
    );

    expect(screen.getByText('Deferred section')).toBeDefined();
    expect(screen.queryByText('Loaded section')).toBeNull();
    expect(observe).toHaveBeenCalledTimes(1);

    act(() => {
      observerCallback?.(
        [
          {
            isIntersecting: true,
            intersectionRatio: 1,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
    });

    expect(screen.getByText('Loaded section')).toBeDefined();
    expect(screen.queryByText('Deferred section')).toBeNull();
    expect(disconnect).toHaveBeenCalled();
  });
});
