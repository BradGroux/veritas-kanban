# Settings information architecture

This document is the reviewed navigation and layout contract for Settings. It keeps every existing destination available while replacing the flat 20-item list with stable task-oriented families.

## Navigation map

| Family        | Destinations                                                          | Purpose                                                                  |
| ------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Core          | General, Board, Tasks, Agents, Data                                   | Everyday product behavior, execution defaults, and operational data      |
| Collaboration | Notifications, Multi-user, Workspaces, Delegation                     | People, communication, workspace membership, and delegated work          |
| Automation    | Scheduler, Queues, Reflections, Trackers                              | Recurring work, queue observation, learning loops, and external tracking |
| Governance    | Security, Tool Policies, Enforcement, Shared Resources, Doc Freshness | Trust boundaries, policy, shared authority, and controlled knowledge     |
| System        | Maintenance, Manage                                                   | Installation health, recovery, and managed taxonomies                    |

The family and destination order is canonical across desktop and compact navigation. Permission checks disable unavailable destinations without removing their location. `defaultTab` resolves only to an allowed destination and otherwise returns to the first allowed item.

In Board Only mode, General, Board, and Tasks are marked as the primary path. Every other destination remains in its normal family and carries an Advanced label. This preserves discovery and administrative access without giving the full advanced inventory equal emphasis.

## Layout contract

- `SettingsPage` provides one page title, short purpose statement, optional page-level status or actions, a consistent content width, and the page spacing rhythm.
- `SettingsSection` provides the visible restart for one logical workflow: restrained border, neutral surface, heading, description, status, actions, and optional reset confirmation. Advanced and danger tones are semantic exceptions rather than decorative color.
- `SettingRow` uses one responsive label/description and control grid. At narrow widths the control stacks below the label; at desktop widths controls share a stable column.
- `SettingsFieldGrid` arranges related multi-field forms in one or two columns without horizontal scrolling.
- `SettingsStatusCard` uses labeled neutral, success, warning, or error state. Color is supplemental to the icon, title, and description.
- `SettingsLocalNav` is reserved for related sections on a long page. It uses in-page anchors, remains horizontally scrollable at narrow widths, and does not promote subsections into global destinations.
- `SettingsHelpText`, `SettingsErrorText`, `SettingsUnit`, and `SettingsActionGroup` standardize secondary explanation, validation, numeric units, routine transfer actions, and destructive actions.

General, Board, Tasks, and Data are the reference migrations. Data demonstrates continuous local navigation; simpler pages omit it. Agents extends that pattern with anchored Providers, Compatibility, Profiles, Health, and Policies workflows. Notifications, Multi-user, and Maintenance still require dedicated workflow decomposition because each combines several independent operational surfaces.

## Focus and responsive behavior

Changing a primary destination focuses and scrolls the page content to its heading. Arrow keys move through allowed destinations in canonical order. The sidebar scrolls independently at compact heights, while transfer and danger actions remain separated at its end. Compact layouts use the same grouped destination data in a select control.

The dialog grows to a wider desktop maximum while retaining viewport bounds. Page content is capped at a readable width. Rows and field grids stack below the small-screen breakpoint, semantic text remains visible at increased text size, and no section requires horizontal page scrolling.
