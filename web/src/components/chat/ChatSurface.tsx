import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { UiHeading, UiIconAction } from '@/components/ui/UiVocabulary';
import { cn } from '@/lib/utils';

/** Shared chrome for Board, Squad, and task-scoped conversations. */
export function ChatSurface({
  title,
  metadata,
  icon,
  actions,
  onClose,
  children,
  className,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title: string;
  metadata?: string;
  icon: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <section
      {...props}
      aria-label={metadata ? `${title}: ${metadata}` : title}
      className={cn('vk-chat-surface', className)}
    >
      <header className="vk-chat-header desktop-no-drag">
        <div className="min-w-0 flex-1">
          <UiHeading order={3} className="flex items-center gap-2">
            {icon}
            {title}
          </UiHeading>
          {metadata && <p className="vk-chat-metadata">{metadata}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          {actions}
          <UiIconAction aria-label={`Close ${title} panel`} onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </UiIconAction>
        </div>
      </header>
      {children}
    </section>
  );
}

export const ChatTranscript = forwardRef<HTMLDivElement, ComponentProps<'div'>>(
  function ChatTranscript({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={cn('vk-chat-transcript', className)} />;
  }
);

export function ChatComposer({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('vk-chat-composer', className)} />;
}

export function ChatMessageSurface({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('vk-chat-message', className)} />;
}

export function ChatEmptyState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="vk-chat-empty">
      <span aria-hidden="true">{icon}</span>
      <p>{children}</p>
    </div>
  );
}
