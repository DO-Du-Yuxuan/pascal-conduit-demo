import { createEmptyOverlay, parseOverlay, type ConduitOverlayDocument, type RoutingSystem } from "./overlay";
import { createHvacThermostatPort, ensureHvacThermostatPort, ensureHvacUnitPorts } from "./hvac";

type Node = Record<string, any> & { id: string; type: string; parentId?: string | null; children?: string[] };
type Project = Record<string, any> & { nodes: Record<string, Node> };
const SYSTEM_TYPES = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"] as const;
const BUILDING_TYPES = ["Site", "Building", "Level", "Wall", "Door", "Window", "Item", "Shelf", "Slab", "Ceiling", "Column", "Fence", "Beam", "Roof", "RoofSegment", "Stair", "StairSegment", "Guide", "Spawn", "Zone", "Elevator"];
const BUILDING_SET = new Set(BUILDING_TYPES);
const DEVICE_TYPES: Record<string, string> = {
  StrongCurrentBox: "strong-panel",
  WeakCurrentBox: "weak-panel",
  OutletPanel: "socket",
  NetworkOutlet: "network-outlet",
  SwitchPanel: "switch",
  Spotlight: "luminaire",
  LightingJunctionBox: "luminaire",
  SprinklerHead: "sprinkler-head",
  SmokeDetector: "smoke-detector",
  TemperatureHumiditySensor: "sensor",
  RFIDReader: "rfid-reader",
};
const DEVICE_EXTERNAL: Record<string, string> = { ...Object.fromEntries(Object.entries(DEVICE_TYPES).map(([type, kind]) => [kind, type])), luminaire: "LightingJunctionBox" };
const FITTING_TYPES: Record<string, string> = {
  ConduitConnector: "coupling",
  ConduitTee: "tee",
  ConduitElbow: "elbow",
  FireWaterPipeConnector: "coupling",
  FireWaterPipeTee: "tee",
  FireWaterPipeElbow: "elbow",
  FireSignalConduitConnector: "coupling",
  FireSignalConduitElbow: "elbow",
};
const ELECTRICAL_OR_LIGHTING_SYSTEMS = new Set(["ElectricalSystem", "LightingSystem"]);
const ELECTRICAL_OR_LIGHTING_ROUTE_TYPES = new Set(["Conduit", "JunctionBox", "ConduitConnector", "ConduitTee", "ConduitElbow"]);
const CONDUIT_FITTING_TYPES = new Set(["ConduitConnector", "ConduitTee", "ConduitElbow"]);
const FIRE_WATER_FITTING_TYPES = new Set(["FireWaterPipeConnector", "FireWaterPipeTee", "FireWaterPipeElbow"]);
const FIRE_SIGNAL_FITTING_TYPES = new Set(["FireSignalConduitConnector", "FireSignalConduitElbow"]);
const FIRE_SIGNAL_TYPES = new Set(["FireSignalConduit", ...FIRE_SIGNAL_FITTING_TYPES]);
const ROUTING_SYSTEMS_BY_PARENT: Record<string, string[]> = {
  ElectricalSystem: ["receptacle", "network"],
  LightingSystem: ["lighting"],
  FireProtectionSystem: ["sprinkler", "fire-signal"],
};
const AUTHORING_TYPE_PARENTS: Record<string, string> = {
  StrongCurrentBox: "ElectricalSystem",
  WeakCurrentBox: "ElectricalSystem",
  OutletPanel: "ElectricalSystem",
  NetworkOutlet: "ElectricalSystem",
  SwitchPanel: "LightingSystem",
  Spotlight: "LightingSystem",
  LightingJunctionBox: "LightingSystem",
  SprinklerHead: "FireProtectionSystem",
  SmokeDetector: "FireProtectionSystem",
  FireWaterPipe: "FireProtectionSystem",
  FireWaterPipeConnector: "FireProtectionSystem",
  FireWaterPipeTee: "FireProtectionSystem",
  FireWaterPipeElbow: "FireProtectionSystem",
  FireSignalConduit: "FireProtectionSystem",
  FireSignalConduitConnector: "FireProtectionSystem",
  FireSignalConduitElbow: "FireProtectionSystem",
  FanCoilUnit: "HVACSystem",
  FCUThermostat: "HVACSystem",
  HVACControlConduit: "HVACSystem",
  TemperatureHumiditySensor: "HVACSystem",
  GalvanizedSheetMetalDuct: "HVACSystem",
  AirOutlet: "HVACSystem",
  RFIDReader: "SmartSystem",
};
const RETIRED_PUBLIC_TYPES = new Set(["Luminaire", "Sensor", "IndoorUnit", "Thermostat", "AirDuct", "FireWaterInlet", "FireWaterFitting"]);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const copy = <T>(value: T): T => structuredClone(value);
const stableArrayKeys = (value: any): string[] => !record(value) ? [] : [typeof value.id === "string" ? `id:${value.id}` : null, typeof value.levelId === "string" ? `level:${value.levelId}` : null].filter((key): key is string => key !== null);
const mergeFields = (oldValue: any, nextValue: any): any => {
  if (Array.isArray(nextValue)) {
    if (!Array.isArray(oldValue)) return copy(nextValue);
    const oldById = new Map<string, any>();
    for (const value of oldValue) for (const key of stableArrayKeys(value)) oldById.set(key, value);
    return nextValue.map((value: any, index: number) => { const keys = stableArrayKeys(value); const old = keys.map((key) => oldById.get(key)).find(Boolean); return mergeFields(old ?? (keys.length ? undefined : oldValue[index]), value); });
  }
  if (record(nextValue)) {
    const merged = record(oldValue) ? copy(oldValue) : {};
    for (const [key, value] of Object.entries(nextValue)) merged[key] = mergeFields(merged[key], value);
    return merged;
  }
  return copy(nextValue);
};
const systemFor = (system: string) => system === "lighting" ? "LightingSystem" : system === "sprinkler" || system === "fire-signal" ? "FireProtectionSystem" : "ElectricalSystem";
const routingSystem = (node: Node, parentType: string): RoutingSystem => node.system === "lighting" || node.system === "network" || node.system === "sprinkler" || node.system === "fire-signal" ? node.system : parentType === "LightingSystem" ? "lighting" : parentType === "FireProtectionSystem" ? "sprinkler" : "receptacle";
const hasAllowedSystem = (node: Node, parentType: string) => !("system" in node) || ROUTING_SYSTEMS_BY_PARENT[parentType]?.includes(node.system);
const rfidAttachment = (node: Node) => record(node.position?.attachment)
  ? node.position.attachment
  : record(node.mount) && node.mount.kind === "host" && record(node.mount.attachment)
    ? node.mount.attachment
    : undefined;
