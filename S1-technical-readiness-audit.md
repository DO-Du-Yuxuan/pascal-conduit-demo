# S1 技术支持审查报告

## 审查范围与结论

第 1--8 节为实施前的只读审查，依据当时仓库中的 Parser、Evaluation Handoff、G1--G4 评价器、示例 JSON 和画布代码形成；当时未修改代码或依赖。第 9 节记录随后完成的共享空间语义调整及验证结果。

当前 Demo 已具备部分 S1 基础：统一 handoff、Room Region、门洞 Portal、房间连通图、房内 0.1m 网格通行分析、家具/设备旋转矩形 footprint、门扇扫掠区及画布高亮。

它尚不能直接作为完整住宅性能评分底座。主要差距是：功能语义主要来自 Zone 名称；家具无真实多边形、正面语义和配对关系；导航仅为单房间无权 BFS 连通性；没有全局寻路、路径交汇、buffer、射线遮挡或可视性能力；报告/UI 只支持 G1--G4 分组。

只读验证：`npm test -- --reporter=dot` 通过，34 个测试文件通过、1 个跳过；271 个测试通过、1 个跳过。

## 1. 当前数据能力摘要

- Parser 仅校验顶层 `nodes` 和节点 `type`，其余 Pascal 属性以 passthrough 保留：`src/parser/schema.ts`、`src/parser/parse.ts`。
- `buildEvaluationHandoff()` 将原始节点投影为 `levels`、`zones`、`slabs`、`walls`、`doors`、`windows`、`furniture`、`equipment` 等：`src/parser/evaluation-handoff.ts:20-71`。
- `RoomRegion` 由 Slab 边界减去有效墙 footprint 推导，已有面积、周长、紧凑度、边界墙、Zone 对应和置信度：`src/evaluation/room-regions.ts:7-89`。
- `DoorPortal` 可建立 Room--Room 或 Room--Exterior 连接；`RoomConnectivityGraph` 已包含门、楼梯和入口选择：`src/evaluation/connectivity.ts:10-67`、`src/evaluation/connectivity.ts:109-196`。
- `buildRoomNavigationAnalysis()` 已建立房内网格与自由空间连通性，但不是跨房间路径系统：`src/evaluation/navigation.ts:59-99`。

## 2. 数据字段清单

