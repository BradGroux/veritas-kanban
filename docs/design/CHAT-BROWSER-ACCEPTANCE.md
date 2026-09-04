# Chat browser acceptance

Mobile touch behavior and desktop window resizing use separate browser contexts. The mobile check verifies content clearance, touch targets, menus, opening and closing Chat, and retained drafts. The desktop check resizes from narrow to wide and back with enlarged text, retaining drafts and verifying that close controls remain actionable.

Do not resize a phone-emulated context to a desktop window as a substitute for desktop coverage. Chromium can retain a zoomed visual viewport and offset its automation coordinates after the focused composer is resized. The regression measured a 160px difference between the DOM close-button position and the automation bounding box, with visual viewport scale 1.125. This is not a reason to disable user zoom, force a click, or change application layout.

The checks live in `e2e/mobile-chat-entry.spec.ts`. Their task fixture has a distinct title from the readability suite so failed cleanup cannot make unrelated heading selectors ambiguous. These checks do not establish packaged, signed, installed-app, documentation-media, or release acceptance.
