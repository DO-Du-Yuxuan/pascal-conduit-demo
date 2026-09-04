import {z} from 'zod';
export const nodeSchema=z.object({id:z.string().optional(),type:z.string()}).passthrough();
export const zoneNodeSchema=nodeSchema.extend({type:z.literal('zone'),spaceFunctionCode:z.string().optional()}).passthrough();
export const doorNodeSchema=nodeSchema.extend({type:z.literal('door'),isPrimaryEntrance:z.boolean().optional()}).passthrough();
export const projectSchema=z.object({nodes:z.record(z.string(),z.unknown()),rootNodeIds:z.array(z.string()).optional(),installedPlugins:z.array(z.unknown()).optional()}).passthrough();