| 对象 | 已有字段 / 实际类型 | 数据状态与限制 |
|---|---|---|
| 楼层 | `levels[]`: `id`、`rawPascalId`、`name`、`parentId`、`levelId`、`visible`、`ordinal`；`ordinal` 来自 Pascal `level`。`src/parser/evaluation-handoff.ts:22` | 直接存在。 |
| Zone / 逻辑空间 | `zones[]`: 基础字段、`color`、`outline: [x,z][]`、`areaSquareMeters`；`spaces` 只是 Zone 别名投影，并加 `sourceZoneId`、`source: "derived-from-zone"`。`src/parser/evaluation-handoff.ts:23-25,71` | 多边形、面积直接存在；功能仅有 `name`，无结构化 room type，可信度不足。 |
| 物理房间 | `RoomRegion`: `roomRegionId`、`levelId`、`polygons`、`holes`、`areaSquareMeters`、`perimeterMeters`、`compactness`、`boundaryWallIds`、`confidence`、`usableForEvaluation`。`src/evaluation/room-regions.ts:7-21` | 可由 Slab 与墙体推导；通常 medium，碎片/细长/无边界墙时降级。 |
| 建筑总面积 | `BuildingEnvelope.areaSquareMeters` 由可见 Slab 并集计算；Room 总面积可求和。`src/evaluation/envelope.ts:41-63` | 可推导；仅基于 Slab，置信度为 medium。 |
| 墙体 | `walls[]`: `start`、`end`、`thicknessMeters`、`heightMeters`、`curveOffsetMeters`、`frontSide`、`backSide`、`footprintValidation.{valid,codes,areaSquareMeters,footprint}`。`src/parser/evaluation-handoff.ts:49-60` | 中心线、厚度直接存在；footprint 已推导。曲墙对门连接等分析受限。 |
| 墙连接 | `relationships.wallConnections[]`: `wallId`、`wallEnd`、`connectedWallId`、`connectedWallEnd`。`src/parser/evaluation-handoff.ts:69-71` | 可辅助拓扑；只认端点精确重合，不等于空间邻接。 |
| 门/门洞 | `doors[]`: `hostWallId`、`resolvedWorldPosition`、`resolvedTangentRadians`、`widthMeters`、`heightMeters`、`thresholdHeightMeters`、`openingKind`、`openingShape`、`doorType`、铰链、开向和开角等。`src/parser/evaluation-handoff.ts:61-62` | 直接/推导存在。`DoorPortal` 可给出两侧 Room、开口线段、室外连接和置信度：`src/evaluation/connectivity.ts:10-27`。曲墙门、宿主墙异常时不可用。 |
| 门扇开启范围 | `DoorOperation`: `hingePoint`、`portalSegment`、`swingPolygon`、`requiredSwingPolygon`、`leaves`、`entryPolygon`。`src/evaluation/door-operations.ts:7-8,28-58` | 可推导；平开、双开/French door 可用。滑门、曲墙、缺失铰链/开向/开角时不适用。 |
| 窗 | `windows[]` 含开口基础字段，另有 `windowType`、`hingesSide`、`awningDirection`、`casementStyle`、`operationState`、`sill`、`sillDepthMeters`。`src/parser/evaluation-handoff.ts:63` | 直接存在；没有透明度、可视性或遮挡语义。 |
| 家具/设备 | `furniture[]`、`equipment[]`、`columns[]`: `assetId`、`assetName`、`assetTags`、`assetSource`、`category`、`functionTags`、`attachTo`、`dimensionsMeters`、`rawPosition`、`rawRotation`、`resolvedWorldPosition`、`resolvedRotationRadians`、`resolvedVerticalRangeMeters`、`transformStatus`。`src/parser/evaluation-handoff.ts:64-65` | 尺寸、位置、朝向可用；类别来自 asset，可信度中等。没有正面、使用面和配对字段。 |
| 家具多边形 | 通用 item 无真实 polygon；`rectangularFootprint()` 用宽、深、世界坐标和旋转生成矩形。`src/evaluation/envelope.ts:65-70` | 可推导但可信度有限；不能表达异形、镂空或模型实体。Shelf 有 `footprint`。 |
| 家具所属房间 | 无直接字段；家具/fixture 使用分析按 footprint 与 `RoomRegion` 的最大相交面积推断。`src/evaluation/furniture-use.ts:78-80`、`src/evaluation/fixture-use.ts:53` | 可推导；开放空间、跨区、Zone--Room 映射不稳时可信度不足。 |
| 家具语义 | `FurnitureSemantic` 支持 `bed`、`sofa`、`tv-cabinet`、`dining-table`、`dining-chair`、`desk` 等，由名称/category/tag 正则推断。`src/evaluation/furniture-use.ts:9,57-69` | 可推导；非标准化语义。示例数据存在名称与 category 不一致，不能作为高置信配对基础。 |
| 楼梯 | 起止层、宽度、步数、内半径、扫角、footprint、上下落地中心/外向量等。`src/parser/evaluation-handoff.ts:67` | 直接/推导存在，且已形成跨层图边。 |
| 障碍物 | `Obstacle`: `objectType`、`footprint`、`mobility`、`classificationConfidence`、`usableForCollision`。`src/evaluation/door-operations.ts:6,16-26` | 可用作路径/遮挡基础；部分 fixed/movable 判断依赖名称正则。 |
| 客户需求 JSON | `RequirementHandoff` 支持 `space_presence`、`space_count`、`space_area`、`level_location`、`space_adjacency`、`space_separation`、`manual`，以及 `priority`、`autoCheckSupported`。`src/requirements/requirement-handoff.ts:3-114` | 直接存在；没有居住人数、活动频率、活动路径、偏好权重、家具配对和私密性要求。 |
| 路径/邻接/视线 | `NavigationPath.points` 是房内 Portal--anchor / Portal--Portal 网格路径；图边来自门和楼梯。`src/evaluation/navigation.ts:75-99` | 路径和邻接部分可推导；视线/射线/遮挡结果完全缺失。 |

