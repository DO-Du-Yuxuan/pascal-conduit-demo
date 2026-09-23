import { describe, expect, it } from "vitest";
import { createBeam, validateBeam } from "./beams";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";
import { commitWorkspaceTransaction, createWorkspace, projectDocument } from "./workspace";
import { parseProject } from "../parser/parse";

const systems = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"];

function project() {
  const nodes: Record<string, any> = {
    site: { id: "site", type: "Site", parentId: null, children: ["building", ...systems, "drawing"] },
    building: { id: "building", type: "Building", parentId: "site", children: ["level"] },
    level: { id: "level", type: "Level", parentId: "building", children: ["wall"] },
    wall: { id: "wall", type: "Wall", parentId: "level", start: [0, 0], end: [2, 0], metadata: { preserve: true } },
    drawing: { id: "drawing", type: "Drawing", parentId: "site", levelId: "level", purpose: "construction-plan", children: [] },
  };
  for (const type of systems) nodes[type] = { id: type, type, parentId: "site", children: [] };
  nodes.ElectricalSystem.children = ["socket", "future"];
  nodes.PlumbingSystem.futureRecords = [{ id: "future-record", kind: "later", payload: { kept: true } }];
  nodes.socket = { id: "socket", type: "OutletPanel", parentId: "ElectricalSystem", deviceType: "socket", name: "插座", position: { position: [0, 1, 0] }, sizeMm: [86, 86, 50], orientation: [0, 0, 1], systems: ["receptacle"], ports: [], createdAt: "now", pluginField: { retain: true } };
  nodes.future = { id: "future", type: "FutureDevice", parentId: "ElectricalSystem", payload: { retain: [1, 2] } };
  return { schemaVersion: "4.0", pascalConduitProjectId: "project-one", rootNodeIds: ["site"], nodes, installedPlugins: [], materials: {}, collections: {}, topExtra: "preserve" };
}

describe("unified project file", () => {
  it("opens and saves one file with the building, electrical content, and unknown future data intact", () => {
    const raw = project();
    const loaded = decodeUnifiedProject(raw, "project.json", "sha");
    expect((loaded.projectRaw.nodes as any).wall.type).toBe("wall");
    expect(loaded.overlay.devices).toMatchObject([{ id: "socket", deviceType: "socket", name: "插座" }]);
    const next = { ...loaded.overlay, devices: loaded.overlay.devices.map((device) => ({ ...device, name: "新插座" })) };
    const exported = encodeUnifiedProject(loaded.projectRaw, next) as any;
    expect(exported.nodes.wall).toEqual(raw.nodes.wall);
    expect(exported.nodes.socket).toMatchObject({ type: "OutletPanel", name: "新插座", pluginField: { retain: true } });
    expect(exported.nodes.future).toEqual(raw.nodes.future);
    expect(exported.nodes.PlumbingSystem.futureRecords).toEqual(raw.nodes.PlumbingSystem.futureRecords);
    expect(exported.topExtra).toBe("preserve");
    expect(decodeUnifiedProject(exported, "saved.json", "sha2").overlay.devices[0].name).toBe("新插座");
  });
});

