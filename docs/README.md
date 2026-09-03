# Veritas Kanban Documentation

This directory is the public documentation surface for Veritas Kanban. It contains material that users, operators, contributors, security reviewers, and release maintainers need to install, use, inspect, test, or release the application.

## Start here

- [Getting Started](GETTING-STARTED.md)
- [Features](FEATURES.md)
- [CLI Guide](CLI-GUIDE.md)
- [API Reference](API-REFERENCE.md)
- [Agent Providers](AGENT-PROVIDERS.md)
- [Self-Hosting](guides/SELF_HOST.md)
- [Troubleshooting](TROUBLESHOOTING.md)
- [Security Guide](security.md)

## Publication boundary

The public repository keeps five documentation classes:

| Class                                  | Location                                                                                           | Purpose                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Product and operator guides            | `docs/`, `docs/features/`, `docs/guides/`, `docs/mcp/`                                             | Current behavior, setup, APIs, operations, and troubleshooting      |
| Contributor and architecture contracts | `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `docs/architecture/`, `docs/design/`, `docs/testing/` | Maintained implementation and verification contracts                |
| Release sources and evidence           | `CHANGELOG.md`, `docs/releases/`, maintained version guides and checklists                         | Reviewed inputs required to validate and publish supported releases |
| Runtime examples and templates         | `prompt-registry/`, `tasks/examples/`                                                              | Product data loaded or presented by Veritas Kanban                  |
| Repository and test fixtures           | `.github/`, package readmes, `server/src/contracts/`, `server/src/__fixtures__/`                   | Contribution workflows and executable test or protocol fixtures     |

Do not publish execution goal prompts, private advisory notes, one-time implementation handoffs, raw learnings, dated working audits, generated reports, or scratch files. Track actionable work in GitHub issues or Veritas tasks. Keep local working artifacts under `.veritas-kanban/internal/`, which is ignored by Git.

The prompt templates under `prompt-registry/` are application content, not internal execution prompts. They remain versioned because Veritas Kanban loads and exposes them as product functionality.

Run `pnpm check:public-docs` after changing documentation. The check rejects known internal-artifact patterns, verifies that every tracked Markdown file belongs to a public class, and validates relative Markdown targets.