示例 `sample-data/Bellevue demo.json` 实际含 31 个 Zone、102 面墙、26 扇门、30 窗、96 个 item、2 个 level。Zone 实际字段为 `name`、`polygon`、`boundaryWallIds`、`color` 等，并无结构化用途字段。需求样例只含空间存在、数量、面积、楼层、直接连接/分离和 manual：`sample-data/requirements/Bellevue requirements demo.json`。

## 3. 现有算法与依赖清单

| 能力 | 状态 | 复用性/限制 |
|---|---|---|
| 多边形相交、并、差、面积 | 已有且可复用。依赖 `polygon-clipping`，用于 Room、碰撞、操作区。`package.json`、`src/evaluation/room-regions.ts:45-60` | 可支撑面积、相交、可用区。 |
| 多边形包含 | 已有但为局部实现；另有 footprint 差集。`src/evaluation/navigation.ts:43-47`、`src/evaluation/envelope.ts:72-75` | 可复用；复杂边界、洞和容差需要统一。 |
| 点/边距离 | 已有，`pointSegmentDistance` 用于净距/边界接触。`src/evaluation/room-regions.ts:43-45` | 可复用；没有 polygon--polygon 最短距离 API。 |
| 几何 buffer | 完全没有通用 polygon buffer。 | 人半径只是网格点到障碍边界的距离判断，不是 buffer。 |
| Room 邻接 | 已有但需扩展。已有门连接/同 Room Zone 关系；没有共享墙或共享边长度判断。`src/evaluation/connectivity.ts:171-196` | 直接连通可复用，几何相邻需新增。 |
| 门洞连接 | 已有且可复用，`buildDoorPortals()`。`src/evaluation/connectivity.ts:109-140` | 曲墙门不支持，门端近墙端降置信度。 |
| 网格/导航网格 | 已有但需扩展，单个 Room 内四邻接网格。`src/evaluation/navigation.ts:59-70` | 不是跨房间导航网格。 |
| A* / Theta* | 完全没有。 | 需新增。 |
| 最短路径长度 | 部分已有：BFS 返回房内路径点列。`src/evaluation/navigation.ts:75,85-92` | 没有跨房间拼接、目标锚点、路径长度/绕行/转向输出。 |
| 转向次数 | 完全没有。 | 需新增。 |
| 图结构/图最短路径 | 图结构和 `reachableNodeIds()` 已有。`src/evaluation/connectivity.ts:59-67,196-205` | 只有无权可达性，没有成本/路径结果。 |
| 节点介数中心性 | 完全没有。 | Room 图也不足以表达走廊、门口或家具操作区冲突。 |
| 射线/视线遮挡 | 完全没有。 | 需新增 ray--polygon、观察点、目标点、遮挡语义。 |
| 最小外接矩形 | 完全没有。 | 当前仅能生成已知家具矩形。 |
| 长宽比/紧凑度 | 紧凑度已有，长宽比没有。`src/evaluation/room-regions.ts:62-69` | `compactness = 4πA/P²` 可复用；MBR、凹凸度、交通分支需新增。 |
| 碎片/无效交通 | 有局部基础：碎片/细长诊断、自由网格、家具/设备操作区。`src/evaluation/room-regions.ts:64-69` | 当前是 G 级异常/可用性，不是连续性能计算。 |
| 画布路径/区域/家具高亮 | 已有且可复用。RuleResult 的对象 ID 能形成 focus target；Room、门扇、网格路径已有 overlay。`src/main.tsx:328-340`、`src/evaluation-ui/focus.ts:20-52` | 新的路径、射线或热区需要新的结果几何承载方式。 |

