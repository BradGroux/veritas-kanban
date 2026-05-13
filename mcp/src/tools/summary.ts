import { api, API_BASE, buildApiHeaders } from '../utils/api.js';

export const summaryTools = [
  {
    name: 'get_summary',
    description: 'Get overall kanban summary (status counts, projects, high-priority)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_memory_summary',
    description:
      'Get task summary formatted for memory files (completed tasks, active high-priority, project progress)',
    inputSchema: {
      type: 'object',
      properties: {
        hours: {
          type: 'number',
          description: 'Hours to look back (default: 24)',
        },
      },
    },
  },
];

export async function handleSummaryTool(name: string, args: any): Promise<any> {
  switch (name) {
    case 'get_summary': {
      const summary = await api<unknown>('/api/summary');
      return {
        content: [{ type: 'text', text: JSON.stringify(summary, null, 2) }],
      };
    }

    case 'get_memory_summary': {
      const hours = (args as { hours?: number })?.hours || 24;
      const res = await fetch(`${API_BASE}/api/summary/memory?hours=${hours}`, {
        headers: buildApiHeaders(),
      });
      const markdown = await res.text();
      if (!res.ok) {
        throw new Error(markdown || `API error: ${res.status}`);
      }
      return {
        content: [{ type: 'text', text: markdown }],
      };
    }

    default:
      throw new Error(`Unknown summary tool: ${name}`);
  }
}
