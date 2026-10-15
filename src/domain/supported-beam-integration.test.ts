import { describe, expect, it } from 'vitest';
import { createSupportedBeam, validateBeam } from './beams';
import { snapSupportedBeamPoint } from './beam-positioning';
import { decodeUnifiedProject, encodeUnifiedProject } from './unified-project';
import { supportedBeamDependents, unsupportedDependentsAfterEdit } from './beam-dependents';
import { beamRenderTransform, resolveBeamSurfaceHit } from '../nodes/beam/geometry';
import { validBeamVolumes } from './beam-routing';
import { buildPhysicalPositioningSurfaces } from './physical-positioning-surfaces';
import type { NodeData } from '../types';
const systemTypes = ['ElectricalSystem','PlumbingSystem','LightingSystem','HVACSystem','SmartSystem','WaterPurificationSystem','BathroomSystem','FireProtectionSystem','IrrigationSystem','GasSystem'];
function project() {
  const nodes: Record<string,any> = {
    site:{id:'site',type:'Site',parentId:null,children:['building',...systemTypes]},
    building:{id:'building',type:'Building',parentId:'site',children:['level']},
    level:{id:'level',type:'Level',parentId:'building',level:0,height:2.5,children:['west','east']},
    west:{id:'west',type:'Wall',parentId:'level',start:[0,0],end:[0,4],metadata:{keep:'west'}},
    east:{id:'east',type:'Wall',parentId:'level',start:[4,0],end:[4,4]},
  };
  for (const type of systemTypes) nodes[type]={id:type,type,parentId:'site',children:[]};
  return {schemaVersion:'4.0',pascalConduitProjectId:'supported-beam-project',nodes,rootNodeIds:['site'],installedPlugins:[],materials:{},collections:{}};
}
describe('supported Beam persistence and physical consumers', () => {
  it('round-trips wall evidence and unknown data while rendering and hosting at 2500mm without a Ceiling', () => {
    const raw=project(), opened=decodeUnifiedProject(raw,'beam.json','sha'), nodes=opened.projectRaw.nodes as Record<string,NodeData>;
    const start=snapSupportedBeamPoint(nodes,'level',[.05,2],{objectId:'west',kind:'wall'})!;
    const end=snapSupportedBeamPoint(nodes,'level',[3.95,2],{objectId:'east',start:start.point,orthogonal:true})!;
    const beam={...createSupportedBeam(nodes,{id:'beam',name:'梁 1',levelId:'level',start,end}).beam!,futureBeamData:{retain:true}};
    expect(beam.topElevation).toEqual({meters:2.5,basis:'wall-top',sourceWallId:'west',measurementBasis:'derived'});
    expect(beam.effectiveCeilingElevation).toBeUndefined();
    const withBeam={...opened.projectRaw,nodes:{...nodes,level:{...nodes.level,children:['west','east','beam']},beam}};
    const saved=encodeUnifiedProject(withBeam,opened.overlay);
    const reopened=decodeUnifiedProject(saved,'beam.json','next'), restored=reopened.projectRaw.nodes.beam as typeof beam;
    expect(restored).toMatchObject(beam);
    expect(saved.nodes.west).toEqual(raw.nodes.west);
    const restoredNodes=reopened.projectRaw.nodes as Record<string,NodeData>;
    expect(validateBeam(restored,restoredNodes).valid).toBe(true);
    expect(beamRenderTransform(restored,0)?.center[1]).toBe(2.25);
    expect(resolveBeamSurfaceHit(restored,0,[2,2,2])?.attachment.surface).toBe('bottom');
    expect(validBeamVolumes(restoredNodes)[0]?.top).toBe(2.5);
    expect(buildPhysicalPositioningSurfaces(restoredNodes).some(surface=>surface.objectId==='beam')).toBe(true);
  });
  it('prevents moving or deleting a support away from another Beam', () => {
    const opened=decodeUnifiedProject(project(),'beam.json','sha'), nodes=opened.projectRaw.nodes as Record<string,NodeData>;
    const start=snapSupportedBeamPoint(nodes,'level',[.05,2],{objectId:'west',kind:'wall'})!;
    const end=snapSupportedBeamPoint(nodes,'level',[3.95,2],{objectId:'east',start:start.point,orthogonal:true})!;
    const beam=createSupportedBeam(nodes,{id:'beam',name:'主梁',levelId:'level',start,end}).beam!;
    const withWall={...nodes,beam,south:{id:'south',type:'wall',parentId:'level',start:[0,0],end:[4,0]}} as Record<string,NodeData>;
    const secondStart=snapSupportedBeamPoint(withWall,'level',[2,.05],{objectId:'south',kind:'wall'})!;
    const secondEnd=snapSupportedBeamPoint(withWall,'level',[2,1.85],{objectId:'beam',start:secondStart.point,orthogonal:true})!;
    const second=createSupportedBeam(withWall,{id:'second',name:'次梁',levelId:'level',start:secondStart,end:secondEnd}).beam!;
    expect(second).not.toBeNull();
    const all={...withWall,second};
    expect(supportedBeamDependents(all,'beam').map(b=>b.id)).toEqual(['second']);
    expect(unsupportedDependentsAfterEdit(all,{...beam,width:.1}).map(b=>b.id)).toEqual(['second']);
    expect(unsupportedDependentsAfterEdit(all,{...beam,name:'主梁改名'})).toEqual([]);
  });

});
