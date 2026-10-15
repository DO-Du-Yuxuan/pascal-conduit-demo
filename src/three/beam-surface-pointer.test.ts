import { describe, expect, it } from 'vitest';
import { BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { beamPointerFromRay } from './BeamSurfacePointerCapture';
import type { NodeData } from '../types';
const modifiers = {shiftKey: false, ctrlKey: false};
const nodes = {wall: {id:'wall',type:'wall'}, ceiling:{id:'ceiling',type:'ceiling'}, floor:{id:'floor',type:'slab'}} as Record<string,NodeData>;
const meshAt = (id:string, y:number) => {
  const group = new Group();group.userData.boxSelectId=id;
  const mesh = new Mesh(new BoxGeometry(2,.1,2), new MeshBasicMaterial());mesh.position.y=y;group.add(mesh);group.updateMatrixWorld(true);return group;
};
describe('physical Beam pointer picking', () => {
  it('cannot start from an empty ray; projects only after the wall anchor exists', () => {
    const ray = new Raycaster(new Vector3(0,5,0),new Vector3(0,-1,0));
    expect(beamPointerFromRay(ray,[],nodes,new Matrix4(),null,modifiers)).toBeNull();
    expect(beamPointerFromRay(ray,[],nodes,new Matrix4(),2.5,modifiers)).toMatchObject({point:[0,2.5,0]});
  });
  it('returns the frontmost actual node, so a Ceiling hit cannot masquerade as a wall', () => {
    const ray = new Raycaster(new Vector3(0,5,0),new Vector3(0,-1,0));
    expect(beamPointerFromRay(ray,[meshAt('wall',2),meshAt('ceiling',3)],nodes,new Matrix4(),null,modifiers)?.targetId).toBe('ceiling');
  });
  it('transforms real hits into editing coordinates, retaining the physical node identity', () => {
    const ray = new Raycaster(new Vector3(0,5,0),new Vector3(0,-1,0));
    const pointer = beamPointerFromRay(ray,[meshAt('wall',2)],nodes,new Matrix4().makeTranslation(-4,0,-6),null,{shiftKey:true,ctrlKey:true});
    expect(pointer).toMatchObject({targetId:'wall',shiftKey:true,ctrlKey:true});
    expect(pointer!.point[0]).toBe(-4);expect(pointer!.point[1]).toBeCloseTo(2.05);expect(pointer!.point[2]).toBe(-6);
  });
  it('keeps an unsupported cursor on the wall-top plane when the ray hits a floor behind it', () => {
    const floor=meshAt('floor',0);floor.scale.set(20,1,20);floor.updateMatrixWorld(true);
    const ray=new Raycaster(new Vector3(0,5,0),new Vector3(1,-1,0).normalize());
    expect(beamPointerFromRay(ray,[floor],nodes,new Matrix4(),null,modifiers)?.targetId).toBe('floor');
    const draft=beamPointerFromRay(ray,[floor],nodes,new Matrix4(),2.5,modifiers);
    expect(draft?.targetId).toBeUndefined();
    expect(draft?.point[0]).toBeCloseTo(2.5);expect(draft?.point[1]).toBeCloseTo(2.5);
  });

});
