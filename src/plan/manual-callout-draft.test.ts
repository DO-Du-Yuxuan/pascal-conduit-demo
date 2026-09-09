import {describe,expect,it} from 'vitest';
import {newManualCalloutDraft} from './manual-callout-model';

describe('new manual callout draft',()=>{
  it('starts empty so placeholder wording is never persisted with user text',()=>{
    expect(newManualCalloutDraft('wall','L0',[1,2],[3,4]).text).toBe('');
  });
});