it("exports an authored Beam under its Level and reads it back after a fresh import", () => {
  const raw = project();
  raw.nodes.level.children.push("ceiling");
  raw.nodes.ceiling = { id: "ceiling", type: "Ceiling", parentId: "level", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] };
  const loaded = decodeUnifiedProject(raw, "project.json", "sha");
  const beam = createBeam(parseProject(loaded.projectRaw).nodes, { id: "beam-new", name: "梁 1", levelId: "level", start: [0, 1], end: [2, 1] }).beam!;
  expect(beam).not.toBeNull();
  const initial = projectDocument(loaded.projectRaw, "project.json", "sha");
  const authored = {
    ...initial,
    raw: {
      ...initial.raw,
      nodes: {
        ...(initial.raw.nodes as Record<string, any>),
        level: { ...(initial.raw.nodes as Record<string, any>).level, children: ["wall", "ceiling", beam.id] },
        [beam.id]: beam,
      },
    },
  };
  const committed = commitWorkspaceTransaction(createWorkspace(initial, loaded.overlay), { project: authored });
  expect(committed.status).toBe("committed");
  if (committed.status !== "committed") return;
  const incomplete = { ...authored.raw, nodes: { ...(authored.raw.nodes as Record<string, any>), level: { ...(authored.raw.nodes as Record<string, any>).level, children: ["wall", "ceiling"] } } };
  expect(() => encodeUnifiedProject(incomplete, loaded.overlay)).toThrow(/未列入所属楼层/);
  const exported = encodeUnifiedProject(committed.state.project!.raw, loaded.overlay);
  expect(exported.nodes[beam.id]).toMatchObject({ type: "Beam", parentId: "level", name: "梁 1" });
  expect(exported.nodes.level.children).toContain(beam.id);
  const reopened = decodeUnifiedProject(JSON.parse(JSON.stringify(exported)), "saved.json", "sha2");
  const reopenedNodes = parseProject(reopened.projectRaw).nodes;
  expect(validateBeam(reopenedNodes[beam.id], reopenedNodes).valid).toBe(true);
  const nextNodes = { ...(committed.state.project!.raw.nodes as Record<string, any>) };
  delete nextNodes[beam.id];
  nextNodes.level = { ...nextNodes.level, children: nextNodes.level.children.filter((id: string) => id !== beam.id) };
  const removed = commitWorkspaceTransaction(committed.state, { project: { ...committed.state.project!, raw: { ...committed.state.project!.raw, nodes: nextNodes } } });
  expect(removed.status).toBe("committed");
  if (removed.status !== "committed") return;
  const withoutBeam = encodeUnifiedProject(removed.state.project!.raw, loaded.overlay);
  expect(withoutBeam.nodes[beam.id]).toBeUndefined();
  expect(withoutBeam.nodes.level.children).not.toContain(beam.id);
});

it("keeps zero drawings on an untouched round trip and creates a stable default only for authored drawing content", () => {
  const raw = project();
  raw.nodes.site.children = raw.nodes.site.children.filter((id: string) => id !== "drawing");
  delete raw.nodes.drawing;
  const loaded = decodeUnifiedProject(raw, "project.json", "sha");
  const untouched = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
  expect(Object.values(untouched.nodes).filter((node: any) => node.type === "Drawing")).toHaveLength(0);
  const edited = { ...loaded.overlay, pointDimensionEvidence: { "socket:position": { levelId: "level", sourceObjectIds: ["socket", "wall"], basis: { kind: "derived" as const, reference: "wall-face", assumptions: ["physical wall face"], confidence: "high" as const } } }, pointPositionDimensionLabelPositions: { "socket:position": .6 } };
  const saved = encodeUnifiedProject(loaded.projectRaw, edited);
  const drawing = saved.nodes["drawing:construction-plan:level"];
  expect(drawing).toMatchObject({ type: "Drawing", parentId: "site", levelId: "level", purpose: "construction-plan" });
  expect(saved.nodes["socket:position"]).toMatchObject({ type: "PointDimension", parentId: drawing.id, sourceObjectIds: ["socket", "wall"], basis: { kind: "derived", confidence: "high" }, layout: { labelPosition: .6 } });
  expect(saved.nodes["socket:position"].valueMeters).toBeUndefined();
  expect(encodeUnifiedProject(decodeUnifiedProject(saved, "saved.json", "sha2").projectRaw, decodeUnifiedProject(saved, "saved.json", "sha2").overlay).nodes["socket:position"]).toEqual(saved.nodes["socket:position"]);
});

it("saves current annotations to the default construction drawing without rewriting another drawing", () => {
  const raw = project();
  raw.nodes.site.children.push("other-drawing");
  raw.nodes["other-drawing"] = { id: "other-drawing", type: "Drawing", parentId: "site", levelId: "level", purpose: "detail", children: ["other-note"] };
  raw.nodes["other-note"] = { id: "other-note", type: "ConstructionAnnotation", parentId: "other-drawing", sourceObjectIds: ["socket"], basis: { kind: "explicit", reference: "survey", assumptions: [], confidence: "high" }, layout: { labelPosition: [1, 2], hidden: false }, plugin: { retained: true } };
  const loaded = decodeUnifiedProject(raw, "project.json", "sha");
  const edited = { ...loaded.overlay, constructionAnnotationEvidence: { "socket:height": { levelId: "level", sourceObjectIds: ["socket"], basis: { kind: "derived" as const, reference: "height", assumptions: ["model datum"], confidence: "limited" as const } } }, constructionAnnotationLabelPositions: { "socket:height": [3, 4] as [number, number] } };
  const saved = encodeUnifiedProject(loaded.projectRaw, edited);
  expect(saved.nodes["other-note"]).toEqual(raw.nodes["other-note"]);
  expect(saved.nodes["socket:height"]).toMatchObject({ parentId: "drawing", sourceObjectIds: ["socket"], layout: { labelPosition: [3, 4] } });
});

