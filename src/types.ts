export type Vec3 = [number, number, number];
export type NodeData = Record<string, any> & {
  id: string;
  type: string;
  parentId?: string;
  position?: number[];
  rotation?: number[];
  scale?: number[];
};
export type ZoneNodeData = NodeData & { type: "zone"; spaceFunctionCode?: string };
export type DoorNodeData = NodeData & { type: "door"; isPrimaryEntrance?: boolean };
export type Diagnostic = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  nodeId?: string;
  sourcePath?: string;
};
export type Transform = {
  x: number;
  z: number;
  rotationY: number;
  ancestorLevelId?: string;
  sourceNodeIds: string[];
  status: "ok" | "error";
  error?: string;
};
export type AffineMatrix2D = {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
};
export type Parsed = {
  nodes: Record<string, NodeData>;
  raw: any;
  diagnostics: Diagnostic[];
};
