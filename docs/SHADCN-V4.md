# shadcn/ui CLI v4 — Veritas Kanban

> Upgraded 2026-03-08. CLI version: **4.0.0**

## New CLI Commands (v4)

| Command                             | Description                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `shadcn info`                       | Show project config, installed components, resolved paths, and registry URLs |
| `shadcn docs <component>`           | Get API references, usage examples, and docs for components                  |
| `shadcn view <item>`                | View items from the registry                                                 |
| `shadcn search <registry>`          | Search/list items from registries                                            |
| `shadcn migrate [migration] [path]` | Run migrations (e.g., Tailwind v3 → v4)                                      |
| `shadcn build [registry]`           | Build components for a custom shadcn registry                                |
| `shadcn mcp`                        | MCP server and configuration commands                                        |
| `shadcn registry add`               | Add external registries to your project                                      |

### Useful Flags

| Flag              | Command           | Description                                       |
| ----------------- | ----------------- | ------------------------------------------------- |
| `--diff`          | `add <component>` | Show diff of upstream changes before applying     |
| `--dry-run`       | `add <component>` | Preview what would be added without writing files |
| `--view`          | `add <component>` | View component source code                        |
| `--force`         | `init`            | Force overwrite existing configuration            |
| `--preset <name>` | `init`            | Use a preset configuration (e.g., `base-nova`)    |
| `--reinstall`     | `init`            | Re-install existing UI components                 |
| `--base <base>`   | `init`            | Choose component library base (`radix` or `base`) |

## Project Configuration

```
framework:       Vite (vite)
style:           new-york
base:            radix
tailwindVersion: v4
tailwindConfig:  tailwind.config.js
tailwindCss:     src/globals.css
iconLibrary:     lucide
typescript:      Yes
rsc:             No
```

## VK Design Preset

VK uses the **neutral** base color with a custom dark-mode primary at **270° 50% 40%** (purple accent). This is not a built-in shadcn preset — it's our custom theme encoded in CSS variables.

### Light Mode

```css
:root {
  --background: 0 0% 100%;
  --foreground: 0 0% 3.9%;
  --primary: 0 0% 9%;
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 96.1%;
  --muted: 0 0% 96.1%;
  --accent: 0 0% 96.1%;
  --destructive: 0 84.2% 60.2%;
  --border: 0 0% 89.8%;
  --ring: 0 0% 3.9%;
  --radius: 0.5rem;
}
```

### Dark Mode (VK default)

```css
.dark {
  --background: 0 0% 3.9%;
  --foreground: 0 0% 98%;
  --primary: 270 50% 40%; /* Purple accent — VK brand */
  --primary-foreground: 0 0% 98%;
  --secondary: 0 0% 14.9%;
  --muted: 0 0% 14.9%;
  --accent: 0 0% 14.9%;
  --destructive: 0 62.8% 30.6%;
  --border: 0 0% 14.9%;
  --ring: 270 50% 40%; /* Matches primary */
}
```

### Chart Colors (Dark)

```css
.dark {
  --chart-1: 220 70% 50%; /* Blue */
  --chart-2: 160 60% 45%; /* Teal */
  --chart-3: 30 80% 55%; /* Orange */
  --chart-4: 280 65% 60%; /* Purple */
  --chart-5: 340 75% 55%; /* Pink */
}
```

### To recreate this theme on a fresh `shadcn init`:

```bash
pnpm dlx shadcn@latest init --template=vite --force
# Then replace CSS variables in src/globals.css with the values above
```

## Installed Components (16)

All components are current with upstream as of 2026-03-08:

- alert-dialog, badge, button, checkbox, dialog, input, label, popover
- scroll-area, select, sheet, skeleton, switch, tabs, textarea, tooltip

Plus 2 custom components (not from shadcn registry):

- `MarkdownEditor.tsx`
- `MarkdownRenderer.tsx`

### Checking for upstream changes

```bash
cd web
pnpm dlx shadcn@latest diff          # Check all components
pnpm dlx shadcn@latest add button --diff  # Check specific component
```

## Dark Mode

VK uses class-based dark mode (`darkMode: ['class']` in tailwind.config.js). The `<html>` element has `class="dark"` by default. All CSS variables have both `:root` (light) and `.dark` (dark) variants defined in `src/globals.css`.
