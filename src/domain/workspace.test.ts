import { describe, expect, it } from "vitest";
import { createEmptyOverlay } from "./overlay";
import { PROJECT_ID_FIELD, commitWorkspaceTransaction, createWorkspace, hasUnsavedWorkspaceChanges, importProjectRevision, makeProjectWritable, markWorkspaceDocumentExported, migrateOverlayOwnership, overlayBelongsToProject, projectDocument, redoWorkspaceTransaction, undoWorkspaceTransaction } from "./workspace";

const raw = (extra: Record<string, unknown> = {}) => ({ nodes: { level: { id: "level", type: "level" }, unknown: { id: "unknown", type: "plugin-node", payload: { preserved: true } } }, metadata: { source: "kept" }, ...extra });

describe("workspace project lifecycle", () => {
  it("creates one stable identity for a legacy project while its revision fingerprint may change", () => {
    const legacy = projectDocument(raw(), "legacy.json", "first-sha");
    const writable = makeProjectWritable(legacy, () => "project-1");
    const exportedAgain = makeProjectWritable({ ...writable, revisionSha256: "second-sha" }, () => "wrong");
    expect(writable.raw[PROJECT_ID_FIELD]).toBe("project-1");
    expect(exportedAgain.projectId).toBe("project-1");
    expect(exportedAgain.revisionSha256).toBe("second-sha");
  });

  it("migrates legacy SHA-only overlay ownership without losing its source evidence", () => {
    const project = makeProjectWritable(projectDocument(raw(), "revised.json", "revised-sha"), () => "project-1");
    const migrated = migrateOverlayOwnership(createEmptyOverlay("legacy.json", "legacy-sha"), project);
    expect(migrated.source).toEqual({ fileName: "revised.json", sha256: "revised-sha", projectId: "project-1" });
  });

  it("accepts only matching identity sidecars and their exact legacy SHA predecessors", () => {
    const project = makeProjectWritable(projectDocument(raw(), "revised.json", "revised-sha"), () => "project-1");
    expect(overlayBelongsToProject(createEmptyOverlay("legacy.json", "revised-sha"), project)).toBe(true);
    expect(overlayBelongsToProject(createEmptyOverlay("other.json", "other-sha", "other-project"), project)).toBe(false);
  });

  it("retains an overlay for the same identity and starts a separate one for another project", () => {
    const first = makeProjectWritable(projectDocument(raw(), "one.json", "one"), () => "one-id");
    const overlay = createEmptyOverlay("one.json", "one", "one-id");
    const state = createWorkspace(first, overlay);
    const same = importProjectRevision(state, { ...first, fileName: "one-revision.json", revisionSha256: "two" }, (project) => createEmptyOverlay(project.fileName, project.revisionSha256, project.projectId ?? undefined));
    expect(same).toMatchObject({ status: "imported", retainedOverlay: true, state: { overlayDirty: true, overlay: { source: { projectId: "one-id", sha256: "two" } } } });
    const other = makeProjectWritable(projectDocument(raw(), "other.json", "other"), () => "other-id");
    const different = importProjectRevision(markWorkspaceDocumentExported(same.state, "overlay"), other, (project) => createEmptyOverlay(project.fileName, project.revisionSha256, project.projectId ?? undefined));
    expect(different).toMatchObject({ status: "imported", retainedOverlay: false, state: { overlay: { source: { projectId: "other-id" } } } });
  });

  it("preserves unknown top-level values and node payloads through an identity-only project change", () => {
    const legacy = projectDocument(raw({ pluginPayload: { keep: [1, 2] } }), "legacy.json", "sha");
    const writable = makeProjectWritable(legacy, () => "project-1");
    expect(writable.raw).toMatchObject({ metadata: { source: "kept" }, pluginPayload: { keep: [1, 2] }, nodes: { unknown: { type: "plugin-node", payload: { preserved: true } } } });
  });

  it("keeps dirty states independent and restores both through chronological undo and redo", () => {
    const project = makeProjectWritable(projectDocument(raw(), "one.json", "one"), () => "one-id");
    let state = createWorkspace(project, createEmptyOverlay("one.json", "one", "one-id"));
    const projectRevision = { ...project, raw: { ...project.raw, title: "saved revision" } };
    state = commitWorkspaceTransaction(state, { project: projectRevision }).state;
    state = commitWorkspaceTransaction(state, { overlay: { ...state.overlay!, settings: { ...state.overlay!.settings, sensorVisible: false } } }).state;
    expect(state).toMatchObject({ projectDirty: true, overlayDirty: true });
    state = markWorkspaceDocumentExported(state, "project");
    expect(state).toMatchObject({ projectDirty: false, overlayDirty: true });
    expect(hasUnsavedWorkspaceChanges(state)).toBe(true);
    state = undoWorkspaceTransaction(state);
    expect(state).toMatchObject({ projectDirty: true, overlayDirty: false });
    state = redoWorkspaceTransaction(state);
    expect(state).toMatchObject({ projectDirty: false, overlayDirty: true });
  });

  it("permits a Demo Beam transaction and restores it through workspace undo and redo", () => {
    const project = projectDocument(raw({ nodes: { level: { id: "level", type: "level" }, ceiling: { id: "ceiling", type: "ceiling", parentId: "level", polygon: [[0, 0], [4, 0], [4, 4], [0, 4]] } } }), "one.json", "one");
    const state = createWorkspace(project, createEmptyOverlay("one.json", "one"));
    const beam = { id: "beam", type: "beam", parentId: "level", name: "梁 1", start: [0, 1], end: [3, 1], width: .3, height: .5, ceilingIds: ["ceiling"], effectiveCeilingElevation: { meters: 2.7, basis: "derived-default-2700mm" } };
    const changed = commitWorkspaceTransaction(state, { project: { ...project, raw: { ...project.raw, nodes: { ...(project.raw.nodes as object), beam } } } });
    expect(changed).toMatchObject({ status: "committed", state: { projectDirty: true, project: { raw: { nodes: { beam } } } } });
    expect(undoWorkspaceTransaction(changed.state).project?.raw.nodes).not.toHaveProperty("beam");
    expect(redoWorkspaceTransaction(undoWorkspaceTransaction(changed.state)).project?.raw.nodes).toHaveProperty("beam");
  });

  it("rejects imported building-node changes through the explicit Beam-only allowlist", () => {
    const project = projectDocument(raw(), "one.json", "one");
    const state = createWorkspace(project, createEmptyOverlay("one.json", "one"));
    const edited = { ...project, raw: { ...project.raw, nodes: { ...(project.raw.nodes as object), level: { id: "level", type: "level", name: "edited" } } } };
    expect(commitWorkspaceTransaction(state, { project: edited })).toMatchObject({ status: "rejected" });
  });
});
