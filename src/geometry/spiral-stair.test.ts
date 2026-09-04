import { describe, expect, it } from 'vitest';
import { buildSpiralStairPlanGeometry } from './spiral-stair';
const stair=(extra:any={})=>({id:'stair',type:'stair',parentId:'level',position:[2,0,3],rotation:0,stairType:'spiral',width:1.1,innerRadius:.4,sweepAngle:Math.PI,stepCount:20,showCenterColumn:false,showStepSupports:false,railingMode:'none',topLandingMode:'none',...extra});
describe('spiral stair plan geometry',()=>{
 it('uses width outside the inner radius and preserves the centre',()=>{const g=buildSpiralStairPlanGeometry(stair())!;expect(g.outerRadius).toBeCloseTo(1.5);expect(g.center).toEqual({x:2,z:3});});
 it('creates stepCount plus boundary radial lines with exact sweep ends',()=>{const g=buildSpiralStairPlanGeometry(stair())!;expect(g.treadLines).toHaveLength(21);expect(Math.atan2(g.treadLines[0].start.z-g.center.z,g.treadLines[0].start.x-g.center.x)).toBeCloseTo(g.startAngle);expect(Math.atan2(g.treadLines[20].start.z-g.center.z,g.treadLines[20].start.x-g.center.x)).toBeCloseTo(g.endAngle);});
 it('keeps negative sweep direction and optional parts data driven',()=>{const negative=buildSpiralStairPlanGeometry(stair({sweepAngle:-Math.PI,showCenterColumn:true,showStepSupports:true,railingMode:'both',topLandingMode:'integrated'}))!;expect(negative.sweepAngle).toBeLessThan(0);expect(negative.centerColumn).not.toBeNull();expect(negative.supportLines).toHaveLength(21);expect(negative.railingPaths).toHaveLength(2);expect(negative.landingGeometry).toHaveLength(4);});
 it('rejects invalid geometry instead of fabricating a placeholder',()=>expect(buildSpiralStairPlanGeometry(stair({stepCount:0}))).toBeNull());
});
