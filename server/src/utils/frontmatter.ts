/* eslint-disable @typescript-eslint/no-explicit-any */
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface MarkdownFrontmatterFile<T = string> {
  data: Record<string, any>;
  content: T;
  orig: T;
  matter: string;
  language: 'yaml';
}

interface Frontmatter {
  (input: string): MarkdownFrontmatterFile<string>;
  stringify(content: string, data?: Record<string, unknown>): string;
}

const DELIMITER_PATTERN = /^(---|\.\.\.)[ \t]*$/;

function asRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, any>;
}

export function parseMarkdownFrontmatter(input: string): MarkdownFrontmatterFile<string> {
  const source = input.startsWith('\uFEFF') ? input.slice(1) : input;
  const firstLineEnd = source.indexOf('\n');
  const firstLine = (firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)).replace(
    /\r$/,
    ''
  );

  if (firstLine !== '---' || firstLineEnd === -1) {
    return {
      data: {},
      content: source,
      orig: input,
      matter: '',
      language: 'yaml',
    };
  }

  const matterStart = firstLineEnd + 1;
  let lineStart = matterStart;

  while (lineStart <= source.length) {
    const nextLineEnd = source.indexOf('\n', lineStart);
    const lineEnd = nextLineEnd === -1 ? source.length : nextLineEnd;
    const line = source.slice(lineStart, lineEnd).replace(/\r$/, '');

    if (DELIMITER_PATTERN.test(line)) {
      const matter = source.slice(matterStart, lineStart);
      const contentStart = nextLineEnd === -1 ? lineEnd : nextLineEnd + 1;
      const parsed = matter.trim() ? parseYaml(matter) : {};

      return {
        data: asRecord(parsed),
        content: source.slice(contentStart),
        orig: input,
        matter,
        language: 'yaml',
      };
    }

    if (nextLineEnd === -1) break;
    lineStart = nextLineEnd + 1;
  }

  throw new Error('Unclosed YAML frontmatter block');
}

export function stringifyMarkdownFrontmatter(
  content: string,
  data: Record<string, any> = {}
): string {
  const yaml = stringifyYaml(data, { lineWidth: 0 }).trimEnd() || '{}';
  const body = content || '';
  return body ? `---\n${yaml}\n---\n${body}` : `---\n${yaml}\n---\n`;
}

const frontmatter = parseMarkdownFrontmatter as Frontmatter;
frontmatter.stringify = stringifyMarkdownFrontmatter;

export default frontmatter;
