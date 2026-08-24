/**
 * DocsViewer — Full docs tab with file browser, markdown preview, and editor
 * GH #88: Docs Tab with Markdown Viewer/Editor
 *
 * Inspired by @nateherk's Klouse dashboard docs section.
 */

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { docsApi } from '@/lib/api/docs';
import {
  FileText,
  FolderOpen,
  Search,
  Edit3,
  Save,
  X,
  Plus,
  Trash2,
  ChevronRight,
  Clock,
  HardDrive,
} from 'lucide-react';

// ─── Helpers ─────────────────────────────────────────────────────

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

function formatTimeAgo(ts: string): string {
  const seconds = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// ─── Component ───────────────────────────────────────────────────

export function DocsViewer() {
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<string | undefined>();
  const [searchQuery, setSearchQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [creating, setCreating] = useState(false);
  const [newFileName, setNewFileName] = useState('');

  // Fetch file list
  const { data: files = [] } = useQuery({
    queryKey: ['docs', 'list', selectedDir],
    queryFn: () => docsApi.list({ directory: selectedDir }),
    staleTime: 30_000,
  });

  // Fetch directories
  const { data: directories = [] } = useQuery({
    queryKey: ['docs', 'directories'],
    queryFn: () => docsApi.directories(),
    staleTime: 60_000,
  });

  // Fetch selected file
  const { data: selectedFile } = useQuery({
    queryKey: ['docs', 'file', selectedPath],
    queryFn: () => docsApi.getFile(selectedPath!),
    enabled: !!selectedPath,
  });

  // Search
  const { data: searchResults = [] } = useQuery({
    queryKey: ['docs', 'search', searchQuery],
    queryFn: () => docsApi.search(searchQuery),
    enabled: searchQuery.length >= 2,
    staleTime: 10_000,
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: ({ path, content }: { path: string; content: string }) =>
      docsApi.saveFile(path, content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      setEditing(false);
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (path: string) => docsApi.deleteFile(path),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['docs'] });
      setSelectedPath(null);
    },
  });

  const handleSave = useCallback(() => {
    if (selectedPath) {
      saveMutation.mutate({ path: selectedPath, content: editContent });
    }
  }, [selectedPath, editContent, saveMutation]);

  const handleCreate = useCallback(() => {
    if (!newFileName.trim()) return;
    const fileName = newFileName.endsWith('.md') ? newFileName : `${newFileName}.md`;
    const filePath = selectedDir ? `${selectedDir}/${fileName}` : fileName;
    saveMutation.mutate(
      { path: filePath, content: `# ${newFileName.replace('.md', '')}\n\n` },
      {
        onSuccess: (file) => {
          setCreating(false);
          setNewFileName('');
          setSelectedPath(file.path);
        },
      }
    );
  }, [newFileName, selectedDir, saveMutation]);

  const startEditing = useCallback(() => {
    if (selectedFile?.content) {
      setEditContent(selectedFile.content);
      setEditing(true);
    }
  }, [selectedFile]);

  const displayFiles = searchQuery.length >= 2 ? searchResults.map((r) => r.file) : files;

  return (
    <div className="h-full flex">
      {/* Sidebar — file browser */}
      <div className="w-72 border-r flex flex-col bg-card/50">
        {/* Search */}
        <div className="p-3 border-b">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              className="w-full text-xs pl-8 pr-3 py-1.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search docs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Directories */}
        <div className="px-3 py-2 border-b">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Folders
            </span>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setCreating(true)}
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="space-y-0.5">
            <button
              className={`flex items-center gap-1.5 w-full text-left text-xs px-2 py-1 rounded transition-colors ${
                !selectedDir
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50'
              }`}
              onClick={() => setSelectedDir(undefined)}
            >
              <FolderOpen className="w-3 h-3" />
              All Docs
            </button>
            {directories.map((dir) => (
              <button
                key={dir}
                className={`flex items-center gap-1.5 w-full text-left text-xs px-2 py-1 rounded transition-colors ${
                  selectedDir === dir
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-muted/50'
                }`}
                onClick={() => setSelectedDir(dir)}
              >
                <ChevronRight className="w-3 h-3" />
                {dir}
              </button>
            ))}
          </div>
        </div>

        {/* New file form */}
        {creating && (
          <div className="px-3 py-2 border-b bg-muted/30">
            <input
              type="text"
              className="w-full text-xs px-2 py-1 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring mb-1"
              placeholder="filename.md"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              autoFocus
            />
            <div className="flex gap-1">
              <button className="text-[10px] text-green-500 hover:underline" onClick={handleCreate}>
                Create
              </button>
              <button
                className="text-[10px] text-muted-foreground hover:underline"
                onClick={() => setCreating(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {displayFiles.map((file) => (
            <button
              key={file.path}
              className={`flex items-start gap-2 w-full text-left px-2 py-1.5 rounded transition-colors ${
                selectedPath === file.path
                  ? 'bg-purple-500/10 text-purple-500'
                  : 'hover:bg-muted/50 text-muted-foreground'
              }`}
              onClick={() => {
                setSelectedPath(file.path);
                setEditing(false);
              }}
            >
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{file.name}</div>
                <div className="text-[10px] text-muted-foreground/60 flex items-center gap-2">
                  <span>{formatSize(file.size)}</span>
                  <span>{formatTimeAgo(file.modified)}</span>
                </div>
              </div>
            </button>
          ))}
          {displayFiles.length === 0 && (
            <div className="text-xs text-muted-foreground/40 text-center py-8">
              {searchQuery ? 'No matches found' : 'No docs yet'}
            </div>
          )}
        </div>

        {/* Stats footer */}
        <div className="px-3 py-2 border-t text-[10px] text-muted-foreground/50 flex items-center gap-2">
          <HardDrive className="w-3 h-3" />
          {files.length} files
        </div>
      </div>

      {/* Main content — markdown viewer/editor */}
      <div className="flex-1 flex flex-col">
        {selectedFile ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b bg-card/50">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold truncate">{selectedFile.name}</h2>
                <div className="text-[10px] text-muted-foreground flex items-center gap-2">
                  <Clock className="w-3 h-3" />
                  Modified {formatTimeAgo(selectedFile.modified)}
                  <span>·</span>
                  <span>{formatSize(selectedFile.size)}</span>
                  <span>·</span>
                  <span className="font-mono">{selectedFile.path}</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {editing ? (
                  <>
                    <button
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-green-600 hover:bg-green-700 text-white transition-colors"
                      onClick={handleSave}
                      disabled={saveMutation.isPending}
                    >
                      <Save className="w-3 h-3" />
                      {saveMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-muted transition-colors"
                      onClick={() => setEditing(false)}
                    >
                      <X className="w-3 h-3" />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="flex items-center gap-1 text-xs px-2.5 py-1 rounded border hover:bg-muted transition-colors"
                      onClick={startEditing}
                    >
                      <Edit3 className="w-3 h-3" />
                      Edit
                    </button>
                    <button
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded border hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-colors"
                      onClick={() => {
                        if (confirm(`Delete ${selectedFile.name}?`)) {
                          deleteMutation.mutate(selectedFile.path);
                        }
                      }}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
              {editing ? (
                <textarea
                  className="w-full h-full p-4 font-mono text-sm bg-background resize-none focus:outline-none"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <div className="p-4 prose prose-sm dark:prose-invert max-w-none">
                  {/* Render raw markdown for now — MarkdownText component can be used here */}
                  <pre className="whitespace-pre-wrap text-sm font-sans">
                    {selectedFile.content}
                  </pre>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-muted-foreground/30">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <div className="text-sm">Select a document to view</div>
              <div className="text-xs mt-1">or create a new one with the + button</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
