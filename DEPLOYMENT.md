# Deployment and security notes

This is a **development starter**, not a production-ready multi-user service. It implements Google OAuth sign-in and read-only Drive folder video discovery. **It does not transcribe videos or save transcripts yet.**

## Local setup
1. Create a Google Cloud OAuth web client and authorize http://localhost:3001/auth/callback as a redirect URI.
2. Copy .env.example to .env and provide credentials and a high-entropy session secret.
3. Install dependencies with npm install.
4. Run npm run build, then npm run server (or run npm run dev and npm run server in two terminals; dev server proxies API routes).

## Required before public deployment
- Replace Express MemoryStore sessions with an encrypted server-side shared session store (for example Redis), with appropriate session lifecycle and expiry controls.
- Encrypt OAuth refresh/access tokens at rest and keep them server-side. Do not log tokens.
- Request and justify narrow Google Drive scopes during Google verification; this starter uses drive.readonly for folder discovery, which may be a sensitive/restricted scope and is broader than a file-picker-based design.
- Enforce quotas, bounded processing jobs, durable queues, user ownership checks, cancellation, and per-user data deletion.
- Implement cloud transcription using a trusted backend worker; isolate tenant workloads and store transcript files only in the authenticated user's authorized Drive destination.
- Configure real HTTPS, secure cookies, CSP, CSRF safeguards on state-changing endpoints, OAuth policy compliance, secret rotation, monitoring, and abuse controls.
- Run dependency/security scans and penetration testing before public availability. No web application can credibly be guaranteed 'unhackable'.
- Restrict Google OAuth test users while the application is in Google Cloud's testing state.

## Google OAuth limitations
Development OAuth sessions are ephemeral; restart logs users out. For real users, configure a persistent isolated session store. Requesting broad Drive read access should be revisited before launching to the public.
