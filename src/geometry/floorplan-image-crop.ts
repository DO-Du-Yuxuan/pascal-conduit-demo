import { Diagnostic, NodeData } from "../types";
import { finalDimensions } from "./transform";

export const ALPHA_THRESHOLD = 16;
export const ASPECT_MISMATCH_THRESHOLD = 0.05;

export type PixelBounds = { x: number; y: number; width: number; height: number };
export type ImagePixelSource = { naturalWidth: number; naturalHeight: number; data: Uint8ClampedArray };
export type FloorplanImageCropCacheEntry = {
  imageUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  alphaThreshold: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  isFallback: boolean;
  fallbackReason: "empty-alpha" | "image-load-failed" | "canvas-unavailable" | "pixel-read-failed" | "invalid-pixel-data" | null;
};
export type CropPlacement = { drawWidth: number; drawHeight: number; offsetX: number; offsetY: number; scaleX: number; scaleY: number; uniformScaleApplied: boolean; contentAspectRatio: number; physicalAspectRatio: number; aspectDifferencePercent: number };
export type ImagePixelLoader = (imageUrl: string) => Promise<ImagePixelSource>;

const resolvedCache = new Map<string, FloorplanImageCropCacheEntry>(), pendingCache = new Map<string, Promise<FloorplanImageCropCacheEntry>>(), listeners = new Set<() => void>();
export const floorplanImageCropCacheKey = (imageUrl: string, alphaThreshold = ALPHA_THRESHOLD) => `${imageUrl}|alpha:${alphaThreshold}`;
const notify = () => listeners.forEach((listener) => listener());
export function subscribeFloorplanImageCrop(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function clearFloorplanImageCropCache() { resolvedCache.clear(); pendingCache.clear(); notify(); }
export function peekFloorplanImageCrop(imageUrl: string, alphaThreshold = ALPHA_THRESHOLD) { return resolvedCache.get(floorplanImageCropCacheKey(imageUrl, alphaThreshold)) ?? null; }

export function scanAlphaContentBounds(data: Uint8ClampedArray, width: number, height: number, alphaThreshold = ALPHA_THRESHOLD): PixelBounds | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length < width * height * 4) return null;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) if (data[(y * width + x) * 4 + 3]! >= alphaThreshold) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return maxX < minX || maxY < minY ? null : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function computeCropPlacement(bounds: PixelBounds, targetWidth: number, targetHeight: number): CropPlacement | null {
  if (![bounds.width, bounds.height, targetWidth, targetHeight].every((value) => Number.isFinite(value) && value > 0)) return null;
  const scaleX = targetWidth / bounds.width, scaleY = targetHeight / bounds.height, contentAspectRatio = bounds.width / bounds.height, physicalAspectRatio = targetWidth / targetHeight;
  return { drawWidth: targetWidth, drawHeight: targetHeight, offsetX: 0, offsetY: 0, scaleX, scaleY, uniformScaleApplied: Math.abs(scaleX - scaleY) <= 1e-12, contentAspectRatio, physicalAspectRatio, aspectDifferencePercent: Math.abs(contentAspectRatio - physicalAspectRatio) / physicalAspectRatio * 100 };
}

const fallback = (imageUrl: string, reason: FloorplanImageCropCacheEntry["fallbackReason"], naturalWidth = 0, naturalHeight = 0): FloorplanImageCropCacheEntry => ({ imageUrl, naturalWidth, naturalHeight, alphaThreshold: ALPHA_THRESHOLD, cropX: 0, cropY: 0, cropWidth: naturalWidth, cropHeight: naturalHeight, isFallback: true, fallbackReason: reason });

