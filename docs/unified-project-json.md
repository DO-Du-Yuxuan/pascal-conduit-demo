# 统一 Project JSON 格式

> 当前合同：仅导入和导出 `schemaVersion: "4.0"`。3.0 及更早格式、明确退休的公共类型均拒绝导入；不迁移。编辑器内部 Overlay 通用名仅为适配结构，不是公开类型。未知合法未来节点与字段仍无损往返。详见 [ADR 0005](adr/0005-unified-project-file.md) 与 [ADR 0006](adr/0006-project-4-system-catalog.md)。

## 文件外壳与身份

统一项目是一份 JSON 文件。顶层保留 Pascal 已有的 `nodes`、`rootNodeIds`、`installedPlugins`、`materials`、`collections`，以及 Demo 的稳定 `pascalConduitProjectId`；新增 `schemaVersion: "4.0"` 作为统一格式的版本。`rootNodeIds` 必须只包含一个 `Site` 节点 ID。原 Overlay 的 `source` 文件名和 SHA 不进入统一格式；内容 SHA 可在读取文件时计算，稳定项目身份由 `pascalConduitProjectId` 提供。

```json
{
  "schemaVersion": "4.0",
  "pascalConduitProjectId": "project-stable-id",
  "rootNodeIds": ["site-1"],
  "nodes": {
    "site-1": {
      "id": "site-1",
      "type": "Site",
      "parentId": null,
      "children": ["building-1", "electrical-1", "plumbing-1", "lighting-1", "hvac-1", "smart-1", "water-purification-1", "bathroom-1", "fire-1", "irrigation-1", "gas-1", "drawing-1"]
    },
    "building-1": { "id": "building-1", "type": "Building", "parentId": "site-1", "children": [] },
    "electrical-1": { "id": "electrical-1", "type": "ElectricalSystem", "parentId": "site-1", "children": [] },
    "plumbing-1": { "id": "plumbing-1", "type": "PlumbingSystem", "parentId": "site-1", "children": [] },
    "lighting-1": { "id": "lighting-1", "type": "LightingSystem", "parentId": "site-1", "children": [] },
    "hvac-1": { "id": "hvac-1", "type": "HVACSystem", "parentId": "site-1", "children": [] },
    "smart-1": { "id": "smart-1", "type": "SmartSystem", "parentId": "site-1", "children": [] },
    "water-purification-1": { "id": "water-purification-1", "type": "WaterPurificationSystem", "parentId": "site-1", "children": [] },
    "bathroom-1": { "id": "bathroom-1", "type": "BathroomSystem", "parentId": "site-1", "children": [] },
    "fire-1": { "id": "fire-1", "type": "FireProtectionSystem", "parentId": "site-1", "children": [] },
    "irrigation-1": { "id": "irrigation-1", "type": "IrrigationSystem", "parentId": "site-1", "children": [] },
    "gas-1": { "id": "gas-1", "type": "GasSystem", "parentId": "site-1", "children": [] },
    "drawing-1": { "id": "drawing-1", "type": "Drawing", "parentId": "site-1", "levelId": "level-1", "purpose": "construction-plan", "children": [] }
  },
  "installedPlugins": [],
  "materials": {},
  "collections": {}
}
```

上例中的 ID 仅为示意，`Drawing` 可以有零张或多张；十个系统容器即使为空也必须存在。`Drawing_001` 等是规范的实例示例，不是不同的 `type`。系统容器和 `Building` 必须直接属于 `Site`，系统实体不能放入 `Building`。节点类别由 `type` 表示，不为 `Cable`、`Conduit` 等类别另建目录节点。

## 节点与引用规则

