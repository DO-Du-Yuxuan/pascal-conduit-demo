import { describe, expect, it } from 'vitest';
import { addHvacOutlet, addHvacWallPenetration, appendHvacDuctSegment, bindThermostat, createHvacDuct, deleteHvacObject, editHvacOutlet, editIndoorUnit, hvacAxisPlanarReferences, hvacOutletEdgeClearances, HVAC_DEFAULT_SECTION_MM, indoorUnitCasingSizeMeters, indoorUnitFootprint, indoorUnitPort, indoorUnitPortDirection, placeIndoorUnit, placeThermostat, projectFirstDuctSegmentFromPort, resizeHvacTerminalSegment } from './hvac';
import { createEmptyOverlay } from './overlay';

const point = (x: number, y: number, z: number) => ({ position: [x, y, z] as [number, number, number] });
describe('HVAC Overlay', () => {
  it('treats a placement point as the indoor unit bottom support, not its center', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    expect(placed.unit.position.position).toEqual([0, 2.85, 0]);
    expect(placed.unit).toMatchObject({ name: 'FCU 空调内机', sizeMm: [1000, 600, 300], sectionMm: [500, 200] });
  });
  it('keeps the FCU casing envelope and bottom support independent from the duct section', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const footprint = indoorUnitFootprint(placed.unit);
    const edited = editIndoorUnit(placed.overlay, placed.unit.id, { sectionMm: [800, 400] });
    if ('reason' in edited) throw new Error('fixture');
    const unit = edited.overlay.hvac.indoorUnits[0]!;

    expect(unit).toMatchObject({ sizeMm: [1000, 600, 300], sectionMm: [800, 400], position: placed.unit.position });
    expect(indoorUnitCasingSizeMeters(placed.unit)).toEqual([.6, .3, 1]);
    expect(indoorUnitCasingSizeMeters(unit)).toEqual([.6, .3, 1]);
    expect(indoorUnitFootprint(unit)).toEqual(footprint);
    expect(unit.position.position[1] - unit.sizeMm[2] / 2000).toBeCloseTo(2.7);
  });
  it('keeps one shared rectangular section and one non-branching route per unit/system', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const routed = createHvacDuct(placed.overlay, placed.unit.id, 'supply', point(0, 2.7, 0), point(2, 2.85, .3));
    expect(routed).toHaveProperty('duct');
    if (!('duct' in routed)) throw new Error('fixture');
    expect(routed.overlay.hvac.indoorUnits[0]?.sectionMm).toEqual(HVAC_DEFAULT_SECTION_MM);
    expect(createHvacDuct(routed.overlay, placed.unit.id, 'supply', point(0, 2.7, 0), point(0, 2.7, 2))).toHaveProperty('reason');
  });
  it('starts a supply duct at the indoor unit supply port, never an arbitrary click point', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const routed = createHvacDuct(placed.overlay, placed.unit.id, 'supply', point(99, 2.7, 99), point(0, 2.7, 2));
    if (!('duct' in routed)) throw new Error('fixture');
    const firstSegment = routed.overlay.hvac.segments.find(segment => segment.id === routed.duct.segmentIds[0]);
    expect(firstSegment?.start.position).toEqual([0, 2.85, 0.5]);
  });
  it('keeps the plan footprint and supply/return ports in the same yaw frame as the 3D unit', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(1, 2.7, 3));
    const edited = editIndoorUnit(placed.overlay, placed.unit.id, { rotationYDegrees: 90 });
    if ('reason' in edited) throw new Error('fixture');
    const unit = edited.overlay.hvac.indoorUnits[0]!;
    expect(indoorUnitPort(unit, 'supply').position).toEqual([1.5, 2.85, 3]);
    expect(indoorUnitPort(unit, 'return').position).toEqual([0.5, 2.85, 3]);
    expect(indoorUnitFootprint(unit).map(point => [Number(point[0].toFixed(3)), Number(point[2].toFixed(3))])).toEqual([[0.5, 3.3], [0.5, 2.7], [1.5, 2.7], [1.5, 3.3]]);
  });
  it('measures all signed plan axes from the indoor-unit envelope to the first physical wall or indoor unit', () => {
    const first = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const second = placeIndoorUnit(first.overlay, point(2, 2.7, 0));
    const references = hvacAxisPlanarReferences(second.unit, [
      { id: 'west-wall', start: [-3, 0, -2], end: [-3, 0, 2], normal: [1, 0, 0], halfThickness: .1 },
      { id: 'east-wall', start: [4, 0, -2], end: [4, 0, 2], normal: [-1, 0, 0], halfThickness: .1 },
      { id: 'south-wall', start: [-2, 0, -4], end: [2, 0, -4], normal: [0, 0, 1], halfThickness: .1 },
      { id: 'north-wall', start: [-2, 0, 5], end: [2, 0, 5], normal: [0, 0, -1], halfThickness: .1 },
    ], second.overlay.hvac.indoorUnits);
    expect(references.map(reference => [reference.label, reference.targetKind, reference.targetId, reference.millimeters])).toEqual([
      ['+X', 'wall', 'east-wall', 1600], ['−X', 'indoor-unit', first.unit.id, 1400], ['+Z', 'wall', 'north-wall', 4400], ['−Z', 'wall', 'south-wall', 3400],
    ]);
  });
  it('uses the selected supply or return port normal as the first duct direction', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(1, 2.7, 3));
    expect(indoorUnitPortDirection(placed.unit, 'supply')).toEqual([0, 0, 1]);
    expect(indoorUnitPortDirection(placed.unit, 'return')).toEqual([0, 0, -1]);
    expect(projectFirstDuctSegmentFromPort(placed.unit, 'supply', point(1, 2.85, 2)).position).toEqual([1, 2.85, 5]);
    expect(projectFirstDuctSegmentFromPort(placed.unit, 'supply', point(1, 2.85, 0)).position).toEqual([1, 2.85, 7]);
    const turned = editIndoorUnit(placed.overlay, placed.unit.id, { rotationYDegrees: 90 });
    if ('reason' in turned) throw new Error('fixture');
    expect(indoorUnitPortDirection(turned.overlay.hvac.indoorUnits[0]!, 'supply')).toEqual([1, 0, 0]);
  });
  it('allows only 90-degree extensions and protects outlets when shortening a terminal', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const routed = createHvacDuct(placed.overlay, placed.unit.id, 'supply', point(0, 2.7, 0), point(2, 2.85, .5));
    if (!('duct' in routed)) throw new Error('fixture');
    expect(appendHvacDuctSegment(routed.overlay, routed.duct.id, point(3, 2.85, 1.3))).toHaveProperty('reason');
    const turned = appendHvacDuctSegment(routed.overlay, routed.duct.id, point(2, 2.85, 2.5));
    if (!('overlay' in turned) || 'reason' in turned) throw new Error('fixture');
    const outlet = addHvacOutlet(turned.overlay, routed.duct.id, turned.overlay.hvac.ducts[0]!.segmentIds[1]!, 'top', 1500, [300, 150]);
    if (!('outlet' in outlet)) throw new Error('fixture');
    expect(editHvacOutlet(outlet.overlay, outlet.outlet.id, { sizeMm: [3000, 150] })).toHaveProperty('reason');
    expect(resizeHvacTerminalSegment(outlet.overlay, routed.duct.id, 1700)).toHaveProperty('reason');
  });
  it('allows a selected outlet to be repositioned while keeping its placed face fixed', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const routed = createHvacDuct(placed.overlay, placed.unit.id, 'supply', point(0, 2.7, 0), point(0, 2.85, 2.3));
    if (!('duct' in routed)) throw new Error('fixture');
    const segmentId = routed.duct.segmentIds[0]!, outlet = addHvacOutlet(routed.overlay, routed.duct.id, segmentId, 'top', 100, [300, 150]);
    if (!('outlet' in outlet)) throw new Error('fixture');
    const edited = editHvacOutlet(outlet.overlay, outlet.outlet.id, { offsetMm: 250 });
    if ('reason' in edited) throw new Error('fixture');
    expect(edited.overlay.hvac.outlets.find(item => item.id === outlet.outlet.id)).toMatchObject({ face: 'top', offsetMm: 250 });
  });
  it('derives the two editable edge clearances from the outlet and its duct face', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const routed = createHvacDuct(placed.overlay, placed.unit.id, 'supply', point(0, 2.7, 0), point(0, 2.85, 3.3));
    if (!('duct' in routed)) throw new Error('fixture');
    const outlet = addHvacOutlet(routed.overlay, routed.duct.id, routed.duct.segmentIds[0]!, 'top', 500, [300, 150]);
    if (!('outlet' in outlet)) throw new Error('fixture');
    expect(hvacOutletEdgeClearances(outlet.overlay, outlet.outlet.id)).toEqual({ fromStartMm: 500, toEndMm: 2000 });
  });
  it('keeps thermostat control one-to-one and wall-mounted', () => {
    const unit = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    expect(placeThermostat(unit.overlay, point(1, 1.3, 0))).toHaveProperty('reason');
    const thermostat = placeThermostat(unit.overlay, { ...point(1, 1.3, 0), attachment: { hostId: 'wall', hostKind: 'wall', surface: 'front', normal: [0, 0, 1], levelId: 'L0' } });
    if (!('thermostat' in thermostat)) throw new Error('fixture');
    expect(thermostat.thermostat.name).toBe('FCU 温控器');
    expect(bindThermostat(thermostat.overlay, thermostat.thermostat.id, unit.unit.id)).toHaveProperty('control');
  });
  it('locks a connected unit but propagates its shared section and records fixed-clearance Wall penetrations', () => {
    const placed = placeIndoorUnit(createEmptyOverlay('a', 'b'), point(0, 2.7, 0));
    const routed = createHvacDuct(placed.overlay, placed.unit.id, 'return', point(0, 2.7, 0), point(2, 2.7, 0));
    if (!('duct' in routed)) throw new Error('fixture');
    expect(editIndoorUnit(routed.overlay, placed.unit.id, { rotationYDegrees: 90 })).toHaveProperty('reason');
    const resized = editIndoorUnit(routed.overlay, placed.unit.id, { sectionMm: [800, 250] });
    if (!('overlay' in resized) || 'reason' in resized) throw new Error('fixture');
    expect(resized.overlay.hvac.indoorUnits[0]?.sectionMm).toEqual([800, 250]);
    const segment = resized.overlay.hvac.segments[0]!;
    const penetration = addHvacWallPenetration(resized.overlay, 'wall-1', segment.id, point(1, 2.7, 0), point(1.1, 2.7, 0));
    expect(penetration).toMatchObject({ penetration: { openingMm: [850, 300] } });
    expect(deleteHvacObject(resized.overlay, placed.unit.id)).toHaveProperty('reason');
    expect(deleteHvacObject(resized.overlay, routed.duct.id).overlay.hvac.ducts).toEqual([]);
  });
});
