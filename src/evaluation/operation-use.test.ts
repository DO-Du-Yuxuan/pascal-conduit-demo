import { describe, expect, it } from "vitest";
import { buildOperationUseAnalysis, operationZoneDisplayGroup } from "./operation-use";
import { ruleG3009, ruleG3010, ruleG3011, ruleG3012, ruleG3039, ruleG3040, ruleG3041, ruleG3042, ruleG3043, ruleG3044 } from "./g3-final-rules";
import { ruleG3029 } from "./g3-fixture-rules";
import { ruleG3018 } from "./g3-furniture-rules";

const level = { id: "L1", rawPascalId: "L1", levelId: "L1", parentId: null, visible: true, name: "Level 1" };
const wall = (id: string, start: [number, number], end: [number, number]) => { const dx=end[0]-start[0], dz=end[1]-start[1], l=Math.hypot(dx,dz), nx=-dz/l*.05,nz=dx/l*.05; return { id, rawPascalId:id, levelId:"L1", parentId:"L1", visible:true, name:id, start, end, thicknessMeters:.1, heightMeters:3, curveOffsetMeters:0, footprintValidation:{valid:true,codes:[],areaSquareMeters:l*.1,footprint:[[start[0]+nx,start[1]+nz],[end[0]+nx,end[1]+nz],[end[0]-nx,end[1]-nz],[start[0]-nx,start[1]-nz]]} }; };
const item = (id:string,name:string,category:string,x:number,z:number,width=.8,depth=.6,extra:Record<string,unknown>={}) => ({ id,rawPascalId:id,levelId:"L1",parentId:"L1",visible:true,name,assetId:id,assetName:name,assetTags:[category],assetSource:"test",category,functionTags:[category],attachTo:null,dimensionsMeters:[width,1,depth],rawPosition:[x,0,z],rawRotation:[0,0,0],resolvedWorldPosition:[x,z],resolvedRotationRadians:0,resolvedVerticalRangeMeters:[0,1],verticalTransformError:null,floorPlanUrl:null,transformStatus:"ok",transformError:null,...extra });
const shelf = (id:string,x:number,z:number,withBack=false) => ({ id,rawPascalId:id,levelId:"L1",parentId:"L1",visible:true,name:"Shelf",style:"open-rack",functionTags:["open-rack"],itemScale:[1,1,1],openingDirections:[],rawMaxOpeningDepthMeters:null,rawMinOpeningUseClearanceMeters:null,dimensionsMeters:[1,2,.4],footprint:[[x-.5,z-.2],[x+.5,z-.2],[x+.5,z+.2],[x-.5,z+.2]],rawPosition:[x,0,z],rawRotation:[0,0,0],resolvedWorldPosition:[x,z],resolvedRotationRadians:0,resolvedVerticalRangeMeters:[0,2],transformStatus:"ok",transformError:null,rows:4,columns:2,withBack,withSides:true,withBottom:true,childItemIds:[]});
const reliableDoor = { itemScale:[1,1,1],openingDirections:["front"],rawMaxOpeningDepthMeters:.6,rawMinOpeningUseClearanceMeters:.45 };
const reliableDrawer = { itemScale:[1,1,1],openingDirections:["front"],rawMaxOpeningDepthMeters:.45,rawMinOpeningUseClearanceMeters:.45 };
const base = (zoneName="ROOM", furniture:any[]=[], equipment:any[]=[], doors=true) => { const outline:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[8,0],[8,6],[0,6]], zone={id:"Z",rawPascalId:"Z",levelId:"L1",parentId:"L1",visible:true,name:zoneName,outline,areaSquareMeters:48}; return {schemaVersion:"1.0",source:{},units:{},levels:[level],slabs:[{id:"S",rawPascalId:"S",levelId:"L1",parentId:"L1",visible:true,name:"Floor",outline,holes:[],areaSquareMeters:48,autoFromWalls:false}],walls:[wall("W1",[0,0],[8,0]),wall("W2",[8,0],[8,6]),wall("W3",[8,6],[0,6]),wall("W4",[0,6],[0,0])],doors:doors?[{id:"D",rawPascalId:"D",levelId:"L1",parentId:"W4",visible:true,name:"Door",hostWallId:"W4",rawWallLocalPosition:[3,1,0],resolvedWorldPosition:[0,3],resolvedTangentRadians:Math.PI/2,widthMeters:1,heightMeters:2.1,openingKind:"door",doorType:"hinged",hingesSide:"left",effectiveHingesSide:"left",swingDirection:"outward",effectiveSwingDirection:"outward",swingAngleRadians:Math.PI/2}]:[],windows:[],zones:[zone],spaces:[{...zone,sourceZoneId:"Z",source:"derived-from-zone"}],furniture,equipment,columns:[],shelves:[],stairs:[],shafts:[],relationships:{},unclassifiedNodes:[],diagnostics:[]} as any; };

