---
status: accepted
---

# Device-first routing with manual local reconnection

Conduit authoring is organized around precisely placed device points and their physical ports, while conduit geometry remains user-guided through confirmed route points. The MVP deliberately avoids numeric conduit-length entry and automatic routing: object snaps, host-surface orthogonal constraints, and world-axis locks make each candidate precise without taking route choice away from the user.

When a connected device point moves, every conduit leg directly adjacent to that device is removed up to the nearest stable connection boundary, leaving truthful open conduit endpoints and unconnected device ports. The user manually redraws only those local legs; the rest of the network is unchanged, and the move plus removal is one undoable operation. This was chosen over stretching geometry or automatic rerouting because either alternative must silently choose bends, collision responses, port assignments, and construction impacts that the MVP cannot reliably infer.

Devices without modeled ceiling or beam hosts are placed on a per-level installation reference plane with a default elevation of 2700 mm above the finished floor. The plane records an explicit editing reference, not a fabricated building host. Device positioning uses minimal 3D-only edge-clearance dimensions: wall devices use bottom-edge height plus horizontal clearance to the nearest same-wall device or wall end; floor and reference-plane devices use clearances to a stable near-orthogonal wall pair. Only the selected device moves when a displayed value is edited.