- `nodes` 的每个键等于该节点的 `id`；ID 在整份文件内稳定且唯一。`parentId` 指向实际父节点；拥有 `children` 的节点须与子节点的 `parentId` 相互一致。`Site.parentId` 为 `null`。
- 建筑的父子关系按新规范：`Site → Building → Level →` 楼层对象，`Elevator` 在 `Building` 下；`Wall` 包含 `Door`、`Window`、`Item`；`Roof` 包含 `RoofSegment`；`Stair` 包含 `StairSegment`；`Item` 可以递归包含 `Item`。
- 已有建筑及 Demo 实体的业务字段（几何、尺寸、宿主、端口、时间等）原则上保留；目标格式改变其 `type`、父子归属和必要的 ID 引用。现有原始建筑字段、未知属性、插件数据及尚未实现类型必须无损读写。导入建筑节点仍只读，文档化的 Demo `Beam` 作者工具是例外。
- 可独立引用的实体是 `nodes` 节点。同一实体只存一份。跨系统的设备端口连接、宿主、绘图来源等以稳定 ID 引用，不能复制实体以凑系统树。物理端口嵌入其所属设备或管件并保留端口 ID；`Circuit`、灯控关系和施工记录作为所属系统容器上的带 ID 数据，不成为 `Site` 的新子节点。
- 现有几何长度继续使用米；现有以 `Mm` 结尾的施工参数继续使用毫米。转换不能只改字段名而改变数值单位。

## Project 4.0 公开类型目录

以下是当前合同确认的精确公开类型及唯一父系统。父级关系必须正确；已知类型放错系统会被拒绝。十个系统容器即使为空也必须存在。其余未知且未明确退休的节点与字段保留原样往返，但不承诺当前版本可编辑或渲染。

| 父容器 | 公开实体 `type` |
| --- | --- |
| `Building` / `Level` 及建筑子节点 | `Level`, `Wall`, `Door`, `Window`, `Item`, `Slab`, `Ceiling`, `Column`, `Fence`, `Beam`, `Roof`, `RoofSegment`, `Stair`, `StairSegment`, `Guide`, `Spawn`, `Zone`, `Elevator`, `Shelf` |
| `ElectricalSystem` | `StrongCurrentBox`, `WeakCurrentBox`, `OutletPanel`, `NetworkOutlet`, `Conduit`, `JunctionBox`, `ConduitConnector`, `ConduitTee`, `ConduitElbow` |
| `LightingSystem` | `SwitchPanel`, `Spotlight`, `Conduit`, `JunctionBox`, `ConduitConnector`, `ConduitTee`, `ConduitElbow` |
| `HVACSystem` | `FanCoilUnit`, `FCUThermostat`, `TemperatureHumiditySensor`, `GalvanizedSheetMetalDuct`, `AirOutlet` |
| `SmartSystem` | `RFIDReader` |
| `FireProtectionSystem` | `SprinklerHead`, `FireWaterPipe`, `FireWaterPipeElbow`, `FireWaterPipeTee`, `FireWaterPipeConnector` |
| `PlumbingSystem` | 当前无 Demo 作者类型；容器保留为空 |
| `WaterPurificationSystem` | 当前无 Demo 作者类型；容器保留为空 |
| `BathroomSystem` | 当前无 Demo 作者类型；容器保留为空 |
| `IrrigationSystem` | 当前无 Demo 作者类型；容器保留为空 |
| `GasSystem` | 当前无 Demo 作者类型；容器保留为空 |
| `Drawing` | `PointDimension`, `ConstructionAnnotation`, `ManualLeader` |

`FireWaterPipe` 可从用户确认的首点自由起画，也可从兼容开放管端继续；不需要入户点，不创建或引用 Circuit。消防转弯、分支和直接连接件分别用 `FireWaterPipeElbow`、`FireWaterPipeTee`、`FireWaterPipeConnector` 表达。FireProtectionSystem 不接受 `circuits` 数据。消防管件不能用通用 `FireWaterFitting` 表示。

