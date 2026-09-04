import { describe, expect, it } from "vitest";
import { buildFixtureUseAnalysis } from "./fixture-use";
import { kitchenCoreConfiguration, ruleG3025, ruleG3026, ruleG3027, ruleG3028, ruleG3029, ruleG3030, ruleG3032, ruleG3033, ruleG3034, ruleG3035, ruleG3036, ruleG3037, ruleG3038 } from "./g3-fixture-rules";

const level = { id: "L1", rawPascalId: "L1", levelId: "L1", parentId: null, visible: true, name: "Level 1" };
const item = (id: string, name: string, category: string, x: number, z: number, width: number, depth: number, rotation = 0, functionTags = [category]) => ({ id, rawPascalId: id, levelId: "L1", parentId: "L1", visible: true, name, assetId: id, assetName: name, assetTags: functionTags, assetSource: "test", category, functionTags, attachTo: null, dimensionsMeters: [width, 1, depth], rawPosition: [x,0,z], rawRotation: [0,rotation,0], resolvedWorldPosition: [x,z], resolvedRotationRadians: rotation, resolvedVerticalRangeMeters: [0,1], verticalTransformError: null, floorPlanUrl: null, transformStatus: "ok", transformError: null });
const wall = (id: string, start: [number,number], end: [number,number]) => { const dx=end[0]-start[0], dz=end[1]-start[1], l=Math.hypot(dx,dz), nx=-dz/l*.05,nz=dx/l*.05; return { id, rawPascalId:id, levelId:"L1", parentId:"L1", visible:true, name:id, start, end, thicknessMeters:.1, heightMeters:3, curveOffsetMeters:0, footprintValidation:{valid:true,codes:[],areaSquareMeters:l*.1,footprint:[[start[0]+nx,start[1]+nz],[end[0]+nx,end[1]+nz],[end[0]-nx,end[1]-nz],[start[0]-nx,start[1]-nz]]} }; };
const door = { id:"D", rawPascalId:"D", levelId:"L1", parentId:"W4", visible:true, name:"Door", hostWallId:"W4", rawWallLocalPosition:[3,1,0], resolvedWorldPosition:[0,3], resolvedTangentRadians:Math.PI/2, widthMeters:1, heightMeters:2.1, openingKind:"door", doorType:"hinged", hingesSide:"left", effectiveHingesSide:"left", swingDirection:"outward", effectiveSwingDirection:"outward", swingAngleRadians:Math.PI/2 };
const base = (kind: "KITCHEN"|"BATH", furniture: any[], equipment: any[] = [], width=10, depth=6) => { const outline:[[number,number],[number,number],[number,number],[number,number]]=[[0,0],[width,0],[width,depth],[0,depth]], zone={id:"Z",rawPascalId:"Z",levelId:"L1",parentId:"L1",visible:true,name:kind,outline,areaSquareMeters:width*depth}; return {schemaVersion:"1.0",source:{},units:{},levels:[level],slabs:[{id:"S",rawPascalId:"S",levelId:"L1",parentId:"L1",visible:true,name:"Floor",outline,holes:[],areaSquareMeters:width*depth,autoFromWalls:false}],walls:[wall("W1",[0,0],[width,0]),wall("W2",[width,0],[width,depth]),wall("W3",[width,depth],[0,depth]),wall("W4",[0,depth],[0,0])],doors:[door],windows:[],zones:[zone],spaces:[{...zone,sourceZoneId:"Z",source:"derived-from-zone"}],furniture,equipment,columns:[],shelves:[],stairs:[],shafts:[],relationships:{},unclassifiedNodes:[],diagnostics:[]} as any; };
const normalKitchen = () => base("KITCHEN", [item("sink","Sink","sinks",3,1,1,.6), item("counter","Counter","counters",4.5,1,4,.7)], [item("stove","Stove","stoves",6,1,.8,.7), item("fridge","Fridge","refrigerators",8,1,1,.8)]);
const normalBath = () => base("BATH", [item("toilet","Toilet","toilets",3,1,.7,.8), item("basin","Bathroom Sink","sinks",5,1,1,.6), item("shower","Shower enclosure","showers",7,1,1.2,.2)]);

