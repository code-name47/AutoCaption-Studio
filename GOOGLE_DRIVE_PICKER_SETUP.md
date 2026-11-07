# Google Drive Picker setup

## Enable Google Picker API
In Google Cloud project AutoCaption Studio, enable **Google Picker API** and **Google Drive API**.

Create a Google Cloud API key for the Picker. Restrict it to **Websites (HTTP referrers)**:
- `https://autocaption-studio-bridge.onrender.com/*`
Restrict API access to **Google Picker API** if Google Cloud offers this option.

In Render Web Service -> Environment set:
- `GOOGLE_PICKER_API_KEY`: the Google Picker browser API key
- `GOOGLE_CLOUD_PROJECT_NUMBER`: the numeric Google Cloud project number (optional; recommended for Picker)

Do not use the OAuth Client Secret as the API key. The Picker API key is a browser-visible identifier, so it **must be restricted** by referrer and API. Do not commit the OAuth client secret.

## Test
1. Wait for the new commit to deploy.
2. Sign in through **Commands -> Connect Google account**.
3. Click **Choose video from Google Drive**.
4. Select an audio/video file in the Google Picker.
5. The selected file is fetched through the authenticated server and loaded into your browser. Run local Whisper as normal.

## Known limitations
- Only files explicitly selected with Google Picker are intended to be accessible using `drive.file`.
- Current import downloads the entire file via the Render backend into server memory and then the browser, capped at 150 MB. It is a prototype and may fail for large videos or free-tier memory limits. A streaming/direct-browser transfer design is needed before public rollout.
- Drive Picker may require Google app verification for public users; remain in OAuth Testing and use test users.
- Batch folder processing and saving transcripts to Drive are not implemented.
- Do not expose this to untrusted users before authentication, session persistence, quotas, and file-transfer limits are hardened.
