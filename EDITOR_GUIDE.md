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

## Resizable workspace and playhead

- Drag the thin vertical grip **between Project Files and the preview** to change the width of the media bin; the preview automatically takes the available space.
- Drag the divider **between the preview and Inspector** to make the preview wider or Inspector narrower.
- Drag the **horizontal divider immediately above the timeline** up or down to choose how much screen space the timeline receives.
- Panel dimensions are remembered for this browser between reloads. Double-click a divider, or choose **Reset panels** in the top bar, to restore default sizes. Use arrow keys when a divider is focused to resize in 10 px increments (Shift+arrow for 30 px).
- The **Canvas zoom** slider above the preview supports zooming past 100% for detailed editing. This only affects the workspace view, not the exported video resolution.
- The gold playhead marker in the timeline ruler and the gold line above the tracks can both be dragged to scrub. The line stays above the clips and uses pointer capture, so it will not accidentally select caption or clip labels. The playhead supports left/right arrow keys for fine adjustments.



## Direct canvas manipulation

- Click any visible title, subtitle, image, or video in the **Program monitor**. Its white outline and four handles let you drag or resize the object directly.
- Text sizing supports sizes as low as **1** in the Inspector. Drag a corner to change font size or enter an exact value manually.
- Use the **16:9**, **9:16**, or **1:1** buttons in the monitor toolbar to choose the actual output frame. The preview respects the selected aspect ratio.
- The white rectangle is the **exported area**. You can move selected content outside it (for entrance/exit animations). An out-of-frame indicator remains draggable, and the **Canvas zoom** slider expands the visible pasteboard.
- Transform, rotation, color, scale, subtitle position and audio-volume sliders have adjacent number fields for precise entry.

## Automatic overlap transitions

- Drag a clip partly over another clip **on the same track**. The intersection becomes a blue rounded **automatic crossfade** badge. Moving the clips apart removes it; moving them again changes its duration.
- The visual uses a dissolve between the two images. The audio uses an **equal-power crossfade** between both clips' audio streams. A silent source contributes silence; nothing is synthesized.
- Overlapping clips on *different* video tracks remain independent overlays. Manually selected fades, wipes and slides are still available in the Transitions panel or right-click menu.
- Right-click a clip for split, duplicate, removal, fade/transition presets, monochrome, brightness, contrast and reset effects. Right-click empty track space for track controls.

## Record track animation

1. Select a visual, title, subtitle, or audio clip on its track and seek inside it.
2. Click the **red ●** beside that track. The playhead starts moving and the track is armed.
3. Drag, resize, or reposition the selected object in the canvas, or change numeric Inspector properties. Those changes are recorded as timed keyframes.
4. Click **■ Stop** whenever you choose. If you made changes, AutoCaption Studio creates a **purple Recorded animation clip** on that track. Your original clip's static values are restored; the animation clip plays the recorded changes.
5. Drag the purple animation clip along the timeline or to another compatible track to reuse its motion over media on that track. Right-click to duplicate it.

This is an initial linear-interpolation motion recorder for canvas transforms, text properties, colors, and volume. It is not yet a full graph/Bezier animation editor or frame-accurate motion capture system. The same recorded keyframes are evaluated during preview and experimental WebM export.

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
