import { useMemo, useState } from 'react';
import { Archive, FileText, Loader2, Search, ShieldAlert, Sparkles } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { api, type SearchBackend, type SearchCollection, type SearchResponse } from '@/lib/api';
import { extractTaskId } from '@/lib/search-utils';
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
    <Modal
      opened={open}
      onClose={() => onOpenChange(false)}
      size="xl"
      padding={0}
      title={
        <Group gap="xs">
          <span className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            Search Tasks and Docs
          </span>
        </Group>
      }
      classNames={{ header: 'border-b px-5 py-4', body: 'p-0' }}
    >
      <div className="border-b px-5 pb-4">
        <Text size="sm" c="dimmed">
          Find active work, archived decisions, and project documentation.
        </Text>
      </div>

      <Stack gap="md" className="px-5 py-4">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <div className="relative min-w-0 flex-1">
            <TextInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search task titles, descriptions, notes, docs..."
              aria-label="Search tasks and docs"
              leftSection={<Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />}
              autoFocus
            />
          </div>
          <Select
            value={backend}
            onChange={(value) => setBackend((value ?? 'auto') as SearchBackend)}
            data={BACKENDS.map((item) => ({ value: item.id, label: item.label }))}
            aria-label="Search backend"
            className="w-full sm:w-32"
            allowDeselect={false}
          />
          <Button
            type="submit"
            disabled={!canSearch}
            leftSection={
              isSearching ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Search className="h-4 w-4" aria-hidden="true" />
              )
            }
          >
            Search
          </Button>
        </form>

        <div className="flex flex-wrap items-center gap-3">
          {COLLECTIONS.map((collection) => (
            <Checkbox
              key={collection.id}
              checked={collections.includes(collection.id)}
              onChange={(event) => toggleCollection(collection.id, event.currentTarget.checked)}
              label={collection.label}
              className="flex h-8 items-center rounded-md border px-3"
              classNames={{ label: 'text-sm font-normal' }}
            />
          ))}
          {response?.degraded && (
            <Badge
              variant="outline"
              color="yellow"
              leftSection={<ShieldAlert className="h-3 w-3" aria-hidden="true" />}
            >
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

        <ScrollArea h={460} className="rounded-md border">
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
                      <Badge variant="light" color="gray">
                        {result.collection}
                      </Badge>
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
        </ScrollArea>

        {response?.degraded && response.reason && (
          <p className="text-xs text-muted-foreground">{response.reason}</p>
        )}
      </Stack>
    </Modal>
  );
}

export { extractTaskId };