it("retains ManualLeader ownership and rejects broken drawing references", () => {
  const raw = project();
  raw.nodes.drawing.children.push("leader");
  raw.nodes.leader = { id: "leader", type: "ManualLeader", parentId: "drawing", sourceObjectIds: ["socket", "wall"], targetId: "socket", levelId: "level", anchor: [0, 0], label: [1, 1], text: "survey", createdAt: "now", plugin: { retained: true } };
  const loaded = decodeUnifiedProject(raw, "project.json", "sha");
  const saved = encodeUnifiedProject(loaded.projectRaw, loaded.overlay);
  expect(saved.nodes.leader).toEqual(raw.nodes.leader);
  const broken = structuredClone(raw);
  broken.nodes.leader.targetId = "missing";
  expect(() => decodeUnifiedProject(broken, "bad.json", "sha")).toThrow(/引用损坏/);
  const wrongParent = structuredClone(raw);
  wrongParent.nodes.drawing.children = [];
  wrongParent.nodes.ElectricalSystem.children.push("leader");
  wrongParent.nodes.leader.parentId = "ElectricalSystem";
  expect(() => decodeUnifiedProject(wrongParent, "bad.json", "sha")).toThrow(/直属 Drawing/);
  const duplicate = structuredClone(raw);
  duplicate.nodes.ElectricalSystem.circuits = [{ id: "socket" }];
  expect(() => decodeUnifiedProject(duplicate, "bad.json", "sha")).toThrow(/重复/);
});

it("keeps a leader in its original non-default drawing and omits a derived dimension after its source is deleted", () => {
  const raw = project();
  raw.nodes.site.children.push("detail");
  raw.nodes.detail = { id: "detail", type: "Drawing", parentId: "site", levelId: "level", purpose: "detail", children: ["leader"] };
  raw.nodes.leader = { id: "leader", type: "ManualLeader", parentId: "detail", sourceObjectIds: ["socket"], targetId: "socket", levelId: "level", anchor: [0, 0], label: [1, 1], text: "note", createdAt: "now" };
  const loaded = decodeUnifiedProject(raw, "project.json", "sha");
  expect(encodeUnifiedProject(loaded.projectRaw, loaded.overlay).nodes.leader.parentId).toBe("detail");
  const withDimension = encodeUnifiedProject(loaded.projectRaw, { ...loaded.overlay, pointDimensionEvidence: { "socket:position": { levelId: "level", sourceObjectIds: ["socket", "wall"], basis: { kind: "derived", reference: "wall-face", assumptions: [], confidence: "high" } } } });
  const reloaded = decodeUnifiedProject(withDimension, "saved.json", "sha2");
  const withoutSocket = { ...reloaded.overlay, devices: [], manualCallouts: [] };
  const saved = encodeUnifiedProject(reloaded.projectRaw, withoutSocket);
  expect(saved.nodes["socket:position"]).toBeUndefined();
  expect(saved.nodes.drawing.children).not.toContain("socket:position");
});

it("rejects invalid structure and legacy files without replacing a caller's data", () => {
  const valid = project();
  expect(() => decodeUnifiedProject({ nodes: valid.nodes }, "old.json", "sha")).toThrow(/4.0/);
  const broken = structuredClone(valid);
  broken.nodes.socket.parentId = "missing";
  expect(() => decodeUnifiedProject(broken, "bad.json", "sha")).toThrow(/parentId/);
  expect(valid.nodes.socket.parentId).toBe("ElectricalSystem");
});

it("rejects 3.0 and each retired public type instead of guessing a 4.0 replacement", () => {
  const legacy = project();
  legacy.schemaVersion = "3.0";
  expect(() => decodeUnifiedProject(legacy, "legacy.json", "sha")).toThrow(/schemaVersion 4.0/);
  for (const type of ["Luminaire", "Sensor", "IndoorUnit", "Thermostat", "AirDuct", "FireWaterInlet", "FireWaterFitting"]) {
    const retired = project();
    retired.nodes.retired = { ...retired.nodes.socket, id: "retired", type, parentId: "ElectricalSystem" };
    retired.nodes.ElectricalSystem.children.push("retired");
    expect(() => decodeUnifiedProject(retired, "retired.json", "sha"), type).toThrow(new RegExp(`已废止类型 ${type}`));
  }
});

