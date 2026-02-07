# Squad Chat Webhook Notification System - Implementation Complete

**Status:** ✅ Complete and tested

## Overview

When a human (or agent) posts a message in Veritas Kanban squad chat, VK now fires a configurable HTTP webhook. This makes VK agent-agnostic — it works with OpenClaw, LangGraph, CrewAI, or any system that can receive HTTP webhooks.

## What Was Built

### 1. Backend Type Definitions

**File:** `shared/src/types/config.types.ts`

Added `SquadWebhookSettings` interface to `FeatureSettings`:

```typescript
interface SquadWebhookSettings {
  enabled: boolean;
  url: string;
  secret?: string;
  notifyOnHuman: boolean;
  notifyOnAgent: boolean;
}
```

**File:** `shared/src/types/chat.types.ts`

Added `displayName` field to `SquadMessage` to support human display names.

### 2. Validation Schema

**File:** `server/src/schemas/feature-settings-schema.ts`

Added Zod validation schema for squad webhook settings:

- URL validation (proper HTTP/HTTPS)
- Secret minimum length (16 chars)
- All fields optional for PATCH updates

### 3. Webhook Service

**File:** `server/src/services/squad-webhook-service.ts`

Created dedicated service for firing webhooks:

- **Fire-and-forget:** Never blocks squad chat POST response
- **5-second timeout:** Prevents hanging requests
- **HMAC-SHA256 signing:** Optional webhook verification via `X-VK-Signature` header
- **Filtering:** Respects `notifyOnHuman` and `notifyOnAgent` settings
- **Comprehensive logging:** Success/failure tracking

**Payload format:**

```json
{
  "event": "squad.message",
  "message": {
    "id": "msg_xxx",
    "agent": "Human",
    "displayName": "Brad",
    "message": "Hey team!",
    "tags": ["question"],
    "timestamp": "2026-02-07T15:30:00Z"
  },
  "isHuman": true
}
```

### 4. Integration

**File:** `server/src/routes/chat.ts`

Updated `POST /api/chat/squad` route:

- Retrieves feature settings
- Determines if message is from human
- Gets display name from settings for human messages
- Fires webhook asynchronously (doesn't block)
- Logs errors without breaking squad chat

### 5. Settings UI

**File:** `web/src/components/settings/tabs/NotificationsTab.tsx`

Added "Squad Chat Webhook" section with:

- **Enable toggle:** Master switch
- **Webhook URL input:** With URL validation
- **Secret input:** Password field, min 16 chars
- **Notify on Human Messages:** Checkbox (default: true)
- **Notify on Agent Messages:** Checkbox (default: false)

Settings are saved via existing PATCH /api/settings/features endpoint.

## Security Features

1. **HMAC Signature Verification**
   - Optional `secret` field in settings
   - When configured, adds `X-VK-Signature: sha256=<hex>` header
   - Webhook receiver can verify payload authenticity

2. **Timeout Protection**
   - 5-second max per webhook
   - Fire-and-forget: never blocks squad chat
   - Errors logged but don't break user experience

3. **Path Sanitization**
   - URL validation via Zod schema
   - Dangerous keys check in settings patch

## Testing

### Manual Test Results

✅ Webhook configuration via Settings API  
✅ Message posting to squad chat  
✅ Webhook fires with correct payload  
✅ HMAC signature included when secret configured  
✅ Human display name populated correctly  
✅ Filtering (notifyOnHuman/notifyOnAgent) works

**Test scripts created:**

- `test-webhook.sh` - Basic webhook test with httpbin.org
- `test-webhook-local.sh` - Local netcat listener test
- `test-webhook-signature.sh` - Signature verification test

### Example Configuration

```bash
curl -X PATCH http://localhost:3001/api/settings/features \
  -H 'Content-Type: application/json' \
  -d '{
    "squadWebhook": {
      "enabled": true,
      "url": "https://example.com/webhook",
      "secret": "your-secret-key-here",
      "notifyOnHuman": true,
      "notifyOnAgent": false
    }
  }'
```

## Important Notes

- **Disabled by default:** Won't affect existing VK installations
- **No URL hardcoding:** Fully configurable
- **Non-breaking:** If webhook fails, squad chat still works
- **Backward compatible:** Works with existing SquadMessage system/event fields
- **Agent-agnostic:** Any HTTP webhook receiver can integrate

## Next Steps for Users

1. Enable squad webhook in Settings → Notifications
2. Configure webhook URL (your orchestrator's endpoint)
3. (Optional) Add secret for signature verification
4. Test with a squad chat message
5. Integrate your agent orchestrator to receive and respond to webhooks

## Files Modified

**Shared:**

- `shared/src/types/config.types.ts`
- `shared/src/types/chat.types.ts`

**Server:**

- `server/src/schemas/feature-settings-schema.ts`
- `server/src/services/squad-webhook-service.ts` (NEW)
- `server/src/services/chat-service.ts`
- `server/src/routes/chat.ts`

**Web:**

- `web/src/components/settings/tabs/NotificationsTab.tsx`

**Tests:**

- `test-webhook.sh` (NEW)
- `test-webhook-local.sh` (NEW)
- `test-webhook-signature.sh` (NEW)

---

**Build Status:** ✅ All packages built successfully  
**Runtime Status:** ✅ Tested and working on localhost:3001  
**Git Status:** NOT PUSHED (per instructions)
