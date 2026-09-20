import { create } from "zustand";
import type { ConduitOverlayDocument, NetworkDeviceType, RoutePoint, RoutingSystem, Vec3 } from "./overlay";
import type { PlannedRoute } from "./routing";
import { commitWorkspaceTransaction, createWorkspace, markWorkspaceDocumentExported, redoWorkspaceTransaction, type ProjectDocument, type WorkspaceState, undoWorkspaceTransaction } from "./workspace";

export type RoutePreviewSnapshot = {
  sourceSha: string;
  system: RoutingSystem;
  diameterMm: number;
  levelId: string | null;
  points: RoutePoint[];
  plan: PlannedRoute | null;
  branchNode?: { kind: "junction-box" | "tee"; position: Vec3; sizeMm: [number, number, number] };
  deviceNode?: { deviceType: NetworkDeviceType; position: RoutePoint; valid: boolean };
};

type OverlayState = {
  workspace: WorkspaceState;
  project: ProjectDocument | null;
  overlay: ConduitOverlayDocument | null;
  undoStack: ConduitOverlayDocument[];
  redoStack: ConduitOverlayDocument[];
  projectDirty: boolean;
  dirty: boolean;
  preview: RoutePreviewSnapshot | null;
  load: (overlay: ConduitOverlayDocument) => void;
  loadWorkspace: (project: ProjectDocument, overlay: ConduitOverlayDocument, overlayDirty?: boolean) => void;
  publish: (overlay: ConduitOverlayDocument, dirty: boolean) => void;
  markExported: () => void;
  markProjectExported: () => void;
  commit: (next: ConduitOverlayDocument) => void;
  commitWorkspace: (project: ProjectDocument | null, overlay: ConduitOverlayDocument | null, projectDirty?: boolean, overlayDirty?: boolean) => void;
  undo: () => void;
  redo: () => void;
  publishPreview: (preview: RoutePreviewSnapshot) => void;
  clearPreview: () => void;
};

const clone = (value: ConduitOverlayDocument) => structuredClone(value);
// `planRoute` deliberately assigns persistent IDs and timestamps, even while it
// is being used to draw a transient preview.  Those values change on every
// render although the route shown to the author has not changed.  Treating them
// as preview changes republishes the same draft through Zustand indefinitely in
// a split 2D/3D workspace.
const previewSignature = (preview: RoutePreviewSnapshot | null) => preview ? JSON.stringify(preview, (key, value) => {
  if (["id", "createdAt", "segmentId", "segmentIds", "routeElementId", "startPortId", "endPortId", "connectedSegmentIds"].includes(key)) return undefined;
  return value;
}) : "";
const snapshotOverlayHistory = (workspace: WorkspaceState) => workspace.undoStack.map((snapshot) => snapshot.overlay).filter((overlay): overlay is ConduitOverlayDocument => Boolean(overlay));
const syncWorkspace = (workspace: WorkspaceState, preview: RoutePreviewSnapshot | null) => ({ workspace, project: workspace.project, overlay: workspace.overlay, undoStack: snapshotOverlayHistory(workspace), redoStack: workspace.redoStack.map((snapshot) => snapshot.overlay).filter((overlay): overlay is ConduitOverlayDocument => Boolean(overlay)), projectDirty: workspace.projectDirty, dirty: workspace.overlayDirty, preview });

export const useOverlayStore = create<OverlayState>((set, get) => ({
  workspace: createWorkspace(null, null),
  project: null,
  overlay: null,
  undoStack: [],
  redoStack: [],
  projectDirty: false,
  dirty: false,
  preview: null,
  // A newly loaded building or imported Overlay is already backed by a file.
  load: (overlay) => set(syncWorkspace(createWorkspace(null, clone(overlay)), null)),
  loadWorkspace: (project, overlay, overlayDirty = false) => {
    const workspace = createWorkspace(project, overlay);
    workspace.overlayDirty = overlayDirty;
    set(syncWorkspace(workspace, null));
  },
  // 3D owns transient drawing state, while 2D consumes this shared snapshot.
  // Publishing must not reset history or silently mark local edits as exported.
  publish: (overlay, dirty) => set((state) => syncWorkspace({ ...state.workspace, overlay, overlayDirty: dirty }, state.preview)),
  markExported: () => set((state) => {
    return syncWorkspace(markWorkspaceDocumentExported(state.workspace, "overlay"), state.preview);
  }),
  markProjectExported: () => set((state) => {
    return syncWorkspace(markWorkspaceDocumentExported(state.workspace, "project"), state.preview);
  }),
  commit: (next) => {
    const current = get();
    const result = commitWorkspaceTransaction(current.workspace, { overlay: next });
    if (result.status === "committed") set(syncWorkspace(result.state, current.preview));
  },
  commitWorkspace: (project, overlay, projectDirty = true, overlayDirty = true) => {
    const current = get();
    const result = commitWorkspaceTransaction(current.workspace, { project, overlay, projectDirty, overlayDirty });
    if (result.status === "committed") set(syncWorkspace(result.state, current.preview));
  },
  undo: () => {
    const current = get();
    set(syncWorkspace(undoWorkspaceTransaction(current.workspace), current.preview));
  },
  redo: () => {
    const current = get();
    set(syncWorkspace(redoWorkspaceTransaction(current.workspace), current.preview));
  },
  // Preview is ephemeral UI state: no clone, history entry, dirty flag or export.
  // Its producer may re-render with new object identities but identical geometry;
  // avoid waking 2D subscribers in that case.
  publishPreview: (preview) => set((state) => previewSignature(state.preview) === previewSignature(preview) ? state : { preview }),
  clearPreview: () => set((state) => state.preview ? { preview: null } : state),
}));
