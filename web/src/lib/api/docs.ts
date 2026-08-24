import { API_BASE, apiFetch } from './helpers';

export interface DocFile {
  path: string;
  name: string;
  content?: string;
  size: number;
  modified: string;
  created: string;
  extension: string;
  directory: string;
}

export interface DocSearchMatch {
  file: DocFile;
  matches: Array<{ line: number; text: string }>;
}

function encodeDocPath(filePath: string): string {
  return filePath.split('/').map(encodeURIComponent).join('/');
}

export const docsApi = {
  list: (params?: { directory?: string; sortBy?: string }): Promise<DocFile[]> => {
    const query = new URLSearchParams();
    if (params?.directory) query.set('directory', params.directory);
    if (params?.sortBy) query.set('sortBy', params.sortBy);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return apiFetch(`${API_BASE}/docs${suffix}`);
  },

  getFile: (filePath: string): Promise<DocFile> => {
    return apiFetch(`${API_BASE}/docs/file/${encodeDocPath(filePath)}`);
  },

  saveFile: (filePath: string, content: string): Promise<DocFile> => {
    return apiFetch(`${API_BASE}/docs/file/${encodeDocPath(filePath)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
  },

  deleteFile: (filePath: string): Promise<void> => {
    return apiFetch(`${API_BASE}/docs/file/${encodeDocPath(filePath)}`, { method: 'DELETE' });
  },

  search: (query: string): Promise<DocSearchMatch[]> => {
    return apiFetch(`${API_BASE}/docs/search?q=${encodeURIComponent(query)}`);
  },

  directories: (): Promise<string[]> => apiFetch(`${API_BASE}/docs/directories`),
};
