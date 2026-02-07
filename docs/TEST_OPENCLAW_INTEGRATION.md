# OpenClaw Gateway Wake Integration - Testing Guide

## What Was Built

Added OpenClaw gateway wake integration to VK's squad chat webhook service.

### Changes Made

1. **Type Updates** (`shared/src/types/config.types.ts`):
   - Added `mode: 'webhook' | 'openclaw'` to `SquadWebhookSettings`
   - Added `openclawGatewayUrl?: string` (e.g., "http://127.0.0.1:18789")
   - Added `openclawGatewayToken?: string` (Auth token)
   - Made `url` optional (only required for 'webhook' mode)
   - Updated default settings to use `mode: 'webhook'`

2. **Webhook Service** (`server/src/services/squad-webhook-service.ts`):
   - Split webhook firing into two modes:
     - `fireGenericWebhook()` - Original behavior for 'webhook' mode
     - `fireOpenClawWake()` - New function for 'openclaw' mode
   - OpenClaw mode POSTs to `{gatewayUrl}/tools/invoke` with payload:
     ```json
     {
       "tool": "cron",
       "args": {
         "action": "wake",
         "text": "🗨️ Squad chat from {displayName}: {message}",
         "mode": "now"
       }
     }
     ```
   - Includes `Authorization: Bearer {gatewayToken}` header
   - Same 5-second timeout and fire-and-forget pattern
   - Logs success/failure

3. **Settings UI** (`web/src/components/settings/tabs/NotificationsTab.tsx`):
   - Added mode selector (dropdown) between "Generic Webhook" and "OpenClaw Direct"
   - Shows webhook URL/secret fields when mode is 'webhook'
   - Shows gateway URL/token fields when mode is 'openclaw'
   - Gateway token field uses password input (hidden text)

4. **Validation Schema** (`server/src/schemas/feature-settings-schema.ts`):
   - Updated `SquadWebhookSettingsSchema` to accept new fields
   - Both modes validated with proper constraints

## Testing

### Prerequisites

- VK server running on `http://localhost:3001`
- OpenClaw gateway running on `http://127.0.0.1:18789`
- Gateway token: `ce32c58381203632de389342a041f56d43a8f5cff8212295`

### Test Steps

1. **Configure OpenClaw mode in VK settings:**
   - Open VK web UI: http://localhost:3001
   - Go to Settings → Notifications
   - Scroll to "Squad Chat Webhook" section
   - Enable webhook toggle
   - Select mode: "OpenClaw Direct"
   - Gateway URL: `http://127.0.0.1:18789`
   - Gateway Token: `ce32c58381203632de389342a041f56d43a8f5cff8212295`
   - Enable "Notify on Human Messages"
   - Save settings

2. **Post a message in squad chat:**
   - Go to VK Squad Chat
   - Post a message as Human (not Agent)

3. **Verify wake call:**
   - Check VK server logs for: `"OpenClaw wake call fired successfully"`
   - Check OpenClaw gateway logs for wake request
   - Verify main agent receives wake notification

### Manual API Test

You can also test the wake call directly:

```bash
curl -sS http://127.0.0.1:18789/tools/invoke \
  -H 'Authorization: Bearer ce32c58381203632de389342a041f56d43a8f5cff8212295' \
  -H 'Content-Type: application/json' \
  -d '{
    "tool": "cron",
    "args": {
      "action": "wake",
      "text": "🗨️ Squad chat from Brad: Test message",
      "mode": "now"
    }
  }'
```

Expected response: Success status from OpenClaw gateway

## Backward Compatibility

- Existing 'webhook' mode still works exactly as before
- Default mode is 'webhook' (preserves current behavior)
- No breaking changes to API or database schema
- Existing configurations will continue to work

## Security Notes

- Gateway token is stored but never exposed in API responses
- Token field uses password input (hidden text) in UI
- Validation ensures token is at least 16 characters
- Same timeout/error handling as generic webhooks

## Implementation Complete

All requested features have been implemented:

- ✅ Type updates with both modes
- ✅ Webhook service with OpenClaw integration
- ✅ Settings UI with mode selector
- ✅ Validation schema updates
- ✅ Backward compatible (default mode: 'webhook')
- ✅ Security considerations (password input, no token exposure)
- ✅ Follows existing VK patterns
- ✅ TypeScript compilation successful
- ✅ No git push (as requested)
