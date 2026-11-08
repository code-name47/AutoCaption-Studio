# AutoCaption Studio — editing workspace

The default route (/) opens the full-screen editor. The original transcription interface remains at /?classic=1.

## Editing workflow

1. Choose **Media → Import media**, **Google Drive**, or drag local files into the media bin. Click a file to preview the original in the Source Viewer.
2. Drag videos/images to **V1 / V2 / V3**, audio to **A1 / A2**. Use **+ Video track** or **+ Audio track** to create additional tracks.
3. Drag placed clips horizontally or across compatible tracks. Drag a clip's narrow left or right handle to trim. Use the ruler to scrub and **+ / − / Fit** to zoom.
4. Select a clip to edit speed, in/out points, volume, color, transform or transition in the Inspector. **S** splits a selected clip at the playhead. **Delete** removes it. **Ctrl/Cmd+Z** and **Ctrl/Cmd+Y** undo/redo timeline edits.
5. Choose **Captions → Transcribe selected media** or **Transcribe all project videos**. Select a transcribed file, then choose **Place subtitles on C1 track** once its video is on the timeline. Edit individual subtitle clips in Inspector.
6. Add text templates using **Titles** and fades, cross-dissolves, wipes, and slides via **Transitions**. Drag a transition onto an incoming clip or select a clip and click the effect. Adjacent clips overlap during a cross-dissolve.
7. In **Export**, download SRT, VTT or TXT, experiment with browser-based WebM video rendering, or save/reopen the project in this browser.

The layout docks tools around a preview monitor with internal panel and timeline scrolling. Expand the timeline for detailed work.

## Important limitations

- **Experimental export:** Canvas, MediaRecorder and Web Audio render in real time and may be slow, silent or unsupported on some browsers. Check exported files before publishing.
- **Source limits:** maximum 150 MB per media file through the Google Drive endpoint. Browser Whisper decoding currently limits individual clips to 10 minutes.
- **Local-only project storage:** IndexedDB saves and source media are stored in the browser/device, not Google Drive or a shared cloud account. Clearing site data may delete a saved project. Storage quotas vary.
- **Not yet supported:** reliable MP4/H.264 export, frame-accurate rendering, keyframe graph editing, masking, chroma key, LUTs, ripple editing, motion tracking, nested sequences, background rendering, shared project collaboration, and professional color grading.
- **AI integration:** the experimental MCP endpoint currently queues transcription jobs only. AI-driven editing requires separately authenticated and explicitly authorized editing commands. Never publish bearer tokens.
- **Google Drive permissions:** the narrow drive.file scope may not list all existing files in a folder. Use multi-select Google Picker for those files.

## Tests

- npm test — editor core, timeline, and security unit tests.
- npm run build — production build.
- npm run test:ui — browser interactions in Chromium via Playwright.
- GitHub Actions runs unit/build checks and a separate UI smoke test.

The pure non-destructive editing model lives in src/editorCore.js and experimental WebM rendering lives in src/editorExport.js. Future AI editing tools should authorize user and project access and invoke these same operations instead of directly sharing users' private files.
