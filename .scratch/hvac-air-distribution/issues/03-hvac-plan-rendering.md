# HVAC plan rendering

Type: task
Status: resolved

Render indoor units, supply/return ducts, face outlets, thermostats, control relations, and true duct-segment lengths in read-only 2D.

## Answer

Implemented in `src/plan/ConduitPlan.tsx`; the shared Overlay HVAC visibility flag applies to its plan and 3D presentation.
