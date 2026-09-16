import type { ConduitOverlayDocument } from "./overlay";

/** The Demo owns this extension; it deliberately does not reuse a Pascal Core field. */
export const PROJECT_ID_FIELD = "pascalConduitProjectId";
export const EDITABLE_PROJECT_NODE_KINDS: ReadonlySet<"beam"> = new Set(["beam"]);

export type ProjectDocument = {
  fileName: string;
  revisionSha256: string;
  raw: Record<string, unknown>;
  projectId: string | null;
};

export type WorkspaceSnapshot = {
  project: ProjectDocument | null;
  overlay: ConduitOverlayDocument | null;
  projectDirty: boolean;
  overlayDirty: boolean;
};

export type WorkspaceState = WorkspaceSnapshot & {
  undoStack: WorkspaceSnapshot[];
  redoStack: WorkspaceSnapshot[];
};

export type WorkspaceTransaction = {
  project?: ProjectDocument | null;
  overlay?: ConduitOverlayDocument | null;
  projectDirty?: boolean;
  overlayDirty?: boolean;
};

export type WorkspaceTransactionResult = { status: "committed"; state: WorkspaceState } | { status: "rejected"; reason: string; state: WorkspaceState };

const clone = <T>(value: T): T => structuredClone(value);
const stableJson = (value: unknown) => JSON.stringify(value);

export const readProjectIdentity = (raw: unknown): string | null => {
  if (!raw || typeof raw !== "object") return null;
  const value = (raw as Record<string, unknown>)[PROJECT_ID_FIELD];
  return typeof value === "string" && value.trim() ? value : null;
};

export function projectDocument(raw: Record<string, unknown>, fileName: string, revisionSha256: string): ProjectDocument {
  const copied = clone(raw);
  return { raw: copied, fileName, revisionSha256, projectId: readProjectIdentity(copied) };
}

export function makeProjectWritable(project: ProjectDocument, createId: () => string = () => crypto.randomUUID()): ProjectDocument {
  if (project.projectId) return clone(project);
  const projectId = createId();
  return { ...clone(project), raw: { ...project.raw, [PROJECT_ID_FIELD]: projectId }, projectId };
}

export const hasUnsavedWorkspaceChanges = (state: Pick<WorkspaceSnapshot, "projectDirty" | "overlayDirty">) => state.projectDirty || state.overlayDirty;
// Documents are immutable at their callers; retaining their references keeps
// large route networks cheap to undo while the snapshot owns its state flags.
export const workspaceSnapshot = (state: WorkspaceSnapshot): WorkspaceSnapshot => ({ project: state.project, overlay: state.overlay, projectDirty: state.projectDirty, overlayDirty: state.overlayDirty });

export function createWorkspace(project: ProjectDocument | null, overlay: ConduitOverlayDocument | null): WorkspaceState {
  return { project, overlay, projectDirty: false, overlayDirty: false, undoStack: [], redoStack: [] };
}

function changedProjectNodeKinds(before: ProjectDocument | null, after: ProjectDocument | null): string[] {
  const beforeNodes = before?.raw.nodes && typeof before.raw.nodes === "object" ? before.raw.nodes as Record<string, unknown> : {};
  const afterNodes = after?.raw.nodes && typeof after.raw.nodes === "object" ? after.raw.nodes as Record<string, unknown> : {};
  const ids = new Set([...Object.keys(beforeNodes), ...Object.keys(afterNodes)]);
  return [...ids].flatMap((id) => {
    if (stableJson(beforeNodes[id]) === stableJson(afterNodes[id])) return [];
    const node = afterNodes[id] ?? beforeNodes[id];
    return node && typeof node === "object" && typeof (node as { type?: unknown }).type === "string" ? [(node as { type: string }).type] : ["invalid"];
  });
}

/**
 * The identity extension and Demo Beam nodes are the only project mutations
 * permitted here. Imported Pascal nodes never become writable merely because
 * they are present in source JSON.
 */
export function commitWorkspaceTransaction(state: WorkspaceState, transaction: WorkspaceTransaction): WorkspaceTransactionResult {
  const next: WorkspaceSnapshot = {
    project: transaction.project === undefined ? state.project : transaction.project,
    overlay: transaction.overlay === undefined ? state.overlay : transaction.overlay,
    projectDirty: transaction.projectDirty ?? (transaction.project === undefined ? state.projectDirty : true),
    overlayDirty: transaction.overlayDirty ?? (transaction.overlay === undefined ? state.overlayDirty : true),
  };
  const changedKinds = changedProjectNodeKinds(state.project, next.project);
  const forbidden = changedKinds.find((kind) => !EDITABLE_PROJECT_NODE_KINDS.has(kind as "beam"));
  if (forbidden) return { status: "rejected", reason: `项目节点 ${forbidden} 为只读，不能通过工作区事务修改。`, state };
  const unchanged = stableJson(state.project) === stableJson(next.project) && stableJson(state.overlay) === stableJson(next.overlay) && state.projectDirty === next.projectDirty && state.overlayDirty === next.overlayDirty;
  if (unchanged) return { status: "committed", state };
  return { status: "committed", state: { ...next, undoStack: [...state.undoStack, workspaceSnapshot(state)], redoStack: [] } };
}

export function undoWorkspaceTransaction(state: WorkspaceState): WorkspaceState {
  const previous = state.undoStack[state.undoStack.length - 1];
  if (!previous) return state;
  return { ...workspaceSnapshot(previous), undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, workspaceSnapshot(state)] };
}

export function redoWorkspaceTransaction(state: WorkspaceState): WorkspaceState {
  const next = state.redoStack[state.redoStack.length - 1];
  if (!next) return state;
  return { ...workspaceSnapshot(next), undoStack: [...state.undoStack, workspaceSnapshot(state)], redoStack: state.redoStack.slice(0, -1) };
}

export function markWorkspaceDocumentExported(state: WorkspaceState, document: "project" | "overlay"): WorkspaceState {
  return document === "project" ? { ...state, projectDirty: false } : { ...state, overlayDirty: false };
}

export function migrateOverlayOwnership(overlay: ConduitOverlayDocument, project: ProjectDocument): ConduitOverlayDocument {
  return { ...overlay, source: { ...overlay.source, fileName: project.fileName, sha256: project.revisionSha256, ...(project.projectId ? { projectId: project.projectId } : {}) } };
}

/** A legacy SHA-only sidecar is accepted only for its exact source revision. */
export const overlayBelongsToProject = (overlay: ConduitOverlayDocument, project: ProjectDocument) => overlay.source.projectId ? overlay.source.projectId === project.projectId : overlay.source.sha256 === project.revisionSha256;

export function importProjectRevision(state: WorkspaceState, imported: ProjectDocument, createOverlay: (project: ProjectDocument) => ConduitOverlayDocument): { status: "imported" | "needs-confirmation"; state: WorkspaceState; retainedOverlay: boolean } {
  const sameProject = Boolean(imported.projectId && state.project?.projectId === imported.projectId);
  if (!sameProject && hasUnsavedWorkspaceChanges(state)) return { status: "needs-confirmation", state, retainedOverlay: false };
  const overlay = sameProject && state.overlay ? migrateOverlayOwnership(state.overlay, imported) : createOverlay(imported);
  // Revalidation changes the retained sidecar's revision evidence. It must
  // remain unsaved until the user exports that sidecar, even if it was clean.
  const next = createWorkspace(imported, overlay);
  if (sameProject && state.overlay) next.overlayDirty = true;
  return { status: "imported", state: next, retainedOverlay: sameProject };
}
