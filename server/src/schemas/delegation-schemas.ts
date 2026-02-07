/**
 * Delegation API Request Schemas (Zod)
 */

import { z } from 'zod';

const DelegationScopeSchema = z.object({
  type: z.enum(['all', 'project', 'priority']),
  projectIds: z.array(z.string()).optional(),
  priorities: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
});

export const SetDelegationRequestSchema = z.object({
  delegateAgent: z.string().min(1, 'Delegate agent is required'),
  expires: z.string().datetime('Invalid ISO timestamp'),
  scope: DelegationScopeSchema,
  excludePriorities: z.array(z.enum(['critical', 'high', 'medium', 'low'])).optional(),
  excludeTags: z.array(z.string()).optional(),
  createdBy: z.string().min(1, 'Creator name is required'),
});

export type SetDelegationRequest = z.infer<typeof SetDelegationRequestSchema>;
