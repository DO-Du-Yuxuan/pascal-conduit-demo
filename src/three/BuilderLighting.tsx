import { getBuilderPresentation } from "./builder-presentation";

/** Studio key, fill, ambient and hemisphere light used by Builder's viewer. */
export function BuilderLighting({ shadowsEnabled = true }: { shadowsEnabled?: boolean }) {
  const theme = getBuilderPresentation();
  const { ambient, hemisphere, key, fill } = theme.lighting;
  return <>
    <ambientLight color={ambient.color} intensity={ambient.intensity} />
    <hemisphereLight color={hemisphere.sky} groundColor={hemisphere.ground} intensity={hemisphere.intensity} />
    <directionalLight
      color={key.color}
      position={key.position}
      intensity={key.intensity}
      castShadow={shadowsEnabled}
      shadow-bias={-0.002}
      shadow-mapSize={[1024, 1024]}
      shadow-normalBias={0.3}
      shadow-radius={1.5}
    >
      <orthographicCamera attach="shadow-camera" left={-50} right={50} top={50} bottom={-50} near={1} far={100} />
    </directionalLight>
    <directionalLight color={fill.color} position={fill.position} intensity={fill.intensity} />
  </>;
}
