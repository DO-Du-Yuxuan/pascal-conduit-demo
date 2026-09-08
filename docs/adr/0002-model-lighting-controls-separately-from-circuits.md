---
status: accepted
---

# Model lighting controls separately from circuits

Persist each lighting control group as a logical relationship between exactly one switch device point and one or more luminaires, independently of conduit geometry, lighting circuits, and level placement. A switch may own multiple groups and derives its gang count from them, while each luminaire belongs to at most one group in the MVP; physical button positions and multi-location switching are not modeled.

Authors create one group by selecting unbound luminaires first and then choosing a switch. Existing groups are edited as an atomic staged selection from the switch, and can be unbound only as a whole group; deleting or moving devices follows the relationship lifecycle defined in `CONTEXT.md` without deleting or rerouting unrelated physical objects.
