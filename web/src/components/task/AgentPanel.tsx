import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { useConfig } from '@/hooks/useConfig';
import {
  useAgentStatus,
  useStartAgent,
  useStopAgent,
  useSendMessage,
  useAgentStream,
} from '@/hooks/useAgent';
import {
  Play,
  Square,
  Send,
  Bot,
  Loader2,
  Terminal,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { Task, AgentType } from '@veritas-kanban/shared';
import { cn } from '@/lib/utils';

interface AgentPanelProps {
  task: Task;
}

export function AgentPanel({ task }: AgentPanelProps) {
  const { data: config } = useConfig();
  const { data: agentStatus } = useAgentStatus(task.id);
  const { outputs, isConnected, isRunning, clearOutputs } = useAgentStream(task.id);
  
  const startAgent = useStartAgent();
  const stopAgent = useStopAgent();
  const sendMessage = useSendMessage();

  const [selectedAgent, setSelectedAgent] = useState<AgentType | undefined>();
  const [message, setMessage] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  
  const outputRef = useRef<HTMLDivElement>(null);

  // Get enabled agents
  const enabledAgents = config?.agents.filter(a => a.enabled) || [];
  const defaultAgent = config?.defaultAgent;

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputs, autoScroll]);

  // Handle scroll to detect user scroll up
  const handleScroll = () => {
    if (!outputRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = outputRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(isAtBottom);
  };

  const handleStart = () => {
    clearOutputs();
    startAgent.mutate({
      taskId: task.id,
      agent: selectedAgent || defaultAgent,
    });
  };

  const handleStop = () => {
    stopAgent.mutate(task.id);
  };

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return;
    
    sendMessage.mutate({
      taskId: task.id,
      message: message.trim(),
    });
    setMessage('');
  };

  // Check if we can start an agent
  const canStart = task.git?.worktreePath && !isRunning && !agentStatus?.running;
  const isAgentRunning = isRunning || agentStatus?.running;

  if (!task.git?.worktreePath) {
    return (
      <div className="space-y-2">
        <Label className="text-muted-foreground flex items-center gap-2">
          <Bot className="h-4 w-4" />
          AI Agent
        </Label>
        <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-md border border-dashed">
          <AlertCircle className="h-4 w-4" />
          Create a worktree first to use an AI agent.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-muted-foreground flex items-center gap-2">
          <Bot className="h-4 w-4" />
          AI Agent
        </Label>
        <div className="flex items-center gap-2">
          {isConnected ? (
            <Wifi className="h-3 w-3 text-green-500" />
          ) : (
            <WifiOff className="h-3 w-3 text-muted-foreground" />
          )}
          {isAgentRunning && (
            <span className="flex items-center gap-1 text-xs text-green-500">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              Running
            </span>
          )}
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 overflow-hidden">
        {/* Controls */}
        <div className="flex items-center gap-2 p-2 border-b bg-card">
          {!isAgentRunning ? (
            <>
              <Select
                value={selectedAgent || defaultAgent}
                onValueChange={(v) => setSelectedAgent(v as AgentType)}
              >
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue placeholder="Select agent..." />
                </SelectTrigger>
                <SelectContent>
                  {enabledAgents.map((agent) => (
                    <SelectItem key={agent.type} value={agent.type}>
                      <div className="flex items-center gap-2">
                        <Bot className="h-3 w-3" />
                        {agent.name}
                        {agent.type === defaultAgent && (
                          <span className="text-xs text-muted-foreground">(default)</span>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleStart}
                disabled={!canStart || startAgent.isPending}
              >
                {startAgent.isPending ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Start
              </Button>
            </>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="destructive">
                  <Square className="h-4 w-4 mr-1" />
                  Stop
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Stop the agent?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will terminate the running agent. The attempt will be marked as failed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleStop}
                    className="bg-destructive text-destructive-foreground"
                  >
                    Stop Agent
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Output */}
        <div
          ref={outputRef}
          onScroll={handleScroll}
          className="h-[300px] overflow-y-auto p-3 font-mono text-xs bg-zinc-950 text-zinc-200"
        >
          {outputs.length === 0 ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Terminal className="h-6 w-6 mr-2 opacity-50" />
              {isAgentRunning ? 'Waiting for output...' : 'Agent output will appear here'}
            </div>
          ) : (
            outputs.map((output, i) => (
              <div
                key={i}
                className={cn(
                  'whitespace-pre-wrap break-all',
                  output.type === 'stderr' && 'text-red-400',
                  output.type === 'stdin' && 'text-blue-400 bg-blue-500/10 px-2 py-1 rounded my-1',
                  output.type === 'system' && 'text-yellow-400 italic'
                )}
              >
                {output.type === 'stdin' && <span className="font-bold">You: </span>}
                {output.content}
              </div>
            ))
          )}
        </div>

        {/* Input */}
        {isAgentRunning && (
          <form onSubmit={handleSendMessage} className="flex gap-2 p-2 border-t bg-card">
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Send a message to the agent..."
              className="flex-1 h-8 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!message.trim() || sendMessage.isPending}
            >
              <Send className="h-4 w-4" />
            </Button>
          </form>
        )}
      </div>

      {/* Current attempt info */}
      {task.attempt && (
        <div className="text-xs text-muted-foreground space-y-1">
          <div>Attempt: {task.attempt.id}</div>
          <div>Agent: {task.attempt.agent}</div>
          <div>Status: {task.attempt.status}</div>
          {task.attempt.started && (
            <div>Started: {new Date(task.attempt.started).toLocaleString()}</div>
          )}
        </div>
      )}
    </div>
  );
}
