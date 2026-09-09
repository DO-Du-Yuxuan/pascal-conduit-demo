import { describe,expect,it } from 'vitest';
import type { NodeData } from '../types';
import { createEmptyOverlay } from '../domain/overlay';
import { manualCalloutTargetAnchor } from './manual-callout-model';

describe('manual callout anchors',()=>{
  it('resolves stable centers for building and network objects',()=>{
    const nodes={level:{id:'level',type:'level',level:0},wall:{id:'wall',type:'wall',parentId:'level',start:[0,0],end:[4,2]}} as unknown as Record<string,NodeData>;
    const overlay=createEmptyOverlay('a','sha');overlay.segments=[{id:'pipe',type:'conduit-segment',system:'lighting',diameterMm:20,start:{position:[0,1,0],attachment:{hostId:'wall',hostKind:'wall',surface:'front',normal:[0,0,1],levelId:'level'}},end:{position:[2,1,4],attachment:{hostId:'wall',hostKind:'wall',surface:'front',normal:[0,0,1],levelId:'level'}},createdAt:''}];
    expect(manualCalloutTargetAnchor(nodes,overlay,'wall')).toEqual({levelId:'level',anchor:[2,1]});
    expect(manualCalloutTargetAnchor(nodes,overlay,'pipe')).toEqual({levelId:'level',anchor:[1,2]});
  });
});