it("enforces the approved system owner for each implemented 4.0 entity", () => {
  const raw = project();
  raw.nodes.bad = { ...raw.nodes.socket, id: "bad", type: "RFIDReader", parentId: "ElectricalSystem" };
  raw.nodes.ElectricalSystem.children.push("bad");
  expect(() => decodeUnifiedProject(raw, "wrong-owner.json", "sha")).toThrow(/RFIDReader bad 必须归属 SmartSystem/);
});

it("uses the public device type as the authoritative internal deviceType", () => {
  const conflicting = project();
  conflicting.nodes.spotlight = { ...conflicting.nodes.socket, id: "spotlight", type: "Spotlight", parentId: "LightingSystem", deviceType: "socket", systems: ["lighting"] };
  conflicting.nodes.LightingSystem.children.push("spotlight");
  expect(() => decodeUnifiedProject(conflicting, "conflicting-device.json", "sha")).toThrow(/Spotlight spotlight 的 deviceType 必须为 luminaire/);

  const omitted = project();
  omitted.nodes.spotlight = { ...omitted.nodes.socket, id: "spotlight", type: "Spotlight", parentId: "LightingSystem", systems: ["lighting"] };
  delete omitted.nodes.spotlight.deviceType;
  omitted.nodes.LightingSystem.children.push("spotlight");
  expect(decodeUnifiedProject(omitted, "fixed-device.json", "sha").overlay.devices.find((device) => device.id === "spotlight")?.deviceType).toBe("luminaire");
});

it("accepts RFID readers only on walls and Beam side faces", () => {
  const rfid = (surface: string, hostKind: "wall" | "beam") => ({
    id: "rfid",
    type: "RFIDReader",
    parentId: "SmartSystem",
    deviceType: "rfid-reader",
    name: "RFID 读写器",
    position: { position: [0, 1, 0], attachment: { hostId: `${hostKind}-1`, hostKind, surface, normal: [0, 0, 1], levelId: "level" } },
    sizeMm: [86, 130, 25],
    orientation: [0, 0, 1],
    systems: [],
    ports: [],
    createdAt: "now",
  });
  const allowed = project();
  allowed.nodes.rfid = rfid("side-a", "beam");
  allowed.nodes.SmartSystem.children.push("rfid");
  expect(() => decodeUnifiedProject(allowed, "rfid-side.json", "sha")).not.toThrow();
  for (const surface of ["top", "bottom"]) {
    const rejected = project();
    rejected.nodes.rfid = rfid(surface, "beam");
    rejected.nodes.SmartSystem.children.push("rfid");
    expect(() => decodeUnifiedProject(rejected, "rfid-beam.json", "sha"), surface).toThrow(/RFIDReader rfid 只允许安装在墙面或梁侧面/);
  }
});

it("rejects route and fitting discriminators that conflict with their public owner or type", () => {
  const route = (type: string, parentId: string, system: string, extra: Record<string, unknown> = {}) => ({
    id: "route",
    type,
    parentId,
    system,
    diameterMm: 20,
    start: { position: [0, 0, 0] },
    end: { position: [1, 0, 0] },
    position: { position: [0, 0, 0] },
    segmentIds: [],
    ports: [],
    createdAt: "now",
    ...extra,
  });
  const cases: Array<{ node: Record<string, any>; parent: string; error: RegExp }> = [
    { node: route("Conduit", "ElectricalSystem", "lighting"), parent: "ElectricalSystem", error: /Conduit route 的 system 与 ElectricalSystem 不一致/ },
    { node: route("Conduit", "LightingSystem", "network"), parent: "LightingSystem", error: /Conduit route 的 system 与 LightingSystem 不一致/ },
    { node: route("FireWaterPipe", "FireProtectionSystem", "network"), parent: "FireProtectionSystem", error: /FireWaterPipe route 的 system 与 FireProtectionSystem 不一致/ },
    { node: route("ConduitConnector", "ElectricalSystem", "receptacle", { fitting: "tee" }), parent: "ElectricalSystem", error: /ConduitConnector route 的 fitting 必须为 coupling/ },
    { node: route("FireWaterPipeElbow", "FireProtectionSystem", "sprinkler", { fitting: "tee" }), parent: "FireProtectionSystem", error: /FireWaterPipeElbow route 的 fitting 必须为 elbow/ },
    { node: route("JunctionBox", "LightingSystem", "network"), parent: "LightingSystem", error: /JunctionBox route 的 system 与 LightingSystem 不一致/ },
  ];
  for (const { node, parent, error } of cases) {
    const raw = project();
    raw.nodes.route = node;
    raw.nodes[parent].children.push("route");
    expect(() => decodeUnifiedProject(raw, "bad-route.json", "sha"), node.type).toThrow(error);
  }
});

