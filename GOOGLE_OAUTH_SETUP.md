# Google OAuth setup (testing)

The server supports a Google authorization-code flow with PKCE. It uses a temporary HttpOnly session cookie and keeps Google access tokens in server memory; tokens are not exposed to browser JavaScript.

## Render environment
Set these **only in Render -> autocaption-studio-bridge -> Environment**, not GitHub:

- `GOOGLE_CLIENT_ID`: the Google OAuth Web client ID
- `GOOGLE_CLIENT_SECRET`: the **rotated** Google OAuth client secret
- `GOOGLE_REDIRECT_URI`: `https://autocaption-studio-bridge.onrender.com/auth/google/callback`

Google Cloud -> Google Auth Platform -> Clients must include:
- JavaScript origin: `https://autocaption-studio-bridge.onrender.com`
- Redirect URI: `https://autocaption-studio-bridge.onrender.com/auth/google/callback`

Add your own Google account under Google Auth Platform -> Audience -> Test users while the app remains in Testing. Ensure the Google Drive API is enabled.

## Test
1. Wait for Render to deploy the latest commit.
2. Open `https://autocaption-studio-bridge.onrender.com/auth/google/status`. `configured` should be true.
3. In the app's Commands tab, select **Connect Google account**.
4. Approve only the permissions you recognize.
5. Confirm the app shows **Google connected**. Use **Disconnect Google** to end the local session.

## Limitations
- No Google Drive video browsing, import, transcription batch jobs, or transcript upload yet.
- `drive.file` grants access to files the user explicitly opens with or creates through this app, **not all files in arbitrary Drive folders**. Folder-wide workflows may require a different authorization design and additional Google verification.
- OAuth sessions are stored in memory and disappear on restart or instance spin-down. There is no refresh-token persistence.
- Google sign-in is not yet tied to the separate bridge/MCP session identity. Do not open public registration or claim production tenant isolation.
- The MCP endpoint still requires its temporary bridge token; Google login alone does not authenticate MCP.
- Never paste the rotated client secret into chat, screenshots, source code, or logs.
