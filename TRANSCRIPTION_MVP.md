# Drag-and-drop transcription MVP (v0.2)

Google Drive is postponed. This branch implements video/audio upload, server-side audio extraction, Whisper transcription, transcript preview, and TXT/SRT/VTT downloads.

## Preview
The existing Render **Static Site** automatically shows the updated upload UI. It **cannot run the transcription API**. To actually transcribe, deploy a Render **Web Service** using this branch.

- Runtime: Node
- Build command: `npm install && npm run build`
- Start command: `npm start`
- Environment: `NODE_ENV=production`, `OPENAI_API_KEY=<server-side secret>`, `TRANSCRIPTION_ACCESS_CODE=<random private code of at least 16 characters>`
- Health endpoint: `/api/health`
- Do not set API secrets in `VITE_*` environment variables.

After deployment, open the **Web Service URL**, not the Static Site URL, for transcription. Alternatively, configure `VITE_API_BASE_URL` on the Static Site to the HTTPS Web Service URL, but CORS must then be deliberately configured; the simpler and safer initial approach is to serve the frontend and API from the same Web Service.

## Limitations and security
- This is a **private, access-code-protected prototype**, not a public multi-tenant SaaS. Never publish the access code.
- The server temporarily processes media and deletes extracted audio; the original file remains in request memory until the request ends. Do not upload sensitive files yet.
- Upload limit: 150 MB; extracted audio limit: 24 MB; audio extraction timeout: 120 seconds; transcription timeout: 180 seconds. Longer videos need a durable job queue, chunking, and object storage.
- Audio conversion uses `ffmpeg-static`. Validate platform compatibility in the deployed service.
- No authentication, per-user quotas, billing controls, storage isolation, or comprehensive abuse protection yet. Rate limiting and access code are only preliminary safeguards.
- The OpenAI API incurs usage costs. Configure provider-side budget alerts and limits.
- No guarantee of accurate subtitles; timestamps are model-generated. Always review captions.
- For real public use, add proper user accounts, upload streaming, queueing, malware/content validation, persistent storage, observability, and security testing.
