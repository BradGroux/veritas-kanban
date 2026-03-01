# PR Risk Scoring & Merge Gate

Automated PR risk assessment that scores every pull request and enforces merge gates for high-risk changes.

## How It Works

When a PR is opened, synchronized, or reopened, the `pr-risk-score` workflow runs `scripts/pr-risk-scorer.mjs` which:

1. **Fetches PR data** (changed files, lines added/deleted) from the GitHub API
2. **Computes a risk score** (0–100) based on weighted factors
3. **Posts a comment** with the score breakdown and risk tier
4. **Applies a label** (`risk:low`, `risk:medium`, or `risk:high`)
5. **Enforces a merge gate** for high-risk PRs (fails the check until conditions are met)

## Scoring Factors

| Factor           | Weight                       | Description                                          |
| ---------------- | ---------------------------- | ---------------------------------------------------- |
| Files changed    | 0.3 pts per file beyond 5    | Large PRs are harder to review                       |
| Lines changed    | 0.05 pts per line beyond 100 | More code = more risk                                |
| Sensitive paths  | 8 pts each                   | Auth, security, middleware, workflows, Docker, infra |
| Dependency files | 5 pts each                   | package.json, lockfiles, etc.                        |
| No tests         | 15 pts penalty               | PRs without test files get penalized                 |

### Sensitive Path Patterns

Files matching these patterns are flagged:

- `auth`, `security` (case-insensitive)
- `middleware/*validate*`
- `.github/workflows/`
- `Dockerfile`, `docker-compose`
- `.env` files
- `infrastructure/`, `infra/`, `terraform/`, `k8s/`, `helm/`
- `.pre-commit` config
- `server/src/routes/auth*`, `server/src/middleware/`

## Risk Tiers

| Tier      | Score Range | Action                                    |
| --------- | ----------- | ----------------------------------------- |
| 🟢 Low    | 0–29        | Comment + label only                      |
| 🟡 Medium | 30–59       | Comment + label (review recommended)      |
| 🔴 High   | 60–100      | Comment + label + **merge gate enforced** |

## Merge Gate (High Risk)

When a PR scores ≥60 (high risk), the check will **fail** unless:

1. **Required approvals** are met (default: 2 approving reviews)
2. **Security review label** is applied (default: `security-reviewed`)

The gate re-evaluates on review submissions and label changes.

## Configuration

All thresholds are configurable via GitHub repository variables (`Settings > Secrets and variables > Actions > Variables`):

| Variable                | Default             | Description                                  |
| ----------------------- | ------------------- | -------------------------------------------- |
| `RISK_THRESHOLD_MEDIUM` | `30`                | Score threshold for medium risk              |
| `RISK_THRESHOLD_HIGH`   | `60`                | Score threshold for high risk                |
| `MERGE_GATE_ENABLED`    | `true`              | Set to `false` to disable the merge gate     |
| `REQUIRED_APPROVALS`    | `2`                 | Number of approvals needed for high-risk PRs |
| `SECURITY_REVIEW_LABEL` | `security-reviewed` | Label that signals security sign-off         |

## Overriding the Merge Gate

For legitimate high-risk PRs:

1. Get the required number of approving reviews
2. Have a security reviewer apply the `security-reviewed` label
3. Re-run the workflow (or push a commit to trigger it)

The check will pass once both conditions are satisfied.

## Running Locally

```bash
GITHUB_TOKEN=ghp_xxx GITHUB_REPOSITORY=owner/repo PR_NUMBER=123 \
  node scripts/pr-risk-scorer.mjs --json
```

## Testing

```bash
node --test scripts/__tests__/pr-risk-scorer.test.mjs
```
