# Embedded Operations Digest headings

The populated Operations Digest produced two level-one headings: the page title and the report's Markdown title. The existing component test replaced MarkdownRenderer with a plain text div, so it could not detect document hierarchy failures. The full primary-page-shell gate exposed the populated-state regression in QA run 33800497397.

The regression now uses the real Markdown renderer. Before the fix it failed with two h1 elements; after the fix the report begins at h3 beneath the Rendered Briefing h2. Deeper source headings retain their relative order up to HTML's h6 limit. Other consumers keep their default heading levels. The source string is never rewritten, so literal headings in code blocks, the source textarea, clipboard text, and downloaded Markdown remain unchanged.

The focused component slice has four passing tests. The browser route matrix covers all 12 primary routes in dark, light, compact, and enlarged-text modes, now with a populated briefing fixture. It passes in 40.4 seconds and checks one page h1, embedded h3/h4/h5 structure, initial route focus, overflow, and byte-for-byte Markdown downloads. All four rendered-briefing captures were inspected. The capture helper writes inspectable PNGs to the test output directory even with the line reporter. Web typecheck, changed-file lint, and formatting pass. Standards and specification reviews found no blockers.

This fixes #1400 and supports the broader desktop audit #1389. It does not close the remaining popout, Task Chat, maintained-media, or packaged-release acceptance work. Required full QA for PR #1398 must run on an integrated revision containing this fix; a focused pass here is not a substitute for that gate.
