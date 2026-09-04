# S1 核心家具关系与使用空间：数据准备审计

日期：2026-08-07
状态：审计结论已落实为 S1-FUR 原始测量 v0.1

## 1. 当前结论

家具正式语义统一使用 Item 的 `functionTags`。当前需求不再增加 `itemFunctionCode`，`asset.category`、Item 名称和资产 ID 只用于显示与诊断，不能产生正式 S1 家具语义。

当前数据链已足以测量两类事实：一是复用共享操作区生成的最小使用空间与最大开启范围；二是对 `functionTags` 能可靠识别的核心家具测量空间归属、中心距离、边界距离和相对方向。当前仍不具备家具评分阈值和 S1 权重。

## 2. Item 数据链

| 环节 | 当前实现 | 结论 |
| --- | --- | --- |
| 原始 JSON | Item 含稳定 `id`、`functionTags`、尺寸、位置、旋转，以及部分对象的显式开启方向、最大开启深度和最小使用净空。 | `functionTags` 是正式用途来源；实例由 Item `id` 区分。 |
| Parser / Handoff | [evaluation-handoff.ts](</Users/dupanghu/Workspace/pascal-layout-auditor/src/parser/evaluation-handoff.ts>) 显式投影 `functionTags`、尺寸、世界坐标、旋转和操作几何字段。 | 评价器无需读取原始动态字段。 |
| 共享语义 | [object-semantics.ts](</Users/dupanghu/Workspace/pascal-layout-auditor/src/evaluation/object-semantics.ts>) 只用 `functionTags` 解析家具和设备用途。 | 不按 tag 数组第一项推断，也不以 `asset.category` 覆盖标签。 |
| 使用空间 | [object-use-space.ts](</Users/dupanghu/Workspace/pascal-layout-auditor/src/evaluation/object-use-space.ts>) 与 [operation-use.ts](</Users/dupanghu/Workspace/pascal-layout-auditor/src/evaluation/operation-use.ts>) 生成并评估 `minimumUsePolygon`、`openingPolygon` 和开启后使用区。 | S1-FUR 复用同一障碍、豁免、Slab 越界和可达性证据，不另建碰撞模型。 |
| 几何与归属 | 旋转矩形 footprint、中心点、Level、RoomRegion 均可取得；Zone 由 Item 中心点在其 RoomRegion 对应 Zone 内稳定推导。 | 开放空间边界或跨 Zone 大件仍可能没有唯一 Zone。 |

同类家具允许重复。正式关系不能选择数组第一项；先按同一明确 Zone、再按同一 RoomRegion、最后按边界与中心距离稳定配对。完全并列时返回 `ambiguous`。

## 3. Bellevue 最新数据

[Bellevue passing demo.json](</Users/dupanghu/Workspace/pascal-layout-auditor/sample-data/Bellevue%20passing%20demo.json>) 当前有 88 个 Item，88 个均有非空 `functionTags`。其中 34 个声明了可生成最小使用空间和最大开启范围的显式操作字段。

与第一批关系有关的标签实例为：4 张床、3 个床头柜、2 个沙发、2 个茶几、1 张餐桌、8 把餐椅、5 张书桌、5 把办公椅。S1-FUR 可形成餐桌—餐椅 8 条、床—床头柜 3 条、书桌—工作椅 5 条，以及沙发—茶几 1 条正式关系。Reading 内的圆茶几没有同一 Zone 或 RoomRegion 内的沙发，保留 1 条 `unable_to_determine`，不跨空间猜配。

显式使用空间测量中，34 个对象均进入正式测量；12 个对象的最小使用空间存在重叠、范围不足或不可达事实，6 个对象的最大开启范围不能完整展开。当前 Bellevue 未发现开启范围越出可靠 Slab 的情况。上述均为原始事实，不是评分或法规结论。

## 4. 已实施与仍受限的关系

| 关系 | 当前状态 | 说明 |
| --- | --- | --- |
| 餐桌—餐椅 | 已测量 | 一张餐桌可对应多把餐椅；多套餐区优先按 Zone 分组。 |
| 床—床头柜 | 已测量 | 一张床允许对应 0、1、2 或更多床头柜。 |
| 沙发—茶几 | 部分可测 | 同一空间内可配对；跨 RoomRegion 不猜测，因此 Bellevue 有一条无法判断。 |
| 书桌—工作椅 | 已测量 | 仅用 `desks` 与 `office-chairs` 等正式标签。 |
| 沙发—电视/媒体墙 | 未纳入 | 当前第一批关系未定义，且 Bellevue 没有可靠目标语义。 |
| 岛台—吧椅 | 未纳入 | 当前第一批关系未定义，Bellevue 也缺少可靠吧椅对象。 |

## 5. 数据维护建议

- 继续维护集中式 `functionTags` 语义映射，不新增平行的 `itemFunctionCode`。
- Item `name`、`assetName`、`assetId` 和 `asset.category` 保留为自由展示与诊断字段。
- 旧 JSON 缺失必要 `functionTags` 时返回 `unable_to_determine`；不得通过名称生成正式测量或评分。
- 每个家具实例始终由 Item `id` 区分，多实例配对规则由具体指标定义。
- 新增正式家具角色时，应先更新共享语义契约和测试，再由 S1 指标复用。

## 6. 项目节点

S1-FUR v0.1 已完成原始测量、报告和画布定位，不包含分数、等级、权重或 S1 总分。该指标是 S1 测量阶段最后一个新增指标；项目下一步进入“S1评分体系收口阶段”，统一审查 FR、PCP、HPE、PCI、SFS 与 FUR 的评分边界和汇总方式。
