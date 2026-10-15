// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene } from 'three';
import { BeamSurfacePointerCapture } from './BeamSurfacePointerCapture';
const runtime = vi.hoisted(() => ({value:null as any}));
vi.mock('@react-three/fiber', () => ({useThree:()=>runtime.value}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const roots: ReturnType<typeof createRoot>[]=[];
afterEach(()=>{act(()=>roots.splice(0).forEach(root=>root.unmount()));document.body.innerHTML='';});
it('resolves every pointer-down from the real scene and ignores navigation buttons', () => {
  const canvas=document.createElement('canvas');document.body.append(canvas);
  canvas.getBoundingClientRect=()=>({left:0,top:0,width:200,height:200,right:200,bottom:200,x:0,y:0,toJSON:()=>({})});
  const scene=new Scene(), camera=new PerspectiveCamera(60,1,.1,100);camera.position.set(0,2,5);camera.lookAt(0,2,0);camera.updateMatrixWorld();
  const group=new Group();group.userData.boxSelectId='wall';scene.add(group);
  const body=new Mesh(new BoxGeometry(4,4,.1),new MeshBasicMaterial());body.position.y=2;group.add(body);
  runtime.value={scene,camera,gl:{domElement:canvas}};
  const preview=vi.fn(), place=vi.fn(), root=createRoot(document.createElement('div'));roots.push(root);
  act(()=>root.render(<BeamSurfacePointerCapture nodes={{wall:{id:'wall',type:'wall'}}} topY={null} worldToEditing={new Matrix4()} onPreview={preview} onPlace={place}/>));
  const send=(type:string,button:number)=>{const e=new MouseEvent(type,{clientX:100,clientY:100,button,bubbles:true,cancelable:true});Object.assign(e,{pointerId:1});act(()=>canvas.dispatchEvent(e));};
  send('pointermove',0);expect(preview.mock.calls[preview.mock.calls.length-1]?.[0]?.targetId).toBe('wall');
  // Removing the previously hovered mesh before clicking must not reuse it.
  scene.remove(group);send('pointerdown',0);expect(place.mock.calls[place.mock.calls.length-1]?.[0]).toBeNull();
  scene.add(group);send('pointerdown',0);expect(place.mock.calls[place.mock.calls.length-1]?.[0]?.targetId).toBe('wall');
  const count=place.mock.calls.length;send('pointerdown',2);expect(preview.mock.calls[preview.mock.calls.length-1]?.[0]).toBeNull();send('pointerdown',1);expect(place.mock.calls.length).toBe(count);
  act(()=>canvas.dispatchEvent(new WheelEvent('wheel')));expect(preview.mock.calls[preview.mock.calls.length-1]?.[0]).toBeNull();
});
