# Session menu keyboard dismissal (#1451)

Escape closes the Session menu when focus is on its trigger or inside the account popover, returning focus to the current trigger. A nested control that consumes Escape keeps ownership of the event. Clicking the trigger again still closes the menu; clicking elsewhere does not force focus back to the header. Members & Permissions, Security Settings, and logout actions are unchanged.

The previous Mantine dropdown handled Escape during capture inside the portaled content only. The trigger was outside that path. The fix handles bubbling key events on both the trigger and dropdown, disables the dropdown's capture handler, and restores focus only for an unconsumed Escape.

The focused layout-chrome regressions reproduce the original failure in both trigger presentations and cover content focus, nested event ownership, mouse toggle, click-away, and identity/security callbacks. Packaged macOS acceptance uses the candidate-bound runner from #1387 at 1700×760 and 1180×760 in both themes. A passing candidate does not establish signing, installation, refreshed documentation media, or release publication.