## 4. 八项可行性矩阵

| 指标 | 数据准备度 | 算法准备度 | 可复用模块 | 新增与主要风险 | 难度 | 画布定位 | 第一版建议 |
|---|---|---|---|---|---|---|---|
| 高频活动路径效率 | 中低：入口可推断，Room/门/障碍存在；活动频率、家具目标锚点、晾晒区语义缺失。 | 低：仅有单房间 BFS。 | Room Graph、房内导航、障碍物、RoomRegion。 | 全局导航、portal 拼接、目标锚点、长度/绕行/转向；多入口与 Zone 语义含糊。 | 高 | 部分稳定；Room/门/既有网格可标。 | 需要较大基础设施 |
| 常用路径交汇与冲突 | 低：没有路线集合、频率、窄区/操作区优先级。 | 低：没有路径流量、边使用计数、瓶颈/中心性。 | Room Graph、房内网格、家具/fixture use zone。 | 多路线、共享单元计数、窄度、门口/操作区冲突；不能重算 G3 堵塞。 | 高 | 部分稳定；热区需新增。 | 需要较大基础设施 |
| 功能空间邻接适配度 | 中高：Zone 名称、Zone--Room、门连接、楼层都有；用途为名称推断。 | 中高：已有 direct connection 图。 | RoomRegion、DoorPortal、Room Graph、G4 语义。 | 共享边/开放空间邻接、语义置信度；避免 G4 重复处罚。 | 低 | 稳定：可标两个 Room/Zone 与门。 | 可以优先做 |
| 公共动线穿越私密空间 | 中：图、入口、Room/Zone 有；public/private 无结构化字段。 | 中低：无必经节点/删节点可达性。 | Entrance、Room Graph、门连接。 | 分类词典、图割或逐节点移除可达性；开放空间和多入口有歧义。 | 中 | 稳定：入口、Room、目标、门序列可标。 | 数据补齐后做 |
| 功能面积分配适配度 | 中：空间/总面积和功能名称有；人口、容量、面积要求通常缺。 | 高：面积和总量都能计算。 | RoomRegion 面积、Envelope 面积、G4 area。 | 功能规范化、开放空间归属、人口/容量输入；避免重算 G4 硬门槛。 | 中 | 稳定。 | 数据补齐后做 |
| 房间形状、无效交通和碎片空间 | 中：Room polygon、面积、周长、紧凑度、自由网格、家具占地有。 | 中低：有紧凑度/碎片诊断；无 MBR、凹度、骨架、交通分割。 | RoomRegion、footprint、导航自由单元、操作区。 | OBB/长宽比、凹凸度、交通区、家具后碎片；纯交通面积没有定义。 | 高 | 中高；碎片 polygon 需新增。 | 需要较大基础设施 |
| 核心家具配对关系 | 中低：类型、中心、矩形边界、旋转、Room 可得。 | 低：无 pair matcher、前向语义或配对 schema。 | FurnitureSemanticItem、footprint、操作区。 | 正面、候选筛选、一对多归属；asset 分类不稳定。 | 高 | 中：可标两家具和中间区。 | 暂不建议第一版做 |
| 私密对象入口视线暴露 | 中低：门中心/方向、床/马桶矩形可得；无视觉目标/遮挡语义。 | 无。 | DoorPortal、墙/家具 footprint、对象语义。 | ray--polygon、视角扇、遮挡、目标/观察点；包围矩形会误报。 | 高 | 中：需新增射线 overlay。 | 暂不建议第一版做 |

## 5. 与 G 规则的重复风险

