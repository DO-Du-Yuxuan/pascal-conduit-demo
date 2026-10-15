import actualLegacyScene from "./fixtures/legacy-pascal-2026-10-13.json";
import { describe, expect, it } from "vitest";
import { importProjectJson } from "./project-import";
import { decodeUnifiedProject, encodeUnifiedProject } from "./unified-project";
import { parseProject } from "../parser/parse";

const legacy = () => ({
  projectId: "old-project", rootNodeIds: ["site"], installedPlugins: ["custom"], materials: { custom: true }, collections: {}, extra: { kept: true },
  nodes: {
    site: { id: "site", type: "site", parentId: null, children: ["building"] },
    building: { id: "building", type: "building", parentId: "site", children: ["level"] },
    level: { id: "level", type: "level", parentId: "building", children: ["wall", "future"] },
    wall: { id: "wall", type: "wall", parentId: "level", start: [0, 0], end: [2, 0], metadata: { kept: true } },
    future: { id: "future", type: "plugin:future", parentId: "level", payload: { kept: true } },
  },
});

describe("backward-compatible project import", () => {
  it("opens the reported 25-node scene and preserves every building field on save/reopen", () => {
    const raw = actualLegacyScene;
    expect(Object.keys(raw.nodes)).toHaveLength(25);
    const opened = importProjectJson(raw, "demo测试场景_2026-10-13.json", "sha");
    expect(Object.keys(parseProject(opened.projectRaw).nodes)).toHaveLength(25);
    const saved = encodeUnifiedProject(opened.projectRaw, opened.overlay);
    for (const [id, node] of Object.entries(raw.nodes)) {
      if (node.type === "site") {
        expect(saved.nodes[id]).toMatchObject({ ...node, type: "Site", children: saved.nodes[id].children });
        expect(saved.nodes[id].children?.slice(0, 1)).toEqual(raw.nodes.site_cmb439xvsc9y2d2n.children);
      } else if (node.type === "level") expect(saved.nodes[id]).toMatchObject({ ...node, type: "Level" });
      else expect(saved.nodes[id]).toEqual({ ...node, type: node.type[0].toUpperCase() + node.type.slice(1) });
    }
    expect(saved.projectId).toBe(raw.projectId);
    expect(saved.pascalConduitProjectId).toBe(raw.projectId);
    expect(saved.installedPlugins).toEqual(raw.installedPlugins);
    const reopened = importProjectJson(JSON.parse(JSON.stringify(saved)), "saved.json", "sha2");
    expect(reopened.importNotice).toBeNull();
    expect(encodeUnifiedProject(reopened.projectRaw, reopened.overlay)).toEqual(saved);
  });

  it.each(["1.0", "2.0", "3.0"])("imports supported %s trees with stable identity and no duplicate containers", (schemaVersion) => {
    const raw = { ...legacy(), schemaVersion, pascalConduitProjectId: "persisted" };
    const first = importProjectJson(raw, "a.json", "sha");
    const saved = encodeUnifiedProject(first.projectRaw, first.overlay);
    const again = importProjectJson({ ...saved, schemaVersion }, "b.json", "other-sha");
    expect(encodeUnifiedProject(again.projectRaw, again.overlay)).toEqual(saved);
    expect(saved.pascalConduitProjectId).toBe("persisted");
  });

  it("uses collision-safe container IDs and a filename-independent fallback project identity", () => {
    const raw: any = legacy();
    delete raw.projectId;
    raw.nodes["site:ElectricalSystem"] = { id: "site:ElectricalSystem", type: "FutureDevice", parentId: "level", value: 3 };
    raw.nodes.level.children.push("site:ElectricalSystem");
    const a = importProjectJson(raw, "a.json", "sha"), b = importProjectJson(raw, "b.json", "new-sha");
    expect(a.overlay.source.projectId).toBe(b.overlay.source.projectId);
    const saved = encodeUnifiedProject(a.projectRaw, a.overlay);
    expect(saved.nodes["site:ElectricalSystem"]).toEqual(raw.nodes["site:ElectricalSystem"]);
    expect(saved.nodes["site:ElectricalSystem:1"].type).toBe("ElectricalSystem");
  });

  it.each([
    ["misowned", (raw: any) => {
      raw.nodes.electrical = { id: "electrical", type: "ElectricalSystem", parentId: "building", children: [] };
      raw.nodes.building.children.push("electrical");
    }],
    ["duplicated", (raw: any) => {
      raw.nodes.electrical = { id: "electrical", type: "ElectricalSystem", parentId: "site", children: [] };
      raw.nodes.electrical2 = { id: "electrical2", type: "ElectricalSystem", parentId: "site", children: [] };
      raw.nodes.site.children.push("electrical", "electrical2");
    }],
  ])("does not repair or hide an existing %s system container", (_case, prepare) => {
    const raw: any = legacy();
    prepare(raw);
    const before = structuredClone(raw);
    expect(() => importProjectJson(raw, "bad-container.json", "sha")).toThrow();
    expect(raw).toEqual(before);
  });

  it("preserves project and node IDs plus unknown future data, and leaves failed legacy input untouched", () => {
    const raw: any = legacy();
    raw.nodes.future.payload = { nested: ["keep", { revision: 7 }] };
    const before = structuredClone(raw);
    const first = importProjectJson(raw, "first.json", "sha");
    const second = importProjectJson(raw, "second.json", "other-sha");
    const saved = encodeUnifiedProject(first.projectRaw, first.overlay);
    const savedAgain = encodeUnifiedProject(second.projectRaw, second.overlay);

    expect(saved.pascalConduitProjectId).toBe(raw.projectId);
    expect(saved.nodes.future).toEqual(raw.nodes.future);
    expect(Object.keys(saved.nodes).sort()).toEqual(Object.keys(savedAgain.nodes).sort());
    expect(saved.nodes.building.id).toBe(raw.nodes.building.id);
    expect(saved.nodes.level.id).toBe(raw.nodes.level.id);
    expect(raw).toEqual(before);

    const invalid = structuredClone(raw);
    invalid.nodes.wall.parentId = "missing-parent";
    const invalidBefore = structuredClone(invalid);
    expect(() => importProjectJson(invalid, "invalid-legacy.json", "sha")).toThrow();
    expect(invalid).toEqual(invalidBefore);
  });

  it("rejects an unversioned canonical Site/Building tree instead of filling its missing 4.0 identity and systems", () => {
    const raw: any = legacy();
    for (const node of Object.values(raw.nodes) as any[]) {
      node.type = node.type[0].toUpperCase() + node.type.slice(1);
    }
    delete raw.projectId;
    const before = structuredClone(raw);

    expect(() => importProjectJson(raw, "missing-version.json", "sha")).toThrow();
    expect(raw).toEqual(before);
    expect(raw.nodes.site.children).toEqual(["building"]);
  });

  it("rejects damaged trees, unsupported versions, retired entities and standalone overlays without mutation", () => {
    const invalid: any[] = [
      { ...legacy(), schemaVersion: "5.0" },
      { ...legacy(), schemaVersion: "2.3", source: {}, segments: [] },
      { schemaVersion: "2.3", source: {}, segments: [] },
    ];
    const broken: any = legacy(); broken.nodes.wall.parentId = "missing"; invalid.push(broken);
    const retired: any = legacy(); retired.nodes.wall.type = "Sensor"; invalid.push(retired);
    for (const raw of invalid) {
      const before = structuredClone(raw);
      expect(() => importProjectJson(raw, "bad.json", "sha")).toThrow();
      expect(raw).toEqual(before);
    }
    const four: any = { ...legacy(), schemaVersion: "4.0" };
    expect(() => importProjectJson(four, "bad4.json", "sha")).toThrow();
  });

  it("imports a legacy Pascal tree and saves a valid 4.0 project without changing source data", () => {
    const raw = legacy(), before = structuredClone(raw);
    const opened = importProjectJson(raw, "old.json", "sha");
    expect(parseProject(opened.projectRaw).nodes.wall.type).toBe("wall");
    const saved = encodeUnifiedProject(opened.projectRaw, opened.overlay);
    expect(saved.schemaVersion).toBe("4.0");
    expect(saved.pascalConduitProjectId).toBe(raw.projectId);
    expect(saved.nodes.wall).toEqual({ ...raw.nodes.wall, type: "Wall" });
    expect(saved.nodes.future).toEqual(raw.nodes.future);
    expect(saved.extra).toEqual(raw.extra);
    expect(saved.installedPlugins).toEqual(raw.installedPlugins);
    expect(saved.materials).toEqual(raw.materials);
    expect(saved.nodes.site.children).toHaveLength(11);
    expect(() => decodeUnifiedProject(saved, "saved.json", "sha2")).not.toThrow();
    expect(raw).toEqual(before);
    expect(opened.importNotice).toMatch(/4.0/);
  });
});
