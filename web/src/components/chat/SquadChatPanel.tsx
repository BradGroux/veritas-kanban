import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Send, Loader2, Users, Filter, Settings2 } from 'lucide-react';
import { useSquadMessages, useSendSquadMessage, useSquadStream } from '@/hooks/useChat';
import { useFeatureSetting } from '@/hooks/useFeatureSettings';
import type { SquadMessage } from '@veritas-kanban/shared';

interface SquadChatPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Agent colors for visual distinction
const agentColors: Record<string, string> = {
  Human: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30', // Human user - distinct green
  VERITAS: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  TARS: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  CASE: 'bg-green-500/20 text-green-400 border-green-500/30',
  Ava: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  'R2-D2': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'K-2SO': 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MAX: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  'Johnny 5': 'bg-red-500/20 text-red-400 border-red-500/30',
  Bishop: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  Marvin: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

export function SquadChatPanel({ open, onOpenChange }: SquadChatPanelProps) {
  const humanDisplayName = useFeatureSetting('general', 'humanDisplayName');

  // Load includeSystem preference from localStorage
  const [includeSystem, setIncludeSystem] = useState<boolean>(() => {
    const saved = localStorage.getItem('squadChat.includeSystem');
    return saved === null ? true : saved === 'true'; // Default to true
  });

  // Save includeSystem preference to localStorage
  useEffect(() => {
    localStorage.setItem('squadChat.includeSystem', includeSystem.toString());
  }, [includeSystem]);

  // Available agents for the selector (Human display name is dynamic)
  const availableAgents = [
    humanDisplayName, // Human user first (from settings)
    'VERITAS',
    'TARS',
    'CASE',
    'Ava',
    'R2-D2',
    'K-2SO',
    'MAX',
    'Johnny 5',
    'Bishop',
    'Marvin',
  ];

  const [message, setMessage] = useState('');
  const [selectedAgent, setSelectedAgent] = useState(humanDisplayName || 'Human'); // Human user default (from settings)
  const [agentFilter, setAgentFilter] = useState<string>('all');

  // Sync selectedAgent when humanDisplayName loads from settings
  useEffect(() => {
    if (humanDisplayName) {
      setSelectedAgent((prev) => (prev === 'Human' || prev === '' ? humanDisplayName : prev));
    }
  }, [humanDisplayName]);
  const { data: messages = [], isLoading } = useSquadMessages({ limit: 50, includeSystem });
  const { mutate: sendMessage, isPending } = useSendSquadMessage();
  const { newMessage } = useSquadStream();

  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Scroll helper — finds the actual scrollable viewport inside ScrollArea
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    // Try scrollIntoView on the sentinel div first
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior });
    }
    // Fallback: find Radix ScrollArea viewport and scroll it directly
    const viewport = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, []);

  // Auto-scroll to bottom when panel opens
  useEffect(() => {
    if (open) {
      // Use setTimeout to ensure DOM is fully rendered
      setTimeout(() => {
        scrollToBottom('instant');
        setShouldAutoScroll(true);
      }, 150);
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

    sendMessage(
      {
        agent: agentForBackend,
        message: message.trim(),
      },
      {
        onSuccess: () => {
          setMessage('');
          setShouldAutoScroll(true);
          // Force scroll to bottom immediately after sending
          setTimeout(() => scrollToBottom(), 100);
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

  // Filter messages by agent
  const filteredMessages =
    agentFilter === 'all' ? messages : messages.filter((m) => m.agent === agentFilter);

  // Get unique agents from messages
  const uniqueAgents = Array.from(new Set(messages.map((m) => m.agent))).sort();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[500px] sm:max-w-[500px] overflow-hidden flex flex-col p-0"
        side="right"
      >
        <SheetHeader className="border-b border-border px-4 py-3 pr-10 flex-shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Squad Chat
          </SheetTitle>
          <div className="text-xs text-muted-foreground pt-2">
            Agent-to-agent communication channel
          </div>
        </SheetHeader>

        {/* Filter Bar */}
        <div className="border-b border-border px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-8 text-xs w-[150px]">
              <SelectValue placeholder="Filter by agent" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Agents</SelectItem>
              {uniqueAgents.map((agent) => (
                <SelectItem key={agent} value={agent}>
                  {agent}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={includeSystem ? 'default' : 'outline'}
            size="sm"
            onClick={() => setIncludeSystem(!includeSystem)}
            className="ml-auto h-8 text-xs gap-1.5"
            title={includeSystem ? 'Hide system messages' : 'Show system messages'}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {includeSystem ? 'Hide' : 'Show'} System
          </Button>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4" onScrollCapture={handleScroll} ref={scrollAreaRef}>
          <div className="py-4 space-y-3">
            {isLoading && (
              <div className="text-center text-muted-foreground py-8">
                <Loader2 className="h-8 w-8 mx-auto mb-2 animate-spin" />
                <p className="text-sm">Loading messages...</p>
              </div>
            )}
            {!isLoading && filteredMessages.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                <p className="text-sm">
                  {agentFilter === 'all'
                    ? 'No messages yet. Be the first to say something!'
                    : `No messages from ${agentFilter}`}
                </p>
              </div>
            )}
            {filteredMessages.map((msg) =>
              msg.system ? (
                <SystemMessageDivider key={msg.id} message={msg} />
              ) : (
                <SquadMessageBubble
                  key={msg.id}
                  message={msg}
                  humanDisplayName={humanDisplayName}
                />
              )
            )}
            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="border-t border-border p-4 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs text-muted-foreground">Sending as:</span>
            <Select value={selectedAgent} onValueChange={setSelectedAgent}>
              <SelectTrigger className="h-8 text-xs w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent} value={agent}>
                    {agent}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Send a message to the squad..."
              disabled={isPending}
              className="flex-1"
              autoFocus
            />
            <Button onClick={handleSend} disabled={!message.trim() || isPending} size="icon">
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

interface SquadMessageBubbleProps {
  message: SquadMessage;
  humanDisplayName: string;
}

const SquadMessageBubble = React.memo(function SquadMessageBubble({
  message,
  humanDisplayName,
}: SquadMessageBubbleProps) {
  const colorClass = agentColors[message.agent] || agentColors.VERITAS;
  const isHuman = message.agent === 'Human';
  // Use the display name for Human agents, otherwise use the agent name
  const displayName = isHuman ? humanDisplayName : message.agent;

  return (
    <div
      className={`rounded-lg border p-3 ${colorClass} ${isHuman ? 'ring-1 ring-emerald-500/50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">
            {displayName}
            {isHuman && <span className="ml-1 text-xs opacity-70">(Human)</span>}
          </span>
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
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{message.message}</div>
    </div>
  );
});

interface SystemMessageDividerProps {
  message: SquadMessage;
}

const SystemMessageDivider = React.memo(function SystemMessageDivider({
  message,
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

    switch (message.event) {
      case 'agent.spawned':
        return `${message.agent} assigned${taskTitle}`;
      case 'agent.completed':
        return `${message.agent} completed${taskTitle}${duration}`;
      case 'agent.failed':
        return `${message.agent} failed${taskTitle}${duration}`;
      case 'agent.status':
        return `${message.agent} is working on${taskTitle}${duration}`;
      default:
        return message.message;
    }
  };

  return (
    <div className="flex items-center gap-3 py-2 text-xs text-muted-foreground/80">
      <div className="flex-1 h-px bg-border" />
      <div className="flex items-center gap-2 px-2 py-1 rounded bg-muted/30">
        <span>{getEventIcon()}</span>
        <span className="font-medium">{getEventText()}</span>
      </div>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
});
