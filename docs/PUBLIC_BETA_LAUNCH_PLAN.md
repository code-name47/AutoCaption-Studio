# AutoCaption Studio — Public Beta Readiness & Product Roadmap

Last reviewed: 2026-11-08. Sources: this repository, current Render service configuration, and official references below. This is a build plan, not a security certification or legal opinion.

## Current technical baseline (verified)

- Live application: https://autocaption-studio-bridge.onrender.com
- Source: https://github.com/code-name47/AutoCaption-Studio
- Render: one free-tier Node web-service instance, Oregon; auto-deploys `feature/secure-transcription-starter`.
- Vite/React browser timeline with local uploads, captions, video transitions, text animations and real-time WebM export.
- Local Whisper transcription using browser-side models; browser decoding can be slow or unsupported on some machines.
- Google account OAuth and Google Picker with the narrow `drive.file` scope; files chosen by the user can be downloaded into the browser.
- Projects and media persist only in that device's IndexedDB when the user clicks Save. They do not sync to other devices.
- A same-Google-user bridge connects ChatGPT's MCP OAuth identity to one connected browser session. Timeline edits require the user's on-screen approval.
- Bridge jobs, OAuth tokens, Google sessions and reviews currently use in-memory single-instance storage and disappear on restart or deployment.
- Visual review (new beta feature) is an explicit browser action: at most six small, composited JPEG preview stills, timeline warnings and optional audio RMS values are shared for five minutes. No source audio, original video file, or Drive credential is passed to MCP; user can revoke the shared stills. Authenticated, session-isolated and limited by size.

## Gate P0 — Required *before* inviting unrelated users

1. **Accounts, legal and consent**
   - Register a real production domain and support inbox; publish accessible Terms, Privacy Policy, retention/deletion policy, acceptable-use rules and copyright policy.
   - Be transparent: videos remain in their browser by default, **except** user-initiated frame sharing and user-initiated Drive transfers. ChatGPT can receive transcript text and shared stills; its data handling should be disclosed, not implied to be local.
   - Google OAuth: production consent screen, branding/domain verification, privacy URL, approved domains, tested account disconnect and token revocation. Stay on `drive.file` and Google Picker unless a deliberate scope/verification decision is made.
2. **Multi-user authentication and isolation**
   - Replace in-memory identity/session/OAuth maps with an explicitly isolated, durable store for a multi-instance environment (for example Postgres + Redis). Encrypt sensitive tokens at rest, implement rotation and cleanup.
   - Authenticate and authorize **every object, job, file, edit and signed upload URL** from server-verified user identity. Never use user-supplied IDs as proof of ownership.
   - Test cross-account read/write, OAuth CSRF and PKCE, forced login/session expiry, logout, multiple windows, stale previews, and concurrent users. Conduct an independent security review and penetration test.
   - Secure browser against XSS/CSRF, protect cookies, strengthen CSP incrementally after verifying workers/Google integrations, lock dependencies and monitor advisories.
3. **Storage, queues, rendering and cost controls**
   - Move public production off an unscaled free web-service prototype. Separate web API from worker pool for media conversion, Whisper inference, export and recurring tasks. Add bounded per-user concurrency/CPU quotas.
   - If cloud media storage becomes necessary, use private object storage with scoped short-lived signed URLs, per-account paths/ACLs, encryption, lifecycle deletion, and a documented regional/data residency policy.
   - Enforce video duration/type/size limits at all entrypoints; inspect actual file magic/type, use sandboxes for codecs/FFmpeg, scan malicious uploads where appropriate; avoid unbounded memory buffering and timeouts.
   - Add production-quality MP4 export (H.264/AAC where licensed/supported) and browser-independent rendering. Current WebM export and browser Whisper are not guaranteed to work for devices without sufficient computing resources.
   - Budget for per-minute transcription/LLM, storage, outbound network, transcoding, export, and model inference. Apply per-account limits and an abuse/DoS strategy before self-serve public signup.
4. **Drive-to-Drive product gap**
   - A Drive **folder link** is not by itself permission to download every child file under `drive.file`. Google Picker per-file authorization works today; true one-click arbitrary folder processing needs carefully designed authorization, consent and possibly restricted-scope verification.
   - Build encrypted temporary processing or stream-from-Drive jobs, selected output folder creation, transcript/video upload, partial failure retries, audit trail and idempotency.
5. **Reliability/operations**
   - Automated backups and restore tests, health/alerting, structured redacted logs, request/job tracing, cost alerts, load testing and a security incident-response plan.
   - Self-service account deletion and data export; state clearly how browser-saved media is deleted.
   - Invite-only beta, rate limits, error reporting, accessibility testing, and device/browser checks. Require one real external-user pilot with distinct Google accounts before broadening access.

**Security principle:** It is not possible to promise that any public application is literally “unhackable.” Use independent testing, least privilege, tenant isolation, measurable controls and a documented response process.

## P1 — Product features worth prioritizing after visual QA

| Priority | Feature | User benefit | Notes |
|---|---|---|---|
| 1 | Word-level caption alignment + confidence flags | Detect subtitle drift accurately | Whisper timestamp and cut mapping first; avoid claiming accuracy from sparse stills |
| 2 | Transcript-based timeline editing | “Remove everything after this sentence” | Design editable per-word/per-phrase source map, reversible edits |
| 3 | Silence/filler removal with adjustable threshold | Quick rough-cut feedback interviews | Preview proposed cuts; avoid chopping deliberate pauses |
| 4 | Better social caption styles | Readable kinetic subtitles, word highlighting, outlines, speaker labels | Include safe-area/layout checks and accessibility controls |
| 5 | Automatic highlight selection and rank | Best testimonials from many files | Speech + image understanding, citation back to source and timestamp |
| 6 | 9:16 smart crop + face tracking | Better Reels/Shorts conversions | Opt-in browser/cost-aware model analysis; preserve original |
| 7 | Audio cleanup, normalize and auto ducking | Clearer interviews | Deterministic reproducible audio processing |
| 8 | Batch jobs + named presets/templates | Drive folder in → reels + SRT/MP4 out | Durable per-user queues and scoped Drive permissions required |
| 9 | Multi-language subtitles/translations | Wider reach | Explicit model quality review, safe permission controls |
| 10 | Timeline QA and revision diff with shared frame review | AI can explain *what changed* visually | Preview stills now; audio intelligibility and continuous playback later |

## A pragmatic release sequence

1. **Internal alpha (now):** exercise the approval-gated editor and local visual-review flow with test assets; fix timing/frame-render mismatches and private-data edge cases.
2. **Closed beta:** 10–30 invited creators, two-user isolation tests, stable auth/session datastore, audit logs, scoped Drive import, support/Privacy/Terms, quotas and recoverable export.
3. **Public beta:** self-serve signup only once access isolation, payment/abuse controls, cloud-worker budget, export failures and deletion have been tested; start with explicit low per-user limits.
4. **Scale:** large folder batches, organization workspaces, asynchronous queues, team access and billing.

## Official references

- Descript Underlord: https://www.descript.com/underlord
- Kapwing Kai: https://www.kapwing.com/ai/video-assistant
- VEED OpenEdit: https://www.veed.io/tools/openedit
- Google Drive scope selection: https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Google Picker for web apps: https://developers.google.com/workspace/drive/picker/guides/web-picker
- Google restricted scope verification: https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- OWASP Multi-Tenant Security: https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html
- OWASP File Upload Security: https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