| S1 候选 | 现有 G 边界 | 应复用的原始测量 | 避免重复处罚 |
|---|---|---|---|
| 高频路径效率 | G3-003/004/006 已检查路径连续、不依赖移动家具、不穿越实体。`src/evaluation/g3-navigation-rules.ts` | 网格、障碍分类、Portal 落点、G3 通过结果。 | G3 判“能否通”；S1 只在其通过后评估长度、绕行、转向。 |
| 路径交汇与冲突 | G3、门操作区、家具/fixture 使用区已覆盖不能通/不能操作。 | 路径、门扇、操作区。 | S1 只统计仍可通路线的共享与竞争；不重复净宽、碰撞、完全阻塞。 |
| 邻接适配度 | G4 已支持 `space_adjacency` 和 `space_separation`。`src/evaluation/g4-requirements.ts` | Zone--Room、直接关系边。 | 客户明确硬性关系只由 G4 判门槛；S1 仅评估未被客户硬编码的适配关系。 |
| 公共穿越私密 | G3-001 关注入口基本可达；G4 可表达特定 separation。 | 入口、Room 图、门连接。 | G3 判到不了则 S1 不运行；G4 判客户隔离则 S1 不重复。 |
| 面积分配 | G4 `space_area` 已检查 any/every/total 的面积上下限。 | Room 面积与 G4 测量。 | G4 判硬下限/上限；S1 只评价通过后的相对分配。 |
| 形状/碎片 | G1-012 排查数值残渣和不可信碎片；G3 检查基本可用区/路径。 | compactness、polygon、自由网格、操作区。 | G1/G3 处理错误几何和不可用；S1 只评价有效空间的质量。 |
| 家具配对 | G1-023 处理实体碰撞；G3 处理最低家具可用区。 | 家具 footprint、语义、Room 归属、G3 通过状态。 | S1 只评价相对组织；相撞/不可用仍归 G1/G3。 |
| 私密视线 | 目前无对应 G 规则。 | 门 Portal、墙/家具 footprint、对象语义。 | 无现存重复，但必须以数据可信和 G 准入为前提。 |

统一报告已有依赖规则机制，可复用同一原始测量而不生成第二张处罚卡：`src/evaluation-report/report.ts:80-123`。

## 6. S1 接入位置

### 触发位置

当前 UI 入口是 `runFoundationEvaluation()`：先建 handoff、Room/Graph/DoorOperation，再调用 `evaluateAll()`，随后计算导航和各类 use zones：`src/main.tsx:312-344`。

S1 最适合接在 `evaluateAll()` 获得完整 G1--G4 结果之后。只有所有适用规则为 `pass` 或 `not_applicable` 时才调用 S1；`issue` 或 `unable_to_determine` 都阻止进入。当前 `RuleStatus` 已有 `pass`、`issue`、`unable_to_determine`、`not_applicable`：`src/evaluation/types.ts:5`。

### 可复用输入和结果结构

- 直接复用 `EvaluationHandoff`，不要重新从 Pascal JSON 取数。
- `RuleResult` 已有 `normalizedObjectIds`、`pascalSourceIds`、`measurements`、`missingData`、`confidence`、`diagnostics` 和 `applicability` / `dataSufficiency`，足以承载单项 S1 的内部结果：`src/evaluation/types.ts:71-97`。
- `not_applicable` 和 `unable_to_determine` 已是通用状态；S1 可以复用，不需要另造状态类型。

### 报告和画布

- 可复用报告卡片和 `RuleResult` -> finding 的转换，但必须扩展 `EvaluationReport.scope`，以及 `src/evaluation-report/report.ts` 中的分组枚举、`groupOf()` 和筛选类型；当前仅识别 G1--G4。
- 可复用 `evaluationIssueTargets()`、`evaluationHighlightFor()`、`resolveEvaluationFocus()` 对 Room、Zone、门、墙、家具和 RoomRegion 的定位：`src/evaluation-ui/focus.ts:20-52`。
- 若 S1 输出路径、射线、热区等并非已有对象的几何，现有 `normalizedObjectIds` 只能高亮关联对象；需要额外的展示几何承载层才可画出分析本身。

