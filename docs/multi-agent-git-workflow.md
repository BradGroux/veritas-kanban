# Multi-Agent Git Worktree Workflow

Veritas assigns each code task a dedicated Git branch, worktree, ownership
lease, and durable lifecycle manifest. The primary checkout is operator-owned;
task creation, integration, and cleanup must not switch its branch or change
its files.

## Why Worktrees Are Required

Multiple agents in one working directory share a checkout and index. A branch
switch, staged file, reset, or incomplete edit from one run can affect every
other run. Separate worktrees provide each task with:

- an isolated working directory and index
- a unique branch and path
- an exact, recorded base commit
- task and attempt ownership
- independently inspectable changes and recovery state

Sequential execution is still appropriate for overlapping tasks, but it is not
a substitute for isolation.

## Veritas-Managed Creation

Create worktrees from the task Git tab or API:

```http
POST /api/tasks/:id/worktree
Content-Type: application/json

{}
```

Veritas validates the configured repository and branch names, fetches the base
branch from `origin`, resolves its exact commit, checks all active manifests and
registered Git worktrees for branch/path collisions, and persists
`worktree-manifest/v1` before `git worktree add` runs.

Fetch errors are not ignored. When remote access is intentionally unavailable,
an operator may acknowledge the risk:

```json
{
  "allowStaleBase": true,
  "staleBaseAcknowledgement": {
    "reason": "Operator confirmed offline maintenance mode."
  }
}
```

The manifest records the local commit, failed-fetch diagnostic, reason, actor,
and timestamp. Do not use stale-base mode merely to bypass a remote error.

### Adopting pre-6.0 worktrees

Existing tasks with a worktree path but no manifest require explicit admin
adoption:

```http
POST /api/tasks/:id/worktree/adopt
```

Veritas verifies the registered path, branch, common Git directory, redacted
remote identity, cross-task uniqueness, exact remote base, and current status
before persisting ownership. The fetched base must be an ancestor of the legacy
HEAD and is labeled `legacy-adopted`, so adoption evidence is not confused with
the unknown original creation base. Veritas does not remove or rewrite local
changes.

## Launch Ownership

When an agent starts, the new attempt claims and renews the worktree lease. The
task envelope and run launch manifest record:

- worktree manifest ID
- ownership lease ID
- owning attempt ID
- repository, branch, and base branch
- exact resolved base commit
- remote or acknowledged-local resolution source
- launch HEAD and pre-existing file fingerprints

Lease claims are compare-and-claim operations. A second live attempt cannot
replace an unexpired owner, terminal attempts release ownership, and a claim
that occurs immediately before attempt persistence still locks cleanup. An
active or pending attempt locks rebase, integration, and cleanup, including
forced cleanup.

## Integration

The Merge action does not check out the base branch in the primary repository.
Veritas:

1. Requires a clean task worktree and no active run.
2. Fetches and resolves the latest remote base commit.
3. Creates a detached worktree under
   `.veritas-kanban/worktrees/.integration/`.
4. Merges the task branch there with a merge commit.
5. Pushes `HEAD` to the remote base without force.
6. Fetches and verifies the resulting remote commit.
7. Removes the integration and source worktrees when cleanup remains safe.
8. Marks the task done.

If merge or push fails, the integration path, commit, stage, and bounded error
remain in the manifest. A clean failed-push worktree can be retried. Conflicts
or a newly advanced remote base require inspection and resolution in the
recorded integration worktree before retrying.

## Cleanup

Preview cleanup before removing anything:

```http
GET /api/tasks/:id/worktree/cleanup-preview
GET /api/tasks/worktrees/cleanup-preview
```

The task endpoint evaluates one worktree. The collection endpoint lists
expired-lease candidates without deleting them.

Cleanup blocks when Veritas finds:

- an active or pending attempt
- a task/manifest or branch mismatch
- tracked staged or unstaged changes
- untracked files
- commits not reachable from the remote base
- a HEAD not merged into the remote base
- a known external process hold
- an unavailable external-hold probe, missing path, or other incomplete safety
  evidence

An active run, unexpired attempt lease, branch mismatch, or manifest mismatch
is not overrideable. Other findings require `admin:manage`, `force=true`, and
an explicit reason:

```http
DELETE /api/tasks/:id/worktree?force=true&reason=Operator%20accepted%20the%20risk
```

The branch is retained. The override reason, actor, time, and bypassed checks
are appended to the manifest. A clean status alone never proves that a
worktree is pushed, merged, unowned, or safe to remove.

## Recovery

Lifecycle state is durable:

| Failure point       | Recorded state                                  | Recovery                                                                  |
| ------------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| Worktree creation   | exact base, branch, path, `creation: failed`    | Retry creation; Veritas adopts only an unambiguous partial branch/path    |
| Task metadata write | Git worktree and `creation: ready`              | Retry creation to reconcile the task reference                            |
| Rebase              | target exact base and `rebase: rebasing/failed` | Retry; Veritas aborts partial Git state and reapplies the recorded intent |
| Integration prepare | integration path/base and `preparing`           | Retry; Veritas validates or recreates the detached worktree               |
| Integration merge   | integration path and `merging` or merge error   | Retry; completed merges are recognized, partial merges are aborted        |
| Integration push    | integration HEAD and `pushing` or push error    | Retry; Veritas first checks whether the commit already reached remote     |
| Cleanup             | path and `cleanup: failed` or `blocked`         | Retry; a post-removal task-write failure reconciles without re-deleting   |

Repository allocation locks serialize cross-task branch/path reservation.
Worktree manifest lock files are ownership records. Veritas never guesses that
a stale-looking lock is abandoned. Confirm that no Veritas process owns the
lock before removing it manually.

## Operator Checklist

- Give every code task a unique branch.
- Create or reconcile the worktree before starting an agent.
- Treat the recorded worktree path as the run boundary.
- Stop the run before rebase, integration, or cleanup.
- Review the cleanup preview and preserve ambiguous work.
- Prefer pull-request review when repository policy requires it.
- Never force-push as part of automated integration.
- Keep `.veritas-kanban/worktree-manifests/` in runtime backups.
