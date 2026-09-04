export type Vec3 = [number, number, number];

export type PascalNode = Record<string, unknown> & {
  id: string;
  type: string;
  parentId?: string | null;
  visible?: boolean;
};

export type BuildingScene = {
  raw: { nodes?: Record<string, PascalNode>; rootNodeIds?: string[]; installedPlugins?: string[] };
  nodes: Record<string, PascalNode>;
  rootNodeIds: string[];
  levelIds: string[];
  diagnostics: string[];
};

const finite = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;

export const numberAt = (value: unknown, index: number, fallback = 0) => Array.isArray(value) ? finite(value[index], fallback) : fallback;
export const vec3 = (value: unknown): Vec3 => [numberAt(value, 0), numberAt(value, 1), numberAt(value, 2)];
export const planPoint = (value: unknown): Vec3 => [numberAt(value, 0), 0, numberAt(value, 1)];

export function parseBuilding(raw: unknown): BuildingScene {
  const input = raw && typeof raw === "object" ? raw as BuildingScene["raw"] : {};
  const nodes = Object.fromEntries(Object.entries(input.nodes ?? {}).filter((entry): entry is [string, PascalNode] => Boolean(entry[1]) && typeof entry[1] === "object"));
  const declaredRoots = Array.isArray(input.rootNodeIds) ? input.rootNodeIds.filter((id): id is string => typeof id === "string" && Boolean(nodes[id])) : [];
  const derivedRoots = Object.values(nodes).filter((node) => !node.parentId).map((node) => node.id);
  const rootNodeIds = declaredRoots.length ? declaredRoots : derivedRoots;
  const diagnostics: string[] = [];
  if (!declaredRoots.length && derivedRoots.length) diagnostics.push("源文件缺少可用 rootNodeIds，已按无 parentId 节点推导展示根。");
  if (!rootNodeIds.length) diagnostics.push("无法建立建筑展示根。");
  return { raw: input, nodes, rootNodeIds, levelIds: Object.values(nodes).filter((node) => node.type === "level").sort((a, b) => finite(a.level) - finite(b.level)).map((node) => node.id), diagnostics };
}

export function levelForNode(scene: BuildingScene, node: PascalNode): string | null {
  let cursor: PascalNode | undefined = node;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.type === "level") return cursor.id;
    cursor = typeof cursor.parentId === "string" ? scene.nodes[cursor.parentId] : undefined;
  }
  return null;
}

export function levelElevation(scene: BuildingScene, levelId: string | null): number {
  if (!levelId) return 0;
  const index = scene.levelIds.indexOf(levelId);
  return index < 0 ? 0 : index * 3.2;
}

export function sceneFingerprint(raw: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return crypto.subtle.digest("SHA-256", source).then((hash) => [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join(""));
}
