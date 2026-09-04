import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Badge, Popover, Select, Text, TextInput, Tooltip } from '@mantine/core';
import {
  CheckCircle2,
  Filter,
  Loader2,
  Pin,
  Reply,
  Search,
  Send,
  Settings2,
  Users,
  X,
} from 'lucide-react';
import {
  useAddSquadReaction,
  useMarkSquadRead,
  useSendSquadMessage,
  useSquadMessages,
  useSquadSearch,
  useSquadStream,
  useSquadUnread,
  useUpdateSquadMessageState,
} from '@/hooks/useChat';
import { useConfig } from '@/hooks/useConfig';
import { useFeatureSetting } from '@/hooks/useFeatureSettings';
import type { SquadMessage } from '@veritas-kanban/shared';
import { UiDrawer } from '@/components/ui/UiOverlay';
import { UiAction, UiIconAction } from '@/components/ui/UiVocabulary';
import {
  ChatSurface,
  ChatTranscript,
  ChatComposer,
  ChatEmptyState,
  ChatMessageSurface,
} from './ChatSurface';

interface SquadChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  variant?: 'drawer' | 'inline';
  className?: string;
}

function safeSquadLinkHref(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      if (parsed.username || parsed.password) return undefined;
      return parsed.toString();
    }
    if (parsed.protocol !== 'buzz:' || parsed.hostname !== 'message') return undefined;
    const channelId = parsed.searchParams.get('channel');
    const eventId = parsed.searchParams.get('id');
    const threadId = parsed.searchParams.get('thread');
    if (
      !channelId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        channelId
      ) ||
      !eventId ||
      !/^[a-f0-9]{64}$/i.test(eventId) ||
      (threadId && !/^[a-f0-9]{64}$/i.test(threadId))
    ) {
      return undefined;
    }
    return value;
  } catch {
    return undefined;
  }
}

function readIncludeSystemPreference(): boolean {
  try {
    const saved = window.localStorage.getItem('squadChat.includeSystem');
    return saved === null ? true : saved === 'true';
  } catch {
    return true;
  }
}

function writeIncludeSystemPreference(includeSystem: boolean): void {
  try {
    window.localStorage.setItem('squadChat.includeSystem', includeSystem.toString());
  } catch {
    // Ignore storage failures in restricted browser/test environments.
  }
}

