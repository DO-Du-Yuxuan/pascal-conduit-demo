import {
  getEffectiveWallSurfaceMaterial,
  getMaterialPresetByRef,
  resolveMaterial,
  type MaterialSchema,
  type WallNode,
  type WallSurfaceMaterialSpec,
} from "@pascal-app/core";
import { getBuilderPresentation } from "./builder-presentation";
import type { NodeData } from "../types";

export type BuilderSurfaceRole = "wall" | "floor" | "ceiling" | "roof" | "joinery" | "glazing" | "furnishing" | "beam";

export type BuilderTextureSlot =
  | "map"
  | "normalMap"
  | "roughnessMap"
  | "metalnessMap"
  | "displacementMap"
  | "aoMap"
  | "emissiveMap"
  | "bumpMap"
  | "alphaMap"
  | "lightMap";

export type BuilderMaterialTexture = {
  url: string;
  repeat: [number, number];
};

export type BuilderResolvedMaterial = {
  source: "clay-role" | "material-schema" | "library-preset";
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  transparent: boolean;
  side: "front" | "back" | "double";
  maps: Partial<Record<BuilderTextureSlot, BuilderMaterialTexture>>;
  diagnostics: string[];
};

export type BuilderWallMaterialSet = {
  base: BuilderResolvedMaterial;
  interior: BuilderResolvedMaterial;
  exterior: BuilderResolvedMaterial;
  diagnostics: string[];
};

export type BuilderWallMaterialOptions = {
  /** Texture references are retained by default; false keeps all saved scalar properties. */
  textures?: boolean;
  /** Builder Studio visual role used only when a side has no explicit material. */
  role?: BuilderSurfaceRole;
};

const MATERIAL_MAP_SLOTS: Array<[string, BuilderTextureSlot]> = [
  ["albedoMap", "map"],
  ["normalMap", "normalMap"],
  ["roughnessMap", "roughnessMap"],
  ["metalnessMap", "metalnessMap"],
  ["displacementMap", "displacementMap"],
  ["aoMap", "aoMap"],
  ["emissiveMap", "emissiveMap"],
  ["bumpMap", "bumpMap"],
  ["alphaMap", "alphaMap"],
  ["lightMap", "lightMap"],
];

/**
 * Resolves Builder wall base and side materials without mutating the project.
 * `textures` controls only texture use; saved colors and PBR values always win.
 */
export function resolveBuilderWallMaterials(
  wall: NodeData,
  { textures = true, role = "wall" }: BuilderWallMaterialOptions = {},
): BuilderWallMaterialSet {
  const typedWall = wall as WallNode;
  const base = resolveBuilderRoleMaterial(role);
  const interior = resolveWallSide(getEffectiveWallSurfaceMaterial(typedWall, "interior"), textures, role);
  const exterior = resolveWallSide(getEffectiveWallSurfaceMaterial(typedWall, "exterior"), textures, role);
  const diagnostics = [...interior.diagnostics, ...exterior.diagnostics];
  return { base, interior, exterior, diagnostics: [...new Set(diagnostics)] };
}

/** Resolve a Builder Studio role for any building surface with no saved material. */
export function resolveBuilderRoleMaterial(role: BuilderSurfaceRole): BuilderResolvedMaterial {
  const colors = getBuilderPresentation().colors;
  const colorByRole: Record<BuilderSurfaceRole, string> = {
    wall: colors.wall,
    floor: colors.floor,
    ceiling: colors.ceiling,
    roof: colors.roof,
    joinery: colors.joinery,
    glazing: colors.glazing,
    furnishing: colors.furnishing,
    beam: colors.beam,
  };
  const glazing = role === "glazing";
  return {
    source: "clay-role",
    color: colorByRole[role],
    roughness: glazing ? 0.35 : 0.9,
    metalness: 0,
    opacity: glazing ? getBuilderPresentation().glazingOpacity : 1,
    transparent: glazing,
    side: glazing ? "double" : "front",
    maps: {},
    diagnostics: [],
  };
}

/** Resolve an explicit material schema without applying a Builder role tint. */
export function resolveBuilderMaterialSchema(
  material: MaterialSchema,
  { textures = true }: Pick<BuilderWallMaterialOptions, "textures"> = {},
): BuilderResolvedMaterial {
  return materialSchema(material, textures);
}

function resolveWallSide(
  spec: WallSurfaceMaterialSpec,
  textures: boolean,
  role: BuilderSurfaceRole,
): BuilderResolvedMaterial {
  if (spec.materialPreset) {
    const preset = getMaterialPresetByRef(spec.materialPreset);
    if (!preset) {
      return {
        ...resolveBuilderRoleMaterial(role),
        diagnostics: [`wall_material_preset_unresolved:${spec.materialPreset}`],
      };
    }
    const props = preset.mapProperties;
    const side = props.side === 1 ? "back" : props.side === 2 ? "double" : "front";
    const maps: BuilderResolvedMaterial["maps"] = {};
    if (textures) {
      for (const [sourceKey, slot] of MATERIAL_MAP_SLOTS) {
        const url = preset.maps[sourceKey as keyof typeof preset.maps];
        if (typeof url === "string" && url.length > 0) {
          maps[slot] = { url, repeat: [props.repeatX, props.repeatY] };
        }
      }
    }
    return {
      source: "library-preset",
      color: props.color,
      roughness: props.roughness,
      metalness: props.metalness,
      opacity: props.opacity,
      transparent: props.transparent || props.opacity < 1,
      side,
      maps,
      diagnostics: [],
    };
  }

  if (spec.material) return materialSchema(spec.material, textures);
  return resolveBuilderRoleMaterial(role);
}

function materialSchema(material: MaterialSchema, textures: boolean): BuilderResolvedMaterial {
  const props = resolveMaterial(material);
  const maps: BuilderResolvedMaterial["maps"] = {};
  if (textures && material.texture?.url) {
    const repeat = material.texture.repeat ?? [material.texture.scale ?? 1, material.texture.scale ?? 1];
    maps.map = { url: material.texture.url, repeat: [repeat[0], repeat[1]] };
  }
  return {
    source: "material-schema",
    color: props.color,
    roughness: props.roughness,
    metalness: props.metalness,
    opacity: props.opacity,
    transparent: props.transparent || props.opacity < 1,
    side: props.side,
    maps,
    diagnostics: [],
  };
}

