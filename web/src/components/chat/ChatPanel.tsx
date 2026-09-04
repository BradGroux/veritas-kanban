import { useState, useEffect, useRef, useMemo } from 'react';
import { Group, Stack, Text, TextInput } from '@mantine/core';
import {
  Send,
  ChevronDown,
  ChevronRight,
  Loader2,
  Bot,
  User,
  Trash2,
  Download,
} from 'lucide-react';
import {
  useChatSession,
  useSendChatMessage,
  useDeleteChatSession,
  useChatStream,
  useChatSessions,
} from '@/hooks/useChat';
import { useTask } from '@/hooks/useTasks';
import type { ChatMessage } from '@veritas-kanban/shared';
import { UiDrawer, UiModal } from '@/components/ui/UiOverlay';
import { UiAction, UiIconAction } from '@/components/ui/UiVocabulary';
import {
  ChatSurface,
  ChatTranscript,
  ChatComposer,
  ChatEmptyState,
  ChatMessageSurface,
} from './ChatSurface';

interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
  variant?: 'drawer' | 'inline';
  className?: string;
  /** Lets an inline host suspend its focus trap while chat owns a confirmation. */
  onModalOpenChange?: (open: boolean) => void;
}

export function ChatPanel({
  open,
  onOpenChange,
  taskId,
  variant = 'drawer',
  className,
  onModalOpenChange,
}: ChatPanelProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'ask' | 'build'>('ask');
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  useEffect(() => {
    onModalOpenChange?.(clearConfirmOpen);
    return () => onModalOpenChange?.(false);
  }, [clearConfirmOpen, onModalOpenChange]);
  const { data: task } = useTask(taskId || '');
  const { data: sessions = [] } = useChatSessions();
  const { data: session } = useChatSession(currentSessionId);
  const { mutateAsync: sendChatMessage, isPending } = useSendChatMessage();
  const { mutate: deleteChatSession } = useDeleteChatSession();
  const { streamingMessage } = useChatStream(currentSessionId);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll && scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'auto' });
    }
  }, [session?.messages, streamingMessage, shouldAutoScroll]);

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 50;
    setShouldAutoScroll(isAtBottom);
  };

  // Filter sessions by taskId if scoped
  const filteredSessions = useMemo(() => {
    if (!taskId) {
      return sessions.filter((s) => !s.taskId);
    }
    return sessions.filter((s) => s.taskId === taskId);
  }, [sessions, taskId]);

  // Handle sending a message
  const handleSend = () => {
    if (!message.trim() || isPending) return;

    // Promise completion survives Activity hiding/unsubscribing this channel.
    void sendChatMessage({
      sessionId: currentSessionId,
      taskId,
      message: message.trim(),
      mode,
    }).then(
      (response) => {
        setCurrentSessionId(response.sessionId);
        setMessage((current) => (current === message ? '' : current));
        setShouldAutoScroll(true);
        // Re-focus the input so user can keep typing
        requestAnimationFrame(() => inputRef.current?.focus());
      },
      () => undefined // Retain the draft when sending fails.
    );
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Load session on mount — task-scoped sessions use a deterministic ID
  useEffect(() => {
    if (taskId && !currentSessionId) {
      setCurrentSessionId(`task_${taskId}`);
    } else if (!taskId && !currentSessionId && filteredSessions.length > 0) {
      setCurrentSessionId(filteredSessions[0].id);
    }
  }, [filteredSessions, currentSessionId, taskId]);

  const exportChat = () => {
    if (!session?.messages?.length) return;
    const title = taskId && task ? task.title : 'Board Chat';
    const date = new Date().toLocaleString();
    const lines = [`# Chat Export — ${title}`, `*Exported: ${date}*`, ''];
    for (const msg of session.messages) {
      const role =
        msg.role === 'user' ? '👤 User' : msg.role === 'assistant' ? '🤖 Assistant' : '⚙️ System';
      const time = new Date(msg.timestamp).toLocaleString();
      lines.push('---', '', `### ${role}`, `*${time}*`, '', msg.content, '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${taskId || 'board'}-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const title = taskId ? 'Task Chat' : 'Board Chat';
  const headerActions = (
    <>
      {currentSessionId && session?.messages && session.messages.length > 0 && (
        <>
          <UiIconAction aria-label="Export chat" onClick={exportChat}>
            <Download className="h-4 w-4" />
          </UiIconAction>
          <UiIconAction aria-label="Clear chat" onClick={() => setClearConfirmOpen(true)}>
            <Trash2 className="h-4 w-4" />
          </UiIconAction>
        </>
      )}
    </>
  );

  const chatContent = (
    <>
      <ChatTranscript onScroll={handleScroll} ref={scrollAreaRef}>
        {session?.messages.map((msg) => (
          <ChatMessageBubble key={msg.id} message={msg} />
        ))}
        {streamingMessage && (
          <ChatMessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              content: streamingMessage.content || '',
              timestamp: new Date().toISOString(),
            }}
            isStreaming
          />
        )}
        {(!session || session.messages.length === 0) && !streamingMessage && (
          <ChatEmptyState icon={<Bot />}>
            {taskId ? 'Start a conversation about this task' : 'Start a new chat session'}
          </ChatEmptyState>
        )}
      </ChatTranscript>

      <ChatComposer>
        <div className="flex items-center gap-2">
          <TextInput
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Type a message..."
            aria-label={`Message ${title}`}
            disabled={isPending}
            className="min-w-0 flex-1"
            autoFocus
          />
          <UiIconAction
            onClick={handleSend}
            disabled={!message.trim() || isPending}
            aria-label="Send chat message"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </UiIconAction>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">Mode:</span>
          <UiAction
            variant={mode === 'ask' ? 'primary' : 'secondary'}
            aria-pressed={mode === 'ask'}
            onClick={() => setMode('ask')}
          >
            Ask
          </UiAction>
          <UiAction
            variant={mode === 'build' ? 'primary' : 'secondary'}
            aria-pressed={mode === 'build'}
            onClick={() => setMode('build')}
          >
            Build
          </UiAction>
          <span className="ml-1 min-w-0 text-muted-foreground">
            {mode === 'ask' ? '· Read-only queries' : '· Changes, files, commands'}
          </span>
        </div>
      </ChatComposer>
    </>
  );

  const surface = (
    <ChatSurface
      title={title}
      metadata={taskId ? (task?.title ?? taskId) : undefined}
      icon={<Bot className="h-4 w-4" aria-hidden="true" />}
      actions={headerActions}
      onClose={() => onOpenChange(false)}
      className={className}
      onKeyDown={(event) => {
        if (
          variant === 'inline' &&
          event.key === 'Escape' &&
          !clearConfirmOpen &&
          !event.defaultPrevented &&
          (event.target as HTMLElement).getAttribute('data-mantine-stop-propagation') !== 'true'
        ) {
          event.stopPropagation();
          onOpenChange(false);
        }
      }}
    >
      {chatContent}
      <UiModal
        variant="confirm"
        opened={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        centered
        title="Clear chat history?"
      >
        <Stack>
          <Text size="sm" c="dimmed">
            This will permanently delete all messages in this chat. This action cannot be undone.
          </Text>
          <Group justify="flex-end">
            <UiAction variant="secondary" onClick={() => setClearConfirmOpen(false)}>
              Cancel
            </UiAction>
            <UiAction
              variant="destructive"
              onClick={() => {
                if (currentSessionId) {
                  deleteChatSession(currentSessionId, {
                    onSuccess: () => {
                      setClearConfirmOpen(false);
                      setCurrentSessionId(undefined);
                      if (taskId) {
                        setTimeout(() => setCurrentSessionId(`task_${taskId}`), 100);
                      }
                    },
                  });
                }
              }}
            >
              Clear History
            </UiAction>
          </Group>
        </Stack>
      </UiModal>
    </ChatSurface>
  );
  if (variant === 'inline') return open ? surface : null;
  return (
    <UiDrawer
      variant="chat"
      compound
      opened={open}
      onClose={() => onOpenChange(false)}
      withCloseButton={false}
      closeOnEscape={!clearConfirmOpen}
      attributes={{ content: { 'aria-label': title } }}
    >
      {surface}
    </UiDrawer>
  );
}

interface ChatMessageBubbleProps {
  message: ChatMessage | { id: string; role: string; content: string; timestamp: string };
  isStreaming?: boolean;
}

function ChatMessageBubble({ message, isStreaming }: ChatMessageBubbleProps) {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';

  const toggleTool = (index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  if (isSystem) {
    return (
      <div className="text-center text-sm text-muted-foreground italic py-2">{message.content}</div>
    );
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div className="min-w-0 max-w-[85%] space-y-2">
        <ChatMessageSurface>
          <MarkdownContent content={message.content} />
          {isStreaming && <span className="inline-block w-1 h-4 bg-current animate-pulse ml-1" />}
        </ChatMessageSurface>

        {/* Tool calls */}
        {'toolCalls' in message && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1">
            {message.toolCalls.map((tool, idx) => (
              <div key={idx} className="border border-border rounded bg-muted overflow-hidden">
                <button
                  onClick={() => toggleTool(idx)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-accent transition-colors"
                  aria-expanded={expandedTools.has(idx)}
                >
                  {expandedTools.has(idx) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <code>{tool.name}</code>
                </button>
                {expandedTools.has(idx) && (
                  <div className="px-3 pb-2 space-y-2 text-xs font-mono">
                    <div>
                      <div className="text-muted-foreground mb-1">Input:</div>
                      <pre className="whitespace-pre-wrap break-all">{tool.input}</pre>
                    </div>
                    {tool.output && (
                      <div>
                        <div className="text-muted-foreground mb-1">Output:</div>
                        <pre className="whitespace-pre-wrap break-all">{tool.output}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground px-1">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </div>
      {isUser && (
        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-muted flex items-center justify-center">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}

/**
 * Simple markdown renderer
 * Handles code blocks and basic formatting
 */
function MarkdownContent({ content }: { content: string }) {
  // Split content by code blocks
  const parts = content.split(/(```[\s\S]*?```|`[^`]+`)/g);

  return (
    <div className="space-y-2">
      {parts.map((part, idx) => {
        // Multi-line code block
        if (part.startsWith('```')) {
          const lines = part.split('\n');
          const language = lines[0].replace('```', '').trim();
          const code = lines.slice(1, -1).join('\n');

          return (
            <pre key={idx} className="bg-muted rounded p-2 overflow-x-auto text-xs">
              {language && <div className="text-muted-foreground mb-1">{language}</div>}
              <code>{code}</code>
            </pre>
          );
        }

        // Inline code
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={idx} className="bg-muted px-1 py-0.5 rounded text-xs">
              {part.slice(1, -1)}
            </code>
          );
        }

        // Regular text
        return (
          <span key={idx} className="whitespace-pre-wrap">
            {part}
          </span>
        );
      })}
    </div>
  );
}