## 7. 推荐的第一个垂直切片

建议先做：**功能空间邻接适配度**。

原因：它直接复用 Room--Door Portal--Connectivity Graph 链路，不依赖全局寻路、射线、buffer 或家具正面语义；可稳定定位两个空间及关联门；同时能验证 G 准入、S1 卡片、画布高亮和与 G4 去重的完整产品路径。

最小范围：

1. 只处理同层、`RoomRegion.usableForEvaluation` 为真、Zone--Room 匹配可靠的空间。
2. 只使用“同一 Room”或已有 `DoorPortal` 的直接关系。
3. 只处理现有语义识别覆盖的空间类型；其余返回 `unable_to_determine`，不猜测。
4. 对 G4 已明确检查的同一关系，跳过重复惩罚或仅显示覆盖说明。
5. 只高亮两个 Room/Zone 与关联门；不做热力图、路径动画、评分阈值或 0--100 映射。

人工验收：

- 厨房--餐厅直接连通：应可评价并定位两空间和门。
- 两空间经走廊或第三房间连接：不得误判为直接关系。
- Zone 无法可靠映射、曲墙门或 Portal 未解析：应为无法计算，而非负面评价。

## 8. 阻塞问题

1. **S1 不能直接接入当前报告分组。** `EvaluationReport.scope`、报告分组和 UI 筛选只支持 G1--G4；新的 `S1-*` 当前会在 `groupOf()` 中被默认归为 G1。见 `src/evaluation/types.ts:99-111`、`src/evaluation-report/report.ts:76-80`。
2. **当前没有 S1 准入分支。** `evaluateAll()` 合并 G1、G2、G3、G4，没有“全通过/不适用才运行 S1”的触发条件。见 `src/evaluation/evaluate.ts:73-76`。
3. **高频路径和路径冲突无法可靠实现。** 当前路径只在单个 Room 内 BFS，没有跨 Room 路由、目标锚点、长度、绕行或转向结果。见 `src/evaluation/navigation.ts:75-97`。
4. **入口视线暴露无法可靠实现。** 缺少射线/遮挡算法，也缺少私密对象视觉目标、家具正面和透明度数据。
5. **核心家具配对无法稳定实现。** 缺少配对关系、前向语义和可靠分类约束；当前语义依赖名称/category 正则，示例数据已存在分类不一致。

## 9. 后续实施结果：共享空间语义入口

第 8 节中的“尚无 S1 准入/报告分组”是实施前结论，已由此前的 S1 基础外壳解决：`src/evaluation/s1.ts` 提供严格白名单准入，`src/main.tsx` 提供独立 S1 区域、测量卡片和画布定位。本节记录在该外壳之上完成的语义来源调整。

### 已完成的调整

- 新增 `src/evaluation/space-semantics.ts`，作为空间语义的共享入口，而不是让 S1 依赖 G4。它同时提供两种粒度：
  - `RegulatoryRoomUse` / `resolveRegulatoryRoomSemantic()`：沿用 G2 既有的法规用途分类、开放复合 Room 处理和 `roomUseOverrides` 优先级；例如主卧归为 `sleeping`，开放客餐厨可归为 `habitable`。
  - `functionalSemanticsForZoneName()`：为 G4/S1 保留 `primary_bedroom`、`primary_bathroom`、`living_room`、`dining`、`laundry` 等细粒度、多标签的功能语义。
