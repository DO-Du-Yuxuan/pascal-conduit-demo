# ADR 0008: Model HVAC thermostat control as a physical conduit

- Status: Accepted
- Date: 2026-09-27

## Context

The HVAC editor previously stored a logical thermostat-to-FCU association. It did not identify a physical path, so the dashed association could be mistaken for installed work and could not be checked against other routes. FCUs also need separate physical endpoints for power and control.

## Decision

Use stable physical ports and a separate HVACSystem-owned `HVACControlConduit` route. A thermostat exposes the eight perimeter holes of an 86 box as alternative source locations while unconnected; selecting a hole persists its position and direction in the thermostat's single stable white source port. Each FCU provides a white control sink and a red receptacle power sink. Each endpoint accepts one conduit, preserving one thermostat-to-one-FCU control topology. The red power route remains an ElectricalSystem `Conduit` from a strong-current box. The white HVAC control route starts at the selected thermostat hole and ends at the FCU without a weak-current box. It is not electrically cross-connectable to the white Electrical network.

Plan control routes through the existing route planner so sweep radius, clearance, stock-length couplings, collision diagnostics, and stable segment/fitting geometry follow the same rules as conduit routes. Persist the resulting HVAC route and nested segments/fittings under HVACSystem, without registering it as an Electrical route or Circuit.

On import, discard legacy HVAC `controls` records. Preserve the thermostat and FCU identities and geometry, create missing stable endpoint ports, and require the user to draw physical routes manually. Never infer a route from a former logical association.

## Consequences

- 2D and 3D display actual HVAC control pipe geometry instead of a dashed relation.
- FCUs have distinct power and control endpoints, and connected FCUs cannot move or rotate.
- Old control relationships do not survive import; users must add the physical route.
- HVAC control routes share bend and collision rules with conduit routes while remaining HVAC-owned data.
