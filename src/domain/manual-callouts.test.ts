import { describe,expect,it } from 'vitest';
import { createEmptyOverlay } from './overlay';
import { addManualCallout,deleteManualCallout,updateManualCallout } from './manual-callouts';
import { deleteNetworkObject } from './routing';

describe('manual callouts',()=>{
  it('adds, edits, moves and removes an annotation without changing its target',()=>{
    const base=createEmptyOverlay('a','sha'),created=addManualCallout(base,{targetId:'wall',levelId:'L0',anchor:[1,2],label:[3,4],text:'备注'});
    expect(base.manualCallouts).toEqual([]);expect(created.callout.targetId).toBe('wall');
    const edited=updateManualCallout(created.overlay,created.callout.id,{text:'复核',label:[5,6]});
    expect(edited.manualCallouts[0]).toMatchObject({targetId:'wall',text:'复核',label:[5,6]});
    expect(deleteManualCallout(edited,created.callout.id).manualCallouts).toEqual([]);
  });
  it('removes annotations with a deleted network object',()=>{
    const base=createEmptyOverlay('a','sha');base.devices=[{id:'device',type:'network-device',deviceType:'socket',name:'插座',position:{position:[0,1,0]},sizeMm:[86,86,50],orientation:[0,0,1],systems:['receptacle'],ports:[],createdAt:''}];
    base.manualCallouts=[{id:'note',targetId:'device',levelId:'L0',anchor:[0,0],label:[1,1],text:'备注',createdAt:''}];
    expect(deleteNetworkObject(base,'device').manualCallouts).toEqual([]);
  });
});