const asInternal = (node: Node, type: string) => ({ ...copy(node), type });
const defaultDrawing = (drawings: Node[], levelId: string) => drawings.filter((drawing) => drawing.levelId === levelId && drawing.purpose === "construction-plan").sort((a, b) => a.id.localeCompare(b.id))[0];

/** Validate the public 4.0 tree before it can replace a live workspace. */
export function validateUnifiedProject(raw: unknown): asserts raw is Project {
  if (!record(raw) || raw.schemaVersion !== "4.0") throw new Error("项目格式必须为 schemaVersion 4.0；3.0 及更早项目不支持导入。");
  if (!record(raw.nodes) || !Array.isArray(raw.rootNodeIds) || raw.rootNodeIds.length !== 1) throw new Error("项目必须有 nodes 和唯一 Site 根节点。");
  if (typeof raw.pascalConduitProjectId !== "string" || !raw.pascalConduitProjectId.trim()) throw new Error("项目缺少稳定的 pascalConduitProjectId。");
  const nodes = raw.nodes as Record<string, Node>, root = raw.rootNodeIds[0];
  if (!record(nodes[root]) || nodes[root].type !== "Site" || nodes[root].parentId !== null) throw new Error("根节点必须是 parentId 为 null 的 Site。");
  const ids = new Set<string>();
  for (const [id, node] of Object.entries(nodes)) {
    if (!record(node) || node.id !== id || typeof node.type !== "string") throw new Error(`节点 ${id} 的键、id 或 type 无效。`);
    if (ids.has(id)) throw new Error(`重复节点 ID：${id}`);
    ids.add(id);
    if (id !== root && (typeof node.parentId !== "string" || !nodes[node.parentId])) throw new Error(`节点 ${id} 的 parentId 不存在。`);
    if (node.children !== undefined && (!Array.isArray(node.children) || node.children.some((child) => typeof child !== "string"))) throw new Error(`节点 ${id} 的 children 无效。`);
    if (RETIRED_PUBLIC_TYPES.has(node.type)) throw new Error(`节点 ${id} 使用已废止类型 ${node.type}；4.0 项目必须使用具体实体类型。`);
  }
  for (const [id, node] of Object.entries(nodes)) {
    if (id !== root && !(nodes[node.parentId!].children ?? []).includes(id)) throw new Error(`节点 ${id} 未列入父节点 children。`);
    for (const child of node.children ?? []) if (!nodes[child] || nodes[child].parentId !== id) throw new Error(`节点 ${id} 的 children 与 parentId 不一致：${child}`);
    if (node.children && new Set(node.children).size !== node.children.length) throw new Error(`节点 ${id} 的 children 有重复 ID。`);
  }
  const direct = (nodes[root].children ?? []).map((id) => nodes[id]);
  if (direct.filter((node) => node.type === "Building").length !== 1) throw new Error("Site 下必须有且仅有一个 Building。");
  for (const type of SYSTEM_TYPES) if (direct.filter((node) => node.type === type).length !== 1) throw new Error(`Site 下必须有且仅有一个 ${type}。`);
  for (const node of Object.values(nodes)) {
    if (node.type === "Site" && node.id !== root) throw new Error(`额外 Site 节点不允许：${node.id}`);
    if ((node.type === "Building" || SYSTEM_TYPES.includes(node.type as typeof SYSTEM_TYPES[number])) && node.parentId !== root) throw new Error(`${node.type} ${node.id} 必须直属 Site。`);
    const parentType = nodes[node.parentId ?? ""]?.type;
    const expectedParent = AUTHORING_TYPE_PARENTS[node.type];
    if (expectedParent && parentType !== expectedParent) throw new Error(`${node.type} ${node.id} 必须归属 ${expectedParent}。`);
    if (ELECTRICAL_OR_LIGHTING_ROUTE_TYPES.has(node.type) && !ELECTRICAL_OR_LIGHTING_SYSTEMS.has(parentType ?? "")) throw new Error(`${node.type} ${node.id} 必须归属 ElectricalSystem 或 LightingSystem。`);
    const expectedDeviceType = DEVICE_TYPES[node.type];
    if (expectedDeviceType && "deviceType" in node && node.deviceType !== expectedDeviceType) throw new Error(`${node.type} ${node.id} 的 deviceType 必须为 ${expectedDeviceType}。`);
    if (node.type === "RFIDReader") {
      const attachment = rfidAttachment(node);
      if (!attachment || attachment.hostKind !== "wall" && (attachment.hostKind !== "beam" || !attachment.surface || ["top", "bottom"].includes(attachment.surface))) throw new Error(`RFIDReader ${node.id} 只允许安装在墙面或梁侧面。`);
    }
    if ((node.type === "Conduit" || node.type === "FireWaterPipe" || FIRE_SIGNAL_TYPES.has(node.type) || node.type === "JunctionBox" || FITTING_TYPES[node.type]) && !hasAllowedSystem(node, parentType ?? "")) throw new Error(`${node.type} ${node.id} 的 system 与 ${parentType} 不一致。`);
    if (FIRE_SIGNAL_TYPES.has(node.type) && node.system !== "fire-signal") throw new Error(`${node.type} ${node.id} 的 system 必须为 fire-signal。`);
    if (FITTING_TYPES[node.type] && "fitting" in node && node.fitting !== FITTING_TYPES[node.type]) throw new Error(`${node.type} ${node.id} 的 fitting 必须为 ${FITTING_TYPES[node.type]}。`);
    if (node.type === "FireProtectionSystem" && Array.isArray(node.circuits) && node.circuits.length) throw new Error("FireProtectionSystem 不支持 Circuit；消防管从自由起点或开放管端绘制。");
    if (node.type === "FireWaterPipe" && "circuitId" in node) throw new Error(`FireWaterPipe ${node.id} 不支持 circuitId；消防管不使用 Circuit。`);
    if (node.type === "FireWaterPipe" && "legacyUnrooted" in node) throw new Error(`FireWaterPipe ${node.id} 不支持 legacyUnrooted；消防管不使用 Circuit。`);
    if (node.type === "FireSignalConduit" && ("circuitId" in node || "legacyUnrooted" in node)) throw new Error(`FireSignalConduit ${node.id} 不支持 Circuit 字段。`);
    if (node.type === "FireSignalConduit" && node.endTermination !== undefined && (node.endTermination !== "wall" || node.endPortId || node.end?.attachment?.hostKind !== "wall")) throw new Error(`FireSignalConduit ${node.id} 的墙面终止必须位于无端口的墙面末端。`);
    if (node.type === "HVACControlConduit") {
      if (parentType !== "HVACSystem" || node.system !== "control" || typeof node.thermostatId !== "string" || typeof node.thermostatPortId !== "string" || typeof node.indoorUnitId !== "string" || typeof node.indoorUnitPortId !== "string" || !Array.isArray(node.segmentIds) || !node.segmentIds.length || !Array.isArray(node.segments) || node.segments.length !== node.segmentIds.length || !Array.isArray(node.fittingIds) || !Array.isArray(node.fittings) || node.fittings.length !== node.fittingIds.length || !Number.isFinite(node.diameterMm) || node.diameterMm <= 0) throw new Error(`HVACControlConduit ${node.id} 缺少有效系统、端口或管段数据。`);
      if (node.segments.some((segment: any, index: number) => !record(segment) || typeof segment.id !== "string" || segment.id !== node.segmentIds[index] || !record(segment.start) || !Array.isArray(segment.start.position) || !record(segment.end) || !Array.isArray(segment.end.position))) throw new Error(`HVACControlConduit ${node.id} 的 segmentIds 与嵌套管段不一致。`);
      if (node.fittings.some((fitting: any, index: number) => !record(fitting) || typeof fitting.id !== "string" || fitting.id !== node.fittingIds[index] || fitting.type !== "hvac-control-fitting" || fitting.system !== "control" || !Array.isArray(fitting.segmentIds) || fitting.segmentIds.some((id: string) => !node.segmentIds.includes(id)))) throw new Error(`HVACControlConduit ${node.id} 的 fittingIds 与弯头数据不一致。`);
    }
  }
  const publicPorts = new Map<string, { port: Record<string, any>; ownerNode: Node }>();
  for (const ownerNode of Object.values(nodes)) for (const port of ownerNode.ports ?? []) if (record(port) && typeof port.id === "string") publicPorts.set(port.id, { port, ownerNode });
  for (const node of Object.values(nodes).filter((item) => item.type === "SmokeDetector")) {
    if (node.systems?.length !== 1 || node.systems[0] !== "fire-signal" || !Array.isArray(node.ports) || node.ports.length !== 4 || node.ports.some((port: any) => port.system !== "fire-signal" || port.role !== "bidirectional")) throw new Error(`SmokeDetector ${node.id} 必须有四个消防信号双向端口。`);
  }
  for (const node of Object.values(nodes).filter((item) => item.type === "FireSignalConduit")) {
    for (const field of ["startPortId", "endPortId"] as const) {
      const id = node[field];
      if (!id) continue;
      const reference = publicPorts.get(id), port = reference?.port;
      if (!reference || !port || port.system !== "fire-signal" || !port.connectedSegmentIds?.includes(node.id) || port.owner?.kind === "device" && reference.ownerNode.type !== "SmokeDetector") throw new Error(`FireSignalConduit ${node.id} 的 ${field} 必须引用已连接的消防信号端口。`);
    }
  }
  const referencedIds = new Set(Object.keys(nodes));
  for (const node of Object.values(nodes)) {
    for (const field of ["segments", "fittings", "ports", "circuits", "surfaceChases", "penetrations", "controls", "wallPenetrations", "installationReferencePlanes", "layoutReferencePlanes"]) {
      if (!Array.isArray(node[field])) continue;
      for (const item of node[field]) if (record(item) && typeof item.id === "string") {
        if (referencedIds.has(item.id)) throw new Error(`重复节点或内嵌对象 ID：${item.id}`);
        referencedIds.add(item.id);
      }
    }
  }
  for (const node of Object.values(nodes).filter((item) => item.type === "HVACControlConduit")) {
    const thermostat = nodes[node.thermostatId], unit = nodes[node.indoorUnitId];
    if (thermostat?.type !== "FCUThermostat" || unit?.type !== "FanCoilUnit") throw new Error(`HVACControlConduit ${node.id} 必须从 FCUThermostat 连接到 FanCoilUnit。`);
    const source = thermostat.ports?.find((port: any) => port.id === node.thermostatPortId), target = unit.ports?.find((port: any) => port.id === node.indoorUnitPortId);
    if (source?.system !== "hvac-control" || source.role !== "source" || target?.system !== "hvac-control" || target.role !== "sink") throw new Error(`HVACControlConduit ${node.id} 的控制端口引用无效。`);
    const firstSegment = node.segments[0], lastSegment = node.segments[node.segments.length - 1];
    if (!source.connectedSegmentIds?.includes(firstSegment.id) || !target.connectedSegmentIds?.includes(lastSegment.id)) throw new Error(`HVACControlConduit ${node.id} 未在端口记录连接管段。`);
  }
  const controlOwners = new Set<string>();
  for (const node of Object.values(nodes).filter((item) => item.type === "HVACControlConduit")) for (const key of [`thermostat:${node.thermostatId}`, `fcu:${node.indoorUnitId}`]) {
    if (controlOwners.has(key)) throw new Error(`HVAC 控制管违反一对一端口容量：${key}`);
    controlOwners.add(key);
  }
  for (const node of Object.values(nodes).filter((item) => item.type === "Conduit")) {
    const unit = Object.values(nodes).find((candidate) => candidate.type === "FanCoilUnit" && candidate.ports?.some((port: any) => port.id === node.endPortId));
    if (unit) {
      const port = unit.ports.find((candidate: any) => candidate.id === node.endPortId);
      if (node.system !== "receptacle" || port.system !== "receptacle" || port.role !== "sink" || !Array.isArray(port.connectedSegmentIds) || port.connectedSegmentIds.length !== 1 || !port.connectedSegmentIds.includes(node.id)) throw new Error(`Conduit ${node.id} 与 FCU 电源端口的系统或连接引用无效。`);
    }
  }
  for (const node of Object.values(nodes)) {
    if (node.type === "Drawing") {
      if (node.parentId !== root || typeof node.levelId !== "string" || nodes[node.levelId]?.type !== "Level" || typeof node.purpose !== "string" || !node.purpose.trim()) throw new Error(`Drawing ${node.id} 缺少有效 levelId、purpose 或 Site 父节点。`);
    }
    if (["PointDimension", "ConstructionAnnotation", "ManualLeader"].includes(node.type)) {
      const drawing = nodes[node.parentId ?? ""];
      if (drawing?.type !== "Drawing") throw new Error(`${node.type} ${node.id} 必须直属 Drawing。`);
      if (!Array.isArray(node.sourceObjectIds) || !node.sourceObjectIds.length || node.sourceObjectIds.some((id: unknown) => typeof id !== "string" || !referencedIds.has(id))) throw new Error(`${node.type} ${node.id} 的 sourceObjectIds 引用损坏。`);
      if (node.type === "ManualLeader" && (node.levelId !== drawing.levelId || typeof node.targetId !== "string" || !referencedIds.has(node.targetId) || !node.sourceObjectIds.includes(node.targetId))) throw new Error(`ManualLeader ${node.id} 的 targetId 或 levelId 引用损坏。`);
      if (["PointDimension", "ConstructionAnnotation"].includes(node.type) && (!record(node.basis) || !["explicit", "derived"].includes(node.basis.kind) || typeof node.basis.reference !== "string" || !node.basis.reference.trim() || !Array.isArray(node.basis.assumptions) || node.basis.assumptions.some((item: unknown) => typeof item !== "string") || !["high", "limited", "unknown"].includes(node.basis.confidence))) throw new Error(`${node.type} ${node.id} 缺少有效测量依据。`);
    }
  }
  const visited = new Set<string>();
  const walk = (id: string) => { if (visited.has(id)) throw new Error(`节点树存在循环：${id}`); visited.add(id); for (const child of nodes[id].children ?? []) walk(child); };
  walk(root);
  if (visited.size !== Object.keys(nodes).length) throw new Error("nodes 中存在不属于 Site 树的节点。");
}

