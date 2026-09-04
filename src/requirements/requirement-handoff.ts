import { z } from "zod";

export const requirementTypeSchema = z.enum([
  "space_presence",
  "space_count",
  "space_area",
  "level_location",
  "space_adjacency",
  "space_separation",
  "manual",
]);

const targetSpaceSchema = z.object({
  semantic: z.string().trim().min(1),
  label: z.string().trim().min(1).optional(),
});

const levelTargetSchema = z.object({
  levelId: z.string().trim().min(1).optional(),
  ordinal: z.number().int().optional(),
  name: z.string().trim().min(1).optional(),
}).refine((value) => value.levelId !== undefined || value.ordinal !== undefined || value.name !== undefined, {
  message: "楼层条件至少需要 levelId、ordinal 或 name 之一",
});

const baseRequirementSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  type: requirementTypeSchema,
  autoCheckSupported: z.boolean(),
  manualReviewNote: z.string().trim().min(1).optional(),
  originalDescription: z.string().trim().min(1).optional(),
});

const presenceRequirementSchema = baseRequirementSchema.extend({
  type: z.literal("space_presence"),
  targetSpace: targetSpaceSchema,
});

const countRequirementSchema = baseRequirementSchema.extend({
  type: z.literal("space_count"),
  targetSpace: targetSpaceSchema,
  quantity: z.object({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }).refine((value) => value.min !== undefined || value.max !== undefined, { message: "数量条件至少需要 min 或 max" }),
});

const areaRequirementSchema = baseRequirementSchema.extend({
  type: z.literal("space_area"),
  targetSpace: targetSpaceSchema,
  area: z.object({
    mode: z.enum(["any", "every", "total"]),
    minSquareMeters: z.number().nonnegative().optional(),
    maxSquareMeters: z.number().nonnegative().optional(),
  }).refine((value) => value.minSquareMeters !== undefined || value.maxSquareMeters !== undefined, { message: "面积条件至少需要最小值或最大值" }),
});

const levelRequirementSchema = baseRequirementSchema.extend({
  type: z.literal("level_location"),
  targetSpace: targetSpaceSchema,
  level: levelTargetSchema,
  quantity: z.object({
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  }).optional(),
});

const relationshipRequirementSchema = baseRequirementSchema.extend({
  leftSpace: targetSpaceSchema,
  rightSpace: targetSpaceSchema,
  relationship: z.enum(["directly_connected", "directly_adjacent"]),
});

const adjacencyRequirementSchema = relationshipRequirementSchema.extend({
  type: z.literal("space_adjacency"),
});

const separationRequirementSchema = relationshipRequirementSchema.extend({
  type: z.literal("space_separation"),
});

const manualRequirementSchema = baseRequirementSchema.extend({
  type: z.literal("manual"),
  autoCheckSupported: z.literal(false),
  manualReviewNote: z.string().trim().min(1),
});

export const requirementSchema = z.discriminatedUnion("type", [
  presenceRequirementSchema,
  countRequirementSchema,
  areaRequirementSchema,
  levelRequirementSchema,
  adjacencyRequirementSchema,
  separationRequirementSchema,
  manualRequirementSchema,
]);

export const requirementHandoffSchema = z.object({
  schemaVersion: z.literal("0.1"),
  source: z.object({
    name: z.string().trim().min(1),
    externalReference: z.string().trim().min(1).optional(),
  }),
  requirements: z.array(requirementSchema).min(1),
}).superRefine((value, context) => {
  const seen = new Set<string>();
  value.requirements.forEach((requirement, index) => {
    if (seen.has(requirement.id)) context.addIssue({ code: "custom", path: ["requirements", index, "id"], message: `需求 ID 重复：${requirement.id}` });
    seen.add(requirement.id);
  });
});

export type RequirementHandoff = z.infer<typeof requirementHandoffSchema>;
export type CustomerRequirement = RequirementHandoff["requirements"][number];
export type RequirementType = z.infer<typeof requirementTypeSchema>;
export type TargetSpace = z.infer<typeof targetSpaceSchema>;

export type RequirementLoadResult =
  | { ok: true; handoff: RequirementHandoff }
  | { ok: false; error: string };

export function parseRequirementHandoff(input: unknown): RequirementLoadResult {
  const parsed = requirementHandoffSchema.safeParse(input);
  if (parsed.success) return { ok: true, handoff: parsed.data };
  const details = parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".") || "root"}：${issue.message}`).join("；");
  return { ok: false, error: `客户需求 JSON 格式错误：${details}` };
}

export function loadRequirementHandoffJson(text: string): RequirementLoadResult {
  try {
    return parseRequirementHandoff(JSON.parse(text));
  } catch {
    return { ok: false, error: "客户需求 JSON 格式错误：文件不是有效 JSON。" };
  }
}
