# AutoCaption Studio — deploy and connect ChatGPT

## Verified source

Current app code lives in `feature/secure-transcription-starter` (draft PR #1). CI exercises the browser editor, the session isolation rules, the real MCP editing protocol, and an OAuth/PKCE integration test. CI success is not proof a specific Render service has deployed the branch.

## Render setup

1. Deploy the reviewed feature branch to a Render Node web service.
2. Build: `npm install --no-audit --no-fund && npm run build`.
3. Start: `npm run start`.
4. Check `GET /api/health` for HTTP 200.
5. Set `APP_ORIGIN` to the public HTTPS site origin, e.g. `https://autocaption-studio-bridge.onrender.com` (without trailing slash).
6. Set Google OAuth credentials only in Render secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI=https://autocaption-studio-bridge.onrender.com/auth/google/callback`. Do not commit credentials or log them.
7. If using Google Picker for Drive media, also configure `GOOGLE_PICKER_API_KEY` and optionally `GOOGLE_CLOUD_PROJECT_NUMBER`. Google Cloud must authorize the exact redirect URI and application origin.
8. Set `NODE_ENV=production`. Google OAuth test mode must allow the specific Google accounts that will test. Do not grant unrestricted access to production while under test.

## Connect AutoCaption Studio to ChatGPT

1. Open the editor in a desktop browser, sign in with Google, and open `Connect`.
2. Click `Connect AI editing bridge`; wait for `Browser synced and ready`. Keep only one active editor connected to that same Google account.
3. In ChatGPT on the web, go to `Plugins`, click `+`, choose `Add custom MCP server`.
4. Name it `AutoCaption Studio` and enter the publicly accessible URL `https://autocaption-studio-bridge.onrender.com/api/bridge/mcp`.
5. Choose `OAuth`. ChatGPT discovers `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, registers a public client and starts the OAuth 2.1 authorization-code + PKCE S256 flow.
6. Sign in with the **same Google account** used in AutoCaption Studio. Review the consent page, then choose `Authorize ChatGPT`.
7. After connection succeeds, install the new plugin and select or @mention it in ChatGPT.
8. Ask: `Inspect my current project`, then `Move the first clip to five seconds and make it portrait`. You will see an edit proposal in AutoCaption Studio. Click `Approve & watch`.
9. When editing is done, review and Save locally in your browser. The MCP service does not upload original footage or automatically export to Drive.

## OAuth endpoint contract

- `GET /.well-known/oauth-protected-resource` — protected resource identifier, scopes, authorization server.
- `GET /.well-known/oauth-authorization-server` — OAuth issuer, DCR endpoint, authorize endpoint, token endpoint, PKCE.
- `POST /oauth/register` — restricted ChatGPT callback registration only, no arbitrary client redirect origins.
- `GET /oauth/authorize` — Google login and consent; `POST /oauth/authorize` — user approval, one-time authorization code.
- `POST /oauth/token` — code exchange and one-use rotating refresh token.
- `POST /api/bridge/mcp` — authenticated MCP tools (read metadata, propose edits, status); the browser itself must approve edits.
- OAuth tokens and bridge sessions are stored hashed and/or ephemeral in memory. They are not persistent across Render restarts. Browser session relay currently expires after 30 minutes.

## Before a broad public launch

This is still an **MVP**, not an unhackable public service. Production-hardening needs secure shared session storage (for multiple instances and restarts), OAuth/security review, rate/size limits, tenant isolation tests, and monitoring. Protect Google Drive permissions and respect user consent for every file. Do not publish it to the entire internet as secure-by-design solely because CI passes.

## Test commands

- `npm test`
- `npm run build`
- `npm run test:ui`
- `npx playwright test --config playwright.integration.config.js`

The integration fixture uses a test-only Google identity and does not connect the user's real Google Drive or ChatGPT account.
