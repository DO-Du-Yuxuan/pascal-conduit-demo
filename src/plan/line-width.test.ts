import { describe, expect, it } from 'vitest';
import { planConduitStrokeWidth } from './line-width';

describe('planConduitStrokeWidth', () => {
  it('keeps the saved physical diameter and adds only a fixed screen-space readability floor', () => {
    const atScale50 = planConduitStrokeWidth(20, 50);
    const fireAtScale50 = planConduitStrokeWidth(50, 50);
    expect(atScale50).toBeCloseTo(Math.max(.02, 1.8 / 50));
    expect(fireAtScale50).toBeCloseTo(.05);
    expect(fireAtScale50).toBeGreaterThan(atScale50);
    expect(planConduitStrokeWidth(20, 100)).toBeCloseTo(.02);
  });

  it('uses a safe readable width when scale or diameter is invalid', () => {
    expect(planConduitStrokeWidth(Number.NaN, 0)).toBeCloseTo(1.8);
    expect(planConduitStrokeWidth(-10, 50)).toBeCloseTo(1.8 / 50);
  });
});