export const readImagePixels: ImagePixelLoader = (imageUrl) => new Promise((resolve, reject) => {
  if (typeof Image === "undefined" || typeof document === "undefined") { reject(new Error("canvas-unavailable")); return; }
  const image = new Image(); image.crossOrigin = "anonymous";
  image.onload = () => {
    const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) { reject(new Error("canvas-unavailable")); return; }
    try { context.drawImage(image, 0, 0); resolve({ naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, data: context.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data }); }
    catch { const error = new Error("pixel-read-failed") as Error & { naturalWidth?: number; naturalHeight?: number }; error.naturalWidth = image.naturalWidth; error.naturalHeight = image.naturalHeight; reject(error); }
  };
  image.onerror = () => reject(new Error("image-load-failed")); image.src = imageUrl;
});

export function loadFloorplanImageCrop(imageUrl: string, loader: ImagePixelLoader = readImagePixels): Promise<FloorplanImageCropCacheEntry> {
  const key = floorplanImageCropCacheKey(imageUrl), existing = resolvedCache.get(key); if (existing) return Promise.resolve(existing);
  const pending = pendingCache.get(key); if (pending) return pending;
  const request = loader(imageUrl).then((source) => {
    if (source.data.length < source.naturalWidth * source.naturalHeight * 4) return fallback(imageUrl, "invalid-pixel-data", source.naturalWidth, source.naturalHeight);
    const bounds = scanAlphaContentBounds(source.data, source.naturalWidth, source.naturalHeight);
    return bounds ? { imageUrl, naturalWidth: source.naturalWidth, naturalHeight: source.naturalHeight, alphaThreshold: ALPHA_THRESHOLD, cropX: bounds.x, cropY: bounds.y, cropWidth: bounds.width, cropHeight: bounds.height, isFallback: false, fallbackReason: null } as FloorplanImageCropCacheEntry : fallback(imageUrl, "empty-alpha", source.naturalWidth, source.naturalHeight);
  }).catch((error: Error & { naturalWidth?: number; naturalHeight?: number }) => fallback(imageUrl, (["image-load-failed", "canvas-unavailable", "pixel-read-failed"].includes(error.message) ? error.message : "pixel-read-failed") as FloorplanImageCropCacheEntry["fallbackReason"], error.naturalWidth ?? 0, error.naturalHeight ?? 0)).then((entry) => { resolvedCache.set(key, entry); pendingCache.delete(key); notify(); return entry; });
  pendingCache.set(key, request); return request;
}

export function floorplanImageCropDiagnostics(nodes: Record<string, NodeData>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const node of Object.values(nodes)) {
    if (node.type !== "item" || !node.asset?.floorPlanUrl) continue;
    const entry = peekFloorplanImageCrop(node.asset.floorPlanUrl); if (!entry) continue;
    if (entry.isFallback) diagnostics.push({ severity: "warning", code: entry.fallbackReason === "empty-alpha" ? "floorplan_image_empty_alpha" : "floorplan_image_crop_unavailable", message: entry.fallbackReason === "empty-alpha" ? "floorPlan 图片没有达到 alpha 阈值的有效像素，已回退整图显示" : `floorPlan 图片无法读取像素，已回退整图显示：${entry.fallbackReason}`, nodeId: node.id, sourcePath: `nodes.${node.id}.asset.floorPlanUrl` });
    const dimensions = finalDimensions(node), placement = dimensions && !entry.isFallback && entry.cropWidth > 0 && entry.cropHeight > 0 ? computeCropPlacement({ x: entry.cropX, y: entry.cropY, width: entry.cropWidth, height: entry.cropHeight }, dimensions.width, dimensions.depth) : null;
    if (placement && placement.aspectDifferencePercent > ASPECT_MISMATCH_THRESHOLD * 100) diagnostics.push({ severity: "warning", code: "floorplan_image_aspect_mismatch", message: `裁切内容与物理占地框宽高比差异 ${placement.aspectDifferencePercent.toFixed(2)}%，已使用 X/Y 独立缩放实现四边贴合`, nodeId: node.id, sourcePath: `nodes.${node.id}.asset.floorPlanUrl` });
  }
  return diagnostics;
}
