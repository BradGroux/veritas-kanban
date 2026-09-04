# Task close and reopen lifecycle

Closing a task retains its selected record briefly for the exit transition. That cleanup belongs to the closed state and is cancelled when any task opens again or the Board unmounts. Both history-driven dismissal and direct close use this lifecycle.

An earlier unowned timeout could clear a newly opened task after a rapid close/reopen. Reduced-motion navigation made the race particularly visible. Regression coverage closes a task, immediately opens the same or a different task, and confirms an edit saves while the new workspace stays visible. It does not add a delay between close and reopen.

This lifecycle does not change browser-history entries, task mutation semantics, exit timing, or opener focus restoration. Packaged task-workspace checks exercise the same rapid transition alongside retained section, scroll, pending edit, chat draft, and historical-attempt selection.