`FanCoilUnit` 默认外壳尺寸为 `1000 × 600 × 300 mm`，`GalvanizedSheetMetalDuct` 默认截面为 `500 × 200 mm`。`Spotlight` 默认直径 90 mm、深度 100 mm；`RFIDReader` 默认 `86 × 130 × 25 mm`，仅允许墙面或 Beam 侧面宿主。类型名称及父系统是公开合同，编辑器内部 `luminaire`、`sensor`、`indoor-unit`、`air-duct`、`thermostat` 等适配 discriminator 不是 JSON 类型。

明确退休并拒绝导入的公共类型：`Luminaire`、`Sensor`、`IndoorUnit`、`Thermostat`、`AirDuct`、`FireWaterInlet`、`FireWaterFitting`。文件版本不是 4.0 时拒绝导入，不执行旧格式迁移或静默重写。拒绝已知退休类型或错误系统归属，不意味着拒绝未知合法未来类型。

## 非节点数据归属

| 数据 | 目标位置与规则 |
| --- | --- |
| 设备及管件物理端口 | 嵌入所有者节点的 `ports`；保留端口 ID、位置、方向、连接引用及系统身份。 |
| `circuits` | 仅对应 `ElectricalSystem` 或 `LightingSystem` 容器；成员以实体和端口 ID 引用。消防水管不属于 Circuit。 |
| `lightingControlGroups` | `LightingSystem` 上的同名数组；它是开关与灯具的逻辑关系，不能从管路推导。 |
| HVAC `controls` | `HVACSystem` 上的同名数组，按 ID 连接 `FCUThermostat` 与 `FanCoilUnit`。 |
| `surfaceChases`、`penetrations`、HVAC `wallPenetrations` | 与产生它们的路线同属一个系统容器，保留宿主建筑 ID、路线 ID、显式/派生依据及尺寸；不修改建筑节点。 |
| `installationReferencePlanes`、`layoutReferencePlanes` | 按 `levelId` 归入对应 `Level` 节点的同名数组，保留明确与推导标高的依据。 |
| 弯曲半径、定尺长度、盒尺寸等施工参数 | 归相关系统容器的 `settings`，现有 `Mm` 单位与数值不变。 |
| 颜色、图层可见性、传感器及 HVAC 可见性 | 归 `Site.settings` 的显示偏好；它们不改变建筑或系统实体。 |
| 旧 Overlay 的 `source` 和独立 `schemaVersion` | 由统一项目身份和统一 `schemaVersion` 取代，不再作为第二份文档保存。 |

同一宿主可能被多个系统引用。一个有稳定 ID 的对象只能归属一个系统；其他系统引用它的 ID。例如位于 `ElectricalSystem` 的强电箱可以通过端口 ID 连接 `LightingSystem` 的线管，不复制强电箱或端口。

新增的 `surfaceChases` 按其 `routeElementId` 所指管段、管件或接线盒的系统归属；已有槽保留原系统容器。这样照明或消防管件上的槽不会在导出时落到电气系统。

### 内部编辑适配说明

编辑器可在内存中使用 Overlay 通用字段（例如 `indoorUnits`、`ducts`、`thermostats`、`fittings`）处理交互；这些名称不是 Project 4.0 公开实体类型。导出时使用上表精确类型和父系统：HVAC 风管为 `GalvanizedSheetMetalDuct`，消防管件分别输出具体类型。适配不得向公开 Project 写入已退休类型，也不得改变未编辑节点或未知字段。

## Drawing

每张图纸是 `Site` 下的独立 `Drawing` 节点，有稳定 `id`、`levelId`、`purpose` 和 `children`。`PointDimension`、`ConstructionAnnotation`、`ManualLeader` 是其直接子节点。图纸数量不固定；同一楼层可有多张不同用途的图。图纸通过来源 ID 引用建筑与各系统对象，不复制它们。

