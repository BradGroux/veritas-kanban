import { useEffect, useId, useRef, type ReactNode } from 'react';
import { ActionIcon, Text, Title } from '@mantine/core';
import { ArrowLeft } from 'lucide-react';

import { cn } from '@/lib/utils';

export type PrimaryPageWidth = 'standard' | 'wide';

interface PrimaryPageShellProps {
  title: string;
  subtitle?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  onBack: () => void;
  width?: PrimaryPageWidth;
  className?: string;
  contentClassName?: string;
  testId?: string;
  children: ReactNode;
}

/**
 * Shared route-entry frame for the desktop application's primary destinations.
 *
 * The outer application shell owns the window inset. This component owns the
 * page header, route-entry focus, and the content width inside that inset.
 * Data-heavy pages use `wide`; narrative pages keep the bounded default.
 */
export function PrimaryPageShell({
  title,
  subtitle,
  status,
  actions,
  onBack,
  width = 'standard',
  className,
  contentClassName,
  testId,
  children,
}: PrimaryPageShellProps) {
  const generatedId = useId();
  const headingId = `primary-page-heading-${generatedId.replace(/:/g, '')}`;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      aria-labelledby={headingId}
      data-page-shell="primary"
      data-page-width={width}
      data-testid={testId}
      className={cn(
        'primary-page-shell flex min-h-full min-w-0 flex-col',
        width === 'standard' ? 'mx-auto w-full max-w-6xl' : 'w-full max-w-none',
        className
      )}
    >
      <header className="primary-page-header grid min-h-20 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-3 border-b border-border/70 pb-4 xl:h-[5.125rem] xl:min-h-[5.125rem] xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <ActionIcon
          type="button"
          size={40}
          radius="md"
          variant="subtle"
          color="gray"
          onClick={onBack}
          aria-label="Back"
          title="Back"
          className="mt-0.5 shrink-0"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </ActionIcon>

        <div className="min-w-0">
          <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Title
              ref={headingRef}
              id={headingId}
              order={1}
              tabIndex={-1}
              style={{ fontSize: '1.5rem', lineHeight: '2rem' }}
              className="m-0 min-w-0 font-bold tracking-[-0.012em] outline-none focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {title}
            </Title>
            {status ? (
              <div className="primary-page-header-status flex min-w-0 items-center">{status}</div>
            ) : null}
          </div>
          {subtitle ? (
            <Text component="div" size="sm" c="dimmed" lh="1.25rem" className="mt-0.5">
              {subtitle}
            </Text>
          ) : null}
        </div>

        {actions ? (
          <div className="primary-page-header-actions col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-2 xl:col-span-1">
            {actions}
          </div>
        ) : null}
      </header>

      <div className={cn('primary-page-content min-w-0 flex-1 pt-5', contentClassName)}>
        {children}
      </div>
    </section>
  );
}
