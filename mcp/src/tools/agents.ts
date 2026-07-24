import { z } from 'zod';
import { api } from '../utils/api.js';
import { findTask } from '../utils/find.js';

const StartAgentSchema = z.object({
  id: z.string().min(1),
  agent: z.enum(['claude-code', 'amp', 'copilot', 'gemini', 'veritas']).default('claude-code'),
  requiredRuntimeCapabilities: z
    .array(
      z
        .string()
        .regex(/^[a-z][a-z0-9.-]*$/)
        .max(80)
    )
    .max(64)
    .optional(),
  commitPolicy: z.enum(['forbidden', 'allowed', 'required']).optional(),
  parentAttemptId: z.string().trim().min(1).max(120).optional(),
});

const TaskIdSchema = z.object({
  id: z.string().min(1),
});

const ConversationActionSchema = z.enum([
  'resume',
  'follow-up',
  'fork',
  'steer',
  'interrupt',
  'compact',
  'archive',
  'close',
]);

const ConversationControlSchema = z
  .object({
    id: z.string().min(1),
    action: ConversationActionSchema,
    sourceAttemptId: z.string().trim().min(1).max(120).optional(),
    attemptId: z.string().trim().min(1).max(120).optional(),
    message: z.string().trim().min(1).max(20_000).optional(),
    forkTurnId: z.string().trim().min(1).max(240).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (['resume', 'follow-up', 'fork'].includes(value.action)) {
      if (!value.sourceAttemptId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sourceAttemptId'],
          message: `${value.action} requires sourceAttemptId`,
        });
      }
      if (!value.message) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['message'],
          message: `${value.action} requires message`,
        });
      }
    } else {
      if (!value.attemptId) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['attemptId'],
          message: `${value.action} requires attemptId`,
        });
      }
      if (value.action === 'steer' && !value.message) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['message'],
          message: 'steer requires message',
        });
      }
    }
    if (value.forkTurnId && value.action !== 'fork') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['forkTurnId'],
        message: 'forkTurnId is only valid for fork',
      });
    }
  });

export const agentTools = [
  {
    name: 'start_agent',
    description: 'Start an AI coding agent on a code task (requires worktree)',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID',
        },
        agent: {
          type: 'string',
          enum: ['claude-code', 'amp', 'copilot', 'gemini'],
          description: 'Agent to use (default: claude-code)',
        },
        requiredRuntimeCapabilities: {
          type: 'array',
          items: { type: 'string' },
          description: 'Provider runtime capabilities that must be evidenced before launch',
        },
        commitPolicy: {
          type: 'string',
          enum: ['forbidden', 'allowed', 'required'],
          description: 'Commit policy override for this run',
        },
        parentAttemptId: {
          type: 'string',
          description: 'Parent attempt to compare for material launch drift',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'stop_agent',
    description: 'Stop a running agent on a task',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'control_agent_conversation',
    description:
      'Resume, follow up, fork, steer, interrupt, compact, archive, or close a provider conversation using verified native controls',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Task ID or partial ID',
        },
        action: {
          type: 'string',
          enum: ConversationActionSchema.options,
          description: 'Provider-neutral lifecycle action',
        },
        sourceAttemptId: {
          type: 'string',
          description: 'Terminal source attempt for resume, follow-up, or fork',
        },
        attemptId: {
          type: 'string',
          description: 'Exact active attempt for steer, interrupt, compact, archive, or close',
        },
        message: {
          type: 'string',
          description: 'New-turn or steering message',
        },
        forkTurnId: {
          type: 'string',
          description: 'Optional provider turn boundary for a native history fork',
        },
      },
      required: ['id', 'action'],
    },
  },
];

export async function handleAgentTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'start_agent': {
      const { id, agent, requiredRuntimeCapabilities, commitPolicy, parentAttemptId } =
        StartAgentSchema.parse(args);
      const task = await findTask(id);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      if (task.type !== 'code') {
        return {
          content: [{ type: 'text', text: 'Can only start agents on code tasks' }],
          isError: true,
        };
      }

      if (!task.git?.worktreePath) {
        return {
          content: [{ type: 'text', text: 'Task needs a worktree first' }],
          isError: true,
        };
      }

      const result = await api<{ attemptId: string }>(`/api/agents/${task.id}/start`, {
        method: 'POST',
        body: JSON.stringify({
          agent,
          requiredRuntimeCapabilities,
          commitPolicy,
          parentAttemptId,
        }),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Agent started: ${agent}\nAttempt ID: ${result.attemptId}\nWorking in: ${task.git.worktreePath}`,
          },
        ],
      };
    }

    case 'stop_agent': {
      const { id } = TaskIdSchema.parse(args);
      const task = await findTask(id);

      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      const status = await api<{ running: boolean; attemptId?: string }>(
        `/api/agents/${task.id}/status`
      );
      if (!status.running || !status.attemptId) {
        return {
          content: [{ type: 'text', text: 'No active agent attempt is available to stop' }],
          isError: true,
        };
      }

      await api(`/api/agents/${task.id}/stop`, {
        method: 'POST',
        body: JSON.stringify({ attemptId: status.attemptId }),
      });

      return {
        content: [{ type: 'text', text: 'Agent stopped' }],
      };
    }

    case 'control_agent_conversation': {
      const { id, action, sourceAttemptId, attemptId, message, forkTurnId } =
        ConversationControlSchema.parse(args);
      const task = await findTask(id);
      if (!task) {
        return {
          content: [{ type: 'text', text: `Task not found: ${id}` }],
          isError: true,
        };
      }

      const startsTurn = ['resume', 'follow-up', 'fork'].includes(action);
      const body = startsTurn
        ? {
            sourceAttemptId,
            message,
            ...(action === 'fork' && forkTurnId ? { forkTurnId } : {}),
          }
        : {
            attemptId,
            ...(action === 'steer' ? { message } : {}),
          };
      const result = await api(`/api/agents/${task.id}/conversation/${action}`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    }

    default:
      throw new Error(`Unknown agent tool: ${name}`);
  }
}
