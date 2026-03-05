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

The SOURCE DCS deployment points its Casdoor instance at `https://auth.sourcedcs.page`. Update `CASDOOR_ENDPOINT` in your environment variables if your URL differs.

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
| **Redirect URIs** | `https://sourcedcs.page/auth-callback.html` (replace with your actual domain) |
| **Grant Types** | `implicit` (enable the Implicit grant) |
| **Response Type** | `token` |
| **Token Format** | `JWT` |

> **Redirect URI note:** The redirect URI must exactly match the URL Casdoor redirects to after login. The website sends users to `<origin>/auth-callback.html`, so use your production domain (e.g. `https://sourcedcs.page/auth-callback.html`). For local development, also add `http://localhost:3000/auth-callback.html`.

3. Under **Providers**, attach any login providers you want (e.g. username/password, Discord, GitHub).
4. Save.

### Set environment variables

Copy `.env.example` to `.env` (for local development) and set the values for your deployment:

```bash
CASDOOR_CLIENT_ID=<your-client-id-from-above>
CASDOOR_ENDPOINT=https://auth.sourcedcs.page
```

These values are served to the browser automatically via `/js/config.js` — do **not** hardcode them in the JS source files.

## 4. Configure JWT Claims

Casdoor JWTs include claims such as `name`, `preferred_username`, `email`, `sub`, and `roles`. The SOURCE DCS server uses the `roles` claim to determine admin access.

No additional Casdoor configuration is needed for basic claims — the defaults are sufficient.

## 5. Admin Access

Admin access is controlled via Casdoor **roles**. Assign the built-in `admin` role to any user who should have admin privileges.

### Set up the admin role in Casdoor

1. In Casdoor, go to **Roles** → **Add** (or use an existing role).
2. Create a role named exactly `admin` in your organisation.
3. Go to **Users** → select the admin user → **Roles** tab → add the `admin` role.

### How it works

1. When a logged-in user makes a write request to the API (e.g. editing events, roster, or squadrons), the server middleware `requireAuth` extracts the JWT from the `Authorization: Bearer <token>` header.
2. The `requireAdmin` middleware checks if the `roles` claim in the JWT contains a role named `admin`.
3. If not, a `403 Forbidden` response is returned.

### Frontend admin detection

The frontend also checks the JWT `roles` claim to decide whether to show admin UI controls (edit buttons, admin bars). This is purely cosmetic — all actual access control happens server-side.

Admin UI is only shown to users whose JWT contains an `admin` role, so non-admin logged-in users will not see edit controls.

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
Server decodes JWT, checks "admin" role for write operations
```

## 8. Token Lifetime

Configure token lifetime in Casdoor under **Applications** → your app → **Token Expire**. A reasonable default is 7 days (`604800` seconds) for persistent login.

## 9. Security Notes

- The implicit flow does **not** use a client secret — tokens are exposed to the browser. This is acceptable for this use case since the website is a public-facing community tool.
- Token **signature verification** is not performed server-side in the current implementation (the server only decodes the JWT payload). For production deployments with sensitive operations, consider switching to the **Authorization Code** flow and verifying signatures with Casdoor's public key.
- Admin access is determined by the Casdoor `admin` role assigned in the Casdoor admin panel — no local user lists to maintain.
- Always use HTTPS in production to protect tokens in transit.

