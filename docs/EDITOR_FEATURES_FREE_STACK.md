# Free-Model-Only Feature Matrix — AutoCaption Studio
Status on 2026-11-08. The task requested the full video-editor feature catalog; this document distinguishes working features from future engineering. *No paid AI API/model was added.*

## Shipped in this branch, subject to browser/codec testing
- Track-name column: horizontal resizing by dragging the ruler separator, keyboard arrows, double-click reset and local persistence.
- Audio: detach an audio-only clip from a video without duplicating the sound; linked trims, splits, source moves and linked deletion; decode-verified stereo L/R separation onto two audio tracks.
- Audio mix: real Web Audio channel splitter/merger routing, per-track mute/solo, clip pan, 3-band EQ, gain up to 2×, clip fade in/out, dialogue/music/flat mix presets; these apply to both browser preview and WebM export.
- Waveforms: browser audio decoding and limited peak display (small/compatible files only); optional peak normalization (not LUFS).
- Visual compositing: native chroma key with selected key color/tolerance/softness, transparent keyed footage over lower tracks, background replacement by placing an image/video underneath, cropped video/image masks, blur and hue filters, 3 color-style presets. Chroma is a chromatic pixel filter, not semantic person segmentation.
- Captions/text: editable text outline, outline color, shadow strength, existing animation and fonts.
- Timeline: ripple delete, precision trim/scrub, protected/locked clips, solo, named markers (saved with the project), existing undo/redo and transitions.
- Exports: standard browser WebM and optional native MP4 only if MediaRecorder.isTypeSupported reports compatible codecs. Browser video rendering is real-time and hardware/codec dependent.
- Existing: browser-local Whisper Tiny/Base/Small transcription, SRT/VTT export, animation keyframes, private opt-in composited visual review, Google Picker imports, ChatGPT MCP edits with approval.

**Not guaranteed in all browsers:** native MP4, Web Audio decoding of MP4 soundtrack, audio waveforms for video formats, real-time green-screen performance on large 4K footage. Show clear errors/fallbacks. MP4 support is not the same as reliable server-side H.264/AAC transcoding.

## NOT shipped / requires further work
| Group | Feature | Why it is not yet complete |
|---|---|---|
| Audio | Multitrack dynamic compression/limiting, denoising, VAD, auto ducking, pitch/reverb | Requires further DSP implementation and regression validation |
| Audio AI | Vocals/music/drums/bass stem splitting, dialogue/music separation | CPU/GPU-intensive free model deployment and commercial weight/license review |
| Compositing | Model-powered person/background removal, rotoscoping, advanced object erase, subject tracking | Segmentation inference + temporal stabilization + export consistency |
| Timeline | Multicam, nested sequences, reverse playback, speed ramp curves, optical flow interpolation, stabilization | Large engine changes, performance and UX design |
| Color | LUTs/ICC HDR, scopes, color curves, advanced grading, video denoising, upscaling | Accurate color-managed pipeline, sometimes heavy ML |
| Captions | Word-by-word verified timings, diarization, translation/dubbing, social safe zones, animated presets | Transcript/source alignment, layout controls, free model integration |
| AI | Filler/silence-removal proposal engine, ranked highlights, scene classification, beat cutting, automatic B-roll | Additional scoring/analysis, reversible edit proposals and user review |
| Delivery | Stable cloud rendering, large-batch jobs, all-codec MP4, project sync, Drive-to-Drive pipeline | Isolated workers, tenant storage, quotas, Google OAuth testing |
| Collaboration | Remote review links, team permissions, version diff/cloud autosave | Account database, access controls, uploads, retention policy |

Avoid describing these as completed. A feature icon or menu is not equivalent to working processing and render output.

## Free model policy
1. **Local default:** Whisper code and weights (MIT) for transcription. It already runs in the user's browser; speed depends on hardware.
2. **Recommended next:** Silero VAD (MIT, verify the specific ONNX weights before bundling) for voice activity; can run on self-hosted compute and potentially browser ONNX. Native Web Audio can support a free simple silence heuristic but is not equivalent to VAD.
3. **Person segmentation:** MediaPipe Image Segmenter (framework Apache-2.0; separately confirm each downloaded segmentation model's terms) for browser-local person masks. Model file, WASM/runtime version, data processing and fallback require testing before enabling in export.
4. **Music source separation:** Demucs source code MIT but upstream was archived; inspect the trained weights and training-data licensing **separately**, especially for commercial production. Do not ship unreviewed weights or silently use a hosted freemium API.
5. **No surprise paid providers:** The older server-side Groq route is **disabled by default** even when keys are configured; it requires an explicit `ALLOW_HOSTED_TRANSCRIPTION=true` environment setting. The browser editor uses locally downloaded Whisper, not paid transcription requests.
6. **No model fee != no operating cost:** hosting GPUs/CPUs, bandwidth, storage and rendering may cost money. Never promise a zero-cost public service just because model weights are free.

## Next sequence
1. Close-out tests for the shipped free DSP and visual effects; inspect exported result against preview and validate linked audio source mapping with actual real-user files.
2. Add a speech activity detector and reversible silence removal, scene-change candidates and enhanced subtitle word timing.
3. Implement model-backed background removal **only after** runtime and weight license checks, with measured browser responsiveness.
4. Evaluate free stem separation worker on licensed test audio, then grant access only when weight rights and quotas are settled.
5. Build safe persistent user storage, signup, cost/abuse controls and reliable export before public availability.

## References
- Whisper MIT (code and model weights): https://github.com/openai/whisper
- Silero VAD MIT: https://github.com/snakers4/silero-vad
- Demucs MIT source, archived: https://github.com/facebookresearch/demucs
- MediaPipe JS segmenter: https://developers.google.com/edge/api/mediapipe/js/tasks-vision.imagesegmenter
- Image Segmenter models: https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter
- WebCodecs: https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API
