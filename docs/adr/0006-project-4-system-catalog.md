---
status: accepted
---

# Project 4.0 system catalog and compatibility boundary

Project JSON advances incompatibly to `schemaVersion: "4.0"`. The Demo accepts and exports only 4.0; it rejects 3.0 and earlier files without migration. Known retired public types are rejected rather than silently hidden or rewritten. Unknown legal future nodes and fields still round-trip unchanged, preserving forward data the current editor does not understand.

The ten system containers remain present under `Site`, including empty containers. Published entity types are specific and belong to their approved system: electrical uses `NetworkOutlet`; lighting uses `Spotlight`; HVAC uses `FanCoilUnit`, `FCUThermostat`, `TemperatureHumiditySensor`, and `GalvanizedSheetMetalDuct`; smart uses `RFIDReader`; fire uses `FireWaterPipe` and its specific `FireWaterPipeElbow`, `FireWaterPipeTee`, and `FireWaterPipeConnector` fittings. Other currently unsupported systems keep their catalog entry and empty state. Internal Overlay discriminators may retain generic adapter names, but they are not public Project types.

Fire-water routing starts at the user's first confirmed point or continues from a compatible open pipe end. It has no inlet device requirement and creates no Circuit. This keeps physical route authorship explicit without inventing a supply connection or electrical-style circuit relationship.

The catalog has three visible card sections—placing devices, drawing, and editing actions—and a directory lock that constrains each card to its declared system and allowed actions. Spotlight defaults to 90 mm diameter and 100 mm depth; FCU casing defaults to 1000 × 600 × 300 mm; galvanized sheet-metal duct section defaults to 500 × 200 mm; RFID reader defaults to 86 × 130 × 25 mm.

## Relationship to ADR 0005

ADR 0005 remains the decision for storing building, construction systems, and drawings in one Project JSON file, stable project identity, save behavior, and internal Overlay-as-adapter ownership. This ADR adds the incompatible 4.0 schema boundary and system/type catalog; it does not replace those file-ownership decisions.
