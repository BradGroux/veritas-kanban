import { useState, useEffect } from 'react';
import { Check, Save } from 'lucide-react';

export function SaveIndicator({ isPending }: { isPending: boolean }) {
  const [showSaved, setShowSaved] = useState(false);
  const [wasPending, setWasPending] = useState(false);

  useEffect(() => {
    if (isPending) {
      setWasPending(true);
    } else if (wasPending) {
      setShowSaved(true);
      setWasPending(false);
      const timer = setTimeout(() => setShowSaved(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [isPending, wasPending]);

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
        className="flex items-center gap-1.5 text-xs text-green-500"
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
