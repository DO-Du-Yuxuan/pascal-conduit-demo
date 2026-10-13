import { useMemo, useState } from "react";
import type { NodeData } from "../types";
import { isHideableSceneNode, sourceNodeIsVisible } from "../scene-visibility";
import { BuilderIcon } from "./BuilderIcons";

const labels: Record<string, string> = { site: "场地", building: "建筑", level: "楼层", wall: "墙", slab: "楼板", ceiling: "天花", beam: "梁", door: "门", window: "窗", item: "家具", stair: "楼梯", "stair-segment": "楼梯段", roof: "屋顶", "roof-segment": "屋顶段", zone: "区域", shelf: "搁架", column: "柱" };

/** A read-only browser of imported building nodes. Selection uses the workspace's existing authority. */
export function SceneTree({ nodes, selectedId, hiddenNodeIds, layerHiddenNodeIds = new Set<string>(), onSelect, onHide, onRestore, onRestoreNode, onEnableLayerForNode }: {
  nodes: Record<string, NodeData>;
  selectedId: string | null;
  hiddenNodeIds: ReadonlySet<string>;
  /** Effective-hidden nodes due to a Builder 3D layer switch. */
  layerHiddenNodeIds?: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onHide: (id: string) => void;
  onRestore: () => void;
  /** Clears only this session hide; source `visible: false` remains read-only. */
  onRestoreNode?: (id: string) => void;
  /** Enables the Builder layer responsible for this node. */
  onEnableLayerForNode?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const rows = useMemo(() => {
    const children = new Map<string, NodeData[]>();
    const roots: NodeData[] = [];
    for (const node of Object.values(nodes)) {
      if (node.parentId && nodes[node.parentId]) {
        const list = children.get(node.parentId) ?? [];
        list.push(node); children.set(node.parentId, list);
      } else roots.push(node);
    }
    const result: Array<{ node: NodeData; depth: number; hasChildren: boolean }> = [];
    const visited = new Set<string>();
    const search = query.trim().toLowerCase();
    const visit = (node: NodeData, depth: number) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      const descendants = children.get(node.id) ?? [];
      if (!search || `${node.name ?? ""} ${labels[node.type] ?? node.type} ${node.id}`.toLowerCase().includes(search)) result.push({ node, depth: search ? 0 : depth, hasChildren: descendants.length > 0 });
      if (search || !collapsed.has(node.id)) descendants.forEach(child => visit(child, depth + 1));
    };
    roots.forEach(root => visit(root, 0));
    // Preserve visibility of malformed or future cyclic subtrees without recursive loops.
    if (search) Object.values(nodes).filter(node => !visited.has(node.id)).forEach(node => visit(node, 0));
    return result;
  }, [nodes, collapsed, query]);

  return <section className="builder-scene-tree" aria-label="建筑场景">
    <div className="builder-scene-heading"><b>建筑场景</b><span>{Object.keys(nodes).length} 个对象</span></div>
    <input aria-label="搜索场景对象" placeholder="搜索名称、类型或 ID" value={query} onChange={event => setQuery(event.target.value)} />
    {!Object.keys(nodes).length && <p className="builder-panel-empty">导入项目后，在这里浏览建筑对象。</p>}
    {!!Object.keys(nodes).length && !rows.length && <p className="builder-panel-empty">没有匹配的对象。</p>}
    <div role="tree" aria-label="建筑对象树">{rows.map(({ node, depth, hasChildren }) => {
      const sourceVisible = sourceNodeIsVisible(node.id, nodes);
      const sessionHidden = hiddenNodeIds.has(node.id);
      const layerHidden = layerHiddenNodeIds.has(node.id);
      const canRestoreSession = sessionHidden && sourceVisible && Boolean(onRestoreNode || onRestore);
      const canEnableLayer = layerHidden && sourceVisible && Boolean(onEnableLayerForNode);
      const hidden = !sourceVisible || sessionHidden || layerHidden;
      const label = node.name || labels[node.type] || node.type;
      const visibilityAction = !sourceVisible ? `源数据隐藏 ${label}` : hidden ? `显示 ${label}` : `隐藏 ${label}`;
      return <div role="treeitem" aria-level={depth + 1} aria-selected={selectedId === node.id} aria-expanded={hasChildren ? !collapsed.has(node.id) : undefined} key={node.id} className={`builder-scene-row ${selectedId === node.id ? "active" : ""} ${hidden ? "is-hidden" : ""}`} style={{ paddingLeft: 8 + Math.min(depth, 8) * 14 }}>
      <button className="builder-tree-toggle" disabled={!hasChildren || !!query.trim()} aria-label={`${collapsed.has(node.id) ? "展开" : "收起"} ${node.name || labels[node.type] || node.type}`} onClick={() => setCollapsed(current => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })}>{hasChildren && <BuilderIcon name="chevronDown" style={{ transform: collapsed.has(node.id) ? "rotate(-90deg)" : undefined }} size={14} />}</button>
      <button className="builder-tree-select" title={`${node.type} · ${node.id}`} onClick={() => onSelect(node.id)}><BuilderIcon name={node.type === "level" ? "level" : hasChildren ? "folder" : "device"} size={16} /><span>{node.name || labels[node.type] || node.type}</span></button>
      {isHideableSceneNode(node) && <button className="builder-tree-visibility" disabled={!sourceVisible || (sessionHidden && !canRestoreSession) || (layerHidden && !canEnableLayer)} aria-label={visibilityAction} title={visibilityAction} onClick={() => {
        if (!sourceVisible) return;
        if (sessionHidden) { if (onRestoreNode) onRestoreNode(node.id); else onRestore(); }
        if (layerHidden) { onEnableLayerForNode?.(node.id); }
        if (sessionHidden || layerHidden) return;
        onHide(node.id);
      }}><BuilderIcon name={hidden ? "eyeOff" : "eye"} size={14} /></button>}
    </div>})}</div>
    {!!hiddenNodeIds.size && <button className="builder-restore-scene" onClick={onRestore}>恢复隐藏对象（{hiddenNodeIds.size}）</button>}
    {!!Object.keys(nodes).length && <small className="builder-readonly-note">建筑对象只读；梁通过建造工具编辑。</small>}
  </section>;
}
