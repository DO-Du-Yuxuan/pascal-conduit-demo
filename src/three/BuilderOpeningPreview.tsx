import { selectionAppearance } from "./selection-appearance";
import { useEffect, useMemo, useState } from "react";
import { BackSide, DoubleSide, FrontSide, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader } from "three";
import type { NodeData } from "../types";
import { resolveBuilderMaterialSchema, resolveBuilderRoleMaterial, type BuilderResolvedMaterial, type BuilderTextureSlot } from "./builder-materials";
import { buildBuilderOpeningGeometry, type BuilderOpeningPart } from "./builder-opening-geometry";

const slots: BuilderTextureSlot[] = ["map", "normalMap", "roughnessMap", "metalnessMap", "displacementMap", "aoMap", "emissiveMap", "bumpMap", "alphaMap", "lightMap"];

function OpeningSurface({ material, selected, opacityScale = 1 }: { material: BuilderResolvedMaterial; selected: boolean; opacityScale?: number }) {
  const [textures, setTextures] = useState<Partial<Record<BuilderTextureSlot, Texture>>>({});
  useEffect(() => {
    let active = true;
    const loaded: Partial<Record<BuilderTextureSlot, Texture>> = {};
    setTextures({});
    for (const slot of slots) {
      const source = material.maps[slot];
      if (!source) continue;
      new TextureLoader().load(source.url, (texture) => {
        if (!active) { texture.dispose(); return; }
        texture.wrapS = texture.wrapT = RepeatWrapping;
        texture.repeat.set(source.repeat[0], source.repeat[1]);
        if (slot === "map" || slot === "emissiveMap") texture.colorSpace = SRGBColorSpace;
        loaded[slot] = texture;
        setTextures({ ...loaded });
      }, undefined, () => undefined);
    }
    return () => { active = false; Object.values(loaded).forEach((texture) => texture?.dispose()); };
  }, [material]);
  const side = material.side === "double" ? DoubleSide : material.side === "back" ? BackSide : FrontSide;
  return <meshStandardMaterial {...selectionAppearance(material.color, selected, material.opacity * opacityScale)} roughness={material.roughness} metalness={material.metalness}
    transparent={material.transparent || opacityScale < 1} side={side}
    map={textures.map} normalMap={textures.normalMap} roughnessMap={textures.roughnessMap} metalnessMap={textures.metalnessMap}
    displacementMap={textures.displacementMap} aoMap={textures.aoMap} emissiveMap={textures.emissiveMap} bumpMap={textures.bumpMap}
    alphaMap={textures.alphaMap} lightMap={textures.lightMap} />;
}

/**
 * Optional read-only presentation component. Parent owns event/visibility policy
 * and supplies the same wall-local transform used by the wall cut.
 */
export function BuilderOpeningPreview({ node, selected = false, opacityScale = 1, onDiagnostic }: {
  node: NodeData;
  selected?: boolean;
  opacityScale?: number;
  onDiagnostic?: (diagnostic: string) => void;
}) {
  const output = useMemo(() => buildBuilderOpeningGeometry(node), [node]);
  useEffect(() => { output.diagnostics.forEach((diagnostic) => onDiagnostic?.(diagnostic)); }, [output, onDiagnostic]);
  useEffect(() => () => { output.parts.forEach((part) => part.geometry.dispose()); output.cutGeometry.dispose(); }, [output]);
  const joinery = useMemo(() => node.material && typeof node.material === "object"
    ? resolveBuilderMaterialSchema(node.material)
    : resolveBuilderRoleMaterial("joinery"), [node.material]);
  const glazing = useMemo(() => resolveBuilderRoleMaterial("glazing"), []);
  return <group name={`builder-opening:${node.id}`}>
    {output.parts.map((part: BuilderOpeningPart) => <mesh key={part.name} geometry={part.geometry} position={part.position} rotation-y={part.rotationY} castShadow receiveShadow>
      <OpeningSurface material={part.materialRole === "glazing" ? glazing : joinery} selected={selected} opacityScale={opacityScale} />
    </mesh>)}
  </group>;
}
