import { describe, expect, it } from 'vitest';
import type { PointPositionDimension } from './model';
import { chooseVariantMarkerOffset, layoutPointDimensionLabels } from './collision-layout';

const dimension = (id:string, center:[number,number], direction:[number,number], normal:[number,number]):PointPositionDimension => ({id,sourceId:id,levelId:'l',wallId:'w',reference:[0,center[1]],center,referenceWitness:[0,center[1]],centerWitness:center,direction,normal,lane:0,valueMeters:2,referenceKind:'wall-face',relatedIds:[id],measurementBasis:'derived',confidence:'limited',assumptions:[]});

describe('2D point annotation collision layout',()=>{
  it('moves colliding dimension labels onto separate lanes',()=>{
    const layouts=layoutPointDimensionLabels([dimension('a',[2,2],[0,1],[1,0]),dimension('b',[2.05,2.05],[0,1],[1,0])],'millimeters',1);
    expect(layouts[0].label).not.toEqual(layouts[1].label);
    expect(layouts[1].lane).toBeGreaterThan(layouts[0].lane);
  });
  it('chooses another corner when the preferred variant marker hits a dimension label',()=>{
    expect(chooseVariantMarkerOffset([10,-10],[{minX:8,minY:-17,maxX:20,maxY:-5}],10)).not.toEqual([10,-10]);
  });
});
