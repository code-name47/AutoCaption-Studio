import React from 'react';

/** Shows AI proposals and live execution outside the timeline, so the edit stays visible. */
export default function AIReviewPanel({review,applying,progress,recent,error,onApprove,onReject,onRevert,onDismiss}){
 if(!review&&!applying&&!recent&&!error)return null;
 return <aside className="ve-ai-review" role="region" aria-label="AI editing review" data-testid="ai-review-panel">
  <header className="ve-ai-review-head">
   <span className="ve-ai-light" aria-hidden="true"/>
   <strong>{applying?'AI editing live':review?'AI edit proposal':recent?'AI edit complete':'AI bridge notice'}</strong>
   {!review&&!applying&&<button title="Dismiss AI notification" aria-label="Dismiss AI notification" onClick={onDismiss}>×</button>}
  </header>
  {review&&!applying&&<>
   <p className="ve-ai-summary">{review.summary}</p>
   <p className="ve-ai-explain">Review these actions before they change your timeline. You can reject everything.</p>
   <ol className="ve-ai-steps">{review.steps?.map((s,i)=><li key={i}>{s.description}</li>)}</ol>
   <div className="ve-ai-review-actions">
    <button className="ve-accent-btn" onClick={onApprove} data-testid="approve-ai-edit">Approve &amp; watch</button>
    <button onClick={onReject}>Reject</button>
   </div>
  </>}
  {applying&&<div className="ve-ai-live" aria-live="polite">
   <p className="ve-ai-summary">{progress?.description||'Applying approved changes'}</p>
   <div className="ve-ai-progress"><span style={{width:Math.round(100*(progress?.index||0)/Math.max(1,progress?.total||1))+'%'}}/></div>
   <small>Step {progress?.index||0} of {progress?.total||0} — timeline updates live behind this panel</small>
  </div>}
  {!review&&!applying&&recent&&<>
   <p className="ve-ai-summary">{recent.summary}</p>
   <p className="ve-ai-explain">Changes are visible in the editor. Save after reviewing, or undo this batch.</p>
   <button onClick={onRevert} data-testid="revert-ai-edit">Revert last AI edits</button>
  </>}
  {error&&<p className="ve-ai-error" role="alert">{error}</p>}
 </aside>;
}
