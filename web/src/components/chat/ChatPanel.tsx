import { useState, useEffect, useRef, useMemo } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[500px] sm:max-w-[500px] overflow-hidden flex flex-col p-0"
        side="right"
        aria-label={taskId ? 'Task chat panel' : 'Board chat panel'}
      >
        {/* Header action buttons — positioned next to Sheet's built-in X */}
        {currentSessionId && session?.messages && session.messages.length > 0 && (
          <button
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
              a.download = `chat-${taskId || 'board'}-${new Date().toISOString().slice(0, 10)}.md`;
              a.click();
              URL.revokeObjectURL(url);
            }}
            className="absolute right-20 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:text-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          >
            <Download className="h-4 w-4" />
            <span className="sr-only">Export chat</span>
          </button>
        )}
        {currentSessionId && session?.messages && session.messages.length > 0 && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="absolute right-12 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 hover:text-destructive focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2">
                <Trash2 className="h-4 w-4" />
                <span className="sr-only">Clear chat</span>
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear chat history?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all messages in this chat. This action cannot be
                  undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    if (currentSessionId) {
                      deleteChatSession(currentSessionId, {
                        onSuccess: () => {
                          setCurrentSessionId(undefined);
                          if (taskId) {
                            setTimeout(() => setCurrentSessionId(`task_${taskId}`), 100);
                          }
                        },
                      });
                    }
                  }}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Clear History
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}

        <SheetHeader className="border-b border-border px-4 py-3 pr-10 flex-shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            {taskId ? 'Task Chat' : 'Board Chat'}
          </SheetTitle>
          {taskId && task && (
            <div className="text-xs text-muted-foreground flex items-center gap-2 pt-2 border-t border-border/50 mt-2">
              <MessageSquare className="h-3 w-3" />
              Task: {task.title}
            </div>
          )}
        </SheetHeader>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" onScrollCapture={handleScroll} ref={scrollAreaRef}>
          <div className="py-4 space-y-4" role="log" aria-label="Chat messages" aria-live="polite">
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
            <Input
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              aria-label="Chat message"
              disabled={isPending}
              className="flex-1"
              autoFocus
            />
            <Button
              onClick={handleSend}
              disabled={!message.trim() || isPending}
              size="icon"
              aria-label="Send message"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>

          {/* Mode Toggle */}
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Mode:</span>
            <Button
              variant={mode === 'ask' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('ask')}
              className="h-7 text-xs"
            >
              Ask
            </Button>
            <Button
              variant={mode === 'build' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setMode('build')}
              className="h-7 text-xs"
            >
              Build
            </Button>
            <span className="text-muted-foreground ml-1">
              {mode === 'ask' ? '· Read-only queries' : '· Changes, files, commands'}
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
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