export function decodeUnifiedProject(raw: unknown, fileName: string, sha256: string): { projectRaw: Project; overlay: ConduitOverlayDocument } {
  validateUnifiedProject(raw);
  const source = copy(raw), nodes = source.nodes, buildingNodes: Record<string, Node> = {};
  const overlay = createEmptyOverlay(fileName, sha256, source.pascalConduitProjectId);
  const containers = Object.values(nodes).filter((node) => SYSTEM_TYPES.includes(node.type as typeof SYSTEM_TYPES[number]));
  const containerById = Object.fromEntries(containers.map((node) => [node.id, node]));
  const buildingId = Object.values(nodes).find((node) => node.type === "Building")!.id;
  const buildingDescendants = new Set<string>();
  const collect = (id: string) => { buildingDescendants.add(id); for (const child of nodes[id].children ?? []) collect(child); };
  collect(buildingId);
  const site = nodes[source.rootNodeIds[0]];
  buildingNodes[site.id] = { ...copy(site), type: "site", children: [buildingId] };
  for (const id of buildingDescendants) buildingNodes[id] = { ...copy(nodes[id]), type: BUILDING_SET.has(nodes[id].type) ? nodes[id].type.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase() : nodes[id].type };
  const drawingNodes = Object.values(nodes).filter((node) => node.type === "Drawing");
  const activeDrawingIds = new Set(drawingNodes.filter((drawing) => defaultDrawing(drawingNodes, drawing.levelId)?.id === drawing.id).map((drawing) => drawing.id));
  for (const container of containers) {
    // Spotlight is a legacy public alias for the same four-port lighting junction box.
    // Lighting control groups are intentionally discarded: control is expressed by routed conduit.
    if (container.type === "HVACSystem") overlay.hvac.wallPenetrations = copy(container.wallPenetrations ?? []);
    if (["ElectricalSystem", "LightingSystem", "FireProtectionSystem"].includes(container.type)) {
      if (["ElectricalSystem", "LightingSystem"].includes(container.type)) {
        for (const item of container.circuits ?? []) overlay.circuits.push(copy(item));
      }
      for (const item of container.surfaceChases ?? []) overlay.surfaceChases.push(copy(item));
      for (const item of container.penetrations ?? []) overlay.penetrations.push(copy(item));
    }
  }
  if (record(site.settings)) {
    if (record(site.settings.colors)) overlay.settings.colors = { ...overlay.settings.colors, ...site.settings.colors };
    if (record(site.settings.visibleSystems)) overlay.settings.visibleSystems = { ...overlay.settings.visibleSystems, ...site.settings.visibleSystems };
    if (typeof site.settings.sensorVisible === "boolean") overlay.settings.sensorVisible = site.settings.sensorVisible;
    if (typeof site.settings.hvacVisible === "boolean") overlay.hvac.visible = site.settings.hvacVisible;
  }
  const electrical = containers.find((node) => node.type === "ElectricalSystem");
  if (record(electrical?.settings)) overlay.settings = { ...overlay.settings, ...copy(electrical.settings) };
  for (const id of buildingDescendants) if (nodes[id].type === "Level") {
    overlay.installationReferencePlanes.push(...copy(nodes[id].installationReferencePlanes ?? []));
    overlay.layoutReferencePlanes.push(...copy(nodes[id].layoutReferencePlanes ?? []));
  }
  for (const node of Object.values(nodes)) {
    const parent = containerById[node.parentId ?? ""];
    if (!parent) continue;
    if (DEVICE_TYPES[node.type] && ["ElectricalSystem", "LightingSystem", "HVACSystem", "SmartSystem", "FireProtectionSystem"].includes(parent.type)) overlay.devices.push({ ...asInternal(node, "network-device"), deviceType: DEVICE_TYPES[node.type] } as any);
    else if ((node.type === "Conduit" && ELECTRICAL_OR_LIGHTING_SYSTEMS.has(parent.type)) || (node.type === "FireWaterPipe" && parent.type === "FireProtectionSystem") || (node.type === "FireSignalConduit" && parent.type === "FireProtectionSystem")) overlay.segments.push({ ...asInternal(node, node.type === "FireWaterPipe" ? "sprinkler-segment" : "conduit-segment"), system: routingSystem(node, parent.type) } as any);
    else if (CONDUIT_FITTING_TYPES.has(node.type) && ELECTRICAL_OR_LIGHTING_SYSTEMS.has(parent.type)) overlay.fittings.push({ ...asInternal(node, "conduit-fitting"), system: routingSystem(node, parent.type), fitting: node.type === "ConduitElbow" && record(node.bridge) ? "bridge-bend" : FITTING_TYPES[node.type] } as any);
    else if (FIRE_WATER_FITTING_TYPES.has(node.type) && parent.type === "FireProtectionSystem") overlay.fittings.push({ ...asInternal(node, "sprinkler-fitting"), system: "sprinkler", fitting: FITTING_TYPES[node.type] } as any);
    else if (FIRE_SIGNAL_FITTING_TYPES.has(node.type) && parent.type === "FireProtectionSystem") overlay.fittings.push({ ...asInternal(node, "conduit-fitting"), system: "fire-signal", fitting: FITTING_TYPES[node.type] } as any);
    else if (node.type === "JunctionBox" && ELECTRICAL_OR_LIGHTING_SYSTEMS.has(parent.type)) overlay.junctionBoxes.push({ ...asInternal(node, "junction-box"), system: routingSystem(node, parent.type) } as any);
    else if (node.type === "FanCoilUnit" && parent.type === "HVACSystem") {
      const unit = asInternal(node, "indoor-air-handling-unit") as any, ports = Array.isArray(node.ports) ? node.ports : [];
      unit.powerPort ??= ports.find((port: any) => port.id === `${node.id}:power-port`);
      unit.controlPort ??= ports.find((port: any) => port.id === `${node.id}:control-port`);
      overlay.hvac.indoorUnits.push(ensureHvacUnitPorts(unit));
    }
    else if (node.type === "GalvanizedSheetMetalDuct" && parent.type === "HVACSystem") { overlay.hvac.ducts.push(asInternal(node, "hvac-duct") as any); overlay.hvac.segments.push(...copy(node.segments ?? [])); }
    else if (node.type === "AirOutlet" && parent.type === "HVACSystem") overlay.hvac.outlets.push(asInternal(node, "hvac-duct-outlet") as any);
    else if (node.type === "FCUThermostat" && parent.type === "HVACSystem") {
      const thermostat = asInternal(node, "thermostat") as any, ports = Array.isArray(node.ports) ? node.ports : [];
      thermostat.controlPort ??= ports.find((port: any) => port.id === `${node.id}:control-port`);
      overlay.hvac.thermostats.push(ensureHvacThermostatPort(thermostat));
    }
    else if (node.type === "HVACControlConduit" && parent.type === "HVACSystem") { overlay.hvac.controlConduits.push(asInternal(node, "hvac-control-conduit") as any); overlay.hvac.controlSegments.push(...copy(node.segments ?? [])); overlay.hvac.controlFittings.push(...copy(node.fittings ?? [])); }
  }
  for (const drawing of drawingNodes) for (const id of drawing.children ?? []) {
    const node = nodes[id];
    if (node.type === "ManualLeader") overlay.manualCallouts.push(asInternal(node, "manual-callout") as any);
    if (!activeDrawingIds.has(drawing.id)) continue;
    const key = typeof node.derivedId === "string" ? node.derivedId : id;
    if (node.type === "PointDimension") { overlay.pointDimensionEvidence[key] = { levelId: drawing.levelId, sourceObjectIds: copy(node.sourceObjectIds), basis: copy(node.basis) }; if (typeof node.layout?.labelPosition === "number") overlay.pointPositionDimensionLabelPositions[key] = node.layout.labelPosition; if (typeof node.layout?.lineOffset === "number") overlay.pointPositionDimensionLineOffsets[key] = node.layout.lineOffset; if (node.layout?.hidden) overlay.hiddenPointPositionDimensionIds.push(key); }
    if (node.type === "ConstructionAnnotation") { overlay.constructionAnnotationEvidence[key] = { levelId: drawing.levelId, sourceObjectIds: copy(node.sourceObjectIds), basis: copy(node.basis ?? { kind: "derived", reference: "height", assumptions: ["原始图纸未提供测量依据。"], confidence: "unknown" }) }; if (node.layout?.labelPosition) overlay.constructionAnnotationLabelPositions[key] = copy(node.layout.labelPosition); if (node.layout?.placementSignature) overlay.constructionAnnotationLabelPlacementSignatures[key] = node.layout.placementSignature; if (node.layout?.hidden) overlay.hiddenConstructionAnnotationIds.push(key); }
  }
  // Earlier Demo builds placed the thermostat source 25 mm proud of its wall.
  // Normalize only that exact generated endpoint, and its linked first segment,
  // while retaining every stable ID and all unrelated imported geometry.
  for (const thermostat of overlay.hvac.thermostats) {
    const port = thermostat.controlPort, host = thermostat.position.attachment, normal = host?.normal, portHost = port?.position.attachment;
    if (!port || thermostat.sizeMm[0] !== 86 || thermostat.sizeMm[1] !== 86 || thermostat.sizeMm[2] !== 50 || port.id !== `${thermostat.id}:control-port` || port.ownerId !== thermostat.id || port.role !== "source" || port.system !== "hvac-control" || !normal) continue;
    const magnitude = Math.hypot(...normal) || 1, unitNormal = normal.map(value => value / magnitude) as [number, number, number];
    const legacyPosition = thermostat.position.position.map((value, axis) => value + unitNormal[axis]! * thermostat.sizeMm[2] / 2000) as [number, number, number];
    const close = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => Math.abs(value - b[index]!) < 1e-8);
    if (!portHost || portHost.hostId !== host.hostId || portHost.hostKind !== host.hostKind || portHost.surface !== host.surface || portHost.levelId !== host.levelId || !close(portHost.normal, host.normal)) continue;
    if (!close(port.position.position, legacyPosition) || !close(port.direction, unitNormal)) continue;
    const route = overlay.hvac.controlConduits.find(item => item.thermostatId === thermostat.id && item.thermostatPortId === port.id);
    const firstSegment = route && overlay.hvac.controlSegments.find(segment => segment.id === route.segmentIds[0]);
    if (route && (!firstSegment || !close(firstSegment.start.position, port.position.position))) continue;
    const corrected = createHvacThermostatPort(thermostat.id, thermostat.position, thermostat.sizeMm);
    thermostat.controlPort = { ...port, position: corrected.position, direction: corrected.direction };
    if (firstSegment) firstSegment.start = corrected.position;
  }
  // The internal overlay parser checks endpoint, port, and device shapes and duplicate IDs.
  const checked = parseOverlay(overlay);
  return { projectRaw: { ...source, nodes: buildingNodes, rootNodeIds: [site.id], __unifiedSource: source }, overlay: checked };
}

