# Sign in with ChatGPT (identity only)

Veritas Kanban includes an optional, disabled-by-default OpenID Connect integration for
**Continue with ChatGPT**. It adds a sign-in method; it does not replace password, API-key, device,
or localhost authentication.

## Capability boundary

This integration requests only `openid profile email`. It uses the verified issuer, client ID, and
subject to link a ChatGPT identity to an existing Veritas user, then issues a normal Veritas session
with that user's existing workspace and role.

It does **not** request `resource.invoke`, `chatgpt.tokens.use.direct`, or `offline_access`; it cannot
use a user's ChatGPT plan for model inference. Identity and ChatGPT plan usage are separate grants,
and neither grants access to ChatGPT conversations. See the official [Sign in with ChatGPT
quickstart](https://developers.openai.com/siwc/quickstart) and [website identity
guide](https://developers.openai.com/siwc/website).

## Activation requirements

OpenAI currently offers website identity sign-in to selected commercial partners through a limited
trial. The current [interest form](https://openai.com/form/sign-in-with-chatgpt-interest/) asks for
work email, first name, last name, company name, website URL, optional job title, the requested
capability, and a brief description of each product that would use Sign in with ChatGPT. For this
integration the least-privilege capability is **Sign in only**, not **Sign in and ChatGPT plan use
for AI requests**. An authorized company representative must review and submit that form; Veritas
does not submit it or accept terms on an operator's behalf.

Before enabling the feature, an operator must:

1. Request an OAuth client from OpenAI and complete any required review or waitlist process.
2. Register the exact callback for each environment:
   `https://YOUR_HOST/api/auth/openai/callback`.
3. Configure the issued client ID and, only when OpenAI registered a confidential client, its secret.
4. Confirm the Continue with ChatGPT presentation uses current approved OpenAI branding.

No OAuth client registration or credential issuance is performed by Veritas Kanban.

```dotenv
VERITAS_OPENAI_OIDC_ENABLED=true
VERITAS_OPENAI_OIDC_CLIENT_ID=oaiapp_replace_me
VERITAS_OPENAI_OIDC_CLIENT_SECRET=replace_only_for_confidential_clients
VERITAS_OPENAI_OIDC_REDIRECT_URI=https://kanban.example.com/api/auth/openai/callback
```

The callback must use HTTPS, except for an explicit `http://localhost` or `http://127.0.0.1`
development callback. The path must be exactly `/api/auth/openai/callback`. The server loads and
validates OpenAI's discovery document and accepts only OpenAI HTTPS authorization, token, and JWKS
endpoints.

Pending authorization transactions are encrypted at rest, expire after ten minutes, and are consumed
atomically from the authoritative Veritas SQLite database. Start and callback requests may reach
different server processes only when those processes share that database. Deployments with independent
database files must not route one transaction across nodes.

The repository does not define a canonical public Veritas deployment origin. `CORS_ORIGINS` is an
allowlist and is not authoritative evidence of the application's public URL. The production callback
cannot be registered until the operator supplies the exact externally reachable Veritas origin.

## Account linking and roles

An email match never links accounts automatically. The user first signs in with an existing Veritas
method, opens **Settings → Security**, and chooses **Link ChatGPT sign-in**. That authenticated flow
binds the verified OpenAI issuer, client ID, and subject to the current Veritas user. A subject already
linked to another user and a user already linked to another subject are both rejected. The flow never
creates a user, membership, or role. Later sign-ins use the subject link, and existing workspace roles
remain authoritative.

Operators should create or invite the Veritas user first and assign the intended workspace role.
Password sign-in and recovery remain available after activation.

## Security properties

- Authorization Code flow with a fresh state, nonce, and S256 PKCE verifier per attempt.
- Encrypted, ten-minute, one-time SQLite transaction state, referenced by a signed, HttpOnly,
  callback-scoped cookie with `SameSite=Lax`; the PKCE verifier never enters browser storage.
- Exact redirect URI reuse during code exchange and strict OpenAI issuer/audience/nonce validation.
- Remote JWKS signature verification with a maintained JOSE implementation.
- No access, ID, authorization, or refresh tokens are logged or returned to the browser.
- OpenAI credentials remain server-side environment values; the client secret is optional and is
  used only for clients registered as confidential.
