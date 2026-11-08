# Free transcription setup (Groq)

The backend now uses Groq's **free-tier** Whisper API rather than OpenAI's paid transcription API. Groq may change its free limits or availability. No paid fallback is configured.

## Deploy on Render

1. Create a **Web Service** from branch `feature/secure-transcription-starter`.
2. Build command: `npm install && npm run build`.
3. Start command: `npm start`.
4. Set environment variables in Render (never in GitHub or client code):
   - `NODE_ENV=production`
   - `GROQ_API_KEY` = your API key from https://console.groq.com/keys
   - `TRANSCRIPTION_ACCESS_CODE` = a unique random secret with at least 16 characters.
5. Open the **Web Service** URL to transcribe. The old Render Static Site will only show the interface unless connected to a backend.

## Limitations

- Groq's free tier has rate limits, including audio-duration and request quotas. When exceeded, the server returns a 429 error and does **not** switch to a paid service.
- No GPU is needed on the visitor's computer. Render extracts audio; Groq runs Whisper in the cloud.
- The current server buffers uploaded files in RAM. Keep test videos short, particularly on Render's free 512 MB instance. The displayed 150 MB limit is **not** a safe guarantee for that instance. Large-file streaming and queued processing are future work.
- This remains a private prototype protected by a shared access code, **not** a secure public multi-tenant application. Do not publish the code or Groq key, and do not upload sensitive media.
- Groq processes audio on its servers. Review its data-handling policies before handling confidential recordings.
- TXT/SRT/VTT outputs are generated from the returned transcript and segments; review timestamps for accuracy.
