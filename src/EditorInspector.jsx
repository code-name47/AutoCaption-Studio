import React from 'react';
import {clipEnd,clipLength,TRACKS} from './editorCore.js';
const fmt=n=>(Number(n)||0).toFixed(2);
function NumberInput({label,value,min=0,max=9999,step=.1,onChange}){
 return <label className="ve-field"><span>{label}</span><input type="number" min={min} max={max} step={step} value={Number.isFinite(Number(value))?value:0} onChange={e=>{if(e.target.value!=='')onChange(Math.max(min,Math.min(max,Number(e.target.value))))}}/></label>;
}
function Range({label,value,min=0,max=2,step=.05,onChange}){
 return <label className="ve-range"><span>{label}<input aria-label={label+' exact value'} type="number" min={min} max={max} step={step} value={Number.isFinite(Number(value))?value:0} onChange={e=>{const n=Number(e.target.value);if(e.target.value!==''&&Number.isFinite(n))onChange(Math.max(min,Math.min(max,n)))}}/></span><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(Number(e.target.value))}/></label>;
}
export default function EditorInspector({clip,asset,settings,onSettings,onPatch,onTransition,onSplit,onDelete,onDetachAudio,onSplitStereo,onRippleDelete,onAudioPreset,onNormalizeAudio,time}){
 if(!clip)return <aside className="ve-inspector"><div className="ve-pane-heading"><b>Inspector</b><small>Project</small></div>
   <div className="ve-inspector-body"><h4>Project settings</h4><label className="ve-field"><span>Canvas aspect</span><select value={settings.aspect} onChange={e=>onSettings({...settings,aspect:e.target.value})}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
    <label className="ve-field"><span>Frame rate</span><select value={settings.fps} onChange={e=>onSettings({...settings,fps:Number(e.target.value)})}><option>24</option><option>25</option><option>30</option><option>60</option></select></label>
    <p className="ve-note">Select a clip on the timeline to adjust its trim, speed, sound, color, and transitions.</p></div></aside>;
 if(clip.kind==='motion')return <aside className="ve-inspector"><div className="ve-pane-heading"><b>Animation</b><small>{clip.trackId}</small></div><div className="ve-inspector-body"><h4>Reusable motion clip</h4><p className="ve-note">This animation stores {clip.keyframes?.length||0} recorded keyframes. Drag it to another position or compatible track to reuse the motion on an object underneath it.</p><p className="ve-note">Duration: {fmt(clipLength(clip))} seconds</p><button onClick={()=>onDelete(clip.id)}>Delete animation</button></div></aside>;
 const duration=clipLength(clip);
 const patch=(k,v)=>onPatch(clip.id,{[k]:v});
 return <aside className="ve-inspector"><div className="ve-pane-heading"><b>Inspector</b><small>{clip.trackId}</small></div><div className="ve-inspector-body">
  <h4 className="ve-inspector-title">{clip.kind==='text'?clip.text:asset?.name||'Selected clip'}</h4>
  <label className="ve-field"><span>Lock clip</span><input type="checkbox" checked={Boolean(clip.locked)} onChange={e=>patch('locked',e.target.checked)}/></label>
  <div className="ve-inspector-tools"><button onClick={()=>onSplit(clip.id)}>✂ Split at playhead</button><button onClick={()=>onDelete(clip.id)}>Delete</button></div>
  <div className="ve-inspector-tools"><button title="Remove selected clip and close following gap" onClick={()=>onRippleDelete(clip.id)}>Ripple delete</button>
  {clip.kind==='video'&&!clip.trackId.startsWith('A')&&<button onClick={()=>onDetachAudio(clip.id)}>Detach audio</button>}
  {clip.kind==='audio'&&<button onClick={()=>onSplitStereo(clip.id)}>Split L/R</button>}</div>
  <details open><summary>Timing & trim</summary>
   <NumberInput label="Position (s)" value={clip.start} step=".05" onChange={v=>patch('start',v)}/>
   <NumberInput label="In point (s)" value={clip.inPoint} step=".05" max={Math.max(.1,clip.outPoint-.1)} onChange={v=>patch('inPoint',v)}/>
   <NumberInput label="Out point (s)" value={clip.outPoint} step=".05" min={clip.inPoint+.1} max={Math.max(clip.outPoint,asset?.duration||clip.outPoint)} onChange={v=>patch('outPoint',v)}/>
   <NumberInput label="Speed" value={clip.speed} min=".25" max="4" step=".05" onChange={v=>patch('speed',v)}/>
   <p className="ve-note">Timeline duration: {fmt(duration)}s · End: {fmt(clipEnd(clip))}s</p>
  </details>
  {(clip.kind==='video'||clip.kind==='audio')&&<details open><summary>Audio mixer and channels</summary>
   <label className="ve-field"><span>Mute clip</span><input type="checkbox" checked={clip.muted} onChange={e=>patch('muted',e.target.checked)}/></label>
   <Range label="Volume / gain" value={clip.volume} min="0" max="2" step=".01" onChange={v=>patch('volume',v)}/>
   <div className="ve-inspector-tools"><button disabled={!asset?.waveform?.length} onClick={()=>onNormalizeAudio(clip.id)}>Peak normalize</button></div>
   <NumberInput label="Fade in (seconds)" min="0" max="2" step=".1" value={clip.transitionIn==='fade'?clip.transitionDuration:0}
    onChange={v=>onTransition(clip.id,v>0?'fade':'none',Math.max(.1,v))}/>
   <NumberInput label="Fade out (seconds)" min="0" max="3" step=".1" value={clip.fadeOut??0} onChange={v=>patch('fadeOut',v)}/>
   <Range label="Stereo pan" value={clip.pan??0} min="-1" max="1" step=".05" onChange={v=>patch('pan',v)}/>
   <label className="ve-field"><span>Audio channel</span><select value={clip.audioChannel||'stereo'} onChange={e=>patch('audioChannel',e.target.value)}>
    <option value="stereo">Original stereo</option><option value="left">Left only</option><option value="right">Right only</option>
   </select></label>
   <Range label="Low EQ (dB)" value={clip.eqLow??0} min="-18" max="18" step=".5" onChange={v=>patch('eqLow',v)}/>
   <Range label="Mid EQ (dB)" value={clip.eqMid??0} min="-18" max="18" step=".5" onChange={v=>patch('eqMid',v)}/>
   <Range label="High EQ (dB)" value={clip.eqHigh??0} min="-18" max="18" step=".5" onChange={v=>patch('eqHigh',v)}/>
   <div className="ve-inspector-tools">{['dialogue','music','flat'].map(p=><button key={p} onClick={()=>onAudioPreset(clip.id,p)} title={'Apply '+p+' audio mix'}>{p}</button>)}</div>
   <p className="ve-note">Stereo channel isolation, pan and 3-band EQ also apply during export. Audio L/R separation needs a source with two decodable channels.</p>
  </details>}
  {clip.kind!=='audio'&&<details open><summary>Transitions & fades</summary>
   <label className="ve-field"><span>Entrance</span><select value={clip.transitionIn} onChange={e=>onTransition(clip.id,e.target.value,clip.transitionDuration)}>
    <option value="none">Cut (none)</option><option value="crossfade">Cross dissolve</option><option value="fade">Fade in</option><option value="wipe">Wipe right</option><option value="slide">Slide in</option>{clip.kind==='text'&&<option value="rise">Rise from below</option>}
   </select></label>
   {clip.transitionIn!=='none'&&<NumberInput label="Transition (s)" min=".1" max="2" step=".1" value={clip.transitionDuration} onChange={v=>onTransition(clip.id,clip.transitionIn,v)}/>}
   <NumberInput label="Fade out (s)" min="0" max="3" step=".1" value={clip.fadeOut} onChange={v=>patch('fadeOut',v)}/>
  </details>}
  {clip.kind==='text'&&<details open><summary>Text & caption</summary>
   <label className="ve-stacked-field"><span>Text</span><textarea rows="4" value={clip.text} onChange={e=>patch('text',e.target.value)}/></label>
   <label className="ve-field"><span>Text color</span><input type="color" value={clip.fontColor} onChange={e=>patch('fontColor',e.target.value)}/></label>
   <label className="ve-field"><span>Outline color</span><input type="color" value={clip.textOutlineColor||'#000000'} onChange={e=>patch('textOutlineColor',e.target.value)}/></label>
   <NumberInput label="Outline width" value={clip.textOutlineWidth??0} min="0" max="12" step=".5" onChange={v=>patch('textOutlineWidth',v)}/>
   <Range label="Shadow strength" value={clip.textShadow??.9} min="0" max="1" step=".05" onChange={v=>patch('textShadow',v)}/>
   <NumberInput label="Font size" value={clip.fontSize} min="1" max="500" step=".5" onChange={v=>patch('fontSize',v)}/>
   <NumberInput label="Vertical position %" value={clip.positionY} min="0" max="100" step="2" onChange={v=>patch('positionY',v)}/>
   <label className="ve-field"><span>Font</span><select value={clip.fontFamily} onChange={e=>patch('fontFamily',e.target.value)}><option>Arial</option><option>Verdana</option><option>Georgia</option><option>Impact</option><option>Tahoma</option></select></label>
  </details>}
  {(clip.kind==='video'||clip.kind==='image')&&!clip.trackId.startsWith('A')&&<details open><summary>Green screen and compositing</summary>
   <label className="ve-field"><span>Enable chroma key</span><input type="checkbox" checked={Boolean(clip.chromaKey)} onChange={e=>patch('chromaKey',e.target.checked)}/></label>
   <label className="ve-field"><span>Remove color</span><input type="color" value={clip.chromaColor||'#00ff00'} onChange={e=>patch('chromaColor',e.target.value)}/></label>
   <Range label="Key tolerance" value={clip.chromaTolerance??.18} min=".01" max=".9" step=".01" onChange={v=>patch('chromaTolerance',v)}/>
   <Range label="Edge softness" value={clip.chromaSoftness??.12} min="0" max=".5" step=".01" onChange={v=>patch('chromaSoftness',v)}/>
   <p className="ve-note">Place a background image or video on a lower video track. Preview and WebM export use the same color-key algorithm.</p>
  </details>}
  {(clip.kind==='video'||clip.kind==='image')&&!clip.trackId.startsWith('A')&&<details><summary>Crop and mask</summary>
   <Range label="Crop left %" min="0" max="49" step="1" value={clip.cropLeft??0} onChange={v=>patch('cropLeft',v)}/>
   <Range label="Crop right %" min="0" max="49" step="1" value={clip.cropRight??0} onChange={v=>patch('cropRight',v)}/>
   <Range label="Crop top %" min="0" max="49" step="1" value={clip.cropTop??0} onChange={v=>patch('cropTop',v)}/>
   <Range label="Crop bottom %" min="0" max="49" step="1" value={clip.cropBottom??0} onChange={v=>patch('cropBottom',v)}/>
   <button onClick={()=>onPatch(clip.id,{cropLeft:0,cropRight:0,cropTop:0,cropBottom:0})}>Reset crop</button>
  </details>}
  {clip.kind!=='audio'&&<details open><summary>Transform & color</summary>
   <Range label="Opacity" value={clip.opacity} min="0" max="1" step=".02" onChange={v=>patch('opacity',v)}/>
   <Range label="Zoom / scale" value={clip.scale} min=".05" max="10" step=".01" onChange={v=>patch('scale',v)}/>
   <Range label="Horizontal position" value={clip.offsetX} min="-300" max="300" step=".5" onChange={v=>patch('offsetX',v)}/>
   <Range label="Vertical position" value={clip.offsetY} min="-100" max="100" step="1" onChange={v=>patch('offsetY',v)}/>
   <Range label="Rotation" value={clip.rotation} min="-180" max="180" step="1" onChange={v=>patch('rotation',v)}/>
   <Range label="Brightness" value={clip.brightness} min=".2" max="2" step=".05" onChange={v=>patch('brightness',v)}/>
   <Range label="Contrast" value={clip.contrast} min=".2" max="2" step=".05" onChange={v=>patch('contrast',v)}/>
   <Range label="Saturation" value={clip.saturation} min="0" max="3" step=".05" onChange={v=>patch('saturation',v)}/>
   <Range label="Warmth / hue" value={clip.hueRotate??0} min="-180" max="180" step="1" onChange={v=>patch('hueRotate',v)}/>
   <Range label="Blur" value={clip.blur??0} min="0" max="20" step=".5" onChange={v=>patch('blur',v)}/>
   <div className="ve-inspector-tools">
    <button onClick={()=>onPatch(clip.id,{brightness:1,contrast:1,saturation:0,hueRotate:0,blur:0})}>B&W</button>
    <button onClick={()=>onPatch(clip.id,{brightness:1.06,contrast:1.14,saturation:1.3,hueRotate:0,blur:0})}>Vivid</button>
    <button onClick={()=>onPatch(clip.id,{brightness:1,contrast:1,saturation:1,hueRotate:0,blur:0})}>Reset</button>
   </div>
  </details>}
 </div></aside>;
}
