import { z } from 'zod';

export function isCanonicalGitBranchName(value: string): boolean {
  const hasForbiddenControl = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x20 || code === 0x7f;
  });
  return (
    value.length > 0 &&
    value.length <= 240 &&
    value === value.trim() &&
    value !== '@' &&
    !value.startsWith('-') &&
    !value.startsWith('/') &&
    !value.endsWith('/') &&
    !value.endsWith('.') &&
    !value.endsWith('.lock') &&
    !value.includes('..') &&
    !value.includes('//') &&
    !value.includes('@{') &&
    !hasForbiddenControl &&
    !/[~^:?*[\\]/.test(value)
  );
}

export const GitBranchNameSchema = z
  .string()
  .min(1)
  .max(240)
  .refine(isCanonicalGitBranchName, 'Invalid Git branch name');
