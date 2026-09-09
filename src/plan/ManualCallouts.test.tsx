// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach,describe,expect,it,vi } from 'vitest';
import { ManualCallouts } from './ManualCallouts';

const callout={id:'note',targetId:'wall',levelId:'L0',anchor:[0,0] as [number,number],label:[1,1] as [number,number],text:'',createdAt:''};
const roots:ReturnType<typeof createRoot>[]=[];Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));document.body.innerHTML='';});

describe('manual callout editing',()=>{
  it('opens the initial editor once and Escape cancels a new annotation',()=>{
    const host=document.createElement('div'),root=createRoot(host);roots.push(root);const remove=vi.fn(),finish=vi.fn();
    act(()=>root.render(<svg><ManualCallouts callouts={[callout]} preview={null} rotation={0} annotationScale={1} selectedId="note" autoEditId="note" onSelect={()=>{}} onUpdate={()=>{}} onDelete={remove} onMoveStart={()=>{}} onMove={()=>{}} onMoveEnd={()=>{}} onEditFinished={finish}/></svg>));
    const editor=document.body.querySelector('textarea')!;expect(editor).not.toBeNull();expect(host.querySelector('foreignObject')).toBeNull();
    act(()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
    expect(remove).toHaveBeenCalledWith('note');expect(finish).toHaveBeenCalled();
  });

  it('keeps Shift+Enter as a newline and saves ordinary Enter',()=>{
    const host=document.createElement('div'),root=createRoot(host);roots.push(root);const update=vi.fn();
    act(()=>root.render(<svg><ManualCallouts callouts={[callout]} preview={null} rotation={0} annotationScale={1} selectedId="note" autoEditId="note" onSelect={()=>{}} onUpdate={update} onDelete={()=>{}} onMoveStart={()=>{}} onMove={()=>{}} onMoveEnd={()=>{}} onEditFinished={()=>{}}/></svg>));
    const editor=document.body.querySelector('textarea')!;expect(editor.value).toBe('');expect(editor.style.fontSize).toBe('14px');
    act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(editor,'site note');editor.dispatchEvent(new Event('input',{bubbles:true}));});expect(editor.value).toBe('site note');expect(host.textContent).toContain('site note');
    act(()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true})));expect(update).not.toHaveBeenCalled();
    act(()=>editor.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));expect(update).toHaveBeenCalledWith('note',{text:'site note'});
  });

  it('opens a normal HTML editor when saved text is double-clicked',()=>{
    const host=document.createElement('div'),root=createRoot(host);roots.push(root);const saved={...callout,text:'已保存'};
    act(()=>root.render(<svg><ManualCallouts callouts={[saved]} preview={null} rotation={0} annotationScale={1} selectedId={null} autoEditId={null} onSelect={()=>{}} onUpdate={()=>{}} onDelete={()=>{}} onMoveStart={()=>{}} onMove={()=>{}} onMoveEnd={()=>{}} onEditFinished={()=>{}}/></svg>));
    const text=[...host.querySelectorAll('text')].find(node=>node.textContent==='已保存')!;act(()=>text.dispatchEvent(new MouseEvent('dblclick',{bubbles:true})));
    expect(document.body.querySelector('textarea')?.value).toBe('已保存');expect(host.querySelector('foreignObject')).toBeNull();
  });
});
