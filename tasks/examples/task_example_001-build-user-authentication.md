---
id: task_example_001
title: Build user authentication flow
type: code
status: in-progress
priority: high
project: my-project
created: '2026-01-15T10:00:00.000Z'
updated: '2026-01-15T14:30:00.000Z'
subtasks:
  - id: sub_001a
    title: Set up JWT token generation
    done: true
  - id: sub_001b
    title: Create login API endpoint
    done: true
  - id: sub_001c
    title: Build login form component
    done: false
  - id: sub_001d
    title: Add session persistence
    done: false
timeTracking:
  entries:
    - id: time_example_001a
      startTime: '2026-01-15T10:15:00.000Z'
      endTime: '2026-01-15T11:45:00.000Z'
      duration: 5400
    - id: time_example_001b
      startTime: '2026-01-15T13:00:00.000Z'
      endTime: '2026-01-15T14:30:00.000Z'
      duration: 5400
  totalSeconds: 10800
  isRunning: false
comments:
  - id: comment_example_001a
    author: AI Agent
    text: >-
      JWT setup complete — using RS256 with 15-minute access tokens and 7-day
      refresh tokens. Login endpoint returns both tokens with httpOnly cookie
      for the refresh token.
    timestamp: '2026-01-15T11:45:00.000Z'
  - id: comment_example_001b
    author: AI Agent
    text: >-
      Login API endpoint done. Supports email/password auth with bcrypt
      verification. Rate-limited to 5 attempts per minute per IP. Moving to
      the frontend form next.
    timestamp: '2026-01-15T14:30:00.000Z'
position: 0
---

Implement a complete authentication flow with JWT tokens, login/logout, and session persistence.

**Requirements:**

- JWT-based authentication with access + refresh tokens
- Login form with email/password
- Secure token storage (httpOnly cookies for refresh)
- Rate limiting on auth endpoints
- Session persistence across page reloads

**Technical Notes:**

- Use bcrypt for password hashing (cost factor 12)
- Access tokens: 15 min expiry, RS256
- Refresh tokens: 7 day expiry, stored in httpOnly cookie