/** Merge current authored objects back into the original 4.0 file without stripping unknown fields. */
export function encodeUnifiedProject(internalRaw: Record<string, any>, overlay: ConduitOverlayDocument): Project {
  const base: Project = copy(internalRaw.__unifiedSource ?? internalRaw);
  const nodes = base.nodes, original = copy(nodes);
  const internalNodes = internalRaw.nodes as Record<string, Node>;
  const root = base.rootNodeIds[0], building = Object.values(nodes).find((node) => node.type === "Building")!;
  for (const node of Object.values(internalNodes)) if (node.type === "beam" && !internalNodes[node.parentId ?? ""]?.children?.includes(node.id)) {
    throw new Error(`梁 ${node.id} 未列入所属楼层的 children，不能导出不完整项目。`);
  }
  const authoredBuilding = new Set<string>();
  const collect = (id: string) => { authoredBuilding.add(id); for (const child of internalNodes[id]?.children ?? []) collect(child); };
  collect(building.id);
  for (const [id, old] of Object.entries(original)) if (BUILDING_SET.has(old.type) && id !== root && !authoredBuilding.has(id)) delete nodes[id];
  for (const id of authoredBuilding) {
    const node = internalNodes[id]; if (!node) continue;
    const type = BUILDING_TYPES.find((kind) => kind.toLowerCase() === node.type.replace(/-/g, "")) ?? node.type;
    nodes[id] = { ...copy(original[id] ?? {}), ...copy(node), type };
  }
  for (const id of authoredBuilding) if (nodes[id]?.type === "Level") {
    nodes[id].installationReferencePlanes = mergeFields(original[id]?.installationReferencePlanes, overlay.installationReferencePlanes.filter((plane) => plane.levelId === id));
    nodes[id].layoutReferencePlanes = mergeFields(original[id]?.layoutReferencePlanes, overlay.layoutReferencePlanes.filter((plane) => plane.levelId === id));
  }
  const containers = Object.values(nodes).filter((node) => SYSTEM_TYPES.includes(node.type as typeof SYSTEM_TYPES[number]));
  const byType = Object.fromEntries(containers.map((node) => [node.type, node]));
  const put = (item: Record<string, any>, parentType: string, type: string, extra: Record<string, any> = {}) => {
    const parent = byType[parentType]; if (!parent) return;
    const old = original[item.id] ?? {};
    nodes[item.id] = { ...mergeFields(old, item), ...extra, type, parentId: parent.id };
    parent.children ??= []; if (!parent.children.includes(item.id)) parent.children.push(item.id);
  };
  const removeEdited = new Set<string>();
  for (const [id, node] of Object.entries(original)) {
    const parent = nodes[node.parentId ?? ""];
    if (!parent) continue;
    const t = parent.type;
    if ((DEVICE_TYPES[node.type] && ["ElectricalSystem", "LightingSystem", "HVACSystem", "FireProtectionSystem", "SmartSystem"].includes(t)) || (["Conduit", "ConduitConnector", "ConduitTee", "ConduitElbow", "JunctionBox"].includes(node.type) && ["ElectricalSystem", "LightingSystem"].includes(t)) || (["FireWaterPipe", "FireWaterPipeConnector", "FireWaterPipeTee", "FireWaterPipeElbow", ...FIRE_SIGNAL_TYPES].includes(node.type) && t === "FireProtectionSystem") || (["FanCoilUnit", "GalvanizedSheetMetalDuct", "AirOutlet", "FCUThermostat", "HVACControlConduit"].includes(node.type) && t === "HVACSystem")) removeEdited.add(id);
  }
  for (const id of removeEdited) { const parent = nodes[original[id].parentId!]; parent.children = (parent.children ?? []).filter((child) => child !== id); delete nodes[id]; }
  for (const item of overlay.devices) put(item, item.deviceType === "switch" || item.deviceType === "luminaire" ? "LightingSystem" : item.deviceType === "sprinkler-head" || item.deviceType === "smoke-detector" ? "FireProtectionSystem" : item.deviceType === "sensor" ? "HVACSystem" : item.deviceType === "rfid-reader" ? "SmartSystem" : "ElectricalSystem", DEVICE_EXTERNAL[item.deviceType]);
  for (const item of overlay.segments) {
    if (item.system === "sprinkler") {
      const { circuitId: _circuitId, legacyUnrooted: _legacyUnrooted, ...fireWaterPipe } = item;
      put(fireWaterPipe, "FireProtectionSystem", "FireWaterPipe");
    } else if (item.system === "fire-signal") {
      const { circuitId: _circuitId, legacyUnrooted: _legacyUnrooted, ...signalConduit } = item;
      put(signalConduit, "FireProtectionSystem", "FireSignalConduit");
    } else put(item, systemFor(item.system), "Conduit");
  }
  for (const item of overlay.fittings) put(item, systemFor(item.system), item.system === "sprinkler" ? item.fitting === "coupling" ? "FireWaterPipeConnector" : item.fitting === "tee" ? "FireWaterPipeTee" : "FireWaterPipeElbow" : item.system === "fire-signal" ? item.fitting === "coupling" ? "FireSignalConduitConnector" : "FireSignalConduitElbow" : item.fitting === "coupling" ? "ConduitConnector" : item.fitting === "tee" ? "ConduitTee" : "ConduitElbow", item.fitting === "bridge-bend" ? { fitting: "elbow" } : {});
  for (const item of overlay.junctionBoxes) put(item, systemFor(item.system), "JunctionBox");
  for (const item of overlay.hvac.indoorUnits) put(item, "HVACSystem", "FanCoilUnit", { ports: [item.powerPort, item.controlPort].filter(Boolean) });
  const hvacSegmentsById = new Map(overlay.hvac.segments.map((segment) => [segment.id, segment]));
  for (const item of overlay.hvac.ducts) put(item, "HVACSystem", "GalvanizedSheetMetalDuct", {
    segments: mergeFields(original[item.id]?.segments, item.segmentIds.flatMap((id) => {
      const segment = hvacSegmentsById.get(id);
      return segment ? [segment] : [];
    })),
  });
  for (const item of overlay.hvac.outlets) put(item, "HVACSystem", "AirOutlet");
  for (const item of overlay.hvac.thermostats) put(item, "HVACSystem", "FCUThermostat", { ports: item.controlPort ? [item.controlPort] : [] });
  const controlSegmentsById = new Map(overlay.hvac.controlSegments.map((segment) => [segment.id, segment]));
  const controlFittingsById = new Map(overlay.hvac.controlFittings.map((fitting) => [fitting.id, fitting]));
  for (const item of overlay.hvac.controlConduits) put(item, "HVACSystem", "HVACControlConduit", {
    segments: mergeFields(original[item.id]?.segments, item.segmentIds.flatMap((id) => { const segment = controlSegmentsById.get(id); return segment ? [segment] : []; })),
    fittings: mergeFields(original[item.id]?.fittings, item.fittingIds.flatMap((id) => { const fitting = controlFittingsById.get(id); return fitting ? [fitting] : []; })),
  });
  const originalArrayOwner = (field: "surfaceChases" | "penetrations", id: string): string | null => containers.find((node) => (original[node.id]?.[field] ?? []).some((item: any) => item.id === id))?.type ?? null;
  const routeElementSystem = (id: string): RoutingSystem | undefined => overlay.segments.find((item) => item.id === id)?.system
    ?? overlay.fittings.find((item) => item.id === id)?.system
    ?? overlay.junctionBoxes.find((item) => item.id === id)?.system;
  for (const container of containers.filter((node) => ["ElectricalSystem", "LightingSystem", "FireProtectionSystem"].includes(node.type))) {
    if (container.type === "FireProtectionSystem") delete container.circuits;
    else container.circuits = mergeFields(original[container.id]?.circuits, overlay.circuits.filter((item) => systemFor(item.system) === container.type));
    container.surfaceChases = mergeFields(original[container.id]?.surfaceChases, overlay.surfaceChases.filter((item) => (originalArrayOwner("surfaceChases", item.id) ?? systemFor(routeElementSystem(item.routeElementId) ?? "receptacle")) === container.type));
    container.penetrations = mergeFields(original[container.id]?.penetrations, overlay.penetrations.filter((item) => (originalArrayOwner("penetrations", item.id) ?? systemFor(overlay.segments.find((segment) => segment.id === item.segmentId)?.system ?? "receptacle")) === container.type));
  }
  // Do not retain legacy switch-to-luminaire logical controls in the new project.
  delete byType.LightingSystem.lightingControlGroups;
  // Logical thermostat bindings are retired; imported records are deliberately removed on save.
  delete byType.HVACSystem.controls;
  byType.HVACSystem.wallPenetrations = mergeFields(original[byType.HVACSystem.id]?.wallPenetrations, overlay.hvac.wallPenetrations);
  byType.ElectricalSystem.settings = { ...byType.ElectricalSystem.settings, bendRadiusMm: overlay.settings.bendRadiusMm, stockLengthMm: overlay.settings.stockLengthMm, junctionBoxSizeMm: copy(overlay.settings.junctionBoxSizeMm) };
  nodes[root].settings = { ...nodes[root].settings, colors: copy(overlay.settings.colors), visibleSystems: copy(overlay.settings.visibleSystems), sensorVisible: overlay.settings.sensorVisible, hvacVisible: overlay.hvac.visible };
  const drawings = Object.values(nodes).filter((node) => node.type === "Drawing");
  const drawingFor = (levelId: string): Node => {
    const existing = defaultDrawing(drawings, levelId);
    if (existing) return existing;
    if (nodes[levelId]?.type !== "Level") throw new Error(`图纸楼层不存在：${levelId}`);
    const stem = `drawing:construction-plan:${levelId}`;
    let id = stem, suffix = 2;
    while (nodes[id]) id = `${stem}:${suffix++}`;
    const drawing: Node = { id, type: "Drawing", parentId: root, levelId, purpose: "construction-plan", children: [] };
    nodes[id] = drawing; nodes[root].children ??= []; nodes[root].children.push(id); drawings.push(drawing);
    return drawing;
  };
  const oldLeaders = Object.values(original).filter((node) => node.type === "ManualLeader");
  for (const leader of oldLeaders) { delete nodes[leader.id]; const parent = nodes[leader.parentId!]; if (parent) parent.children = (parent.children ?? []).filter((id) => id !== leader.id); }
  for (const item of overlay.manualCallouts) {
    const originalParent = original[item.id] && nodes[original[item.id].parentId ?? ""];
    const drawing = originalParent?.type === "Drawing" && originalParent.levelId === item.levelId ? originalParent : drawingFor(item.levelId);
    nodes[item.id] = { ...copy(original[item.id] ?? {}), ...copy(item), type: "ManualLeader", parentId: drawing.id, sourceObjectIds: copy(original[item.id]?.sourceObjectIds ?? [item.targetId]) };
    drawing.children ??= []; if (!drawing.children.includes(item.id)) drawing.children.push(item.id);
  }
  const sourceExists = (id: string) => Object.prototype.hasOwnProperty.call(nodes, id) || overlay.hvac.segments.some((segment) => segment.id === id);
  for (const drawing of drawings) if (defaultDrawing(drawings, drawing.levelId)?.id === drawing.id) {
    for (const id of [...(drawing.children ?? [])]) {
      const node = nodes[id];
      if (!["PointDimension", "ConstructionAnnotation"].includes(node?.type) || !Array.isArray(node.sourceObjectIds) || node.sourceObjectIds.every(sourceExists)) continue;
      drawing.children = (drawing.children ?? []).filter((child) => child !== id);
      delete nodes[id];
    }
  }
  const putDrawing = (kind: "PointDimension" | "ConstructionAnnotation", key: string, evidence: ConduitOverlayDocument["pointDimensionEvidence"][string]) => {
    if (!evidence.sourceObjectIds.every(sourceExists)) return;
    const drawing = drawingFor(evidence.levelId);
    const existing = (drawing.children ?? []).map((id) => nodes[id]).find((node) => node?.type === kind && (node.derivedId ?? node.id) === key);
    const id = existing?.id ?? (nodes[key] ? `${drawing.id}:${key}` : key);
    if (nodes[id] && nodes[id].parentId !== drawing.id) throw new Error(`图纸节点 ID 冲突：${id}`);
    const previous = original[id] ?? {};
    const layout = kind === "PointDimension"
      ? { ...(key in overlay.pointPositionDimensionLabelPositions ? { labelPosition: overlay.pointPositionDimensionLabelPositions[key] } : {}), ...(key in overlay.pointPositionDimensionLineOffsets ? { lineOffset: overlay.pointPositionDimensionLineOffsets[key] } : {}), hidden: overlay.hiddenPointPositionDimensionIds.includes(key) }
      : { ...(key in overlay.constructionAnnotationLabelPositions ? { labelPosition: copy(overlay.constructionAnnotationLabelPositions[key]) } : {}), ...(key in overlay.constructionAnnotationLabelPlacementSignatures ? { placementSignature: overlay.constructionAnnotationLabelPlacementSignatures[key] } : {}), hidden: overlay.hiddenConstructionAnnotationIds.includes(key) };
    nodes[id] = { ...copy(previous), id, type: kind, parentId: drawing.id, ...(id !== key ? { derivedId: key } : {}), sourceObjectIds: copy(evidence.sourceObjectIds), basis: copy(evidence.basis), layout: { ...copy(previous.layout ?? {}), ...layout } };
    delete nodes[id].valueMeters;
    drawing.children ??= []; if (!drawing.children.includes(id)) drawing.children.push(id);
  };
  for (const [key, evidence] of Object.entries(overlay.pointDimensionEvidence)) putDrawing("PointDimension", key, evidence);
  for (const [key, evidence] of Object.entries(overlay.constructionAnnotationEvidence)) putDrawing("ConstructionAnnotation", key, evidence);
  base.schemaVersion = "4.0";
  delete base.__unifiedSource;
  validateUnifiedProject(base);
  return base;
}