- G1-007 的“应封闭空间”关键词改由共享函数 `isEnclosedSpaceZoneName()` 提供：`src/evaluation/g1-rules.ts`。
- G2 的 `semanticOf()` 改为调用共享的 `resolveRegulatoryRoomSemantic()`；其原有输出和 override 行为不变：`src/evaluation/g2-rules.ts`。
- G3 的厨房/卫生间 Room 分类改为调用共享的 `regulatoryUseForZoneName()`：`src/evaluation/fixture-use.ts`。
- G4 的别名、目标空间标准化及 Room--Zone 功能语义改为从共享层导入；旧导出仍从 `g4-requirements.ts` 兼容转出：`src/evaluation/g4-requirements.ts`。
- S1 改为直接调用共享的 `functionalSemanticsForZoneName()`，不再导入 G4；卡片假设文字也明确为“与 G1--G4 共用”：`src/evaluation/s1.ts`。

### 刻意保留的兼容边界

`src/evaluation/g3-furniture-rules.ts` 的卧室/客厅/餐厅筛选暂时保留原有局部正则。回归中确认它的 `MASTER` 正则会把 `MASTER BATH` 计入“卧室”；这虽然不适合作为 S1/G4 的通用语义，却是现有 G3 结果的一部分。为了不在本次 S1 基础工作中悄悄改变已冻结的 G3 结果，没有将该专项规则强行切换到共享层。

后续若要完全统一 G3，应单独确认并修正这个业务判定，再更新 G3 基线测试；不应把它与 S1 功能关系测量混在同一改动中。

### 验证结果

- 新增 `src/evaluation/space-semantics.test.ts`，覆盖细粒度功能标签、粗粒度法规用途、G2 override 与复合 Room 行为。
- 全量测试：`36 passed | 1 skipped` 测试文件；`277 passed | 1 skipped` 用例。
- `npm run build` 通过；仅有既有的 Vite bundle size warning。
- `git diff --check` 通过。

## 10. 后续实施结果：S1 拓扑关系测量（4.2 及以后）

### 实际完成内容

- S1 锁定状态保持严格白名单准入；未满足时不会调用测量器，界面明确显示“**S1 尚未启动，需先完成并通过全部适用的 G1–G4 检查**”，并列出未解决结果数量及其 G1–G4 分组。
- `src/evaluation/connectivity.ts` 新增 `findShortestRoomPath()`：只在 Room Region 节点内执行稳定、无权 BFS，返回完整 Room 序列和经过的门/楼梯边；不允许通过 exterior 节点形成室外捷径。
- `src/evaluation/s1.ts` 从任意直接关系枚举改为两个配置式关系对：`S1-REL-001 kitchen ↔ dining` 与 `S1-REL-002 primary_bedroom ↔ primary_bathroom`。
- 每个配置对独立输出 `measured`、`not_applicable` 或 `unable_to_determine`。语义缺失为不适用；存在多个 Room 候选、Zone–Room 映射不可靠、Room 不可评价或图不连通为无法判断；不会任意选择第一个候选。
- 已输出同一开放空间、直接连接、经一个或多个中间 Room、跨楼层、完整 Room Region 路径、门 ID、楼梯 ID、拓扑步数、置信度和缺失数据；没有评分、权重、扣分或修改建议。
- S1 通过 `RequirementHandoff` 的结构化 `space_adjacency` / `space_separation` 检查同一对关系是否由 G4 覆盖，支持左右语义反转；覆盖时仅展示事实测量并标注 G4 需求 ID，不改变 G4 结果。
- S1 卡片仅以“已测量 / 无法判断 / 不适用”呈现。点击已测量卡片会高亮当前楼层上的起点、目标、中间 RoomRegion 与相关门/楼梯；跨层关系可分别定位起点或目标层。

### 验证结果

- 新增/扩展 S1 测试：严格准入、BFS 的同 Room、直接连接、一个/多个中间 Room、楼梯、断连和等长路径稳定性；配置对、缺失语义、多候选与 G4 覆盖。
- 全量测试：`36 passed | 1 skipped` 测试文件；`280 passed | 1 skipped` 用例。
- 构建、`git diff --check` 通过。
- 页面检查：Bellevue 示例执行 G1–G4 后，S1 显示锁定状态和 23 项阻塞结果（G1、G2、G3、G4），没有生成伪测量卡片。
