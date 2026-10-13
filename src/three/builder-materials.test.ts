import { describe, expect, it } from "vitest";
import type { MaterialSchema } from "@pascal-app/core";
import type { NodeData } from "../types";
import {
  resolveBuilderMaterialSchema,
  resolveBuilderRoleMaterial,
  resolveBuilderWallMaterials,
} from "./builder-materials";

describe("Builder material resolver", () => {
  it("uses Studio role colors for missing wall sides and honors side-specific material overrides", () => {
    const wall: NodeData = {
      id: "wall-1",
      type: "wall",
      material: { preset: "custom", properties: { color: "#b0b0b0", roughness: 0.7 } },
      interiorMaterial: { preset: "custom", properties: { color: "#cc5533", roughness: 0.32, metalness: 0.1 } },
    };

    const resolved = resolveBuilderWallMaterials(wall);
    expect(resolved.base).toMatchObject({ source: "clay-role", color: "#e9e5db", roughness: 0.9 });
    expect(resolved.interior).toMatchObject({ source: "material-schema", color: "#cc5533", roughness: 0.32, metalness: 0.1 });
    expect(resolved.exterior).toMatchObject({ source: "material-schema", color: "#b0b0b0", roughness: 0.7 });
  });

  it("resolves other Builder surface roles without changing project data", () => {
    expect(resolveBuilderRoleMaterial("floor")).toMatchObject({ source: "clay-role", color: "#d8d2c4" });
    expect(resolveBuilderRoleMaterial("ceiling")).toMatchObject({ color: "#f1ede4" });
  });

  it("keeps explicit PBR properties when textures are disabled and enables saved texture references by default", () => {
    const schema: MaterialSchema = {
      preset: "custom",
      properties: { color: "#725640", roughness: 0.41, metalness: 0.24, opacity: 0.8, transparent: true, side: "double" },
      texture: { url: "https://assets.example.test/wood.png", repeat: [2, 3] },
    };
    const before = JSON.stringify(schema);
    const textured = resolveBuilderMaterialSchema(schema);
    const flat = resolveBuilderMaterialSchema(schema, { textures: false });

    expect(textured).toMatchObject({ color: "#725640", roughness: 0.41, metalness: 0.24, opacity: 0.8, transparent: true, side: "double" });
    expect(textured.maps.map).toEqual({ url: schema.texture!.url, repeat: [2, 3] });
    expect(flat.maps).toEqual({});
    expect(flat).toMatchObject({ color: "#725640", roughness: 0.41, metalness: 0.24, opacity: 0.8, side: "double" });
    expect(JSON.stringify(schema)).toBe(before);
  });

  it("resolves library presets and reports an unknown preset without mutating the wall", () => {
    const presetWall: NodeData = { id: "wood-wall", type: "wall", interiorMaterialPreset: "library:wood-finewood27" };
    const before = JSON.stringify(presetWall);
    const presetResult = resolveBuilderWallMaterials(presetWall);
    expect(presetResult.interior.source).toBe("library-preset");
    expect(presetResult.interior.maps.map?.url).toBeTruthy();

    const unknownWall: NodeData = { id: "unknown-wall", type: "wall", exteriorMaterialPreset: "library:not-a-real-preset" };
    const unknownResult = resolveBuilderWallMaterials(unknownWall);
    expect(unknownResult.exterior.color).toBe("#e9e5db");
    expect(unknownResult.diagnostics).toContain("wall_material_preset_unresolved:library:not-a-real-preset");
    expect(JSON.stringify(presetWall)).toBe(before);
  });
});