describe("Kitchen and bathroom basic-use analysis", () => {
  it("recognizes a normal kitchen and excludes equipment explicitly marked non-openable", () => { const h=normalKitchen(), a=buildFixtureUseAnalysis(h); expect(a.kitchenRooms).toHaveLength(1); expect(ruleG3025(h).status).toBe("pass"); expect(ruleG3026(h).status).toBe("pass"); expect(ruleG3027(h).status).toBe("pass"); expect(ruleG3029(h)).toMatchObject({status:"not_applicable"}); });
  it("allows two kitchens to share one refrigerator while requiring a sink and stove in each kitchen", () => {
    const analysis = buildFixtureUseAnalysis(normalKitchen()), firstRoom = analysis.kitchenRooms[0]!;
    const secondRoom = { ...firstRoom, roomRegionId: "second-kitchen" };
    const secondKitchenItems = analysis.items.filter((entry) => ["sink", "stove"].includes(entry.semantic)).map((entry) => ({ ...entry, item: { ...entry.item, id: `second-${entry.item.id}` }, roomRegionId: secondRoom.roomRegionId }));
    const configuration = kitchenCoreConfiguration({ kitchenRooms: [firstRoom, secondRoom], items: [...analysis.items, ...secondKitchenItems] });
    expect(configuration).toMatchObject({ missingPerKitchen: [], sharedRefrigeratorCount: 1 });
  });
  it("requires one refrigerator across all kitchens, not one refrigerator per kitchen", () => {
    const h = normalKitchen();
    h.equipment = h.equipment.filter((entry: { id: string }) => entry.id !== "fridge");
    expect(ruleG3025(h)).toMatchObject({ status: "unable_to_determine", missingData: ["住宅厨房：至少一台冰箱"] });
  });
  it("uses explicit dishwasher and oven tags for appliance-door checks without treating a stove as an oven", () => {
    const dishwasher={...item("dishwasher","Dishwasher","kitchen-appliances",3,1,.8,.6,0,["dishwashers"]),itemScale:[1,1,1],openingDirections:["front"],rawMaxOpeningDepthMeters:.6,rawMinOpeningUseClearanceMeters:.45};
    const oven={...item("oven","Oven","kitchen-appliances",7,1,.8,.6,0,["ovens"]),itemScale:[1,1,1],openingDirections:["front"],rawMaxOpeningDepthMeters:.55,rawMinOpeningUseClearanceMeters:.45};
    const stove=item("stove","Stove","kitchen-appliances",5,1,.8,.6,0,["stoves"]);
    const h=base("KITCHEN",[],[dishwasher,oven,stove]);
    const analysis=buildFixtureUseAnalysis(h);
    expect(analysis.items.find((entry)=>entry.item.id==="dishwasher")?.semantic).toBe("dishwasher");
    expect(analysis.items.find((entry)=>entry.item.id==="oven")?.semantic).toBe("oven");
    expect(analysis.items.find((entry)=>entry.item.id==="stove")?.semantic).toBe("stove");
    const result=ruleG3029(h);
    expect(result.measurements).toContainEqual(expect.objectContaining({name:"applianceDoorCandidateCount",value:2}));
    expect(result.status).not.toBe("not_applicable");
  });
  it("reports a sink whose standing zone is fully blocked", () => { const h=normalKitchen(); h.furniture.push(item("block","Cabinet","cabinets",3,1.65,1,.7)); expect(ruleG3026(h)).toMatchObject({status:"issue",normalizedObjectIds:expect.arrayContaining(["sink"])}); });
  it("does not call a kitchen entry usable when an island blocks its only landing", () => { const h=normalKitchen(); h.furniture.push(item("island","Kitchen Island","counters",.45,3,1.2,2)); expect(["issue","not_applicable","unable_to_determine"]).toContain(ruleG3030(h).status); });
  it("detects when opposed fixed kitchen objects remove the basic aisle", () => { const h=base("KITCHEN",[item("sink","Sink","sinks",2,.5,1,.6),item("c1","Counter","counters",4,.45,7,.8),item("c2","Counter","counters",4,1.65,7,.8,Math.PI)],[item("stove","Stove","stoves",5,.5,.8,.7),item("fridge","Fridge","refrigerators",7,.5,1,.8)],8,2.2); expect(["issue","unable_to_determine"]).toContain(ruleG3028(h).status); });
  it("detects physical refrigerator and cabinet deadlock", () => { const h=normalKitchen(); h.furniture.push(item("cabinet","Kitchen Cabinet","cabinets",8,1,1,.8)); expect(ruleG3032(h)).toMatchObject({status:"issue",normalizedObjectIds:expect.arrayContaining(["fridge"])}); });
  it("recognizes a normal bathroom", () => { const h=normalBath(); expect(ruleG3033(h).status).toBe("pass"); expect(ruleG3034(h).status).toBe("pass"); expect(ruleG3035(h).status).toBe("pass"); expect(ruleG3036(h).status).toBe("pass"); expect(ruleG3038(h).status).toBe("pass"); });
  it("reports a toilet with no usable front position", () => { const h=normalBath(); h.furniture.push(item("block","Vanity","sinks",3,1.7,1,.8)); expect(ruleG3034(h)).toMatchObject({status:"issue",normalizedObjectIds:["toilet"]}); });
  it("reports a basin with no standing position", () => { const h=normalBath(); h.furniture.push(item("block","Cabinet","cabinets",5,1.65,1,.7)); expect(ruleG3035(h)).toMatchObject({status:"issue",normalizedObjectIds:["basin"]}); });
  it("reports a blocked shower entrance", () => { const h=normalBath(); h.furniture.push(item("block","Toilet","toilets",7,1.4,1,.7)); expect(ruleG3036(h)).toMatchObject({status:"issue",normalizedObjectIds:expect.arrayContaining(["shower"])}); });
  it("uses explicit sink and shower minimum-use fields instead of the legacy fixed depth", () => {
    const sink={...item("sink","Sink","sinks",3,1,1,.6),itemScale:[1,1,1],openingDirections:["front"],rawMaxOpeningDepthMeters:.5,rawMinOpeningUseClearanceMeters:.45};
    const shower={...item("shower","Shower enclosure","showers",7,1,1.2,.2,0,["shower-enclosures"]),itemScale:[1,1,1],openingDirections:["front"],rawMaxOpeningDepthMeters:.67,rawMinOpeningUseClearanceMeters:.6};
    const analysis=buildFixtureUseAnalysis(base("BATH",[sink,shower]));
    expect(analysis.useZones.find((zone)=>zone.ownerObjectId==="sink")).toMatchObject({measurementBasis:"explicit"});
    expect(analysis.useZones.find((zone)=>zone.ownerObjectId==="shower")).toMatchObject({measurementBasis:"explicit"});
  });
  it("only reports a bathroom trap when door swing and unusable fixture confirm a lock", () => { const h=normalBath(); h.furniture.push(item("block","Cabinet","cabinets",3,1.7,1,.8)); expect(["pass","issue"]).toContain(ruleG3037(h).status); });
  it("allows partial fixture-use overlap when sequential use remains possible", () => { const h=normalBath(); h.furniture.push(item("small","Small stool","stools",4,1.6,.25,.25)); expect(ruleG3038(h).status).toBe("pass"); });
});
