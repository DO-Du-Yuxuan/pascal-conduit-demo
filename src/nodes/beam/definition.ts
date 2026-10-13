import {
  createBeam,
  DEFAULT_BEAM_HEIGHT_METERS,
  DEFAULT_BEAM_WIDTH_METERS,
  editBeam,
  resizeBeamLength,
  validateBeam,
} from "../../domain/beams";
import { beamPlanarClearances, editBeamPlanarClearance } from "../../domain/beam-positioning";
import { BeamFootprint } from "./BeamFootprint";
import { BeamRenderer } from "./BeamRenderer";
import { beamFootprintLayout, beamRenderTransform, buildBeamGeometry, resolveBeamSurfaceHit } from "./geometry";

/** Demo-local analogue of a registered node contribution. All persistence and
 * geometry rules delegate to the existing domain modules; this is only the
 * composition/read interface used by display and host adapters. */
export const beamNodeDefinition = {
  kind: "beam" as const,
  category: "structure" as const,
  defaults: () => ({ width: DEFAULT_BEAM_WIDTH_METERS, height: DEFAULT_BEAM_HEIGHT_METERS }),
  parameters: [
    { key: "width", label: "宽度", unit: "mm", defaultValue: DEFAULT_BEAM_WIDTH_METERS * 1000, min: 1, step: 1 },
    { key: "height", label: "高度", unit: "mm", defaultValue: DEFAULT_BEAM_HEIGHT_METERS * 1000, min: 1, step: 1 },
  ] as const,
  schema: { validate: validateBeam },
  create: createBeam,
  edit: editBeam,
  parametrics: {
    buildGeometry: buildBeamGeometry,
    renderTransform: beamRenderTransform,
    surfaceHit: resolveBeamSurfaceHit,
    planFootprint: beamFootprintLayout,
    planClearances: beamPlanarClearances,
    editPlanClearance: editBeamPlanarClearance,
    resizeLength: resizeBeamLength,
  },
  Renderer: BeamRenderer,
  PlanRenderer: BeamFootprint,
} as const;

export type BeamNodeDefinition = typeof beamNodeDefinition;
