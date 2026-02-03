---
id: task_example_002
title: 'Fix: Dashboard WebSocket memory leak'
type: code
status: todo
priority: high
project: my-project
created: '2026-01-16T09:00:00.000Z'
updated: '2026-01-16T09:00:00.000Z'
comments:
  - id: comment_example_002a
    author: Human
    text: >-
      Seeing memory climb steadily on the dashboard page. Heap snapshot shows
      detached DOM nodes from the real-time chart component. Likely the
      WebSocket listener isn't cleaning up on unmount.
    timestamp: '2026-01-16T09:00:00.000Z'
position: 1
---

The dashboard page leaks memory when left open. After ~30 minutes, the tab consumes over 500MB.

**Steps to Reproduce:**

1. Open the dashboard
2. Leave it running for 30+ minutes
3. Check Chrome DevTools → Memory → Heap snapshot
4. Observe detached DOM nodes growing linearly

**Suspected Root Cause:**
WebSocket event listeners in `RealtimeChart.tsx` are not cleaned up in the `useEffect` return function. Each re-render adds a new listener without removing the old one.

**Fix Plan:**

1. Add cleanup function to WebSocket useEffect
2. Move WebSocket connection to a shared context (avoid per-component connections)
3. Add memory regression test
