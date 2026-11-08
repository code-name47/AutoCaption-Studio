# AutoCaption Studio: prototype MCP interface

The deployed Express Web Service exposes `POST https://autocaption-studio-bridge.onrender.com/api/bridge/mcp`.

## Security and readiness
This is a **developer prototype**, not a production ChatGPT connector. Every MCP request requires `Authorization: Bearer <temporary bridge session token>`. Do not publish, log, or paste tokens into chats. Tokens expire after 30 minutes; jobs live only in memory. The bridge does not provide OAuth, durable sessions, user accounts, video attachment ingestion, or Google Drive integration. Some ChatGPT connector flows require OAuth or other supported authorization and therefore **cannot connect to this prototype directly**. Do not claim ChatGPT is connected until that authentication flow is implemented and tested.

## Available tools
- `queue_transcription`: queues Whisper transcription for the media already selected in the paired browser.
- `get_transcription`: reads job status and transcript, scoped to the same session.
- `list_transcriptions`: lists session jobs.

The user must keep the AutoCaption Studio tab open with a video selected. The browser polls the bridge every four seconds and runs Whisper locally.

## Developer smoke test
From a trusted terminal, set the bearer token privately (do not commit it):
```bash
curl -X POST https://autocaption-studio-bridge.onrender.com/api/bridge/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $BRIDGE_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```
The response should contain `queue_transcription`, `get_transcription`, and `list_transcriptions`. If the Render free instance is sleeping, the first request may take longer.

## Production prerequisites
1. Add account-backed OAuth 2.1 or a ChatGPT-supported MCP authorization flow with consent and user isolation.
2. Replace in-memory sessions/jobs with a persistent store; rate-limit session creation and enforce job quotas.
3. Provide authorized media acquisition (Google Drive OAuth or another explicit user-approved transfer).
4. Add tests for session isolation, origin handling, authentication, timeouts, malformed JSON-RPC, and retries.
5. Review privacy, CORS, CSRF, resource exhaustion, and security logging before public access.
