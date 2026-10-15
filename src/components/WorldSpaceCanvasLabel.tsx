import { useEffect, useMemo } from "react";
import { CanvasTexture, FrontSide, Matrix4, Quaternion, SRGBColorSpace, Vector3 } from "three";
import type { Vec3 } from "../domain/overlay";

const METERS_PER_PIXEL = .001;
const FONT_STACK = "'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif";

/** Fixed physical-size text painted locally and oriented in world space. */
export function WorldSpaceCanvasLabel({ text, position, right, up, normal, fontSizeMm = 34, color = "#a43b22", canvasHeightMm = 48, renderOrder = 13, framed = false }: { text: string; position: Vec3; right: Vec3; up: Vec3; normal: Vec3; fontSizeMm?: number; color?: string; canvasHeightMm?: number; renderOrder?: number; framed?: boolean }) {
  const label = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas"), context = canvas.getContext("2d");
    if (!context) return null;
    context.font = `${fontSizeMm}px ${FONT_STACK}`;
    const padding = framed ? 10 : 4;
    canvas.width = Math.max(1, Math.ceil(context.measureText(text).width + padding * 2));
    canvas.height = canvasHeightMm;
    context.font = `${fontSizeMm}px ${FONT_STACK}`; context.fillStyle = color; context.textAlign = "center"; context.textBaseline = "middle";
    if (framed) {
      const inset = 1.5, radius = 5;
      context.beginPath();
      context.roundRect(inset, inset, canvas.width - inset * 2, canvas.height - inset * 2, radius);
      context.fillStyle = "rgba(255, 253, 247, 0.94)"; context.fill();
      context.strokeStyle = "rgba(92, 74, 58, 0.72)"; context.lineWidth = 1; context.stroke();
    }
    context.fillStyle = color;
    context.fillText(text, canvas.width / 2, canvas.height / 2);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    return { texture, width: canvas.width * METERS_PER_PIXEL, height: canvas.height * METERS_PER_PIXEL };
  }, [text, fontSizeMm, color, canvasHeightMm, framed]);
  useEffect(() => () => label?.texture.dispose(), [label]);
  if (!label) return null;
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(new Vector3(...right), new Vector3(...up), new Vector3(...normal)));
  return <mesh position={position} quaternion={quaternion} renderOrder={renderOrder} raycast={() => null}>
    <planeGeometry args={[label.width, label.height]} />
    <meshBasicMaterial map={label.texture} transparent alphaTest={.04} depthTest depthWrite={false} side={FrontSide} toneMapped={false} />
  </mesh>;
}
