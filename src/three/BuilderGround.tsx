import { Grid } from "@react-three/drei";
import { getBuilderPresentation } from "./builder-presentation";

/** Display-only ground and grid. Neither mesh can become a construction host. */
export function BuilderGround({ y }: { y: number }) {
  return <group name="builder-ground-grid">
    <mesh position={[0, y - .015, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow raycast={() => null} userData={{ builderInkGeometry: true }}>
      <planeGeometry args={[2000, 2000]} />
      <meshStandardMaterial color={getBuilderPresentation().ground} roughness={1} />
    </mesh>
    <Grid position={[0, y - .01, 0]} args={[200, 200]} cellSize={.5} sectionSize={5} cellThickness={.5} sectionThickness={.8} cellColor="#d5d5d0" sectionColor="#b0b0a8" fadeDistance={150} fadeStrength={1} infiniteGrid raycast={() => null} />
  </group>;
}
