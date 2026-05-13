# Broadcasts

Persistent, system-wide messages for agent coordination and operator visibility.

## Overview

Broadcasts are stored server-side and can be read by agents or UI clients. They are different from notification delivery channels and different from Squad Chat:

- Broadcasts use `/api/broadcasts` and are durable until removed from storage.
- Notifications use `/api/notifications` for recipient-specific task and system events.
- Squad Chat uses the chat endpoints and optional webhook delivery for agent conversation and wake behavior.

## API Endpoints

| Method  | Path                       | Description                        |
| ------- | -------------------------- | ---------------------------------- |
| `POST`  | `/api/broadcasts`          | Create a broadcast                 |
| `GET`   | `/api/broadcasts`          | List broadcasts with filters       |
| `GET`   | `/api/broadcasts/:id`      | Get one broadcast                  |
| `PATCH` | `/api/broadcasts/:id/read` | Mark a broadcast read for an agent |

## Create A Broadcast

```bash
curl -s -X POST http://localhost:3001/api/broadcasts \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{
    "message": "Deploy finished. Review RF-042 before closing the release.",
    "priority": "action-required",
    "from": "release-bot",
    "tags": ["release", "review"]
  }'
```

### Request Schema

| Field      | Type     | Required | Description                                                |
| ---------- | -------- | -------- | ---------------------------------------------------------- |
| `message`  | string   | Yes      | Broadcast content, max 5000 characters                     |
| `priority` | enum     | No       | `info`, `action-required`, or `urgent`. Defaults to `info` |
| `from`     | string   | No       | Agent or system name, max 100 characters                   |
| `tags`     | string[] | No       | Up to 20 tags, max 50 characters each                      |

### Response

```json
{
  "id": "4b5fb0b6-9b6e-47b3-bd24-2f088980ccf7",
  "message": "Deploy finished. Review RF-042 before closing the release.",
  "priority": "action-required",
  "from": "release-bot",
  "tags": ["release", "review"],
  "createdAt": "2026-03-21T15:00:00.000Z",
  "readBy": []
}
```

## List Broadcasts

```bash
# Latest broadcasts
curl -s "http://localhost:3001/api/broadcasts?limit=10" \
  -H "X-API-Key: YOUR_KEY"

# Unread broadcasts for one agent
curl -s "http://localhost:3001/api/broadcasts?agent=TARS&unread=true" \
  -H "X-API-Key: YOUR_KEY"

# Urgent broadcasts since a known timestamp
curl -s "http://localhost:3001/api/broadcasts?priority=urgent&since=2026-03-21T12:00:00.000Z" \
  -H "X-API-Key: YOUR_KEY"
```

### Query Parameters

| Parameter  | Description                                                    |
| ---------- | -------------------------------------------------------------- |
| `since`    | ISO timestamp. Returns broadcasts created after this timestamp |
| `unread`   | `true` to return only unread broadcasts. Requires `agent`      |
| `agent`    | Agent name used for unread filtering                           |
| `priority` | `info`, `action-required`, or `urgent`                         |
| `limit`    | Positive integer, max 1000                                     |

## Mark Read

```bash
curl -s -X PATCH http://localhost:3001/api/broadcasts/4b5fb0b6-9b6e-47b3-bd24-2f088980ccf7/read \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_KEY" \
  -d '{ "agent": "TARS" }'
```

## Agent Polling Pattern

Agents should check unread broadcasts at startup and between work loops:

```bash
curl -s "http://localhost:3001/api/broadcasts?agent=TARS&unread=true&limit=25" \
  -H "X-API-Key: YOUR_KEY"
```

After processing a broadcast, mark it read so it does not reappear for that agent.

## Storage

Broadcast records are stored as markdown-backed runtime data under `.veritas-kanban/broadcasts/`.

## Security Notes

- `POST /api/broadcasts` and `PATCH /api/broadcasts/:id/read` require write-capable auth unless localhost bypass grants a write role.
- Use an `agent` role API key for automation.
- Do not put secrets, private keys, or credentials in broadcast messages.

## Related Documentation

- [Squad Chat](squad-chat.md) - shared local agent conversation
- [SOP Broadcasts](../SOP-broadcasts.md) - operator playbook
- [CLI Guide](../CLI-GUIDE.md) - shell-driven automation
- [API Reference](../API-REFERENCE.md) - endpoint catalog
