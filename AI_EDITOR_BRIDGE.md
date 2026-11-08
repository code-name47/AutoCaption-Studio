# AutoCaption Studio — visible AI editing bridge (MVP)

AutoCaption Studio now exposes a short-lived remote MCP endpoint that lets an **authorized AI client inspect and propose edits to an editor currently open in a browser**. The browser remains the source of truth: raw video, audio, and image bytes do not pass through the AI bridge. Every proposed edit requires an explicit **Approve & watch** click before execution.

## Quick start

1. Open the deployed AutoCaption Studio editor, sign in with Google, import media and place it on the timeline.
2. Open the **Connect** panel and click **Connect AI editing bridge**.
3. Wait for **Browser synced and ready**. The bridge uploads only the project's **media names, clip metadata, text, track IDs and canvas settings**, not actual video files.
4. For a local end-to-end demonstration, click **Test live AI editing (approval required)**. A floating review panel appears. Click **Approve & watch** to see the canvas switch orientation and a title appear in the preview and timeline. Use **Revert last AI edits** to reverse it.
5. In ChatGPT on the web, open **Plugins → + → Add custom MCP server**, name it **AutoCaption Studio**, and enter `https://YOUR-HOST/api/bridge/mcp`. Select **OAuth authentication**. ChatGPT uses OAuth discovery, dynamic client registration, PKCE, and an explicit consent screen. Approve the app while signed into the **same Google account** that owns your editor session.
6. Install the newly created personal or workspace plugin. In a chat message, select or @mention **AutoCaption Studio**, then say "Inspect my current timeline." Once the project is returned, you can give editing instructions. You will review them in your editor before any changes occur.
7. Neither a GitHub connection nor an open editor tab automatically installs a ChatGPT plugin. Plugin creation and Google authorization require the user to approve the account connection in ChatGPT.
8. Keep the browser open. The browser bridge currently expires after 30 minutes; reconnect the editor if it goes offline.

## MCP tools

- `get_editor_project` — read the current browser editor's project metadata and clip IDs (no source footage).
- `propose_editor_edits` — validate and queue 1–12 operations. No edit occurs until browser approval.
- `get_editor_edit_status` — pending / rejected / stale / applying / complete / failed, and step progress.
- `queue_transcription`, `get_transcription`, `list_transcriptions` — existing transcription bridge.

Example `propose_editor_edits` tool arguments:

```json
{
  "summary": "Move the first clip to 5 seconds and switch to portrait",
  "actions": [
    {"type": "move_clip", "clip_id": "CLIP_ID_FROM_GET_EDITOR_PROJECT", "start": 5},
    {"type": "set_canvas", "aspect": "9:16"}
  ]
}
```

Supported operations: `set_canvas`, `move_clip`, `trim_clip`, `split_clip`, `set_text`, `add_text`, `add_media` (already imported assets only), `remove_clip`, `set_transition`, and restricted `set_clip_property`. The server and browser share `src/aiEditCommands.js` for validation and consistent output.

## What the user sees

1. A visible **AI edit proposal** card displays all intended operations.
2. **Reject** abandons the batch without changing the project.
3. **Approve & watch** applies actions sequentially with a visible timeline, playhead, preview and progress indicator. The rest of the editor is temporarily protected from clicks while those changes apply.
4. **Revert last AI edits** restores the previous canvas and timeline if the user has not made intervening changes.
5. Saving the updated project to browser IndexedDB is still a separate **Save** action. No Drive write-back is implemented yet.

## Security boundary and limitations

- ChatGPT links through an OAuth 2.1 authorization-code flow with PKCE S256. The app brokers the signed-in Google identity into restricted, audience-bound access credentials. Tokens are random and stored only as hashes on the server; do not paste them into chat or URLs.
- OAuth client registration is restricted to ChatGPT's HTTPS callback URI and cannot redirect to arbitrary hosts. The user sees a separate consent screen. The existing short-lived bearer mode remains for test clients but is not the preferred ChatGPT setup.
- Browser snapshots, approval and progress require the **same Google user and login session** that created the editor bridge. ChatGPT OAuth tokens can inspect a live editor only for **the same Google account**, and refuse editing if multiple editor sessions are open. The application never automatically selects a different person's project.
- The MVP keeps sanitized project metadata, edit proposals, OAuth codes and hashed access/refresh credentials **in memory**, not a persistent database. A server restart requires signing in again and reconnecting the editor. Media bytes are not uploaded through the editing bridge.
- The browser never applies an edit until it has compared its project with the exact base revision used by the AI. A human change invalidates a stale proposal.
- Commands use fixed field allowlists and numeric bounds: they cannot execute JavaScript, fetch arbitrary URLs, access Drive, or run shell commands.
- This is an MVP, **not a guarantee of security**. Before launching publicly for many users, audit OAuth and session isolation, add persistent secured sessions, stricter event auditing and abuse quotas, and perform security penetration testing.
- Not implemented: autonomous browsing of Google Drive, automatic media import from pasted URLs, clip understanding via visual frames, semantic footage selection, rendering/export from MCP, or the final ChatGPT plugin registration.

## HTTP relay (browser only)

The signed-in browser uses:

- `POST /api/bridge/session` — create a session
- `POST /api/bridge/editor/snapshot` — publish metadata/revision
- `GET /api/bridge/editor/pending` — poll visible proposals
- `POST /api/bridge/editor/edits/:id/review` — approve or reject
- `POST /api/bridge/editor/edits/:id/progress` — stream applied-step status
- `POST /api/bridge/editor/demo` — generate the same approval-gated test proposal

ChatGPT performs OAuth discovery at `/.well-known/oauth-protected-resource` and `/.well-known/oauth-authorization-server`, registers a public client at `/oauth/register`, then uses authorization code + PKCE at `/oauth/authorize` and `/oauth/token`. Authenticated MCP requests use an OAuth access token, never a browser session secret. A custom ChatGPT plugin must be created and installed before chat commands can call this endpoint.

## Tests

- `tests/ai-editor-actions.test.js`: deterministic, safe timeline operations and malicious input rejection
- `tests/editor-bridge-security.test.js`: isolation, approval, staleness and metadata filtering
- `tests/e2e/ai-live-edit.spec.js`: end-to-end browser review / progressive live edits / undo / reject, with a mocked relay
- `tests/integration/chatgpt-oauth.spec.js`: complete OAuth + PKCE + DCR + browser approval and real editing verification

The custom MCP plugin must be connected in ChatGPT (where permitted) after the feature branch has been deployed; it is not connected automatically through GitHub access.