export function SquadChatPanel({
  open,
  onOpenChange,
  variant = 'drawer',
  className,
}: SquadChatPanelProps) {
  const humanDisplayName = useFeatureSetting('general', 'humanDisplayName');
  const { data: config } = useConfig();

  // Load includeSystem preference from localStorage
  const [includeSystem, setIncludeSystem] = useState<boolean>(readIncludeSystemPreference);

  // Save includeSystem preference to localStorage
  useEffect(() => {
    writeIncludeSystemPreference(includeSystem);
  }, [includeSystem]);

  // Available senders: human first, then the enabled configured agents.
  const availableAgents = Array.from(
    new Set([
      humanDisplayName || 'Human',
      ...(config?.agents ?? []).filter((agent) => agent.enabled).map((agent) => agent.name),
    ])
  );

  const [message, setMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(humanDisplayName || 'Human'); // Human user default (from settings)
  const [agentFilter, setAgentFilter] = useState<string>('all');
  const [replyTo, setReplyTo] = useState<SquadMessage | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  // Sync selectedAgent when humanDisplayName loads from settings
  useEffect(() => {
    if (humanDisplayName) {
      setSelectedAgent((prev) => (prev === 'Human' || prev === '' ? humanDisplayName : prev));
    }
  }, [humanDisplayName]);
  const { data: messages = [], isLoading } = useSquadMessages({ limit: 50, includeSystem });
  const { mutateAsync: sendMessage, isPending } = useSendSquadMessage();
  const { newMessage } = useSquadStream();
  const actorForRead = selectedAgent === humanDisplayName ? 'Human' : selectedAgent;
  const { data: unreadState } = useSquadUnread(actorForRead);
  const { data: searchResponse } = useSquadSearch({
    query: searchQuery,
    limit: 8,
    includeSystem,
    agent: agentFilter === 'all' ? undefined : agentFilter,
  });
  const { mutate: markRead, isPending: isMarkingRead } = useMarkSquadRead();
  const { mutate: updateMessageState } = useUpdateSquadMessageState();
  const { mutate: addReaction } = useAddSquadReaction();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Scroll helper — finds the actual scrollable viewport inside ScrollArea
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const viewport = scrollAreaRef.current;
    if (viewport) {
      viewport.scrollTo({
        top: viewport.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : behavior,
      });
    }
  }, []);

  // Auto-scroll to bottom when panel opens
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure DOM is fully rendered
      const timer = setTimeout(() => {
        scrollToBottom('instant');
        setShouldAutoScroll(true);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [open, scrollToBottom]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (shouldAutoScroll) {
      scrollToBottom();
    }
  }, [messages, newMessage, shouldAutoScroll, scrollToBottom]);

  // Detect manual scroll-up to pause auto-scroll
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.target as HTMLDivElement;
    const isAtBottom = Math.abs(target.scrollHeight - target.scrollTop - target.clientHeight) < 50;
    setShouldAutoScroll(isAtBottom);
  };

  const handleSend = () => {
    if (!message.trim() || isPending) return;

    // Send "Human" to backend if user selected their display name, otherwise send the agent name
    const agentForBackend = selectedAgent === humanDisplayName ? 'Human' : selectedAgent;

    // Complete even when Activity has suspended the hidden channel's observer.
    void sendMessage({
      agent: agentForBackend,
      message: message.trim(),
      replyToId: replyTo?.id,
    }).then(
      () => {
        setMessage((current) => (current === message ? '' : current));
        setReplyTo((current) => (current?.id === replyTo?.id ? null : current));
        setShouldAutoScroll(true);
        // Force scroll to bottom immediately after sending
        setTimeout(() => scrollToBottom(), 100);
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

  const latestMessageId = messages[messages.length - 1]?.id;

  const handleMarkRead = () => {
    markRead({ actor: actorForRead, messageId: latestMessageId });
  };

  const handleJumpToMessage = (messageId: string) => {
    setActiveMessageId(messageId);
    requestAnimationFrame(() => {
      const target = document.getElementById(`squad-message-${messageId}`);
      const viewport = scrollAreaRef.current;
      if (target && viewport)
        viewport.scrollTo({
          top:
            viewport.scrollTop +
            target.getBoundingClientRect().top -
            viewport.getBoundingClientRect().top -
            (viewport.clientHeight - target.clientHeight) / 2,
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
        });
    });
    window.setTimeout(() => setActiveMessageId(null), 2500);
  };

  // Filter messages by agent
  const filteredMessages =
    agentFilter === 'all' ? messages : messages.filter((m) => m.agent === agentFilter);

  const threadedMessages = useMemo(() => {
    const visibleIds = new Set(filteredMessages.map((msg) => msg.id));
    const repliesByThread = new Map<string, SquadMessage[]>();
    const nestedIds = new Set<string>();

    for (const msg of filteredMessages) {
      if (!msg.replyToId) continue;
      const rootId = msg.threadId ?? msg.replyToId;
      if (!visibleIds.has(rootId) || msg.id === rootId) continue;
      nestedIds.add(msg.id);
      repliesByThread.set(rootId, [...(repliesByThread.get(rootId) ?? []), msg]);
    }

    return filteredMessages
      .filter((msg) => !nestedIds.has(msg.id))
      .map((msg) => ({
        message: msg,
        replies: repliesByThread.get(msg.id) ?? [],
      }));
  }, [filteredMessages]);

  // Get unique agents from messages
  const uniqueAgents = Array.from(new Set(messages.map((m) => m.agent))).sort();

  const filters = (
    <Popover
      position="bottom-end"
      withinPortal
      width="min(24rem, calc(100vw - 2rem))"
      opened={filtersOpen}
      onChange={setFiltersOpen}
      // Handle Escape after the nested Select, not in Popover's capture handler.
      closeOnEscape={false}
      returnFocus
    >
      <Popover.Target>
        <UiIconAction
          aria-label="Squad filters and actions"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && filtersOpen) {
              event.stopPropagation();
              setFiltersOpen(false);
            }
          }}
        >
          <Filter className="h-4 w-4" />
        </UiIconAction>
      </Popover.Target>
      <Popover.Dropdown
        aria-label="Squad filters and actions"
        onKeyDown={(event) => {
          if (
            event.key === 'Escape' &&
            !event.defaultPrevented &&
            (event.target as HTMLElement).getAttribute('data-mantine-stop-propagation') !== 'true'
          ) {
            event.stopPropagation();
            setFiltersOpen(false);
          }
        }}
      >
        <div className="vk-chat-toolbar">
          <Select
            value={agentFilter}
            onChange={(value) => setAgentFilter(value ?? 'all')}
            allowDeselect={false}
            style={{ flex: '1 1 10rem', minWidth: 0 }}
            leftSection={<Filter className="h-3.5 w-3.5" aria-hidden="true" />}
            data={[
              { value: 'all', label: 'All Agents' },
              ...uniqueAgents.map((agent) => ({ value: agent, label: agent })),
            ]}
            aria-label="Filter by agent"
          />
          <TextInput
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            leftSection={<Search className="h-3.5 w-3.5" />}
            placeholder="Search"
            aria-label="Search squad chat"
            style={{ flex: '1 1 10rem', minWidth: 0 }}
          />
          <UiAction
            variant="secondary"
            onClick={handleMarkRead}
            style={{ flexShrink: 0 }}
            disabled={!latestMessageId || isMarkingRead}
            leftSection={<CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Mark read
            {unreadState?.unreadCount ? (
              <Badge size="xs" ml={6} variant="light">
                {unreadState.mentionCount
                  ? `${unreadState.unreadCount}/${unreadState.mentionCount}`
                  : unreadState.unreadCount}
              </Badge>
            ) : null}
          </UiAction>
          <UiAction
            variant="secondary"
            aria-pressed={includeSystem}
            onClick={() => setIncludeSystem(!includeSystem)}
            className="gap-1.5"
            style={{ flexShrink: 0 }}
            title={includeSystem ? 'Hide system messages' : 'Show system messages'}
            leftSection={<Settings2 className="h-3.5 w-3.5" />}
          >
            {includeSystem ? 'Hide' : 'Show'} System
          </UiAction>
        </div>
      </Popover.Dropdown>
    </Popover>
  );

  const panelContent = (
    <ChatSurface
      title="Squad Chat"
      icon={<Users className="h-4 w-4" aria-hidden="true" />}
      onClose={() => onOpenChange(false)}
      actions={filters}
      className={className}
    >
      <ChatTranscript onScroll={handleScroll} ref={scrollAreaRef}>
        {searchQuery.trim() && (
          <div className="rounded-md border border-border bg-background/80 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <Text size="xs" fw={600}>
                Search results
              </Text>
              <Badge size="xs" variant="light">
                {searchResponse?.results.length ?? 0}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {(searchResponse?.results ?? []).map((result) => (
                <button
                  key={result.messageId}
                  type="button"
                  onClick={() => handleJumpToMessage(result.messageId)}
                  className="w-full rounded border border-border/70 bg-muted/40 px-2 py-1.5 text-left text-xs hover:bg-muted"
                >
                  <span className="font-medium">{result.displayName || result.agent}</span>
                  <span className="ml-2 text-muted-foreground">
                    {new Date(result.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="block truncate text-muted-foreground">{result.snippet}</span>
                </button>
              ))}
              {searchResponse?.results.length === 0 && (
                <Text size="xs" c="dimmed">
                  No matching messages.
                </Text>
              )}
            </div>
          </div>
        )}
        {isLoading && (
          <ChatEmptyState icon={<Loader2 className="animate-spin" />}>
            Loading messages...
          </ChatEmptyState>
        )}
        {!isLoading && filteredMessages.length === 0 && (
          <ChatEmptyState icon={<Users />}>
            {agentFilter === 'all'
              ? 'No messages yet. Be the first to say something!'
              : `No messages from ${agentFilter}`}
          </ChatEmptyState>
        )}
        {threadedMessages.map(({ message: msg, replies }) =>
          msg.system ? (
            <SystemMessageDivider key={msg.id} message={msg} activeMessageId={activeMessageId} />
          ) : (
            <SquadMessageBubble
              key={msg.id}
              message={msg}
              replies={replies}
              humanDisplayName={humanDisplayName}
              actor={actorForRead}
              activeMessageId={activeMessageId}
              onReply={setReplyTo}
              onJump={handleJumpToMessage}
              onTogglePin={(target) =>
                updateMessageState({ messageId: target.id, pinned: !target.pinned })
              }
              onMarkDecision={(target) =>
                updateMessageState({ messageId: target.id, decision: !target.decision })
              }
              onAck={(target) =>
                addReaction({ messageId: target.id, actor: actorForRead, reaction: 'ack' })
              }
            />
          )
        )}
      </ChatTranscript>

      {/* Input Area */}
      <ChatComposer>
        {replyTo && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-2 py-1.5">
            <Text size="xs" c="dimmed" truncate>
              Replying to {replyTo.displayName || replyTo.agent}: {replyTo.message}
            </Text>
            <UiIconAction aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
              <X className="h-3.5 w-3.5" />
            </UiIconAction>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Sending as:</span>
          <Select
            value={selectedAgent}
            onChange={(value) => setSelectedAgent(value ?? humanDisplayName ?? 'Human')}
            allowDeselect={false}
            style={{ flex: '1 1 10rem', minWidth: 0 }}
            data={availableAgents.map((agent) => ({ value: agent, label: agent }))}
            aria-label="Sending as"
          />
        </div>
        <div className="flex items-center gap-2">
          <TextInput
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Send a message to the squad..."
            aria-label="Message Squad Chat"
            disabled={isPending}
            className="min-w-0 flex-1"
            autoFocus
          />
          <UiIconAction
            onClick={handleSend}
            disabled={!message.trim() || isPending}
            aria-label="Send squad message"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </UiIconAction>
        </div>
      </ChatComposer>
    </ChatSurface>
  );

  return variant === 'inline' ? (
    open && panelContent
  ) : (
    <UiDrawer
      opened={open}
      onClose={() => onOpenChange(false)}
      variant="chat"
      compound
      withCloseButton={false}
      attributes={{ content: { 'aria-label': 'Squad Chat' } }}
    >
      {panelContent}
    </UiDrawer>
  );
}

interface SquadMessageBubbleProps {
  message: SquadMessage;
  replies?: SquadMessage[];
  humanDisplayName: string;
  actor: string;
  activeMessageId: string | null;
  onReply: (message: SquadMessage) => void;
  onJump: (messageId: string) => void;
  onTogglePin: (message: SquadMessage) => void;
  onMarkDecision: (message: SquadMessage) => void;
  onAck: (message: SquadMessage) => void;
  compact?: boolean;
}

const SquadMessageBubble = React.memo(function SquadMessageBubble({
  message,
  replies = [],
  humanDisplayName,
  actor,
  activeMessageId,
  onReply,
  onJump,
  onTogglePin,
  onMarkDecision,
  onAck,
  compact = false,
}: SquadMessageBubbleProps) {
  const isHuman = message.agent === 'Human';
  // Use the display name for Human agents, otherwise use the agent name
  const displayName = isHuman ? humanDisplayName : message.agent;
  const isActive = activeMessageId === message.id;
  const ackCount = message.reactions?.filter((reaction) => reaction.reaction === 'ack').length ?? 0;
  const hasActorAck = message.reactions?.some(
    (reaction) =>
      reaction.reaction === 'ack' && reaction.actor.toLowerCase() === actor.toLowerCase()
  );
  const replyTargetId = message.replyToId;

  return (
    <ChatMessageSurface
      id={`squad-message-${message.id}`}
      className={`transition-shadow ${compact ? 'ml-3 border-l-2 py-2' : ''} ${
        isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-sm">
            {displayName}
            {isHuman && <span className="ml-1 text-xs opacity-70">(Human)</span>}
          </span>
          {message.model && <span className="text-xs opacity-50 font-mono">{message.model}</span>}
          {replyTargetId && (
            <Tooltip label="Jump to parent message">
              <button
                type="button"
                onClick={() => onJump(replyTargetId)}
                className="text-xs opacity-70 underline-offset-2 hover:underline"
              >
                reply
              </button>
            </Tooltip>
          )}
          {message.pinned && (
            <Badge size="xs" variant="light" leftSection={<Pin className="h-3 w-3" />}>
              pinned
            </Badge>
          )}
          {message.decision && (
            <Badge
              size="xs"
              color="green"
              variant="light"
              leftSection={<CheckCircle2 className="h-3 w-3" />}
            >
              decision
            </Badge>
          )}
          {message.tags && message.tags.length > 0 && (
            <div className="flex gap-1">
              {message.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded bg-background/50 border border-current/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {message.links?.map((link) => {
            const safeHref = safeSquadLinkHref(link.href);
            return (
              <Badge
                key={`${link.taskId ?? ''}-${link.runId ?? ''}-${link.href ?? ''}`}
                size="xs"
                variant="outline"
                {...(safeHref
                  ? {
                      component: 'a',
                      href: safeHref,
                      rel: 'noreferrer',
                      'aria-label': link.label || 'Open linked item',
                    }
                  : {})}
              >
                {link.label || link.taskId || link.runId || 'link'}
              </Badge>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-xs opacity-70">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
          {!compact && (
            <>
              <Tooltip label="Reply">
                <UiIconAction
                  aria-label="Reply to message"
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    onReply(message);
                  }}
                  onClick={() => onReply(message)}
                >
                  <Reply className="h-3.5 w-3.5" />
                </UiIconAction>
              </Tooltip>
              <Tooltip label={message.pinned ? 'Unpin' : 'Pin'}>
                <UiIconAction
                  aria-pressed={Boolean(message.pinned)}
                  aria-label={message.pinned ? 'Unpin message' : 'Pin message'}
                  onClick={() => onTogglePin(message)}
                >
                  <Pin className="h-3.5 w-3.5" />
                </UiIconAction>
              </Tooltip>
              <Tooltip label={message.decision ? 'Unmark decision' : 'Mark decision'}>
                <UiIconAction
                  aria-pressed={Boolean(message.decision)}
                  aria-label={message.decision ? 'Unmark decision' : 'Mark decision'}
                  onClick={() => onMarkDecision(message)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </UiIconAction>
              </Tooltip>
              <Tooltip label="Acknowledge">
                <UiIconAction
                  aria-pressed={Boolean(hasActorAck)}
                  aria-label="Acknowledge message"
                  onClick={() => onAck(message)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </UiIconAction>
              </Tooltip>
            </>
          )}
        </div>
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">
        <MentionedText text={message.message} />
      </div>
      {(ackCount > 0 || replies.length > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs opacity-75">
          {ackCount > 0 && (
            <span>
              {ackCount} ack{ackCount === 1 ? '' : 's'}
            </span>
          )}
          {replies.length > 0 && (
            <span>
              {replies.length} repl{replies.length === 1 ? 'y' : 'ies'}
            </span>
          )}
        </div>
      )}
      {replies.length > 0 && (
        <div className="mt-3 space-y-2 border-l border-current/25 pl-2">
          {replies.map((reply) => (
            <SquadMessageBubble
              key={reply.id}
              message={reply}
              humanDisplayName={humanDisplayName}
              actor={actor}
              activeMessageId={activeMessageId}
              onReply={onReply}
              onJump={onJump}
              onTogglePin={onTogglePin}
              onMarkDecision={onMarkDecision}
              onAck={onAck}
              compact
            />
          ))}
        </div>
      )}
    </ChatMessageSurface>
  );
});

function MentionedText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(@[a-zA-Z0-9_-]+)/g).map((part, index) =>
        part.startsWith('@') ? (
          <span key={`${part}-${index}`} className="rounded bg-background/50 px-1 font-medium">
            {part}
          </span>
        ) : (
          <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
        )
      )}
    </>
  );
}

interface SystemMessageDividerProps {
  message: SquadMessage;
  activeMessageId: string | null;
}

const SystemMessageDivider = React.memo(function SystemMessageDivider({
  message,
  activeMessageId,
}: SystemMessageDividerProps) {
  // Format system message based on event type
  const getEventIcon = () => {
    switch (message.event) {
      case 'agent.spawned':
        return '🚀';
      case 'agent.completed':
        return '✅';
      case 'agent.failed':
        return '❌';
      case 'agent.status':
        return '⏳';
      default:
        return '🔔';
    }
  };

  const getEventText = () => {
    const duration = message.duration ? ` (${message.duration})` : '';
    const taskTitle = message.taskTitle ? `: ${message.taskTitle}` : '';
    const model = message.model ? ` [${message.model}]` : '';

    switch (message.event) {
      case 'agent.spawned':
        return `${message.agent}${model} assigned${taskTitle}`;
      case 'agent.completed':
        return `${message.agent}${model} completed${taskTitle}${duration}`;
      case 'agent.failed':
        return `${message.agent}${model} failed${taskTitle}${duration}`;
      case 'agent.status':
        return `${message.agent}${model} is working on${taskTitle}${duration}`;
      default:
        return message.message;
    }
  };

  // All system messages use consistent gray/muted styling
  return (
    <div
      id={`squad-message-${message.id}`}
      className={`rounded-lg border border-border p-3 bg-muted/50 text-muted-foreground ${
        activeMessageId === message.id
          ? 'ring-2 ring-sky-400 ring-offset-1 ring-offset-background'
          : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-base">{getEventIcon()}</span>
          <span className="font-semibold text-xs uppercase tracking-wide opacity-80">
            System Message
          </span>
          {message.model && <span className="text-xs opacity-50 font-mono">{message.model}</span>}
          {message.tags && message.tags.length > 0 && (
            <div className="flex gap-1">
              {message.tags.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-1.5 py-0.5 rounded bg-background/50 border border-current/20"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
        <span className="text-xs opacity-70">
          {new Date(message.timestamp).toLocaleTimeString()}
        </span>
      </div>
      <div className="text-sm leading-relaxed">{getEventText()}</div>
    </div>
  );
});
