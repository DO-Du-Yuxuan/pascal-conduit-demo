import {AffineMatrix2D,NodeData,Transform,Vec3} from '../types';

const vec3=(value:any,fallback:Vec3=[0,0,0]):Vec3=>Array.isArray(value)&&value.length>=3&&value.every(Number.isFinite)?[value[0],value[1],value[2]]:fallback;
const wallPoint=(value:any):[number,number]=>Array.isArray(value)&&value.length>=2&&value.every(Number.isFinite)?[value[0],value[1]]:[0,0];

/** Pascal floorplan rotation: clockwise in the [x,z] plane. */
export function rotatePascalPlanVector(x:number,z:number,rotationY:number){const c=Math.cos(rotationY),s=Math.sin(rotationY);return{x:x*c+z*s,z:-x*s+z*c}}
export const rotatePlanPoint=rotatePascalPlanVector;

export function resolveAncestorLevelId(nodeId:string,nodes:Record<string,NodeData>):{levelId?:string;sourceNodeIds:string[];error?:string}{const sourceNodeIds:string[]=[],seen=new Set<string>();let currentId:string|undefined=nodeId;while(currentId){if(seen.has(currentId))return{sourceNodeIds,error:'parent_cycle'};seen.add(currentId);sourceNodeIds.push(currentId);const current:NodeData|undefined=nodes[currentId];if(!current)return{sourceNodeIds,error:'missing_parent'};if(current.type==='level')return{levelId:current.id,sourceNodeIds};currentId=current.parentId}return{sourceNodeIds,error:'missing_parent'}}
export function validDimensions(item:NodeData):Vec3|null{const d=item.asset?.dimensions;return Array.isArray(d)&&d.length>=3&&d.every((v:any)=>Number.isFinite(v)&&v>0)?[d[0],d[1],d[2]]:null}
export function validItemScale(item:NodeData):Vec3|null{const s=item.scale??[1,1,1];return Array.isArray(s)&&s.length>=3&&s.every((v:any)=>Number.isFinite(v)&&v>0)?[s[0],s[1],s[2]]:null}
export function finalDimensions(item:NodeData){const d=validDimensions(item),s=validItemScale(item);return d&&s?{width:d[0]*s[0],height:d[1]*s[1],depth:d[2]*s[2]}:null}
export function resolveItemVerticalRange(itemId:string,nodes:Record<string,NodeData>):{bottom:number;top:number;status:"ok"|"error";error?:string}{const item=nodes[itemId],dimensions=item?finalDimensions(item):null;if(!item||!dimensions)return{bottom:0,top:0,status:"error",error:item?"invalid_dimensions":"missing_item"};let bottom=0,current:NodeData|undefined=item;const seen=new Set<string>();while(current){if(seen.has(current.id))return{bottom:0,top:0,status:"error",error:"parent_cycle"};seen.add(current.id);if(current.type==="ceiling"||current.asset?.attachTo==="ceiling")return{bottom:0,top:0,status:"error",error:"ceiling_elevation_unresolved"};const y=Array.isArray(current.position)&&Number.isFinite(current.position[1])?current.position[1]:0;bottom+=y;if(!current.parentId)break;current=nodes[current.parentId];if(!current)return{bottom:0,top:0,status:"error",error:"missing_parent"};if(current.type==="level")break}return{bottom,top:bottom+dimensions.height,status:"ok"}}
export function normalizeDegrees(radians:number){const degrees=radians*180/Math.PI;return((degrees%360)+360)%360}

/** Returns Pascal Level-plane coordinates. rotationY is never converted to SVG here. */
export function resolveItemPlanTransform(itemId:string,nodes:Record<string,NodeData>):Transform{const ancestry=resolveAncestorLevelId(itemId,nodes),seen=new Set<string>();const fail=(error:string,sourceNodeIds:string[]):Transform=>({x:0,z:0,rotationY:0,sourceNodeIds,status:'error',error});function walk(id:string):Transform{if(seen.has(id))return fail('parent_cycle',[id]);seen.add(id);const item=nodes[id];if(!item)return fail('missing_parent',[id]);const position=vec3(item.position),itemRotation=vec3(item.rotation)[1];if(!item.parentId)return item.type==='level'?{x:0,z:0,rotationY:0,ancestorLevelId:item.id,sourceNodeIds:[id],status:'ok'}:fail('missing_parent',[id]);const parent=nodes[item.parentId];if(!parent)return fail('missing_parent',[id,item.parentId]);if(parent.type==='wall'){const start=wallPoint(parent.start),end=wallPoint(parent.end),wallRotation=-Math.atan2(end[1]-start[1],end[0]-start[0]),isWallSide=item.asset?.attachTo==='wall-side',thickness=Number.isFinite(parent.thickness)&&parent.thickness>0?parent.thickness:.1,wallLocalZ=isWallSide?thickness/2*(item.side==='front'?1:-1):position[2],offset=rotatePascalPlanVector(position[0],wallLocalZ,wallRotation),rotationY=wallRotation+itemRotation;let x=start[0]+offset.x,z=start[1]+offset.z;if(isWallSide){const dimensions=finalDimensions(item);if(dimensions){const centerOffset=rotatePascalPlanVector(0,dimensions.depth/2,rotationY);x+=centerOffset.x;z+=centerOffset.z}}return{x,z,rotationY,ancestorLevelId:ancestry.levelId,sourceNodeIds:[id,parent.id],status:'ok'}}if(!['level','slab','ceiling','item','shelf'].includes(parent.type))return fail('unsupported_parent_transform',[id,parent.id]);if(parent.type==='level'||parent.type==='slab'||parent.type==='ceiling')return{x:position[0],z:position[2],rotationY:itemRotation,ancestorLevelId:ancestry.levelId,sourceNodeIds:[id,parent.id],status:'ok'};const base=walk(parent.id);if(base.status==='error')return{...base,sourceNodeIds:[id,...base.sourceNodeIds]};const offset=rotatePascalPlanVector(position[0],position[2],base.rotationY);return{x:base.x+offset.x,z:base.z+offset.z,rotationY:base.rotationY+itemRotation,ancestorLevelId:ancestry.levelId,sourceNodeIds:[id,...base.sourceNodeIds],status:'ok'}}const result=walk(itemId);return result.status==='ok'?{...result,ancestorLevelId:ancestry.levelId}:result}

