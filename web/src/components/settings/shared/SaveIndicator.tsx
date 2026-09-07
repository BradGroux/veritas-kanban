import { useState, useEffect } from 'react';
import { Check, Save } from 'lucide-react';

export function SaveIndicator({ isPending, error }: { isPending: boolean; error?: unknown }) {
  const [showSaved, setShowSaved] = useState(false);
  const [wasPending, setWasPending] = useState(false);

  useEffect(() => {
    if (error) {
      setShowSaved(false);
      setWasPending(false);
    } else if (isPending) {
      setWasPending(true);
    } else if (wasPending) {
      setShowSaved(true);
      setWasPending(false);
      const timer = setTimeout(() => setShowSaved(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isPending, wasPending, error]);

  if (error)
    return (
      <div className="text-xs text-destructive" role="status">
        Not saved
      </div>
    );
  if (isPending) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-muted-foreground animate-pulse"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Save className="h-3 w-3" aria-hidden="true" />
        Saving...
      </div>
    );
  }
  if (showSaved) {
    return (
      <div
        className="flex items-center gap-1.5 text-xs text-[var(--vk-semantic-success-fg)]"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Check className="h-3 w-3" aria-hidden="true" />
        Saved
      </div>
    );
  }
  return null;
}
