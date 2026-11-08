# Deploy the local-compute bridge on Render

This branch adds a Render Blueprint (`render.yaml`) that builds the Vite frontend and serves it with the Express backend **on one origin**. The existing Render **Static Site** cannot serve `/api/bridge/*`.

## Deployment
1. Open Render Dashboard -> New -> Blueprint.
2. Connect `code-name47/AutoCaption-Studio` and select branch `feature/secure-transcription-starter`.
3. Review the `autocaption-studio-bridge` Web Service, then deploy. Confirm the current Render free-plan eligibility and limits before creating it.
4. Open the new Web Service URL, **not** the old static-site URL. Check `/api/health` returns `{"ok":true,...}`.
5. Upload a small video, open **Commands**, and select **Start bridge session**. A successful session produces a token and the message "Paired session active".
6. Keep the tab open. This prototype requires a video selected locally in the browser. Do not share the session token.

## What this prototype does not yet provide
- ChatGPT MCP tools or direct ChatGPT attachment transfer.
- Google Drive folder synchronization.
- Accounts, persistent jobs, durable queue, or safe multi-device/multi-user production tenancy.
- Jobs are in memory and expire with the session or server restart; Render free instances may sleep.
- Session tokens are bearer secrets. Treat them like passwords; **do not publish or paste them in public chats**.
- Browser bridge API is restricted to same-origin requests. A production MCP gateway needs a separate, authenticated server-to-server interface and a reviewed security model.

The existing local Whisper engine continues running in the user's browser. No cloud inference is required.
