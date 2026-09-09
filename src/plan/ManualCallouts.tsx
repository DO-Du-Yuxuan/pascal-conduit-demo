import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ManualCallout } from '../domain/overlay';

export function ManualCallouts({ callouts, preview, rotation, annotationScale, selectedId, autoEditId, onSelect, onUpdate, onDelete, onMoveStart, onMove, onMoveEnd, onEditFinished }: {
  callouts: ManualCallout[]; preview?: { anchor: [number,number]; label: [number,number] } | null; rotation: number; annotationScale: number; selectedId: string | null; autoEditId: string | null;
  onSelect: (id: string) => void; onUpdate: (id: string, update: Partial<Pick<ManualCallout,'text'|'label'>>) => void; onDelete: (id: string) => void; onMoveStart: (id: string, event: React.PointerEvent) => void; onMove: (event: React.PointerEvent) => void; onMoveEnd: (event: React.PointerEvent) => void; onEditFinished: () => void;
}) {
  const [editing,setEditing]=useState<{id:string;value:string;left:number;top:number}|null>(null);
  const cancelledEdit=useRef(false);
  const labelElements=useRef(new Map<string,SVGGElement>());
  const editAt=(item:ManualCallout,element?:SVGGElement|null)=>{const rect=(element??labelElements.current.get(item.id))?.getBoundingClientRect();setEditing({id:item.id,value:item.text,left:rect?.left??0,top:rect?.top??0});};
  useEffect(()=>{const item=callouts.find(entry=>entry.id===autoEditId);if(item)editAt(item);},[autoEditId]);
  const save=()=>{if(!editing)return;const text=editing.value.trim();if(text)onUpdate(editing.id,{text});else onDelete(editing.id);setEditing(null);onEditFinished();};
  const renderLeader=(anchor:[number,number],label:[number,number])=>{const horizontalFirst=Math.abs(label[0]-anchor[0])>=Math.abs(label[1]-anchor[1]),bend: [number,number]=horizontalFirst?[label[0],anchor[1]]:[anchor[0],label[1]];return <polyline points={[anchor,bend,label].map(point=>point.join(',')).join(' ')} fill="none" stroke="#454545" strokeWidth="1" vectorEffect="non-scaling-stroke"/>;};
  const editorPortal=editing?createPortal(<textarea
    className="manual-callout-editor"
    autoFocus
    placeholder="输入标注文字"
    value={editing.value}
    onChange={event=>setEditing({...editing,value:event.target.value})}
    onBlur={()=>{if(cancelledEdit.current){cancelledEdit.current=false;return;}save();}}
    onKeyDown={event=>{
      event.stopPropagation();
      if(event.nativeEvent.isComposing)return;
      if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();save();}
      if(event.key==='Escape'){
        event.preventDefault();cancelledEdit.current=true;
        if(autoEditId===editing.id)onDelete(editing.id);
        setEditing(null);onEditFinished();
      }
    }}
    style={{position:'fixed',left:editing.left,top:editing.top,zIndex:30,width:240,height:Math.max(38,editing.value.split('\n').length*22),border:'1px solid #e75c3c',padding:'4px 6px',resize:'none',fontSize:`${14*annotationScale}px`,lineHeight:1.35,background:'#fff',color:'#343434'}}
  />,document.body):null;
  return <>
  <g className="manual-callouts">
    {preview&&<g pointerEvents="none" opacity=".72">{renderLeader(preview.anchor,preview.label)}<circle cx={preview.label[0]} cy={preview.label[1]} r={.055*annotationScale} fill="#454545"/></g>}
    {callouts.map(item=>{const selected=selectedId===item.id,fontSize=.2*annotationScale,displayText=editing?.id===item.id?editing.value:item.text,lines=displayText.split('\n'),width=Math.max(.9,...lines.map(value=>Array.from(value).reduce((sum,char)=>sum+(char.charCodeAt(0)>255?fontSize:fontSize*.58),0)+.28*annotationScale)),lineHeight=.3*annotationScale,height=Math.max(.34*annotationScale,lines.length*lineHeight);return <g key={item.id} data-manual-callout={item.id} onClick={event=>{event.stopPropagation();onSelect(item.id);}}>
      {renderLeader(item.anchor,item.label)}
      <g ref={element=>{if(element)labelElements.current.set(item.id,element);else labelElements.current.delete(item.id);}} transform={`translate(${item.label[0]} ${item.label[1]}) rotate(${-rotation})`} onPointerDown={event=>{if((event.target as Element).closest('text'))return;onMoveStart(item.id,event);}} onPointerMove={onMove} onPointerUp={onMoveEnd} onPointerCancel={onMoveEnd} style={{cursor:'move'}}>
        <rect x={-width/2-.06} y={-height/2-.04} width={width+.12} height={height+.08} fill="#fff" fillOpacity=".96" stroke={selected?'#e75c3c':'none'} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <line x1={-width/2} y1={-height/2} x2={-width/2} y2={height/2} stroke="#343434" strokeWidth="1" vectorEffect="non-scaling-stroke"/>
        <text textAnchor="middle" fontSize={fontSize} fill="#343434" onDoubleClick={event=>{event.stopPropagation();editAt(item,event.currentTarget.parentElement as unknown as SVGGElement);}}>{lines.map((line,index)=><tspan key={index} x="0" y={-height/2+lineHeight*(index+.72)}>{line}</tspan>)}</text>
      </g>
    </g>;})}
  </g>
  {editorPortal}
  </>;
}
