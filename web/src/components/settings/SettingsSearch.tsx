import { useEffect, useId, useRef, useState } from 'react';
import { TextInput } from '@mantine/core';
import { Search } from 'lucide-react';
import { searchSettings, type SettingsSearchEntry } from './settings-search-index';

export function SettingsSearch({
  entries,
  boardOnly,
  onSelect,
}: {
  entries: SettingsSearchEntry[];
  boardOnly: boolean;
  onSelect: (entry: SettingsSearchEntry) => void;
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const results = searchSettings(entries, query, boardOnly);
  const active = Math.min(selected, Math.max(results.length - 1, 0));
  const choose = (entry: SettingsSearchEntry) => {
    setQuery('');
    setSelected(0);
    onSelect(entry);
  };
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, query, entries]);

  return (
    <div className="relative">
      <TextInput
        aria-label="Search settings"
        placeholder="Search settings…"
        leftSection={<Search size={16} aria-hidden="true" />}
        value={query}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={results.length > 0}
        aria-controls={results.length ? listId : undefined}
        aria-activedescendant={results.length ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setQuery(event.currentTarget.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (results.length)
              setSelected(
                (active + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length
              );
          } else if (event.key === 'Enter' && results[active]) {
            event.preventDefault();
            choose(results[active]);
          } else if (event.key === 'Escape' && query) {
            event.preventDefault();
            event.stopPropagation();
            setQuery('');
          }
        }}
      />
      {query.trim() && (
        <div
          className="absolute top-full inset-x-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border bg-popover text-popover-foreground shadow-md"
          ref={listRef}
          id={listId}
          role={results.length ? 'listbox' : undefined}
          aria-label="Matching settings"
        >
          {results.length ? (
            results.map((entry, index) => (
              <button
                key={entry.id}
                id={`${listId}-${index}`}
                type="button"
                role="option"
                aria-selected={index === active}
                tabIndex={-1}
                className={`block w-full px-3 py-2 text-left ${index === active ? 'bg-muted' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(entry)}
              >
                <span className="block text-sm font-medium">{entry.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {entry.description}
                  {boardOnly && entry.optionalInBoardOnly ? ' · Optional in Board Only' : ''}
                </span>
              </button>
            ))
          ) : (
            <div role="status" className="px-3 py-3 text-sm text-muted-foreground">
              No matching settings. Try a different term.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
