import { describe, expect, it } from "vitest";
import { buildCrashDiagnostic, createRecoveryDownloadSnapshot, encodeRecoveryProject, explainReactError, getLastSuccessfulRecoverySnapshot } from "./crash-recovery";
import { decodeUnifiedProject } from "./domain/unified-project";
import { useOverlayStore } from "./domain/store";

const systems = ["ElectricalSystem", "PlumbingSystem", "LightingSystem", "HVACSystem", "SmartSystem", "WaterPurificationSystem", "BathroomSystem", "FireProtectionSystem", "IrrigationSystem", "GasSystem"];
const raw: Record<string, any> = {
  schemaVersion: "4.0", pascalConduitProjectId: "stable-project", rootNodeIds: ["site"], nodes: {
    site: { id: "site", type: "Site", parentId: null, children: ["building", ...systems] },
    building: { id: "building", type: "Building", parentId: "site", children: ["level"] },
    level: { id: "level", type: "Level", parentId: "building", children: [] },
    ...Object.fromEntries(systems.map(type => [type, { id: type, type, parentId: "site", children: [] }])),
  }, installedPlugins: [], materials: {}, collections: {}, futureField: { keep: true },
};

describe("crash recovery", () => {
  it("encodes the latest shared project and overlay as one unified project JSON", () => {
    const loaded = decodeUnifiedProject(raw, "project.json", "source-sha");
    const recovery = encodeRecoveryProject({ project: { raw: loaded.projectRaw }, overlay: loaded.overlay });
    expect(recovery).not.toBeNull();
    expect(recovery?.schemaVersion).toBe("4.0");
    expect(recovery?.pascalConduitProjectId).toBe("stable-project");
    expect(recovery?.futureField).toEqual({ keep: true });
    expect(decodeUnifiedProject(recovery, "recovery.json", "next").overlay.devices).toEqual(loaded.overlay.devices);
    expect(encodeRecoveryProject({ project: null, overlay: null })).toBeNull();
  });

  it("writes the React component stack and actionable runtime metadata without project contents", () => {
    const report = buildCrashDiagnostic({
      error: Object.assign(new Error("Minified React error #185"), { name: "Error" }),
      componentStack: "\n    at Workspace (src/main.tsx:90)", buildLabel: "v0.1.0 · abc1234 · time",
      url: "https://example.test/app?token=secret#drawing", userAgent: "Browser 1",
      projectId: "stable-project", sourceSha: "source-sha", projectDirty: true, overlayDirty: false,
      occurredAt: "2026-09-28T00:00:00.000Z",
    });
    expect(report.componentStack).toContain("Workspace");
    expect(report.url).toBe("https://example.test/app");
    expect(report.project.sourceSha).toBe("source-sha");
    expect(report.recoverySnapshot).toMatchObject({ snapshotAt: null, usedFallback: false, projectId: null, sourceSha: null });
    expect(JSON.stringify(report)).not.toContain("token=secret");
    expect(explainReactError("Minified React error #185")).toMatch(/maximum update depth|循环/);
  });

  it("caches only committed document reference changes and falls back to the last encodable project", () => {
    const store = useOverlayStore.getState();
    const loaded = decodeUnifiedProject(raw, "project.json", "source-sha");
    const project = { raw: loaded.projectRaw, fileName: "project.json", projectId: "stable-project", revisionSha256: "source-sha" };
    useOverlayStore.setState({ project, overlay: loaded.overlay });
    const cached = getLastSuccessfulRecoverySnapshot();
    expect(cached).toMatchObject({ projectId: "stable-project", sourceSha: "source-sha" });

    useOverlayStore.setState({ preview: { sourceSha: "source-sha", system: "receptacle", diameterMm: 20, levelId: null, points: [], plan: null } });
    expect(getLastSuccessfulRecoverySnapshot()).toBe(cached);

    useOverlayStore.setState({ project: { raw: {}, fileName: "broken.json", projectId: "broken-project", revisionSha256: "bad-sha" } });
    const fallback = createRecoveryDownloadSnapshot();
    expect(fallback?.usedFallback).toBe(true);
    expect(fallback?.project.pascalConduitProjectId).toBe("stable-project");
    expect(fallback?.snapshotAt).toBe(cached?.snapshotAt);

    useOverlayStore.setState({ workspace: store.workspace, project: store.project, overlay: store.overlay, projectDirty: store.projectDirty, dirty: store.dirty, preview: store.preview });
  });
});
