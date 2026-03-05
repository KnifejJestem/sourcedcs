# Casdoor Authentication Setup

This document explains how to configure [Casdoor](https://casdoor.org) as the identity provider for the SOURCE DCS website.

## Overview

The SOURCE DCS website uses Casdoor's **OAuth 2.0 Implicit Flow** for authentication. Tokens are JWTs stored client-side in `localStorage`. The server decodes the JWT to identify the user and check admin permissions — no session state is kept server-side.

## 1. Deploy Casdoor

Casdoor can be self-hosted or run via Docker. See the [official docs](https://casdoor.org/docs/basic/server-installation) for full instructions.

```bash
# Example: Docker
docker run -d --name casdoor \
  -p 8000:8000 \
  -v casdoor-data:/var/lib/casdoor \
  casbin/casdoor-all-in-one
```

The SOURCE DCS deployment points its Casdoor instance at `https://auth.sourcedcs.page`. Update `CASDOOR_ENDPOINT` in the website code if your URL differs.

## 2. Create an Organisation

1. Log into the Casdoor admin panel.
2. Navigate to **Organizations** → **Add**.
3. Create an organisation (e.g. `sourcedcs`).

## 3. Create an Application

1. Go to **Applications** → **Add**.
2. Fill in:

| Field | Value |
|---|---|
| **Name** | `sourcedcs-web` |
| **Organization** | `sourcedcs` (the org you created) |
| **Client ID** | Auto-generated — copy this value |
| **Redirect URIs** | `https://your-domain.com/auth-callback.html` |
| **Grant Types** | `implicit` (enable the Implicit grant) |
| **Response Type** | `token` |
| **Token Format** | `JWT` |

3. Under **Providers**, attach any login providers you want (e.g. username/password, Discord, GitHub).
4. Save.

### Update the website code

Set the `CASDOOR_CLIENT_ID` variable in `index.html`, `schedule.html`, and `wing.html` to match the **Client ID** from above:

```js
var CASDOOR_CLIENT_ID = 'your-client-id-here';
```

Set `CASDOOR_ENDPOINT` to your Casdoor URL:

```js
var CASDOOR_ENDPOINT = 'https://auth.sourcedcs.page';
```

## 4. Configure JWT Claims

Casdoor JWTs include claims such as `name`, `preferred_username`, `email`, and `sub`. The SOURCE DCS server uses the `name` claim to identify the user.

No additional Casdoor configuration is needed — the default JWT claims are sufficient.

## 5. Admin Access

Admin access is controlled **server-side** via the `ADMIN_USERS` environment variable. This is a comma-separated list of usernames (matched against the JWT `name` claim, case-insensitive).

```bash
# In your deployment environment:
ADMIN_USERS=niknam,anotheradmin
```

Default: `niknam`

### How it works

1. When a logged-in user makes a write request to the API (e.g. editing events, roster, or squadrons), the server middleware `requireAuth` extracts the JWT from the `Authorization: Bearer <token>` header.
2. The `requireAdmin` middleware then checks if the `name` claim from the JWT is in the `ADMIN_USERS` list.
3. If not, a `403 Forbidden` response is returned.

### Frontend admin detection

The frontend also checks the JWT `name` claim against a hardcoded `ADMIN_USERS` list to decide whether to show admin UI controls (edit buttons, admin bars). This is purely cosmetic — all actual access control happens server-side.

To update the frontend admin list, edit the `ADMIN_USERS` array in `index.html`:

```js
var ADMIN_USERS = ['niknam', 'anotheradmin'];
```

## 6. User Registration

1. In Casdoor, go to **Organizations** → your org → **Settings**.
2. Enable **Allow Registration** if you want users to self-register.
3. Optionally configure **Sign-up Items** to require fields like username and email.

## 7. Auth Flow Summary

```
User clicks LOGIN
    ↓
Browser redirects to Casdoor /login/oauth/authorize
    ↓
User logs in / registers at Casdoor
    ↓
Casdoor redirects back to /auth-callback.html with #access_token=<JWT>
    ↓
auth-callback.html stores JWT in localStorage, redirects to saved return URL
    ↓
Website reads JWT from localStorage, decodes name for display
    ↓
API calls include Authorization: Bearer <JWT> header
    ↓
Server decodes JWT, checks admin list for write operations
```

## 8. Token Lifetime

Configure token lifetime in Casdoor under **Applications** → your app → **Token Expire**. A reasonable default is 7 days (`604800` seconds) for persistent login.

## 9. Security Notes

- The implicit flow does **not** use a client secret — tokens are exposed to the browser. This is acceptable for this use case since the website is a public-facing community tool.
- Token **signature verification** is not performed server-side in the current implementation (the server only decodes the JWT payload). For production deployments with sensitive operations, consider switching to the **Authorization Code** flow and verifying signatures with Casdoor's public key.
- The `ADMIN_USERS` environment variable is the sole source of truth for admin permissions. Keep it up to date.
- Always use HTTPS in production to protect tokens in transit.