it("accepts route authoring only under ElectricalSystem or LightingSystem", () => {
  for (const type of ["Conduit", "JunctionBox", "ConduitConnector", "ConduitTee", "ConduitElbow"]) {
    const raw = project();
    raw.nodes.bad = { ...raw.nodes.socket, id: "bad", type, parentId: "FireProtectionSystem" };
    raw.nodes.FireProtectionSystem.children.push("bad");
    expect(() => decodeUnifiedProject(raw, "wrong-owner.json", "sha"), type).toThrow(new RegExp(`${type} bad 必须归属 ElectricalSystem 或 LightingSystem`));
  }
});

it("rejects Circuit fields on FireWaterPipe", () => {
  const forbiddenFields: Array<[string, unknown]> = [["circuitId", "circuit-1"], ["legacyUnrooted", true]];
  for (const [field, value] of forbiddenFields) {
    const raw = project();
    raw.nodes.firePipe = {
      id: "firePipe",
      type: "FireWaterPipe",
      parentId: "FireProtectionSystem",
      system: "sprinkler",
      start: { position: [0, 0, 0] },
      end: { position: [1, 0, 0] },
      diameterMm: 50,
      createdAt: "now",
      [field]: value,
    };
    raw.nodes.FireProtectionSystem.children.push("firePipe");
    expect(() => decodeUnifiedProject(raw, "fire-circuit.json", "sha"), field).toThrow(new RegExp(`FireWaterPipe firePipe 不支持 ${field}`));
  }
});

it("rejects misplaced known containers while allowing an unknown future node", () => {
  const cases = ["Site", "Building", "ElectricalSystem", "Drawing"];
  for (const type of cases) {
    const broken = project();
    const id = `nested-${type}`;
    broken.nodes.level.children.push(id);
    broken.nodes[id] = { id, type, parentId: "level", children: [], ...(type === "Drawing" ? { levelId: "level", purpose: "detail" } : {}) };
    expect(() => decodeUnifiedProject(broken, "bad.json", "sha"), type).toThrow(/Site|Drawing/);
  }
  const valid = project();
  valid.nodes.level.children.push("future-inspection");
  valid.nodes["future-inspection"] = { id: "future-inspection", type: "FutureInspection", parentId: "level", payload: { preserve: true } };
  expect(encodeUnifiedProject(decodeUnifiedProject(valid, "future.json", "sha").projectRaw, decodeUnifiedProject(valid, "future.json", "sha").overlay).nodes["future-inspection"]).toEqual(valid.nodes["future-inspection"]);
});

it("rejects malformed ConstructionAnnotation basis", () => {
  const valid = project();
  valid.nodes.drawing.children.push("annotation");
  valid.nodes.annotation = { id: "annotation", type: "ConstructionAnnotation", parentId: "drawing", sourceObjectIds: ["socket"], basis: { kind: "derived", reference: "height", assumptions: [], confidence: "limited" }, layout: { labelPosition: [1, 2] } };
  for (const basis of [undefined, { ...valid.nodes.annotation.basis, kind: "estimated" }, { ...valid.nodes.annotation.basis, assumptions: "guess" }, { ...valid.nodes.annotation.basis, confidence: "certain" }]) {
    const broken = structuredClone(valid);
    broken.nodes.annotation.basis = basis;
    expect(() => decodeUnifiedProject(broken, "bad.json", "sha")).toThrow(/测量依据/);
  }
  expect(() => decodeUnifiedProject(valid, "valid.json", "sha")).not.toThrow();
});

