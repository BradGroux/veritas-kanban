import { describe, expect, it } from 'vitest';
import { GitBranchNameSchema } from '../schemas/git-ref-schemas.js';

describe('GitBranchNameSchema', () => {
  it.each(['feature/managed-worktree', 'release/6.1.4', 'topic/a.b', 'main'])(
    'accepts canonical branch %s',
    (branch) => {
      expect(GitBranchNameSchema.parse(branch)).toBe(branch);
    }
  );

  it.each([
    'HEAD:refs/heads/canary',
    '+HEAD:refs/heads/main',
    '-force-like-option',
    '.hidden',
    'topic/.hidden',
    'topic.lock/next',
    'feature/../main',
    'feature branch',
    'refs/heads/main.lock',
  ])('rejects noncanonical branch %s', (branch) => {
    expect(() => GitBranchNameSchema.parse(branch)).toThrow();
  });
});
