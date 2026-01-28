# Veritas Kanban Server - Security Guide

## Overview

The Veritas Kanban server includes a flexible authentication and authorization system to protect API endpoints and WebSocket connections from unauthorized access.

## Quick Start

### Development (Localhost Bypass)

For local development, enable localhost bypass:

```bash
# .env
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=true
```

This allows unauthenticated requests from `localhost`/`127.0.0.1` while still requiring auth for remote connections.

### Production

For production, configure API keys:

```bash
# .env
VERITAS_AUTH_ENABLED=true
VERITAS_AUTH_LOCALHOST_BYPASS=false
VERITAS_ADMIN_KEY=your-secure-admin-key
VERITAS_API_KEYS=agent1:key1:agent,dashboard:key2:read-only
```

## Authentication Methods

Clients can authenticate using any of these methods:

### 1. Authorization Header (Recommended)

```bash
curl -H "Authorization: Bearer your-api-key" \
  http://localhost:3001/api/tasks
```

### 2. X-API-Key Header

```bash
curl -H "X-API-Key: your-api-key" \
  http://localhost:3001/api/tasks
```

### 3. Query Parameter (WebSocket)

```javascript
const ws = new WebSocket('ws://localhost:3001/ws?api_key=your-api-key');
```

## Roles and Permissions

| Role | Read | Write | Admin Actions |
|------|------|-------|---------------|
| `admin` | ✅ | ✅ | ✅ |
| `agent` | ✅ | ✅ | ❌ |
| `read-only` | ✅ | ❌ | ❌ |

### Role Details

- **admin**: Full access to all endpoints including sensitive operations
- **agent**: Can read/write tasks, run agents, manage worktrees. Intended for AI agents like Clawdbot/Veritas
- **read-only**: Can only perform GET requests. Suitable for dashboards and monitoring

## Configuration Reference

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VERITAS_AUTH_ENABLED` | `true` | Enable/disable authentication |
| `VERITAS_AUTH_LOCALHOST_BYPASS` | `false` | Allow unauthenticated localhost requests |
| `VERITAS_ADMIN_KEY` | (none) | Admin API key with full access |
| `VERITAS_API_KEYS` | (none) | Comma-separated API keys (format: `name:key:role`) |

### API Key Format

```
name:key:role,name2:key2:role2
```

Example:
```
veritas:vk_abc123xyz:agent,dashboard:vk_def456uvw:read-only
```

## Generating API Keys

### Using OpenSSL

```bash
# Generate a random 32-character key
openssl rand -base64 32
```

### Using the Built-in Function

```typescript
import { generateApiKey } from './middleware/auth.js';
const key = generateApiKey('vk'); // e.g., vk_AbCdEf123...
```

## API Endpoints

### Auth Status (Unauthenticated)

Check the current authentication configuration:

```bash
curl http://localhost:3001/api/auth/status
```

Response:
```json
{
  "enabled": true,
  "localhostBypass": false,
  "configuredKeys": 2,
  "hasAdminKey": true
}
```

### Health Check (Unauthenticated)

```bash
curl http://localhost:3001/health
```

## WebSocket Authentication

WebSocket connections are authenticated on connect:

```javascript
// With API key
const ws = new WebSocket('ws://localhost:3001/ws?api_key=your-key');

ws.onclose = (event) => {
  if (event.code === 4001) {
    console.error('Authentication failed:', event.reason);
  }
};
```

### WebSocket Close Codes

| Code | Meaning |
|------|---------|
| `1000` | Normal close |
| `4001` | Authentication required/failed |

## Error Responses

### 401 Unauthorized

```json
{
  "error": "Authentication required",
  "code": "AUTH_REQUIRED",
  "hint": "Provide API key via Authorization header (Bearer <key>), X-API-Key header, or api_key query parameter"
}
```

### 403 Forbidden

```json
{
  "error": "Write access denied",
  "code": "WRITE_FORBIDDEN",
  "hint": "Your API key has read-only access"
}
```

## Security Best Practices

1. **Never commit API keys** - Use environment variables or `.env` files (add to `.gitignore`)

2. **Rotate keys regularly** - Update API keys periodically, especially if compromised

3. **Use HTTPS in production** - API keys are transmitted in headers/URLs

4. **Principle of least privilege** - Use `read-only` for dashboards, `agent` for automation

5. **Monitor access** - The server logs connection attempts with role information

## Migrating from No Auth

If you're upgrading from an earlier version without authentication:

1. **Before upgrading**: Document all clients that access the API

2. **During upgrade**: 
   - Start with `VERITAS_AUTH_LOCALHOST_BYPASS=true` for smooth transition
   - Generate API keys for each client
   - Update clients to include authentication headers

3. **After testing**: Disable localhost bypass for production

## Troubleshooting

### "Authentication required" for localhost

Check that `VERITAS_AUTH_LOCALHOST_BYPASS=true` is set, or provide an API key.

### "Invalid API key"

- Verify the key matches exactly (no extra spaces)
- Check that the key is in the `VERITAS_API_KEYS` or `VERITAS_ADMIN_KEY` variable
- Ensure the format is correct: `name:key:role`

### WebSocket immediately closes

- Check browser console for the close reason
- Ensure the API key is passed as a query parameter: `?api_key=...`

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Request Flow                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Client Request                                             │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐                                          │
│  │ CORS/JSON    │ (express middleware)                     │
│  └──────────────┘                                          │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐   ┌───────────────────────┐              │
│  │ /health      │──▶│ Bypass auth           │              │
│  │ /api/auth/*  │   │ (unauthenticated)     │              │
│  └──────────────┘   └───────────────────────┘              │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐                                          │
│  │ authenticate │ (middleware/auth.ts)                     │
│  │              │                                          │
│  │ - Check auth │                                          │
│  │   enabled    │                                          │
│  │ - Localhost  │                                          │
│  │   bypass?    │                                          │
│  │ - Validate   │                                          │
│  │   API key    │                                          │
│  └──────────────┘                                          │
│       │                                                     │
│       ▼                                                     │
│  ┌──────────────┐                                          │
│  │ Route Handler│ (req.auth available)                     │
│  └──────────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Changelog

- **v1.0.0** (2026-01-28): Initial authentication implementation
  - API key authentication for HTTP and WebSocket
  - Role-based authorization (admin, agent, read-only)
  - Localhost bypass for development
  - Configuration via environment variables
