import { useState, useEffect, useRef, useMemo } from 'react';
import {
  ActionIcon,
  Button,
  Drawer,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import {
  MessageSquare,
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

interface ChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId?: string;
}

export function ChatPanel({ open, onOpenChange, taskId }: ChatPanelProps) {
  const [message, setMessage] = useState('');
  const [mode, setMode] = useState<'ask' | 'build'>('ask');
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const { data: task } = useTask(taskId || '');
  const { data: sessions = [] } = useChatSessions();
  const { data: session } = useChatSession(currentSessionId);
  const { mutate: sendChatMessage, isPending } = useSendChatMessage();
  const { mutate: deleteChatSession } = useDeleteChatSession();
  const { streamingMessage } = useChatStream(currentSessionId);

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
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

    sendChatMessage(
      {
        sessionId: currentSessionId,
        taskId,
        message: message.trim(),
        mode,
      },
      {
        onSuccess: (response) => {
          setCurrentSessionId(response.sessionId);
          setMessage('');
          setShouldAutoScroll(true);
          // Re-focus the input so user can keep typing
          requestAnimationFrame(() => inputRef.current?.focus());
        },
      }
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

  return (
    <>
      <Drawer
        opened={open}
        onClose={() => onOpenChange(false)}
        position="right"
        size={500}
        padding={0}
        title={
          <Group justify="space-between" wrap="nowrap" className="w-full pr-8">
            <Stack gap={4}>
              <Group gap="xs" wrap="nowrap">
                <Bot className="h-5 w-5" />
                <Text fw={600}>{taskId ? 'Task Chat' : 'Board Chat'}</Text>
              </Group>
              {taskId && task && (
                <Group gap="xs" className="border-t border-border/50 pt-2">
                  <MessageSquare className="h-3 w-3" />
                  <Text size="xs" c="dimmed">
                    Task: {task.title}
                  </Text>
                </Group>
              )}
            </Stack>
            {currentSessionId && session?.messages && session.messages.length > 0 && (
              <Group gap={4} wrap="nowrap">
                <ActionIcon
                  variant="subtle"
                  aria-label="Export chat"
                  onClick={() => {
                    if (!session?.messages?.length) return;
                    const title = taskId && task ? task.title : 'Board Chat';
                    const date = new Date().toLocaleString();
                    const lines = [`# Chat Export — ${title}`, `*Exported: ${date}*`, ''];
                    for (const msg of session.messages) {
                      const role =
                        msg.role === 'user'
                          ? '👤 User'
                          : msg.role === 'assistant'
                            ? '🤖 Assistant'
                            : '⚙️ System';
                      const time = new Date(msg.timestamp).toLocaleString();
                      lines.push('---', '', `### ${role}`, `*${time}*`, '', msg.content, '');
                    }
                    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `chat-${taskId || 'board'}-${new Date()
                      .toISOString()
                      .slice(0, 10)}.md`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-4 w-4" />
                </ActionIcon>
                <ActionIcon
                  variant="subtle"
                  color="red"
                  aria-label="Clear chat"
                  onClick={() => setClearConfirmOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                </ActionIcon>
              </Group>
            )}
          </Group>
        }
        styles={{
          content: { display: 'flex', flexDirection: 'column', overflow: 'hidden' },
          body: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
        }}
      >
        {/* Messages */}
        <ScrollArea className="flex-1 px-4" onScrollCapture={handleScroll} ref={scrollAreaRef}>
          <div className="py-4 space-y-4">
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
              <div className="text-center text-muted-foreground py-8">
                <Bot className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {taskId ? 'Start a conversation about this task' : 'Start a new chat session'}
                </p>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-border p-4 flex-shrink-0 space-y-3">
          <div className="flex items-center gap-2">
            <TextInput
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              disabled={isPending}
              className="flex-1"
              autoFocus
            />
            <ActionIcon
              onClick={handleSend}
              disabled={!message.trim() || isPending}
              aria-label="Send chat message"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </ActionIcon>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Mode:</span>
            <Button
              variant={mode === 'ask' ? 'filled' : 'outline'}
              size="xs"
              onClick={() => setMode('ask')}
            >
              Ask
            </Button>
            <Button
              variant={mode === 'build' ? 'filled' : 'outline'}
              size="xs"
              onClick={() => setMode('build')}
            >
              Build
            </Button>
            <span className="text-muted-foreground ml-1">
              {mode === 'ask' ? '· Read-only queries' : '· Changes, files, commands'}
            </span>
          </div>
        </div>
      </Drawer>
      <Modal
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
            <Button variant="outline" onClick={() => setClearConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              color="red"
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
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
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
        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-4 w-4 text-primary" />
        </div>
      )}
      <div className={`max-w-[80%] space-y-2`}>
        <div
          className={`rounded-lg px-3 py-2 text-sm ${
            isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
          }`}
        >
          <MarkdownContent content={message.content} />
          {isStreaming && <span className="inline-block w-1 h-4 bg-current animate-pulse ml-1" />}
        </div>

        {/* Tool calls */}
        {'toolCalls' in message && message.toolCalls && message.toolCalls.length > 0 && (
          <div className="space-y-1">
            {message.toolCalls.map((tool, idx) => (
              <div key={idx} className="border border-border rounded bg-zinc-950 overflow-hidden">
                <button
                  onClick={() => toggleTool(idx)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-900 transition-colors"
                >
                  {expandedTools.has(idx) ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  <code className="text-emerald-400">{tool.name}</code>
                </button>
                {expandedTools.has(idx) && (
                  <div className="px-3 pb-2 space-y-2 text-xs font-mono">
                    <div>
                      <div className="text-muted-foreground mb-1">Input:</div>
                      <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                        {tool.input}
                      </pre>
                    </div>
                    {tool.output && (
                      <div>
                        <div className="text-muted-foreground mb-1">Output:</div>
                        <pre className="text-zinc-300 whitespace-pre-wrap break-all">
                          {tool.output}
                        </pre>
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
        <div className="flex-shrink-0 h-8 w-8 rounded-full bg-primary flex items-center justify-center">
          <User className="h-4 w-4 text-primary-foreground" />
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
            <pre key={idx} className="bg-zinc-950 rounded p-2 overflow-x-auto text-xs">
              {language && <div className="text-muted-foreground mb-1">{language}</div>}
              <code className="text-zinc-300">{code}</code>
            </pre>
          );
        }

        // Inline code
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code key={idx} className="bg-zinc-800 px-1 py-0.5 rounded text-xs">
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
