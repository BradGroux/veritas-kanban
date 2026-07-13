# Security Policy

## Reporting a Vulnerability

We take security seriously. If you discover a vulnerability, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, email us at:

📧 **[contact@digitalmeld.io](mailto:contact@digitalmeld.io)**

### What to Include

- A description of the vulnerability
- Steps to reproduce the issue
- The potential impact
- Any suggested fixes (if applicable)

### Response Timeline

| Step               | Timeline                                         |
| ------------------ | ------------------------------------------------ |
| **Acknowledgment** | Within **48 hours** of your report               |
| **Fix timeline**   | Communicated within **7 days** of acknowledgment |
| **Resolution**     | As quickly as possible, depending on severity    |

We will work with you to understand the issue and coordinate disclosure.

## Repository Secret Hygiene

Runtime authentication state must never be committed. In particular, any
`.veritas-kanban/security.json` file may contain password and recovery-key
hashes for an enabled installation. The repository ignores these files and
enforces the rule locally and in CI:

```bash
pnpm check:security-artifacts
```

Deleting a sensitive file in a later commit does not remove it from Git
history. If authentication material is ever tracked, treat it as exposed:

1. Determine whether it belongs to a real installation.
2. Rotate or invalidate the affected password, recovery key, sessions, and
   related credentials before relying on repository cleanup.
3. Review reachable history, forks, and clones and make an explicit decision
   about coordinated history rewriting versus retaining the invalidated blob.
4. Record sensitive evidence in a private security advisory, not a public
   issue, commit message, test fixture, or log.

GitHub secret scanning and push protection should remain enabled for the
repository. The tracked-file guard complements those services because generic
password and recovery-key hashes may not match provider-specific signatures.

## Scope

This policy applies to:

- The **Veritas Kanban** application (all components)
- Direct dependencies used by the application
- The official deployment infrastructure

### Out of Scope

- Third-party services or applications that integrate with Veritas Kanban
- Vulnerabilities in dependencies that have already been publicly disclosed with upstream fixes available
- Social engineering attacks

## Supported Versions

| Version           | Supported      |
| ----------------- | -------------- |
| Latest release    | ✅             |
| Previous releases | ⚠️ Best effort |

## Recognition

We value the security research community. With your permission, we will acknowledge your contribution in our release notes when a vulnerability is fixed.

Thank you for helping keep Veritas Kanban and its users safe.
