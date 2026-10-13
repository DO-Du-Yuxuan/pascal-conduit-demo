import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import {
  Color,
  DepthFormat,
  DepthTexture,
  DoubleSide,
  HalfFloatType,
  LinearFilter,
  LinearSRGBColorSpace,
  Mesh,
  MeshNormalMaterial,
  NearestFilter,
  NoToneMapping,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  WebGLRenderTarget,
} from "three";
import { getBuilderPresentation } from "./builder-presentation";

const EXCLUDED_AUXILIARY_NAME = /(?:^|[-_:])(layout-reference-plane|installation-plane|beam-reticle|beam-planar-position-dimensions|device-position-dimensions|snap-assist|target-reticle|route-preview|pointer-capture)(?:$|[-_:])/i;
const EXCLUDED_AUXILIARY_NAME_PART = /(?:dimension|snap:|target:|preview:|pointer-capture)/i;

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tDepth;
  uniform sampler2D tNormal;
  uniform vec2 resolution;
  uniform vec3 inkColor;
  uniform float radius;
  uniform float opacity;
  varying vec2 vUv;

  float smoothRange(float edge0, float edge1, float value) {
    float t = clamp((value - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
  }

  vec3 decodedNormal(vec2 uv) {
    return normalize(texture2D(tNormal, uv).xyz * 2.0 - 1.0);
  }

  void main() {
    vec2 px = vec2(radius) / resolution;
    float dC = texture2D(tDepth, vUv).r;
    float dR = texture2D(tDepth, vUv + vec2(px.x, 0.0)).r;
    float dL = texture2D(tDepth, vUv - vec2(px.x, 0.0)).r;
    float dU = texture2D(tDepth, vUv + vec2(0.0, px.y)).r;
    float dD = texture2D(tDepth, vUv - vec2(0.0, px.y)).r;

    float depthLap = abs(dR + dL + dU + dD - dC * 4.0);
    float invDepth = 1.0 - dC;
    float depthMetric = depthLap / (invDepth * invDepth + 0.00002);
    float noiseGate = smoothRange(0.00002, 0.00006, depthLap);
    float depthEdge = smoothRange(0.5, 2.5, depthMetric) * noiseGate;

    vec3 nC = decodedNormal(vUv);
    float nDiff = max(
      max(1.0 - dot(nC, decodedNormal(vUv + vec2(px.x, 0.0))), 1.0 - dot(nC, decodedNormal(vUv - vec2(px.x, 0.0)))),
      max(1.0 - dot(nC, decodedNormal(vUv + vec2(0.0, px.y))), 1.0 - dot(nC, decodedNormal(vUv - vec2(0.0, px.y))))
    );
    float normalEdge = smoothRange(0.01, 0.05, nDiff);
    float edgeMask = clamp(max(depthEdge, normalEdge) * opacity, 0.0, 1.0);
    vec3 sceneColor = texture2D(tDiffuse, vUv).rgb;
    gl_FragColor = vec4(mix(sceneColor, inkColor, edgeMask), 1.0);

    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function hasAuxiliaryAncestor(object: Object3D): boolean {
  for (let current: Object3D | null = object; current; current = current.parent) {
    if (EXCLUDED_AUXILIARY_NAME.test(current.name) || EXCLUDED_AUXILIARY_NAME_PART.test(current.name)) return true;
  }
  return false;
}

function isLowOpacityHelper(object: Object3D): boolean {
  const material = (object as Mesh).material;
  if (!material) return false;
  const materials = Array.isArray(material) ? material : [material];
  return materials.every((entry) => !entry.visible || (entry.transparent && entry.opacity <= 0.15));
}

function excludeFromNormalPass(object: Object3D): boolean {
  if (object.userData.builderInkGeometry) return false;
  const renderable = object as Object3D & { isLine?: boolean; isLineSegments?: boolean; isPoints?: boolean; isSprite?: boolean; isMesh?: boolean; raycast?: Object3D["raycast"] };
  if (renderable.isLine || renderable.isLineSegments || renderable.isPoints || renderable.isSprite) return true;
  if (hasAuxiliaryAncestor(object)) return true;
  if (renderable.isMesh && renderable.raycast && renderable.raycast !== Mesh.prototype.raycast) return true;
  return renderable.isMesh === true && isLowOpacityHelper(object);
}

function createTargets(width: number, height: number) {
  const beauty = new WebGLRenderTarget(width, height, { format: RGBAFormat, type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, depthBuffer: true, stencilBuffer: false });
  beauty.texture.colorSpace = LinearSRGBColorSpace;
  beauty.texture.generateMipmaps = false;

  const normal = new WebGLRenderTarget(width, height, { format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true, stencilBuffer: false });
  normal.texture.colorSpace = LinearSRGBColorSpace;
  normal.texture.generateMipmaps = false;
  const depth = new DepthTexture(width, height, UnsignedIntType);
  depth.format = DepthFormat;
  depth.minFilter = NearestFilter;
  depth.magFilter = NearestFilter;
  normal.depthTexture = depth;

  return { beauty, normal, depth };
}

export function BuilderInk({ opacity = 0.5 }: { opacity?: number }) {
  const { gl, scene, camera, size, invalidate } = useThree();
  const resources = useMemo(() => {
    const targets = createTargets(1, 1);
    const normalMaterial = new MeshNormalMaterial({ side: DoubleSide, toneMapped: false });
    const material = new ShaderMaterial({
      uniforms: {
        tDiffuse: { value: targets.beauty.texture },
        tDepth: { value: targets.depth },
        tNormal: { value: targets.normal.texture },
        resolution: { value: new Vector2(1, 1) },
        inkColor: { value: new Color(getBuilderPresentation().colors.ink) },
        radius: { value: 1 },
        opacity: { value: opacity },
      },
      vertexShader,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: true,
    });
    const outputScene = new Scene();
    const outputCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 2);
    outputCamera.position.z = 1;
    const outputPlane = new Mesh(new PlaneGeometry(2, 2), material);
    outputScene.add(outputPlane);
    return { ...targets, normalMaterial, material, outputScene, outputCamera, outputPlane, clearColor: new Color() };
  }, []);

  useEffect(() => {
    resources.material.uniforms.opacity.value = opacity;
  }, [opacity, resources]);

  useEffect(() => {
    invalidate();
  }, [invalidate]);

  useEffect(() => () => {
    resources.beauty.dispose();
    resources.normal.dispose();
    resources.depth.dispose();
    resources.normalMaterial.dispose();
    resources.material.dispose();
    resources.outputPlane.geometry.dispose();
  }, [resources]);

  useFrame(() => {
    const width = Math.max(1, Math.floor(size.width * gl.getPixelRatio()));
    const height = Math.max(1, Math.floor(size.height * gl.getPixelRatio()));
    if (resources.beauty.width !== width || resources.beauty.height !== height) {
      resources.beauty.setSize(width, height);
      resources.normal.setSize(width, height);
      resources.depth.image.width = width;
      resources.depth.image.height = height;
      resources.material.uniforms.resolution.value.set(width, height);
    }

    const previousTarget = gl.getRenderTarget();
    const previousOverride = scene.overrideMaterial;
    const previousBackground = scene.background;
    const previousToneMapping = gl.toneMapping;
    const previousColorSpace = gl.outputColorSpace;
    const previousAutoClear = gl.autoClear;
    const previousShadowMapEnabled = gl.shadowMap.enabled;
    const previousClearColor = gl.getClearColor(resources.clearColor);
    const previousClearAlpha = gl.getClearAlpha();
    const excluded: Array<[Object3D, boolean]> = [];
    try {
      gl.autoClear = false;
      gl.toneMapping = NoToneMapping;
      gl.outputColorSpace = LinearSRGBColorSpace;
      gl.setRenderTarget(resources.beauty);
      gl.setClearColor(0x000000, 0);
      gl.clear(true, true, true);
      gl.render(scene, camera);

      scene.traverse((object) => {
        if (!object.visible || !excludeFromNormalPass(object)) return;
        excluded.push([object, object.visible]);
        object.visible = false;
      });
      scene.background = null;
      scene.overrideMaterial = resources.normalMaterial;
      gl.setRenderTarget(resources.normal);
      gl.setClearColor(0x000000, 1);
      gl.clear(true, true, true);
      gl.shadowMap.enabled = false;
      gl.render(scene, camera);
      gl.shadowMap.enabled = previousShadowMapEnabled;

      scene.overrideMaterial = previousOverride;
      scene.background = previousBackground;
      for (const [object, visible] of excluded) object.visible = visible;
      excluded.length = 0;

      gl.setRenderTarget(previousTarget);
      gl.setClearColor(previousClearColor, previousClearAlpha);
      gl.toneMapping = previousToneMapping;
      gl.outputColorSpace = previousColorSpace;
      gl.autoClear = previousAutoClear;
      gl.shadowMap.enabled = previousShadowMapEnabled;
      gl.clear(true, true, true);
      gl.render(resources.outputScene, resources.outputCamera);
    } finally {
      scene.overrideMaterial = previousOverride;
      scene.background = previousBackground;
      for (const [object, visible] of excluded) object.visible = visible;
      gl.setRenderTarget(previousTarget);
      gl.setClearColor(previousClearColor, previousClearAlpha);
      gl.toneMapping = previousToneMapping;
      gl.outputColorSpace = previousColorSpace;
      gl.autoClear = previousAutoClear;
      gl.shadowMap.enabled = previousShadowMapEnabled;
    }
  }, 1);

  return null;
}
