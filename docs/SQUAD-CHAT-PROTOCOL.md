# Squad Chat Protocol

Squad chat is the **glass box** — the real-time visibility layer that lets humans see what agents are doing. If work is happening and squad chat is quiet, transparency has failed.

## Rule: Every Agent Posts to Squad Chat

**Non-negotiable.** Every agent (human or AI) posts to squad chat when:

1. **Starting work** — What you're about to do
2. **Milestones** — Major progress (e.g., "Chapter 3 of 9 complete")
3. **Completion** — What you delivered
4. **Blockers** — What's preventing progress
5. **Findings** — Bugs found, security issues, review results

## How to Post

### Script (preferred)

```bash
# Usage: squad-post.sh [--model MODEL] <agent-name> <message> [tags...]
./scripts/squad-post.sh TARS "Starting code review for US-42" review code
./scripts/squad-post.sh --model claude-sonnet-4.5 K-2SO "FIXED: Path traversal in broadcast storage" fix security
./scripts/squad-post.sh Ava "Performance review complete — 10/10" review performance
```

### curl (when script isn't available)

```bash
curl -s -X POST "http://localhost:3002/api/chat/squad" \
  -H 'Content-Type: application/json' \
  -d '{
    "agent": "YOUR_NAME",
    "message": "Your update here",
    "tags": ["relevant", "tags"],
    "model": "claude-sonnet-4.5"
  }'
```

### Environment Variables

The script supports these env vars for non-default configurations:

| Variable  | Default     | Description     |
| --------- | ----------- | --------------- |
| `VK_HOST` | `localhost` | Server hostname |
| `VK_PORT` | `3001`      | Server port     |

### API Details

- **Endpoint:** `POST /api/chat/squad`
- **Port:** 3001 (Express) or 3000 (Vite proxy)
- **Body:** `{ "agent": string, "message": string, "tags"?: string[], "model"?: string }`
- **Response:** `201 Created` with the message object `{ id, agent, message, tags, model, timestamp }`
- **Auth:** None required (localhost only). If exposing externally, protect behind auth.

### Troubleshooting

- **Connection refused:** Verify VK server is running (`curl http://localhost:3002/api/health`)
- **Script fails silently:** Check that `jq` is installed (`which jq`)
- **Wrong port:** Set `VK_PORT` env var to match your server configuration

## System Events (Lifecycle)

System events show as **divider lines** in the squad chat UI — visually distinct from regular messages. They track agent lifecycle automatically.

```bash
# When spawning a sub-agent:
./scripts/squad-event.sh spawned TARS "YouTube Script Draft"
./scripts/squad-event.sh --model claude-sonnet-4.5 spawned TARS "YouTube Script Draft"

# When a sub-agent completes:
./scripts/squad-event.sh completed TARS "YouTube Script Draft" "2m35s"
./scripts/squad-event.sh --model claude-sonnet-4.5 completed TARS "YouTube Script Draft" "2m35s"

# When a sub-agent fails:
./scripts/squad-event.sh failed K-2SO "Security Review" "45s"

# Status update (working on):
./scripts/squad-event.sh status Ava "Performance Analysis"
```

| Event       | Icon | When                            |
| ----------- | ---- | ------------------------------- |
| `spawned`   | 🚀   | Sub-agent dispatched            |
| `completed` | ✅   | Sub-agent finished successfully |
| `failed`    | ❌   | Sub-agent errored               |
| `status`    | ⏳   | Agent working on task           |

**Orchestrator responsibility:** The main agent (VERITAS) posts `spawned` events when dispatching and `completed`/`failed` events when results come back. Sub-agents post their own regular messages throughout their work.

## Sub-Agent Template

Every sub-agent task **must** include this block:

```
SQUAD CHAT (mandatory): Post updates to squad chat as YOUR_NAME throughout your work.
Use this command for regular updates:
  curl -s -X POST "http://localhost:3002/api/chat/squad" \
    -H 'Content-Type: application/json' \
    -d '{"agent":"YOUR_NAME","message":"YOUR UPDATE","tags":["relevant","tags"],"model":"YOUR_MODEL"}'

Post when you: (1) start work, (2) hit milestones, (3) complete, (4) find issues.

Note: The model field (e.g. "claude-sonnet-4.5") helps humans see which AI model is behind each agent.
```

The orchestrator handles system events (spawned/completed/failed) — sub-agents just post regular messages about their work.

## Tags Convention

| Tag            | When to use                              |
| -------------- | ---------------------------------------- |
| `review`       | Code/security/perf/functionality reviews |
| `fix`          | Bug fixes                                |
| `security`     | Security-related work                    |
| `coordination` | Task dispatch, team updates              |
| `shipped`      | Releases, deploys                        |
| `blocked`      | Blockers                                 |
| `research`     | Research tasks                           |
| `docs`         | Documentation work                       |

## Why This Matters

Squad chat is what we demo. It's what makes Veritas Kanban different — the glass box. If agents do great work but nobody can see it happening, we've failed at the core value proposition. Every message in squad chat is proof that transparency works.