it("preserves unknown fields inside authored relationship and construction arrays by stable ID", () => {
  const raw = project();
  const point = { position: [0, 0, 0] };
  raw.nodes.level.installationReferencePlanes = [{ id: "install-plane", levelId: "level", elevationMm: 2700, basis: "finished-floor", plugin: { source: "survey" } }];
  raw.nodes.level.layoutReferencePlanes = [{ id: "layout-plane", levelId: "level", visible: true, elevationMm: 2700, basis: "explicit", plugin: { owner: "future" } }];
  raw.nodes.ElectricalSystem.circuits = [
    { id: "c1", system: "receptacle", sourceDeviceId: "socket", rootPortId: null, segmentIds: [], status: "rooted", createdAt: "now", plugin: { first: true } },
    { id: "c2", system: "receptacle", sourceDeviceId: "socket", rootPortId: null, segmentIds: [], status: "rooted", createdAt: "now", plugin: { second: true } },
  ];
  raw.nodes.ElectricalSystem.surfaceChases = [{ id: "chase", type: "surface-chase", hostId: "wall", hostKind: "wall", surfaceNormal: [0, 1, 0], routeElementId: "route", path: { kind: "line", start: point, end: { position: [1, 0, 0] }, plugin: { path: true } }, widthMm: 30, depthMm: 25, plugin: { chase: true } }];
  raw.nodes.LightingSystem.penetrations = [{ id: "penetration", type: "penetration", hostId: "wall", hostKind: "wall", segmentId: "lighting-route", entry: point, exit: { position: [0, 0, 1] }, direction: [0, 0, 1], diameterMm: 30, plugin: { penetration: true } }];
  raw.nodes.LightingSystem.children.push("switch", "light");
  raw.nodes.switch = { ...structuredClone(raw.nodes.socket), id: "switch", type: "SwitchPanel", parentId: "LightingSystem", deviceType: "switch", systems: ["lighting"] };
  raw.nodes.light = { ...structuredClone(raw.nodes.socket), id: "light", type: "Spotlight", parentId: "LightingSystem", deviceType: "luminaire", systems: ["lighting"] };
  raw.nodes.LightingSystem.lightingControlGroups = [{ id: "control", switchDeviceId: "switch", luminaireDeviceIds: ["light"], createdAt: "now", plugin: { scene: "A" } }];
  raw.nodes.HVACSystem.controls = [{ id: "hvac-control", thermostatId: "thermostat", indoorUnitId: "indoor", createdAt: "now", plugin: { protocol: "future" } }];
  raw.nodes.HVACSystem.wallPenetrations = [{ id: "hvac-hole", type: "hvac-wall-penetration", wallId: "wall", segmentId: "duct-segment", entry: point, exit: { position: [0, 0, 1] }, openingMm: [1050, 350], createdAt: "now", plugin: { approval: "pending" } }];
  const loaded = decodeUnifiedProject(raw, "project.json", "sha");
  const changed = {
    ...loaded.overlay,
    circuits: loaded.overlay.circuits.map((item) => item.id === "c1" ? { ...item, status: "broken" as const } : item).reverse(),
  };
  const saved = encodeUnifiedProject(loaded.projectRaw, changed) as any;
  expect(saved.nodes.ElectricalSystem.circuits.map((item: any) => item.id)).toEqual(["c2", "c1"]);
  expect(saved.nodes.ElectricalSystem.circuits[0].plugin).toEqual({ second: true });
  expect(saved.nodes.ElectricalSystem.circuits[1]).toMatchObject({ status: "broken", plugin: { first: true } });
  expect(saved.nodes.ElectricalSystem.surfaceChases[0]).toMatchObject({ plugin: { chase: true }, path: { plugin: { path: true } } });
  expect(saved.nodes.LightingSystem.penetrations[0].plugin).toEqual({ penetration: true });
  expect(saved.nodes.LightingSystem.lightingControlGroups[0].plugin).toEqual({ scene: "A" });
  expect(saved.nodes.HVACSystem.controls[0].plugin).toEqual({ protocol: "future" });
  expect(saved.nodes.HVACSystem.wallPenetrations[0].plugin).toEqual({ approval: "pending" });
  expect(saved.nodes.level.installationReferencePlanes[0]).toMatchObject({ id: "install-plane", plugin: { source: "survey" } });
  expect(saved.nodes.level.layoutReferencePlanes[0]).toMatchObject({ id: "layout-plane", plugin: { owner: "future" } });
  expect(decodeUnifiedProject(saved, "saved.json", "sha2").overlay.circuits).toHaveLength(2);
});
