# Setup Paths

> Credit: `@cob-ai` helped surface the setup friction that led to this guide.

Veritas Kanban starts as a local board. The agent, MCP, OpenClaw, Squad Chat, notification, workflow, and governance layers are optional. Add them only when you need that capability.

## Pick Your Path

| Path                | Use this when                                                   | Required setup                                                         |
| ------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Board only          | You want a local Kanban board and UI                            | `pnpm install`, `cp server/.env.example server/.env`, `pnpm dev`       |
| Board plus CLI      | You want shell commands for tasks                               | Board setup, build/link CLI, `VK_API_URL`, optional `VK_API_KEY`       |
| Board plus MCP      | You want an assistant to read or update board state through MCP | Board setup, build MCP server, configure MCP client env                |
| Board plus OpenClaw | You want OpenClaw to run or wake agents                         | Board setup, OpenClaw config, optional browser relay or direct webhook |
| Self-hosted         | You want remote access                                          | Production env, reverse proxy, auth keys, backups                      |

## Minimal Local Setup

```bash
git clone https://github.com/BradGroux/veritas-kanban.git
cd veritas-kanban
pnpm install
cp server/.env.example server/.env
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The API runs on [http://localhost:3001](http://localhost:3001).

For a low-friction local start, these are the important server values:

```bash
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=true
VERITAS_AUTH_LOCALHOST_ROLE=read-only
```

This is enough for the board and read-only local API checks. Write-capable CLI and MCP actions need either an API key or a broader localhost role.

## CLI Setup

```bash
pnpm --filter @veritas-kanban/shared build
pnpm --filter @veritas-kanban/cli build
cd cli
npm link
```

Then point the CLI at the API:

```bash
export VK_API_URL=http://localhost:3001
```

For write commands, create an agent key in `server/.env`:

```bash
VERITAS_API_KEYS=local-agent:replace-with-a-long-secret:agent
```

Restart the server and export the same key:

```bash
export VK_API_KEY=replace-with-a-long-secret
vk setup
```

### CLI Read/Write Smoke Check

Run this before letting an agent use the CLI:

```bash
export VK_API_URL=http://localhost:3001
export VK_API_KEY=replace-with-a-long-secret

# Read check
vk list --json | jq 'length'

# Write check, then cleanup
TASK_ID=$(vk create "CLI auth smoke test" \
  --type automation \
  --priority low \
  --description "Temporary task created by CLI auth smoke test." \
  --json | jq -r '.id')
vk show "$TASK_ID" --json | jq -e --arg id "$TASK_ID" '.id == $id'
vk delete "$TASK_ID" --json
```

If the read check succeeds but the write check returns `401` or `403`, the CLI is reaching VK but does not have write-capable auth. Recheck `VERITAS_API_KEYS`, restart the server, and confirm `VK_API_KEY` is exported in the same shell running `vk`.

## MCP Setup

Build the MCP server:

```bash
pnpm --filter @veritas-kanban/shared build
pnpm --filter @veritas-kanban/mcp build
```

Local MCP clients should pass both URL and key when the agent will write:

```json
{
  "mcpServers": {
    "veritas-kanban": {
      "command": "node",
      "args": ["/absolute/path/to/veritas-kanban/mcp/dist/index.js"],
      "env": {
        "VK_API_URL": "http://localhost:3001",
        "VK_API_KEY": "replace-with-a-long-secret"
      }
    }
  }
}
```

Read-only localhost calls may work without `VK_API_KEY`. Write tools need `VK_API_KEY` unless `VERITAS_AUTH_LOCALHOST_ROLE` is set to `agent` or `admin`.

### MCP Read/Write Smoke Check

Run this before giving an assistant MCP write access:

```bash
export VK_API_URL=http://localhost:3001
export VK_API_KEY=replace-with-a-long-secret

# Read check: call list_tasks
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_tasks","arguments":{"status":"todo"}}}' | \
  node mcp/dist/index.js 2>/dev/null | \
  head -1 | jq -e '.result.content[0].text | fromjson | type == "array"'

# Write check: create a temporary task
MCP_TASK_ID=$(echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"create_task","arguments":{"title":"MCP auth smoke test","type":"automation","priority":"low","description":"Temporary task created by MCP auth smoke test."}}}' | \
  node mcp/dist/index.js 2>/dev/null | \
  head -1 | jq -r '.result.content[0].text | capture("Task created: (?<id>[^\\n]+)").id')

# Cleanup
echo "{\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"tools/call\",\"params\":{\"name\":\"delete_task\",\"arguments\":{\"id\":\"$MCP_TASK_ID\"}}}" | \
  node mcp/dist/index.js 2>/dev/null | \
  head -1 | jq -e '.result.content[0].text | startswith("Task deleted: ")'
```

If the `list_tasks` read check works but `create_task` fails, the MCP process is installed but does not have write-capable API auth. Put `VK_API_KEY` in the MCP client env block and restart the client.

## Optional Layers

### OpenClaw

OpenClaw is not required to run Veritas Kanban. Use it when you want OpenClaw to execute tasks, route agent work, use the browser relay, or receive direct wake events.

### Squad Chat

Squad Chat is a local shared message log for agents. It does not automatically wake an external agent process unless you also configure an external runner, webhook, or OpenClaw Direct path.

### Notifications And Broadcasts

These are separate surfaces:

- Notifications are per-recipient task and system events.
- Broadcasts are persistent system-wide messages at `/api/broadcasts`.
- Squad Chat Webhook is an optional outbound wake/delivery mechanism for chat messages.

### Workflows And Governance

Workflow engine, gates, policies, cross-model review, and approval rules are production guardrails. They are useful, but they are not part of first-run setup.

## Assistant-Safe Setup Prompt

Use this when asking an assistant to install or configure VK:

```text
Set up Veritas Kanban from the official repo and docs only. Start with the board-only local path first. Do not configure OpenClaw, MCP, Squad Chat webhooks, workflow gates, or notification delivery unless I explicitly ask for that layer. After the board runs, verify localhost:3000 and localhost:3001/api/health. If configuring CLI or MCP writes, use VK_API_URL and VK_API_KEY exactly as documented.
```

## Quick Troubleshooting

| Symptom                                            | Likely cause                                  | Fix                                                                                                          |
| -------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `vk` command exists but cannot import shared files | CLI linked before shared/CLI build            | Run `pnpm --filter @veritas-kanban/shared build && pnpm --filter @veritas-kanban/cli build`, then link again |
| MCP reads work but writes fail                     | No write-capable API key                      | Add `VERITAS_API_KEYS` in `server/.env`, restart, set `VK_API_KEY` in MCP client env                         |
| Assistant says OpenClaw is required                | Setup path confusion                          | Start with board-only setup. OpenClaw is optional                                                            |
| Squad Chat posts save but no agent wakes           | Local chat works, outbound runner is missing  | Configure OpenClaw Direct or another webhook runner only if wake behavior is needed                          |
| Notification test does nothing external            | External delivery is disabled or unconfigured | Configure notification channels or use local broadcasts for in-app visibility                                |
