# shadcn/ui CLI v4 — Veritas Kanban

> Upgraded 2026-03-09. CLI version: **4.0.2** | Style: **radix-nova** | Color format: **oklch**

## What Changed in v4 Upgrade

- **Style**: `new-york` -> `radix-nova` (v4 naming: `base-preset`)
- **Color format**: HSL (`0 0% 3.9%`) -> oklch (`oklch(0.145 0 0)`)
- **Imports**: `@radix-ui/react-*` -> `radix-ui` (unified package)
- **Components**: All 16 registry components updated to v4 API (function components, `data-slot` attributes)
- **CSS**: Added `@theme inline` block for Tailwind v4 integration, `tw-animate-css`, `shadcn/tailwind.css`
- **Font**: Preserved original system font stack (`system-ui, Roboto, sans-serif`)
- **New fields in `components.json`**: `rtl`, `menuColor`, `menuAccent`

## New CLI Commands (v4)

| Command                             | Description                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| `shadcn info`                       | Show project config, installed components, resolved paths, and registry URLs |
| `shadcn docs <component>`           | Get API references, usage examples, and docs for components                  |
| `shadcn view <item>`                | View items from the registry                                                 |
| `shadcn search <registry>`          | Search/list items from registries                                            |
| `shadcn migrate [migration] [path]` | Run migrations (e.g., Tailwind v3 -> v4)                                     |
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
| `--preset <name>` | `init`            | Use a preset configuration (nova, vega, etc.)     |
| `--reinstall`     | `init`            | Re-install existing UI components                 |
| `--base <base>`   | `init`            | Choose component library base (`radix` or `base`) |

## Project Configuration

```
framework:       Vite (vite)
style:           radix-nova
base:            radix
tailwindVersion: v4
tailwindConfig:  tailwind.config.js
tailwindCss:     src/globals.css
iconLibrary:     lucide
typescript:      Yes
rsc:             No
rtl:             No
menuColor:       default
menuAccent:      subtle
```

## VK Design Preset

VK uses the **neutral** base color with a custom dark-mode primary at **oklch(0.389 0.15 303.5)** (purple accent, equivalent to HSL 270 50% 40%). This is applied on top of the `nova` preset.

### Light Mode (oklch)

```css
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --muted: oklch(0.97 0 0);
  --accent: oklch(0.97 0 0);
  --destructive: oklch(0.58 0.22 27);
  --border: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --radius: 0.5rem;
}
```

### Dark Mode (VK default, oklch)

```css
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --primary: oklch(0.389 0.15 303.5); /* Purple accent — VK brand */
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.269 0 0);
  --muted: oklch(0.269 0 0);
  --accent: oklch(0.269 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(0.269 0 0);
  --ring: oklch(0.389 0.15 303.5); /* Matches primary */
}
```

### To recreate this theme on a fresh `shadcn init`:

```bash
pnpm dlx shadcn@latest init --template=vite --force --base radix --preset nova
# Then replace dark mode --primary and --ring in src/globals.css with oklch(0.389 0.15 303.5)
```

## Installed Components (16)

All components updated to v4 as of 2026-03-09:

- alert-dialog, badge, button, checkbox, dialog, input, label, popover
- scroll-area, select, sheet, skeleton, switch, tabs, textarea, tooltip

Plus 4 non-registry components:

- `MarkdownEditor.tsx` (custom)
- `MarkdownRenderer.tsx` (custom)
- `toast.tsx` (customized, uses `@radix-ui/react-toast`)
- `toaster.tsx` (customized)

### Checking for upstream changes

```bash
cd web
pnpm dlx shadcn@latest diff                    # Check all components
pnpm dlx shadcn@latest add button --diff        # Check specific component
```

## Dark Mode

VK uses class-based dark mode (`darkMode: ['class']` in tailwind.config.js). The `<html>` element has `class="dark"` by default. All CSS variables have both `:root` (light) and `.dark` (dark) variants defined in `src/globals.css` using oklch color format.

## Tailwind v4 Integration

The `@theme inline` block in `globals.css` maps CSS custom properties to Tailwind utility classes. This replaces the old `tailwind.config.js` `theme.extend.colors` pattern. The `shadcn/tailwind.css` import provides base component styles.
