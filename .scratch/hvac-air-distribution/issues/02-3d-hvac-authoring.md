# 3D HVAC authoring

Type: task
Status: resolved

Add the air-conditioning tool group, host/reference-plane placement, manual rectangular routing, Ctrl Wall penetration, terminal length editing, outlet placement, and thermostat binding.

## Answer

Implemented in `src/three/ThreeDWorkspace.tsx`, `src/components/HvacScene.tsx`, and the HVAC domain module. The authoring flow remains 3D-only and writes only the Overlay.
