import { decodeUnifiedProject, PROJECT_BUILDING_TYPES, PROJECT_SYSTEM_TYPES } from "./unified-project";

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const buildingAliases = new Map(PROJECT_BUILDING_TYPES.flatMap((type) => [
  [type.toLowerCase(), type],
  [type.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase(), type],
]));

/** File-opening boundary; the editor and writer continue to use Project 4.0. */
export function importProjectJson(raw: unknown, fileName: string, sha256: string) {
  if (record(raw) && raw.schemaVersion === "4.0") {
    return { ...decodeUnifiedProject(raw, fileName, sha256), importNotice: null as string | null };
  }
  if (!record(raw) || !record(raw.nodes) || !Array.isArray(raw.rootNodeIds) || raw.rootNodeIds.length !== 1) {
    throw new Error("旧项目必须有 nodes 和唯一 Site 根节点；单独 Overlay 文件不能作为项目导入。");
  }
  if (raw.schemaVersion !== undefined && !["1.0", "2.0", "3.0"].includes(raw.schemaVersion)) {
    throw new Error(`不支持项目 schemaVersion ${String(raw.schemaVersion)}；支持无版本 Pascal 建筑及 1.0、2.0、3.0、4.0 项目。`);
  }
  if (raw.schemaVersion === undefined && raw.nodes[raw.rootNodeIds[0]]?.type !== "site") {
    throw new Error("无版本文件必须是以小写 site 为根的旧 Pascal 建筑树；统一项目不能缺少 schemaVersion。");
  }
  // Clone first: validation failure must leave the source and live workspace intact.
  const converted = structuredClone(raw);
  const nodes = converted.nodes as Record<string, any>;
  for (const node of Object.values(nodes)) {
    if (record(node) && typeof node.type === "string") node.type = buildingAliases.get(node.type) ?? node.type;
  }
  const rootId = converted.rootNodeIds[0];
  const site = nodes[rootId];
  if (!record(site) || site.type !== "Site" || site.parentId !== null || !Array.isArray(site.children)) {
    throw new Error("旧项目根节点必须是 parentId 为 null、含 children 的 Site。");
  }
  for (const type of PROJECT_SYSTEM_TYPES) {
    // Existing containers remain untouched and are checked by the 4.0 validator.
    if (Object.values(nodes).some((node) => record(node) && node.type === type)) continue;
    const baseId = `${rootId}:${type}`;
    let id = baseId, suffix = 1;
    while (Object.prototype.hasOwnProperty.call(nodes, id)) id = `${baseId}:${suffix++}`;
    nodes[id] = { id, type, parentId: rootId, children: [] };
    site.children.push(id);
  }
  // Prefer persisted identities; a Site-derived fallback is independent of filename/revision.
  if (converted.pascalConduitProjectId === undefined) {
    converted.pascalConduitProjectId = typeof converted.projectId === "string" && converted.projectId.trim()
      ? converted.projectId : `pascal-project:${rootId}`;
  }
  converted.schemaVersion = "4.0";
  return {
    ...decodeUnifiedProject(converted, fileName, sha256),
    importNotice: "已将旧项目转换为 4.0；建筑、稳定 ID 和未知字段保留。导出将保存为统一 4.0 项目，原文件未修改。",
  };
}