当前画布以每层 `purpose: "construction-plan"` 且 ID 字典序最小的图纸作为默认施工图。首次保存尺寸、标注或手工引线时，如该层没有这种图纸，创建稳定 ID `drawing:construction-plan:<levelId>`（冲突时追加数字后缀）。不产生持久图纸内容的零图纸文件仍保持零图纸。其他图纸及其布局原样保留；原有 ManualLeader 更新时保留原图纸归属，新引线归属默认施工图。

派生尺寸和自动施工标注保存其稳定 ID、来源对象 ID、显式或派生的测量依据、假设、置信度，以及用户调整的文字位置、线偏移或隐藏状态。数值从现有源对象和几何重新计算；布局字段不得变成数值覆盖。源对象变化时，只重算受影响的派生结果，未受影响的图纸布局保留。`ManualLeader` 保存现有的目标 ID、文本、锚点、标签位置和创建时间。Drawing 导出的施工测量须保留来源对象 ID、显式/派生依据、假设和置信度。

这三种节点的公共字段是 `id`、`type`、`parentId`、`sourceObjectIds`。`PointDimension` 另有 `basis`（`kind: "explicit" | "derived"`、`reference`、`assumptions`、`confidence`）和 `layout`（现有的 `labelPosition`、`lineOffset`、`hidden`）；`ConstructionAnnotation` 另有 `layout`（现有的 `labelPosition`、`placementSignature`、`hidden`）。自动节点的 `id` 可继续使用现有派生布局键，避免无故丢失用户调整。`ManualLeader` 继续使用现有 `targetId`、`levelId`、`anchor`、`label`、`text`、`createdAt` 字段；其 `sourceObjectIds` 包含 `targetId`。缺少可信依据时用明确的 `confidence: "unknown"` 和具体 `assumptions` 描述缺口，不捏造高置信度。

```json
{
  "id": "socket-1:position:wall:wall-1:from:wall-end:wall-1",
  "type": "PointDimension",
  "parentId": "drawing-1",
  "sourceObjectIds": ["socket-1", "wall-1"],
  "basis": {
    "kind": "derived",
    "reference": "device-center-to-physical-wall-face",
    "assumptions": [],
    "confidence": "high"
  },
  "layout": {
    "labelPosition": 0.5,
    "lineOffset": 0.2,
    "hidden": false
  }
}
```

上例的数字仅说明字段类型，不是对任一实际尺寸或布局的计算结果。`PointDimension` 不持久化可被误认为人工覆盖的派生数值；渲染或导出施工图时根据 `sourceObjectIds` 和 `basis` 计算数值，并带出相同的依据、假设和置信度。

`ConstructionAnnotation` 同样保存依据、假设和置信度证据，而不保存派生数值覆盖。导入拒绝错误父子关系（Site 只允许唯一根节点；Building、系统容器和 Drawing 必须直属 Site）、重复对象 ID、损坏的图纸来源引用或手工引线目标；PointDimension 与 ConstructionAnnotation 的依据类型、假设和置信度都需有效。未知合法节点及字段仍往返保留。

当前 2D 手工测量仍是会话临时结果，关闭或替换项目时消失，不写入 `PointDimension`。Drawing 中持久化的是自动点位尺寸、施工标注和作者创建的 `ManualLeader`。

## 格式边界与转换

Demo 只导入和导出 `schemaVersion: "4.0"`，界面只有一份项目文件的保存与未保存状态。3.0 及更早格式拒绝导入，不提供自动迁移；如需保留旧项目，须在 Demo 外完成转换并生成符合本合同的 4.0 文件。已有对象的 ID 和未知业务字段应保留，不能为了分类而复制、重命名或丢弃对象。未实现的类型可被解析、保留和重新导出，但不承诺在当前 Viewer 中渲染或编辑。

本格式以 README、Viewer、工作区持久化和测量合同共同维护；ADR 0005 记录单文件归属决策，ADR 0006 记录 4.0 断代与系统目录决策。统一格式读写的往返测试覆盖已知实体、未知实体、引用、Drawing 布局和未编辑建筑字段；共享解析或展示修改须运行完整测试与构建。
