# Pascal Conduit Routing

This context describes the language used while interactively drafting conduit routes over a read-only Pascal building model.

## Language

**Device point**:
A placed device with physical and construction meaning, such as a socket, switch, luminaire, sprinkler head, or distribution panel. It is distinct from the device's connection ports and from conduit route control points.
_Avoid_: Connection port, route point, conduit bend point

**Physical port**:
One of the modeled conduit openings on a device point. During an active route, only compatible open ports on the hovered device are candidate targets; an explicitly clicked port wins, otherwise the port nearest the pointer is selected.
_Avoid_: Device point, auxiliary alignment point

**Confirmed route point**:
A path location explicitly accepted by the user with a left click and therefore belonging to the current route draft.
_Avoid_: Current cursor, hover point, device point

**Preview route point**:
A transient candidate path location that follows pointer movement and has not been accepted into the current route draft.
_Avoid_: Confirmed endpoint, saved point

**Same-host port arrival**:
A route reaches a physical port when both lie on the same host surface and their host-plane coordinates satisfy the active drawing constraint; minor normal-depth differences from modeling or display offsets do not prevent arrival.
_Avoid_: Three-dimensional coordinate equality, auxiliary alignment

**Installation reference plane**:
A per-level virtual horizontal plane used to place device points at an explicit elevation when the actual ceiling, beam, or other mounting host is absent from the building model.
_Avoid_: Ceiling, slab, building host

**Local reconnection**:
Manual replacement of only the conduit legs directly adjacent to a moved device point, bounded by the nearest ports, fittings, confirmed route points, or open route endpoints; the rest of the network remains unchanged.
_Avoid_: Whole-circuit reroute, move the entire conduit network

**Point annotation**:
A CAD-style description block connected to one device point or a same-wall installation group. It shows the device type or edited device name and model-derived height, quantity, and relative arrangement. It does not show a generated point number.
_Avoid_: Device identifier, pipe annotation

**Device description**:
Editable construction wording stored in the existing Overlay device name. Editing it does not override height, quantity, or relative arrangement.
_Avoid_: Height override, point number

**Callout rule column**:
The shared visual alignment position for the separate short vertical rules of point annotations on one building side. A point annotation uses an outward secondary column only when its text would collide with another annotation, and later non-colliding annotations return to the primary column. The short rules remain disconnected.
_Avoid_: Continuous callout line, permanent alternating lane