describe("G3 final operation and household checks", () => {
  it("does not expose a window opening/use polygon in the 2D operation layer", () => {
    const h=base(); h.windows=[{id:"window",rawPascalId:"window",levelId:"L1",parentId:"W1",visible:true,name:"Window",hostWallId:"W1",resolvedWorldPosition:[4,0],widthMeters:1,heightMeters:1,windowType:"casement"}];
    expect(buildOperationUseAnalysis(h).zones.filter((zone)=>zone.ownerObjectId==="window")).toEqual([]);
  });
  it("keeps a normal reliable cabinet operable and reports a bed blocking its front", () => {
    const cabinet=item("cabinet","Fixed Cabinet","cabinets",4,1,.8,.6,reliableDoor);
    expect(ruleG3010(base("ROOM",[cabinet])).status).toBe("pass");
    expect(ruleG3010(base("ROOM",[cabinet,item("bed","Bed","beds",4,1.65,1,.7)])).status).toBe("issue");
  });
  it("reports an explicitly modelled blocked drawer and excludes a non-openable drawer", () => {
    const drawer=item("drawer","Drawer Unit","drawers",4,1,.8,.6,reliableDrawer);
    expect(ruleG3011(base("ROOM",[drawer,item("block","Bed","beds",4,1.55,1,.7)]))).toMatchObject({status:"issue",normalizedObjectIds:expect.arrayContaining(["drawer"])});
    expect(ruleG3011(base("ROOM",[item("closed","Bedside Drawer","drawers",4,1)]))).toMatchObject({status:"not_applicable"});
  });
  it("uses explicit bedside-table opening fields as a furniture drawer zone", () => {
    const bedside=item("bedside","Bedside Table","bedside-tables",4,1,.45,.46,reliableDrawer), analysis=buildOperationUseAnalysis(base("BEDROOM",[bedside]));
    const owner=analysis.items.find((candidate)=>candidate.item.id==="bedside")!;
    expect(owner.capabilities).toContain("drawer");
    expect(operationZoneDisplayGroup(owner)).toBe("furniture");
    expect(analysis.zones.find((zone)=>zone.ownerObjectId==="bedside")).toMatchObject({kind:"drawer-front",maximumOpeningDepthMeters:.45,minimumUseClearanceMeters:.45,openingPolygon:expect.any(Array),openedUsePolygon:expect.any(Array)});
  });
  it("excludes a non-openable appliance and detects a reliable blocked appliance door", () => {
    expect(ruleG3012(base("LAUNDRY",[],[item("washer","Washing Machine","laundry-appliances",4,1)]))).toMatchObject({status:"not_applicable"});
    const washer=item("washer","Washing Machine","laundry-appliances",4,1,.8,.7,reliableDoor);
    expect(ruleG3012(base("LAUNDRY",[item("block","Cabinet","cabinets",4,1.65,1,.7)], [washer])).status).toBe("issue");
  });
  it("checks normal and blocked laundry operation without duplicating path blockage", () => {
    const washer=item("washer","Washing Machine","laundry-appliances",4,1,.8,.6,reliableDoor);
    expect(ruleG3039(base("LAUNDRY",[],[washer])).status).toBe("pass");
    expect(ruleG3039(base("LAUNDRY",[item("block","Cabinet","cabinets",4,1.65,1,.7)],[washer])).status).toBe("issue");
    const spanning=item("washer","Washing Machine","laundry-appliances",.55,3,1.1,3,reliableDoor);
    expect(ruleG3040(base("LAUNDRY",[],[spanning])).status).toBe("not_applicable");
  });
  it("reports storage without an entry and a storage cabinet whose retrieval area is sealed", () => {
    expect(ruleG3041(base("PANTRY",[],[],false)).status).toBe("issue");
    const closet=item("closet","Closet","wardrobes",4,1,.8,.6,reliableDoor);
    const blockedCloset = base("WALK-IN CLOSET",[closet,item("bed","Bed","beds",4,1.8,1,1.2)]);
    expect(ruleG3018(blockedCloset)).toMatchObject({status:"issue",normalizedObjectIds:["closet"]});
    expect(ruleG3042(blockedCloset).status).toBe("not_applicable");
  });
  it("counts Shelf nodes as cabinets and uses either accessible side for a backless rack", () => {
    const h=base("PANTRY"); h.shelves=[shelf("pantry-shelf",4,5.7,false)];
    const analysis=buildOperationUseAnalysis(h), shelfZones=analysis.zones.filter((zone)=>zone.ownerObjectId==="pantry-shelf"&&zone.kind==="storage-front");
    expect(shelfZones).toHaveLength(2);
    expect(operationZoneDisplayGroup(analysis.items.find((owner)=>owner.item.id==="pantry-shelf")!)).toBe("furniture");
    expect(ruleG3042(h)).toMatchObject({status:"pass",measurements:expect.arrayContaining([expect.objectContaining({name:"shelfCabinetCount",value:1})])});
  });
  it("groups explicit appliance operation zones with kitchen and bathroom use areas", () => {
    const washer=item("washer","Washing Machine","laundry-appliances",4,1,.8,.7,reliableDoor), analysis=buildOperationUseAnalysis(base("LAUNDRY",[],[washer]));
    const owner=analysis.items.find((candidate)=>candidate.item.id==="washer")!;
    expect(operationZoneDisplayGroup(owner)).toBe("fixture");
    expect(analysis.zones.find((zone)=>zone.ownerObjectId==="washer")).toMatchObject({minimumUsePolygon:expect.any(Array),openingPolygon:expect.any(Array),openedUsePolygon:expect.any(Array),maximumOpeningDepthMeters:.6,minimumUseClearanceMeters:.45});
  });
  it("allows household operation zones to overlap when sequential use remains possible", () => {
    const h=base("LAUNDRY",[item("sink","Utility Sink","utility-sink",5,1,.8,.6,reliableDoor)],[item("washer","Washing Machine","laundry-appliances",3,1,.8,.6,reliableDoor)]);
    expect(ruleG3043(h).status).toBe("pass");
  });
  it("does not duplicate a door-rear blockage already attributed by navigation", () => {
    const h=base("ROOM",[item("bed","Bed","beds",.55,3,1.1,3)]);
    expect(ruleG3009(h).status).toBe("not_applicable");
    expect(buildOperationUseAnalysis(h).zones.length).toBeGreaterThanOrEqual(0);
  });
  it("checks every JSON-explicit operation envelope against the Slab boundary without requiring a Room match", () => {
    const explicit = item("generic","Explicit operation object","custom-storage",4,1,.8,.6,reliableDoor);
    expect(ruleG3044(base("ROOM",[explicit]))).toMatchObject({ status:"pass" });
    const outside = item("outside","Outside operation object","custom-storage",4,5.7,.8,.6,reliableDoor);
    expect(ruleG3044(base("ROOM",[outside]))).toMatchObject({ status:"issue", normalizedObjectIds:["outside"], diagnostics:expect.arrayContaining([expect.objectContaining({ code:"explicit_operation_zone_outside_building_envelope", origin:"source_data" })]) });
    const noSlab=base("ROOM",[explicit]); noSlab.slabs=[];
    expect(ruleG3044(noSlab).status).toBe("unable_to_determine");
  });
  it("does not omit an explicitly-openable Stove from kitchen device operation", () => {
    const stove = item("stove","Stove","stoves",4,1,.8,.6,reliableDoor);
    const blocker = item("blocker","Cabinet","cabinets",4,2.05,1,.7);
    expect(ruleG3029(base("KITCHEN",[blocker],[stove]))).toMatchObject({
      status: "issue",
      normalizedObjectIds: ["stove"],
    });
  });
  it("treats an explicit wardrobe opening as a rigid sweep, not a partially usable area", () => {
    const closet = item("closet", "Closet", "wardrobes", 4, 1, 1.6, .6, reliableDoor);
    const blockingCabinet = item("cabinet", "Kitchen Cabinet", "cabinets", 4, 1.5, 1.6, .7);
    const analysis = buildOperationUseAnalysis(base("BEDROOM", [closet, blockingCabinet]));
    const assessment = analysis.assessments.find((entry) => entry.zone.ownerObjectId === "closet")!;
    expect(assessment.openingBlockedAreaSquareMeters).toBeGreaterThan(0.01);
    expect(assessment.openingUsable).toBe(false);
    expect(ruleG3018(base("BEDROOM", [closet, blockingCabinet]))).toMatchObject({
      status: "issue",
      normalizedObjectIds: ["closet"],
      diagnostics: expect.arrayContaining([
        expect.objectContaining({
          code: "wardrobe_door_operation_blocked",
          normalizedObjectIds: ["closet", "cabinet"],
        }),
      ]),
    });
  });
});
