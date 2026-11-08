import React,{useRef} from 'react';

/** Pointer-captured splitter: delta is relative to the previous pointer move. */
export default function PanelSplitter({axis='vertical',label,value,min,max,onResize,onReset}){
 const drag=useRef(null),coordinate=axis==='vertical'?'clientX':'clientY';
 function down(e){
  if(e.button!==0)return;
  e.preventDefault();e.stopPropagation();
  drag.current={pointerId:e.pointerId,last:e[coordinate]};
  document.body.classList.add('ve-is-resizing');
  e.currentTarget.setPointerCapture(e.pointerId);
 }
 function move(e){
  if(!drag.current||drag.current.pointerId!==e.pointerId)return;
  e.preventDefault();
  const distance=e[coordinate]-drag.current.last;
  drag.current.last=e[coordinate];
  if(distance)onResize(distance);
 }
 function end(e){
  if(!drag.current||drag.current.pointerId!==e.pointerId)return;
  drag.current=null;
  document.body.classList.remove('ve-is-resizing');
  if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);
 }
 function keydown(e){
  const backward=axis==='vertical'?'ArrowLeft':'ArrowUp';
  const forward=axis==='vertical'?'ArrowRight':'ArrowDown';
  if(e.key===backward||e.key===forward){
   e.preventDefault();onResize((e.key===backward?-1:1)*(e.shiftKey?30:10));
  }else if(e.key==='Home'){e.preventDefault();onReset?.();}
 }
 return <div role="separator" tabIndex={0} aria-label={label}
  aria-orientation={axis} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
  title={label+' — drag to resize, double-click to reset'}
  className={'ve-panel-splitter ve-panel-splitter-'+axis}
  onPointerDown={down} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
  onLostPointerCapture={()=>{drag.current=null;document.body.classList.remove('ve-is-resizing')}}
  onDoubleClick={e=>{e.preventDefault();onReset?.()}} onKeyDown={keydown}>
   <span className="ve-splitter-grip" aria-hidden="true"/>
 </div>;
}
