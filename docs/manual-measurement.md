# Manual CAD measurement

Manual measurements are read-only derived overlays. They remain visible after the second click until explicitly deleted, but are not written into Pascal JSON or the 43-kind manifest. Importing a new project clears the current session's manual measurements.

## Mode and orthogonal lock

- The single **Measure** button toggles the tool. Its default is aligned Euclidean world-space distance.
- Holding `Shift` dynamically locks the preview to the dominant world axis: horizontal for the larger X delta or vertical for the larger Z delta.
- A horizontal lock measures the world X projection; a vertical lock measures the world Z projection. The second clicked point receives an extension line to the orthogonal dimension line.

The first click fixes the starting snap. Pointer movement continuously resolves and previews the second snap. The second click commits the dimension. `Esc` exits the tool; right-click cancels only the unfinished measurement. A retained line can be selected and removed with its × control or `Delete` / `Backspace`.

## Snapping

Snapping runs in Level world coordinates after reversing the complete SVG/view rotation transform.

- Wall candidates are vertices and edges of the formal physical wall footprint produced by `buildExperimentalWalls`; wall centerlines are not candidates.
- Furniture candidates are the four corners and four edges after asset dimensions, item scale, inherited placement and Pascal plan rotation have been composed.
- Shelf candidates use the existing resolved physical Shelf footprint.
- Corner snaps have priority within the interaction radius, followed by the nearest projected edge point, then a free world point.

The 12-pixel interaction radius is converted to metres only to decide whether snapping feels usable at the current zoom. Committed coordinates and values never use pixel distances.

## Units

All stored and calculated values remain metres.

- Millimetres: `Math.round(metres * 1000)`, without a suffix.
- Feet–inches: rounded to the nearest 1/16 inch, for example `12'-7 9/16"`.

The unit control changes both automatic exterior annotations and manual measurements without altering geometry or stored values.