/** Current Demo worldToSvg: [worldX, worldZ] -> [svgX, svgY], with no swap, flip, mirror, or scale. */
export function worldPointToSvg(x:number,z:number){return{x,y:z}}
export function composePascalTransformWithWorldToSvg(transform:Transform):AffineMatrix2D{const c=Math.cos(transform.rotationY),s=Math.sin(transform.rotationY),origin=worldPointToSvg(transform.x,transform.z);return{a:c,b:-s,c:s,d:c,e:origin.x,f:origin.y}}
export function svgMatrixString(matrix:AffineMatrix2D){return`matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`}

/** Door/window position[0] is the opening centre's distance along its parent wall. */
export function resolveWallOpeningTransform(node:NodeData,nodes:Record<string,NodeData>){const wall=nodes[node.wallId||node.parentId||''];if(!wall||wall.type!=='wall')return null;const start=wallPoint(wall.start),end=wallPoint(wall.end),dx=end[0]-start[0],dz=end[1]-start[1],length=Math.hypot(dx,dz);if(!Number.isFinite(length)||length===0)return null;const distance=Array.isArray(node.position)&&Number.isFinite(node.position[0])?node.position[0]:0;return{x:start[0]+dx/length*distance,z:start[1]+dz/length*distance,rotationY:Math.atan2(dz,dx),ancestorLevelId:resolveAncestorLevelId(node.id,nodes).levelId,sourceNodeIds:[node.id,wall.id]}}
export function resolveDoorOperationOrientation(node: NodeData) {
  const rawRotationYRadians = Array.isArray(node.rotation) && Number.isFinite(node.rotation[1]) ? node.rotation[1] : 0,
    normalizedRotation = ((rawRotationYRadians % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2),
    placementFlipped = normalizedRotation > Math.PI / 2 && normalizedRotation < Math.PI * 3 / 2,
    rawHingesSide = node.hingesSide ?? "left",
    rawSwingDirection = node.swingDirection ?? "inward";
  return {
    rawRotationYRadians,
    placementFlipped,
    effectiveHingesSide: placementFlipped ? rawHingesSide === "left" ? "right" : "left" : rawHingesSide,
    effectiveSwingDirection: placementFlipped ? rawSwingDirection === "inward" ? "outward" : "inward" : rawSwingDirection,
  };
}
export type ViewBox={minX:number;minZ:number;width:number;height:number};
export function zoomExtents(points:Array<{x:number;z:number}>,padding=1):ViewBox{if(!points.length)return{minX:-5,minZ:-5,width:10,height:10};const xs=points.map(p=>p.x),zs=points.map(p=>p.z),minX=Math.min(...xs)-padding,maxX=Math.max(...xs)+padding,minZ=Math.min(...zs)-padding,maxZ=Math.max(...zs)+padding;return{minX,minZ,width:Math.max(maxX-minX,1),height:Math.max(maxZ-minZ,1)}}
export function zoomViewBoxAtPoint(viewBox:ViewBox,point:{x:number;z:number},factor:number):ViewBox{return{minX:point.x-(point.x-viewBox.minX)*factor,minZ:point.z-(point.z-viewBox.minZ)*factor,width:viewBox.width*factor,height:viewBox.height*factor}}
export function rotatedPanDelta(screenX:number,screenZ:number,rotationDegrees:number){const radians=rotationDegrees*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);return{x:-(screenX*c+screenZ*s),z:-(-screenX*s+screenZ*c)}}
/** Keeps the north arrow aligned with the same world direction as the rotated plan. */
export function compassArrowRotation(viewRotationDegrees:number,northUpRotationDegrees:number){return viewRotationDegrees-northUpRotationDegrees}
