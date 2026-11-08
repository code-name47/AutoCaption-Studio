# AutoCaption Studio — visible AI editing bridge (MVP)

AutoCaption Studio now exposes a short-lived remote MCP endpoint that lets an **authorized AI client inspect and propose edits to an editor currently open in a browser**. The browser remains the source of truth: raw video, audio, and image bytes do not pass through the AI bridge. Every proposed edit requires an explicit **Approve & watch** click before execution.

## Quick start

1. Open the deployed AutoCaption Studio editor, sign in with Google, import media and place it on the timeline.
2. Open the **Connect** panel and click **Connect AI editing bridge**.
3. Wait for **Browser synced and ready**. The bridge uploads only the project's **media names, clip metadata, text, track IDs and canvas settings**, not actual video files.
4. For a local end-to-end demonstration, click **Test live AI editing (approval required)**. A floating review panel appears. Click **Approve & watch** to see the canvas switch orientation and a title appear in the preview and timeline. Use **Revert last AI edits** to reverse it.
5. To connect a real AI client, copy the MCP endpoint and separately supply the short-lived session token using that client's **bearer authentication configuration** (never in a message or a URL). The remote endpoint is `https://YOUR-HOST/api/bridge/mcp`. ChatGPT requires a supported custom MCP plugin connection with appropriate workspace permissions. Merely opening this browser page does **not** connect an existing ChatGPT conversation.
6. Keep the browser and connection open. Each session expires after 30 minutes. On expiration, connect a new session.

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

- Session tokens are random, bearer-based, short-lived, stored only as hashes on the server, and **never added to the MCP URL**. Treat the token as a secret: anyone possessing it can inspect this session's project metadata and propose edits (still subject to browser approval).
- The session-creation and browser polling endpoints require the **same Google user and same Google login session**, preventing one person's browser from reading another person's queued edits. The remote MCP endpoint requires the matching bearer token.
- The server keeps project metadata and queued proposals **only in memory**. Restarting the server loses those sessions. No media bytes, OAuth tokens, or per-user project buffers are stored by the edit relay.
- The browser never applies an edit until it has compared its project with the exact base revision used by the AI. A human change invalidates a stale proposal.
- Commands use fixed field allowlists and numeric bounds: they cannot execute JavaScript, fetch arbitrary URLs, access Drive, or run shell commands.
- This is an MVP, **not a guarantee of security**. Before offering it publicly to many users, use durable authenticated session storage, formal OAuth for MCP clients, CSRF/audit review, quotas and privacy/security testing.
- Not implemented: autonomous browsing of Google Drive, automatic media import from pasted URLs, clip understanding via visual frames, semantic footage selection, rendering/export from MCP, or the final ChatGPT plugin registration.

## HTTP relay (browser only)

The signed-in browser uses:

- `POST /api/bridge/session` — create a session
- `POST /api/bridge/editor/snapshot` — publish metadata/revision
- `GET /api/bridge/editor/pending` — poll visible proposals
- `POST /api/bridge/editor/edits/:id/review` — approve or reject
- `POST /api/bridge/editor/edits/:id/progress` — stream applied-step status
- `POST /api/bridge/editor/demo` — generate the same approval-gated test proposal

The MCP client sends JSON-RPC 2.0 to `POST /api/bridge/mcp` with an HTTPS `Authorization: Bearer <SESSION_TOKEN>` header. Do **not** expose token values in browser URLs or commit them into source code.

## Tests

- `tests/ai-editor-actions.test.js`: deterministic, safe timeline operations and malicious input rejection
- `tests/editor-bridge-security.test.js`: isolation, approval, staleness and metadata filtering
- `tests/e2e/ai-live-edit.spec.js`: end-to-end browser review / progressive live edits / undo / reject, with a mocked relay

The custom MCP plugin must be connected in ChatGPT (where permitted) after the feature branch has been deployed; it is not connected automatically through GitHub access.
