## Plan: sourcedcs-web React Rewrite

Replace the static, script-heavy frontend under [sourcedcs-web/public](sourcedcs-web/public) with a React + TypeScript + Tailwind app while keeping [sourcedcs-web/server.js](sourcedcs-web/server.js) as the source of truth for the Express backend and all existing `/api/*` behavior. Phase 1 should be strictly compatible: keep backend routes, auth flow (`/auth-callback.html`, `/api/auth/token`), and data contracts intact; only the frontend delivery layer changes first.

### Steps
1. Inventory current pages, shared UI, and API consumers from [public/index.html](sourcedcs-web/public/index.html) and [server.js](sourcedcs-web/server.js).
2. Scaffold a React + TypeScript + Tailwind app and keep Express serving current routes/assets during the first phase.
3. Rebuild shared layout, auth/session handling, and reusable components before migrating page views.
4. Move each page feature set one by one, starting with public pages, then member/admin views, against the existing `/api/*` endpoints.
5. Switch production serving to the React build output only after feature parity, then retire legacy static JS/CSS.

### Milestones
- **Milestone 1:** Backend/API compatibility freeze and route inventory.
- **Milestone 2:** React shell, Tailwind theme, and shared app state.
- **Milestone 3:** Public pages migrated with unchanged backend responses.
- **Milestone 4:** Member/admin workflows migrated and validated against existing routes.
- **Milestone 5:** Production cutover to React build hosting.

### Checklist
- [ ] Preserve `/api/*` endpoints and request/response shapes.
- [ ] Keep `/auth-callback.html` and token exchange behavior working.
- [ ] Map all current pages: home, gallery, schedule, wings, skills, flight plans, and forms.
- [ ] Verify admin-only UI stays cosmetic; server-side authorization remains in Express.
- [ ] Ensure session management and auth state flow through React context or similar.
