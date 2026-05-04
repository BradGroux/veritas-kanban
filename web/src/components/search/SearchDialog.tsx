import { useMemo, useState } from 'react';
import { Archive, FileText, Loader2, Search, ShieldAlert, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { api, type SearchBackend, type SearchCollection, type SearchResponse } from '@/lib/api';
import { cn } from '@/lib/utils';

const COLLECTIONS: { id: SearchCollection; label: string }[] = [
  { id: 'tasks-active', label: 'Active' },
  { id: 'tasks-archive', label: 'Archive' },
  { id: 'docs', label: 'Docs' },
];

const BACKENDS: { id: SearchBackend; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'keyword', label: 'Keyword' },
  { id: 'qmd', label: 'QMD' },
];

interface SearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTaskOpen?: (taskId: string) => void;
}

function extractTaskId(path: string): string | null {
  const fileName = path.split('/').pop() ?? '';
  const match = fileName.match(/^(task_[^./]+?)(?:-[^/]*)?\.md$/);
  return match?.[1] ?? null;
}

function collectionIcon(collection: string) {
  if (collection === 'docs') return FileText;
  if (collection === 'tasks-archive') return Archive;
  return Search;
}

export function SearchDialog({ open, onOpenChange, onTaskOpen }: SearchDialogProps) {
  const [query, setQuery] = useState('');
  const [backend, setBackend] = useState<SearchBackend>('auto');
  const [collections, setCollections] = useState<SearchCollection[]>(
    COLLECTIONS.map((collection) => collection.id)
  );
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const trimmedQuery = query.trim();
  const canSearch = trimmedQuery.length > 0 && collections.length > 0 && !isSearching;

  const resultCount = response?.results.length ?? 0;
  const statusLabel = useMemo(() => {
    if (!response) return null;
    const noun = resultCount === 1 ? 'result' : 'results';
    return `${resultCount} ${noun} from ${response.backend}`;
  }, [response, resultCount]);

  const runSearch = async () => {
    if (!canSearch) return;

    setIsSearching(true);
    setError(null);
    try {
      const nextResponse = await api.search.query({
        query: trimmedQuery,
        backend,
        collections,
        limit: 12,
      });
      setResponse(nextResponse);
    } catch (err) {
      setResponse(null);
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleCollection = (collection: SearchCollection, checked: boolean) => {
    setCollections((current) => {
      if (checked) return Array.from(new Set([...current, collection]));
      return current.filter((item) => item !== collection);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Search Tasks and Docs
          </DialogTitle>
          <DialogDescription>
            Find active work, archived decisions, and project documentation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5 py-4">
          <form
            className="flex flex-col gap-3 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              runSearch();
            }}
          >
            <div className="relative min-w-0 flex-1">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search task titles, descriptions, notes, docs..."
                className="pl-9"
                autoFocus
              />
            </div>
            <Select value={backend} onValueChange={(value) => setBackend(value as SearchBackend)}>
              <SelectTrigger className="w-full sm:w-32" aria-label="Search backend">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BACKENDS.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" disabled={!canSearch} className="gap-2">
              {isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )}
              Search
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-3">
            {COLLECTIONS.map((collection) => (
              <Label
                key={collection.id}
                className="flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-normal"
              >
                <Checkbox
                  checked={collections.includes(collection.id)}
                  onCheckedChange={(checked) => toggleCollection(collection.id, checked === true)}
                />
                {collection.label}
              </Label>
            ))}
            {response?.degraded && (
              <Badge variant="outline" className="gap-1 border-amber-500/40 text-amber-700">
                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                Fallback
              </Badge>
            )}
            {statusLabel && <span className="text-sm text-muted-foreground">{statusLabel}</span>}
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="max-h-[460px] overflow-y-auto rounded-md border">
            {!response && !error ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                Search across task markdown and docs.
              </div>
            ) : response && response.results.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                No matches found.
              </div>
            ) : (
              response?.results.map((result) => {
                const Icon = collectionIcon(result.collection);
                const taskId = result.collection.startsWith('tasks')
                  ? extractTaskId(result.path)
                  : null;

                return (
                  <button
                    key={`${result.collection}:${result.id}`}
                    type="button"
                    className={cn(
                      'flex w-full gap-3 border-b px-4 py-3 text-left transition-colors last:border-b-0',
                      taskId ? 'hover:bg-muted/60' : 'cursor-default'
                    )}
                    onClick={() => {
                      if (!taskId) return;
                      onTaskOpen?.(taskId);
                      onOpenChange(false);
                    }}
                  >
                    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{result.title}</span>
                        <Badge variant="secondary">{result.collection}</Badge>
                      </span>
                      <span className="mt-1 block break-all text-xs text-muted-foreground">
                        {result.path}
                      </span>
                      {result.snippet && (
                        <span className="mt-2 block text-sm leading-6 text-muted-foreground">
                          {result.snippet}
                        </span>
                      )}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {Number(result.score).toFixed(2)}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {response?.degraded && response.reason && (
            <p className="text-xs text-muted-foreground">{response.reason}</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { extractTaskId };
