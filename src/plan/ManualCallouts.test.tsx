// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { ManualCallouts } from './ManualCallouts';

const callout={id:'note',targetId:'wall',levelId:'L0',anchor:[0,0] as [number,number],label:[1,1] as [number,number],text:'',createdAt:''};
const roots:ReturnType<typeof createRoot>[]=[];Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
afterEach(()=>act(()=>roots.splice(0).forEach(root=>root.unmount())));

describe('manual callout editing',()=>{
  it('opens the initial editor once and Escape cancels a new annotation',()=>{
    const host=document.createElement('div'),root=createRoot(host);roots.push(root);const remove=vi.fn(),finish=vi.fn();
    act(()=>root.render(<svg><ManualCallouts callouts={[callout]} preview={null} rotation={0} annotationScale={1} selectedId="note" autoEditId="note" onSelect={()=>{}} onUpdate={()=>{}} onDelete={remove} onMoveStart={()=>{}} onMove={()=>{}} onMoveEnd={()=>{}} onEditFinished={finish}/></svg>));
    const editor=host.querySelector('textarea')!;expect(editor).not.toBeNull();
    act(()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(remove).toHaveBeenCalledWith('note');expect(finish).toHaveBeenCalled();
  });

  it('keeps Shift+Enter as a newline and saves ordinary Enter',()=>{
    const host=document.createElement('div'),root=createRoot(host);roots.push(root);const update=vi.fn();
    act(()=>root.render(<svg><ManualCallouts callouts={[callout]} preview={null} rotation={0} annotationScale={1} selectedId="note" autoEditId="note" onSelect={()=>{}} onUpdate={update} onDelete={()=>{}} onMoveStart={()=>{}} onMove={()=>{}} onMoveEnd={()=>{}} onEditFinished={()=>{}}/></svg>));
    const editor=host.querySelector('textarea')!;expect(editor.value).toBe('');expect(editor.style.fontSize).toBe('14px');
    act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(editor,'现场复核');editor.dispatchEvent(new Event('input',{bubbles:true}));});expect(editor.value).toBe('现场复核');
    act(()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true})));expect(update).not.toHaveBeenCalled();
    act(()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(update).toHaveBeenCalledWith('note',{text:'现场复核'});
  });
});
