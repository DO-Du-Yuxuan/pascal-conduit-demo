# Pascal Conduit Routing

This context describes the language used while interactively editing a Pascal building model and drafting conduit routes over it.

## Language

**Ceiling**:
The modeled upper surface of an interior space and a possible host for building elements or device points. It does not by itself mean a suspended or decorative ceiling system.
_Avoid_: Suspended ceiling, slab, installation reference plane

**Effective ceiling elevation**:
The elevation supplied by a Ceiling for hosted geometry; it is explicit when the Ceiling records a height and otherwise uses the Demo's identified 2700 mm derived default.
_Avoid_: Beam height, level elevation, installation reference plane elevation

**Beam**:
A straight rectangular building member whose longitudinal span is defined by two endpoints and whose cross-section is defined by width and height. Its top follows its source Ceiling's effective elevation, normally across only same-elevation Ceilings unless the author explicitly crosses a Ceiling elevation boundary.
_Avoid_: Wall, column, conduit support, installation reference plane

**Explicit Ceiling elevation crossing**:
A deliberate Beam-authoring override held with Ctrl or Command while crossing into a different-elevation Ceiling region. The Beam remains straight and keeps its source Ceiling elevation; the action does not step, split, or retarget the Beam vertically.
_Avoid_: Automatic elevation change, stepped Beam, Beam penetration

**Beam face**:
One of a Beam's exposed bottom, side, or end surfaces that can host a surface-routed conduit. The top surface touching a Ceiling is not a Beam face available for conduit routing.
_Avoid_: Ceiling face, wall face, free-space routing plane

**Beam penetration**:
A construction opening created where an explicitly penetrating conduit passes through a Beam. It belongs to the conduit construction plan rather than to the Beam's base geometry.
_Avoid_: Surface route, collision, beam notch

**Beam positioning dimension**:
A live, editable clearance from a selected Beam side or endpoint to the nearest reliable parallel Wall or neighboring Beam face. Moving the whole Beam preserves its span, while moving one endpoint may change its length and direction; both update their physical witnesses at 5 mm resolution.
_Avoid_: Beam size, wall centreline distance, text-only annotation

**Unhosted device point**:
A device point that retains its world position after its former Beam host moves away or changes shape. It remains present but no longer claims a physical host and requires explicit repositioning or reattachment.
_Avoid_: Beam-following device, deleted device, installation reference plane device

**Project identity**:
The stable identity shared by successive saved versions of the same building project, independent of any one file version's content fingerprint.
_Avoid_: File name, content fingerprint, Overlay version

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

**Layout reference plane**:
A per-level horizontal editing surface shared by Beam authoring and eligible horizontal device-point placement. Its independently persisted Overlay setting is visible and enabled by default at the Level's effective Ceiling elevation, may be hidden or moved for editing, and affects only new or uncommitted geometry rather than previously placed objects.
_Avoid_: Ceiling, building host, Beam elevation, selection plane

**Orthogonal lock**:
An explicit, visible authoring state that constrains a new Beam preview to the Layout reference plane's world X or Z direction. Shift toggles the state; it is not a hidden hold-only modifier and does not change committed geometry.
_Avoid_: Surface snap, auxiliary alignment, permanent Beam constraint

**Surface snap**:
A pointer candidate that resolves a new Beam point to a real Wall, Column, or Beam face and visibly identifies that physical target before confirmation.
_Avoid_: Auxiliary alignment, centreline snap, visual proximity

**Local reconnection**:
Manual replacement of only the conduit legs directly adjacent to a moved device point, bounded by the nearest ports, fittings, confirmed route points, or open route endpoints; the rest of the network remains unchanged.
_Avoid_: Whole-circuit reroute, move the entire conduit network

**Point annotation**:
A CAD-style description block connected to one device point or a same-wall installation group. It shows the device type or edited device name and model-derived height, quantity, and relative arrangement. It does not show a generated point number.
_Avoid_: Device identifier, pipe annotation

**Closed point-position chain**:
A construction dimension sequence for collinear device points of the same professional system and type within one uninterrupted space. It starts at the first reliable wall face or opening edge reached on one side, passes through device centres in order, and ends at the first reliable wall face or opening edge reached on the other side. A wall crossing splits the sequence; an unresolved side remains explicitly incomplete.
_Avoid_: Building-wide dimension chain, nearest-distance-only annotation, dimension through a wall

**Point-position dimension label placement**:
A user-adjusted text position along one derived point-position dimension. It changes only the readable label position, retains the dimension's model-derived value and witnesses, and persists with the construction drawing.
_Avoid_: Dimension value override, geometry edit, manual measurement

**Automatic point-annotation panel placement**:
A user-adjusted drawing position for the editable construction text panel of one current automatic point-annotation group. It retains the group’s model-derived content and leader origin, follows source visibility, and is ignored when the group’s source membership changes.
_Avoid_: Manual callout, device geometry edit, point-position dimension label placement

**Device description**:
Editable construction wording stored in the existing Overlay device name. Editing it does not override height, quantity, or relative arrangement.
_Avoid_: Height override, point number

**Manual callout**:
A user-authored 2D note bound to one stable source object. It stores its own text and paper position, follows the source object's visibility and level, and is removed when its source object is deleted. It does not rename the source object or replace automatic construction annotations.
_Avoid_: Device description, automatic point annotation, measurement

**Callout rule column**:
The shared visual alignment position for the separate short vertical rules of point annotations on one building side. A point annotation uses an outward secondary column only when its text would collide with another annotation, and later non-colliding annotations return to the primary column. The short rules remain disconnected.
_Avoid_: Continuous callout line, permanent alternating lane

**Lighting control group**:
A logical relationship in which one set of luminaires is operated together as one control channel on a switch device point. A switch device point may own multiple groups, but in the MVP each luminaire belongs to at most one group and therefore one switch. A group can be defined before conduit is drawn and must not be inferred from conduit geometry, circuit membership, or level placement. Moving a member preserves the group; deleting its switch dissolves the switch's groups, deleting a luminaire removes that member, and an empty group does not persist.
_Avoid_: Lighting circuit, conduit branch, selected luminaires

**Switch gang count**:
The number of distinct lighting control groups assigned to one switch device point. It is derived from the assigned groups rather than entered before binding; the number of luminaires inside a group does not increase the gang count.
_Avoid_: Luminaire count, lighting circuit count, preset switch size

**Switch device point**:
A device point representing one complete switch faceplate. Its control groups determine its gang count, while the physical left-to-right position of those controls is outside the MVP model.
_Avoid_: Switch button, control channel, preset gang device

**Sprinkler direction**:
An explicit presentation and installation property of a sprinkler-head device point: upright (向上喷) or pendent (向下喷). It controls the 3D geometry and 2D symbol/text label, defaults to upright for new and legacy points, and does not alter conduit topology or connection ports.
_Avoid_: A separate sprinkler device type, automatic pipe reroute

**Sensor point**:
A standalone, unpowered device point used to record a sensor's installation location and editable purpose. It may mount to a wall, slab, ceiling, installation reference plane, or free space; it has no physical conduit port, circuit, or routing system. Its independent sensor layer controls its 2D and 3D display, while its location continues to participate in construction dimensions and installation-height schedules.
_Avoid_: Weak-current outlet, luminaire, conduit endpoint
