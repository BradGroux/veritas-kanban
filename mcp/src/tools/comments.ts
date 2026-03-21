import { z } from 'zod';
import { api } from '../utils/api.js';
import { Task } from '../utils/types.js';

// Tool input schemas
const AddCommentSchema = z.object({
  taskId: z.string().min(1),
  text: z.string().min(1),
  agent: z.string().optional(),
});

const ListCommentsSchema = z.object({
  taskId: z.string().min(1),
});

const DeleteCommentSchema = z.object({
  taskId: z.string().min(1),
  commentId: z.string().min(1),
});

export const commentTools = [
  {
    name: 'add_comment',
    description: 'Add a comment to a task in Veritas Kanban',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
        text: {
          type: 'string',
          description: 'Comment text',
        },
        agent: {
          type: 'string',
          description: 'Agent or author name (optional)',
        },
      },
      required: ['taskId', 'text'],
    },
  },
  {
    name: 'list_comments',
    description: 'List all comments on a task',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
      },
      required: ['taskId'],
    },
  },
  {
    name: 'delete_comment',
    description: 'Delete a comment from a task by comment ID',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: {
          type: 'string',
          description: 'Task ID',
        },
        commentId: {
          type: 'string',
          description: 'Comment ID to delete',
        },
      },
      required: ['taskId', 'commentId'],
    },
  },
];

export async function handleCommentTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'add_comment': {
      const { taskId, text, agent } = AddCommentSchema.parse(args);
      const author = agent || 'agent';

      const task = await api<Task>(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        body: JSON.stringify({ author, text }),
      });

      return {
        content: [
          {
            type: 'text',
            text: `Comment added to task ${taskId}\n${JSON.stringify(task, null, 2)}`,
          },
        ],
      };
    }

    case 'list_comments': {
      const { taskId } = ListCommentsSchema.parse(args);
      const task = await api<Task>(`/api/tasks/${taskId}`);

      const comments = task.comments || [];

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(comments, null, 2),
          },
        ],
      };
    }

    case 'delete_comment': {
      const { taskId, commentId } = DeleteCommentSchema.parse(args);

      const task = await api<Task>(`/api/tasks/${taskId}/comments/${commentId}`, {
        method: 'DELETE',
      });

      return {
        content: [
          {
            type: 'text',
            text: `Comment ${commentId} deleted from task ${taskId}\n${JSON.stringify(task, null, 2)}`,
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown comment tool: ${name}`);
  }
}
