# S1 评分规则

版本：v0.1  
状态：待校准  
日期：2026-08-14

> 当前正式 S1 v0.1 Demo 由五轴构成：空间组织、动线效率、动静分区、空间利用、收纳配置。其余已保留模块只作为底层证据、历史局部分数或未来能力，不进入 S1 v0.1 总分。

本文件记录当前产品决策，不是法规标准、行业标准或经大样本验证的学术结论。以后任何 S1 评分规则、分数、适用条件或版本发生改变，代码配置与本文件必须在同一个任务中同步更新。

正式 S1 评分以 Zone 的 `spaceFunctionCode` 为数据前提。Zone 名称继续用于图纸和报告显示，也可作为旧 JSON 的兼容回退，但名称回退不得生成正式 S1 分数。SF 编码允许重复，每个具体空间仍由 Zone `id` 区分；当同类型编码对应多个候选 RoomRegion 时，必须由具体规则确定对象，不能默认选择第一个或按直线距离配对。

## S1 v0.1 Demo 正式汇总

正式流程为：**G1—G4 严格准入 → 五轴评分 → S1 总分 → 雷达与规则证据**。G1—G4 只决定准入，不进入任何 S1 数值平均；只有每条适用 G 结果均为 `pass` 或 `not_applicable` 时才允许生成 S1 总分。

| 固定顺序 | 正式轴 | 指标 ID | 正式规则 | 基础权重 |
| ---: | --- | --- | --- | ---: |
| 1 | 空间组织 | S1-SO | SO-01、SO-02、SO-03 | 20% |
| 2 | 动线效率 | S1-HPE | 高频行为路线、场景优先汇总 | 20% |
| 3 | 动静分区 | S1-DZ | DZ-01、DZ-02 | 20% |
| 4 | 空间利用 | S1-LY | LY-01、LY-02 | 20% |
| 5 | 收纳配置 | S1-SN | SN-01、SN-02、SN-03 | 20% |

五轴全部适用且均有正式分数时，`S1Total = average(axisScores)`，显示一位小数。某轴 genuinely `not_applicable` 时不显示为 0，并从分母排除；其余适用轴重新等权，报告同时显示 `x / 5 axes applicable`。任一正常应评价轴为 `unable_to_determine` 时，不按 0 分处理，但 S1 总分为 `null`，状态为 `unable_to_determine`，并说明“部分设计性能指标缺少可靠证据，暂不生成完整 S1 总分”。

雷达图只读取上述同一 aggregate result 的五轴正式分数，范围固定为 0—100；N/A 和无法判断均不会绘制为 0。当前总分与五轴均为 **v0.1 Demo provisional calibration**，不是法规、行业或学术标准。

## Deprecated / 已废弃

- **CJ-01 场景完整**：已废弃；家具组合不能可靠代表生活场景是否完整。
- **CJ-02 明确需求容量适配**：已废弃为 S1 评分；显式客户需求由 G4 客户需求匹配负责，S1 不重复评分。
- **场景适配轴**：已由**收纳配置**替代；不得作为雷达轴、S1 total 或当前报告规则。

## S1-DZ 动静分区（v0.1 Demo provisional calibration）

本轴只评价动区与静区的拓扑干扰及静区入口缓冲；不重复评价 HPE 的距离、绕行或转向，也不使用 PCI 的路径交叉证据。正式分类只读取合法 `spaceFunctionCode` 与 SDI 中文标准名，不读取 Zone 名称。

| 类别 | SF 编码 |
| --- | --- |
| active | SF01、SF02、SF06、SF07、SF22、SF26、SF27、SF28、SF36 |
| quiet | SF11、SF12、SF13、SF14、SF16、SF21、SF25、SF31 |
| neutral | SF00、SF03、SF04、SF05、SF08、SF09、SF10、SF15、SF17、SF18、SF19、SF20、SF23、SF24、SF29、SF30、SF32、SF33、SF34、SF35 |

SF16 书房为 quiet；产品已确认 SF25 工作室、SF31 佛堂为 quiet，SF33 观赏间为 neutral。SF50 及以上户外编码不参与本轴。

## S1-LY 空间利用（v0.1 Demo provisional calibration）

空间利用轴由 LY-01 与 LY-02 的适用规则等权平均；任一应评价规则为 `unable_to_determine` 时，轴分为空，`not_applicable` 排除。其正式轴分进入 S1 v0.1 aggregate；aggregate 再按五轴的统一状态规则决定是否生成总分。

**LY-01 显式纯交通面积占比。** 分母直接复用 HPE 的 `effectiveResidentialIndoorAreaSquareMeters`，不新建面积口径。分子只统计正式 SF09 走道的可靠 Zone–RoomRegion 有效几何，按楼层 union 后相加；SF08、SF10、SF19 楼梯、SF34、SF35 等不计入。楼梯暂不计入是为了避免系统性惩罚多层住宅。`corridorRatio` 的连续曲线为：≤5%=100、7%=90、10%=75、13%=50、16%=25、≥20%=0。

**LY-02 二维低效形状。** 只使用正式 Zone / RoomRegion 的二维有效几何与既有 SFS `compactness`、`convexityRatio` 定义；不使用家具、自由网格、门净距、路径或三维证据。参与正常日常功能空间；SF00、SF08、SF09、SF10、SF17、SF19、SF23、SF24、SF30、SF32 与 SF50+ 排除。SF29 酒窖、SF31 佛堂、SF33 观赏间以及 SF34 食品储藏间、SF35 泥房、SF36 儿童活动区参与。只有同时满足 `compactness < 0.45` 与 `convexity < 0.70` 才标记 `inefficient_shape`，一般不规则或仅单项低值不处罚。异常有效面积占比的连续曲线为：≤2%=100、5%=90、10%=75、15%=50、20%=25、≥30%=0。

本版本只抓明显二维结构异常，不把一般非矩形造型判为坏设计。后续真实样本校准重点为：走道占比曲线、双形状阈值、低效面积占比曲线，以及大平层、普通公寓和多层别墅是否存在系统性偏差；所有阈值调整必须版本化。

**DZ-01 动线扰静。** 以 SF06 客厅、SF07 餐厅为公共核心。每个 active RoomRegion 检查是否存在一条到公共核心、且不把 quiet RoomRegion 作为中间节点的 `RoomConnectivityGraph` 路径，复用 PCP 的移除中间节点后重测能力。`quiet_mandatory` 占可评价动区比例为 0、>0% 且 ≤20%、>20% 且 ≤50%、>50% 且 <100%、100% 时，分数依次为 100、80、50、20、0。原图不可达或语义/映射不足为 `unable_to_determine`，不按 0 分处理并阻止完整 DZ-01 分数；没有动区为 `not_applicable`。

**DZ-02 静区缓冲。** 每个 quiet RoomRegion 仅查看真实 DoorPortal 的直接室内邻接：仅有 neutral 且没有 active 为 100；同时有 neutral 与 active 为 80；仅连接 quiet 为 70；有 active 且无 neutral 为 50。仅当可靠拓扑证明通往公共核心必须把 active RoomRegion 作为中间节点时，为 20；拓扑不连通或邻接语义不可靠为 `unable_to_determine`，不生成 0 分。可评分静区等权平均；任一应评价静区无法判断时，DZ-02 总分为空。

DZ-01 与 DZ-02 等权汇总为动静分区轴；其中一个 genuinely `not_applicable` 时使用另一个，任一适用规则无法判断则轴分为空。后续以真实住宅样本检查分类场景偏差、DZ-01 比例档位、DZ-02 入口关系分值及中国/海外样本系统性偏差；所有调整必须版本化。

## 1. S1 与 G1–G4 的边界

G1–G4 是准入检查：只有适用结果全部为 `pass` 或 `not_applicable` 才会启动 S1。G 处理数据、法规技术安全、最低可用条件和客户明确需求；S1 只在准入后评价设计表现。家具碰撞、最低通道、基本可达和客户明确的邻接或分离需求不在本子项重复处罚。

若 G4 的 `space_adjacency` 或 `space_separation` 已明确覆盖某关系对，S1 继续展示拓扑事实，但不计分、不奖惩，避免双重处理。

## 2. S1 候选指标

1. 高频活动路径效率（v0.1 Demo 正式局部评分已实现）
2. 常用路径交汇与冲突（原始测量 v0.1 已实现，尚未评分）
3. 功能空间邻接适配度（本次已实现其“功能空间关系适配度”v0.1）
4. 公共动线穿越私密空间（局部评分 v0.1 已实现）
5. 功能面积分配适配度（未实现）
6. 房间形状、无效交通和碎片空间（房间形状与碎片空间原始测量 v0.1 已实现；无效交通不在本项重复测量）
7. 核心家具关系与使用空间（原始测量 v0.1 已实现，尚未评分）
8. 私密对象的入口视线暴露（未实现）

## 3. 功能空间关系适配度（S1-FR）

本子项将现有、已通过准入的 Room Connectivity Graph 拓扑测量映射到局部 0–100 分。测量仍保留原样；评分只读取同一 RoomRegion、直接连接、中间 RoomRegion、门、楼梯、跨层和不连通证据。

适用关系对：厨房—餐厅（S1-REL-001）与主卧—主卫（S1-REL-002）。空间缺失为 `not_applicable`，主卧/主卫候选不唯一或中间空间语义不能可靠分类为 `unable_to_determine`，两种情况均不得伪造 0 分。

语义解析优先使用合法 SF 编码；缺少编码时才使用 Zone 名称回退展示拓扑事实。若关系对任一端仅由名称回退识别，其局部分数为空且不进入平均分。`OPEN TO BELOW` 暂时保留为未编码 Zone，不删除也不自动补码。

## 4. G4 去重与子项汇总

- 已被 G4 覆盖：`excludedFromScoring=true`，分数为空，不进入分母。
- `not_applicable`：不进入分母，不拉低分数。
- 任一本应参与的关系对 `unable_to_determine`：子项也为 `unable_to_determine`，分数为空。
- 至少一个可靠可计分关系对且无上述无法判断时：算术平均，保留 1 位小数。
- 全部关系对被 G4 排除或不适用：子项 `not_applicable`，分数为空。

S1-FR 只作为空间组织轴的 SO-01、SO-02 底层关系分数来源，不单独作为雷达轴；其结果由 S1 v0.1 aggregate 间接进入空间组织轴与总分。

## 5. 厨房—餐厅规则（S1-FR-001）

| ruleId | 实际测量结果 | 附加条件 | 分数 |
| --- | --- | --- | ---: |
| S1-FR-001-R01 | same_open_space | 无 | 100 |
| S1-FR-001-R02 | direct_connection | 门或开放连接，且不跨楼层 | 100 |
| S1-FR-001-R03 | 一个中间空间 | 可靠餐厨服务空间（pantry、butler pantry 等） | 90 |
| S1-FR-001-R04 | 一个中间空间 | 可靠交通空间（走廊、门厅等） | 70 |
| S1-FR-001-R05 | 一个中间空间 | 其他可靠主要功能空间 | 40 |
| S1-FR-001-R06 | 两个及以上中间空间 | 无 | 20 |
| S1-FR-001-R07 | different_level | 无 | 0 |
| S1-FR-001-R08 | disconnected | 两空间存在且拓扑证据可靠 | 0 |

不区分开放式与封闭式厨房优劣。一个中间空间无法可靠归入服务、交通或主要功能时，结果为 `unable_to_determine`。

## 6. 主卧—主卫规则（S1-FR-002）

| ruleId | 实际测量结果 | 附加条件 | 分数 |
| --- | --- | --- | ---: |
| S1-FR-002-R01 | direct_connection | 通过门，且不跨楼层 | 100 |
| S1-FR-002-R02 | 一个中间空间 | 可靠步入式衣帽间或独立更衣区 | 95 |
| S1-FR-002-R03 | 一个中间空间 | 可靠交通空间 | 60 |
| S1-FR-002-R04 | same_open_space | 同一无隔断 RoomRegion | 30 |
| S1-FR-002-R05 | direct_connection | 开放连接、没有门 | 30 |
| S1-FR-002-R06 | 一个中间空间 | 其他可靠主要功能空间 | 30 |
| S1-FR-002-R07 | 两个及以上中间空间 | 无 | 10 |
| S1-FR-002-R08 | different_level | 无 | 0 |
| S1-FR-002-R09 | disconnected | 两空间存在且拓扑证据可靠 | 0 |

直接连接通过 `connectionDoorIds` 区分门与开放连接；不得因拓扑相邻而假定有门。没有主卫为 `not_applicable`；候选不唯一或中间空间语义不足为 `unable_to_determine`。

## 7. 公共动线穿越私密空间：测量定义（S1-PCP）

本指标 ID 为 `S1-PCP`，规则版本为 v0.1，规则状态为“待校准”。当前保留其 0—100 局部证据，但它不是 S1 v0.1 五轴或总分输入。正式测量和正式评分只使用合法 `spaceFunctionCode`，名称回退不能生成本指标的正式结果。

### 7.1 路线范围

1. 入户到公共空间：SF10 到 SF06、SF07、SF04、SF27、SF28；没有 SF10 时只回退到现有图中唯一可靠的住宅主入口。
2. 访客空间到公卫：SF06、SF07、SF27、SF28 到 SF04。SF03 主卫和 SF05 次卫不作为目的空间。
3. 公共空间到公共户外：SF06、SF07、SF27、SF28 到 SF51、SF52、SF54。SF17 阳台不自动视为公共户外。
4. 车库返回住宅：只有 SF30 RoomRegion 存在可靠住宅内部连接时，才测量其到 SF08、SF09、SF01、SF02、SF06、SF07 的路线；车库外部车辆开口不构成内部连接。

同编码 Zone 落在同一 RoomRegion 时合并为一个空间实例；落在不同 RoomRegion 时逐实例生成路线，不选择第一个候选，也不按直线距离配对。

### 7.2 私密中间空间与判定

v0.1 的私密 SF 编码仅为 SF11、SF12、SF13、SF14、SF21、SF03、SF15。私密属性只在 RoomRegion 作为路线中间节点时生效，起点和终点始终保留。

判定步骤：先在完整 Room Connectivity Graph 中计算稳定的原始最短路径；若原图可达，再移除私密中间 RoomRegion 并重新执行稳定 BFS。移除后仍可达为 `privacy_safe_route_available`；移除后不可达为 `private_space_mandatory`，并保留一条稳定原始最短路径作为见证。原图不可达为 `baseline_unreachable`，只展示事实，不重复评价 G 层的基本可达问题。

SF05、SF09、SF16、SF17、SF20、SF22、SF25 等条件型空间暂不作为私密阻断节点。当前不实现真实步行距离、网格路径、A*/Theta*、介数中心性或阳台公私属性自动判断。

### 7.3 路线评分规则

| ruleId | 原始测量结果 | 路线分数 | 处理 |
| --- | --- | ---: | --- |
| S1-PCP-R01 | `privacy_safe_route_available` | 100 | 存在不穿越私密空间的可行路线。 |
| S1-PCP-R02 | `private_space_mandatory` | 0 | 所有可行路线都必须经过至少一个私密中间空间。 |
| S1-PCP-R03 | `baseline_unreachable` | — | `unable_to_determine`；原图不可达，不在本项重复处罚。 |
| S1-PCP-R04 | `unable_to_determine` | — | `unable_to_determine`；不能伪造 0 分。 |
| S1-PCP-R05 | `not_applicable` | — | 不进入路线组或指标分母。 |

### 7.4 路线组与指标汇总

四组路线为：进入住宅、访客前往公卫、公共空间前往公共户外区域、车库归家动线。组内所有可评分路线等权算术平均，保留一位小数。全部安全路线为 100；例如 4 条中 3 条安全、1 条强制穿越，组分数为 75。

没有实际适用起点或目的空间的路线组为 `not_applicable`，不进入指标分母。组内出现 `baseline_unreachable` 或 `unable_to_determine` 时，整组为 `unable_to_determine`、分数为空；不得用其余路线形成不完整正式组分数。

所有可正式评分的适用路线组等权平均，保留一位小数。不适用组排除后重新平均；任一适用组无法判断时，S1-PCP 整体为 `unable_to_determine`、分数为空；全部组不适用时整体为 `not_applicable`。

### 7.5 入户数据要求

优先使用一个或多个 SF10；每个 SF10 所在的实际 RoomRegion 分别参与检查。缺少 SF10 时，只允许使用唯一可靠住宅主入口回退。若没有 SF10 且多个外门无法区分，进入住宅组必须为 `unable_to_determine`，不得按门位置、面积或直线距离猜测。

## 8. 高频活动路径效率：v0.1 Demo 正式局部评分（S1-HPE）

本指标 ID 为 `S1-HPE`，规则版本为 `v0.1-demo`，状态为 **Demo provisional calibration**。正式测量的关键起点和终点必须由合法 `spaceFunctionCode` 识别；名称回退只能产生 `unable_to_determine`，不能形成正式测量结果。它是 S1 v0.1 的“动线效率”正式轴，局部分数进入 aggregate 与 S1 / 100 总分；不产生等级或扣分卡。

### 8.1 路线范围

1. 主要归家到厨房：起点是唯一 `isPrimaryEntrance=true` Door 的住宅侧 landing；旧数据仅在存在唯一可靠住宅外门时兼容回退。多个外门或多个主入口标记均为 `unable_to_determine`。目标为完整路径实际最近的 SF01/SF02 Kitchen Zone 首次合法进入位置。
2. 车库归家到厨房：从 SF30 RoomRegion 通往非 Garage 住宅 RoomRegion 的真实 DoorPortal 住宅侧 landing 出发，到实际最近的 Kitchen Zone 首次进入位置。多个车库住宅门都参与全局最短选择；外部车辆门不参与。
3. 卧室到可用卫生间：SF11、SF12、SF13、SF14 或 SF21 中每张正式 `functionTags` 床分别生成路线。Item `resolvedRotationRadians` 的局部 Z 轴是床头→床尾纵向轴，垂直的局部 X 轴两侧是正常下床侧；SF11 优先可达 SF03，不可达时回退 SF04/SF05；其他卧室只在 SF04/SF05 中按完整实际路径选择。

卫生间选择不得按平面直线距离分配。同编码 Zone 落在同一 RoomRegion 时合并为一个空间实例；落在不同 RoomRegion 时逐实例测量。

### 8.2 跨房间路径方法

生产路径使用 RoomConnectivityGraph 的合法 Room/Portal/楼梯约束、房内 Polygon Visibility Graph 与全局 deterministic Dijkstra。归家端点是 DoorPortal 住宅侧 landing；Kitchen Zone 与 clearance 后 walkable polygon 的交集边界按集中配置的最大 1.0 m 间距稳定采样，搜索到任一合法候选即表示首次进入，而不是继续前往 Zone centroid。多个 Kitchen Zone 的候选按完整二维路径选择最短者。

床端点以稳定 Item ID 区分。复用 `rectangularFootprint()` 的 local-to-world 旋转约定：`resolvedRotationRadians` 将局部 Z（床头→床尾）和局部 X（左右）转换到世界平面；左右侧各在纵向 25%/50%/75% 位置采样，并只保留落在正式 walkable polygon 的候选。床头和床尾不参与；近方形或 King Size 不构成 `unable_to_determine`，只有中心点、世界方向、尺寸或 footprint 本身不可靠时才阻止该床。若主要入口 Door 同时为 Garage→Residence Door，且起点 landing 与选中 Kitchen Zone 相同，两条归家行为合并成一条测量并保留两个行为来源。

### 8.3 原始测量字段

每条路线记录：`metricId`、稳定 `routeId`、`routeGroup`、`behaviorSources`、起终 RoomRegion/Zone/SF 编码、选中 Kitchen Zone ID/编码、行为对象 ID、行为锚点类型与坐标、`roomPathIds`、`doorIds`、`stairIds`、正式 `pathPoints`、`actualPathLengthMeters`、`straightLineDistanceMeters`、`detourRatio`、`topologicalSteps`、`intermediateRoomCount`、`turnCount`、起终楼层、`status`、`confidence`、`diagnostics` 和 `missingData`。卧室 `routeId` 包含 Bed Item ID，并记录主卫回退及等长卫生间候选。

正式 `pathPoints`、`actualPathLengthMeters`、`detourRatio` 和 `turnCount` 均使用房内可见性平滑后的路径。同层时计算两个 Zone 独立锚点的平面直线距离，并在距离有效时计算 `detourRatio`；跨楼层的直线距离和绕行比均为空，不伪造三维基准距离。转向统计继续删除共线或小方向变化点，再统计方向变化大于 **15°** 的节点；该阈值集中定义在 S1-HPE 配置中。卫生间等长候选容差为 **0.01 m**，仅用于记录稳定并列，不用于直线距离配对。

### 8.4 状态与适用规则

- `measured`：语义、RoomRegion、Portal、自由网格和锚点足以形成完整路径。
- `baseline_unreachable`：Room Connectivity Graph 中起终空间不可达；不得伪造路径或零长度。
- `unable_to_determine`：正式语义、Zone—RoomRegion 映射、Portal、网格或锚点不足。
- `not_applicable`：项目中不存在路线组所需空间，或车库没有可靠住宅内部连接。

本指标与 S1-FR、S1-PCP 分工不同：S1-FR 记录空间拓扑关系，S1-PCP 判断私密空间是否是必经中间节点，S1-HPE 评价具体通行的相对距离与绕行。本版不把 `turnCount`、PCI 路径交叉、重叠或共用对象纳入 HPE 评分。

### 8.5 已冻结的未来评分原则

以下是已确认的产品原则，不是当前评分实现，也不包含米数阈值、`detourRatio` 阈值、权重或 0—100 映射。

1. **单条路线同时考虑实际行走距离和明显绕行。** 路线笔直但行为距离过长，不能自动获得高分；距离较短但存在明显无意义绕行，也应在未来评分中体现。不同生活场景不能直接共用同一套绝对距离标准，例如“卧室→卫生间”与“归家→厨房”的距离尺子可以不同。
2. **先按生活场景汇总，再汇总 HPE。** 当前场景为“归家→厨房”（适用的 Primary Entry→Kitchen、Garage Return→Kitchen；已去重路线只计算一次）与“卧室→卫生间”（每张正式床→合适卫生间入口）。多个卧室或床先在本场景内部汇总，之后两个适用场景再形成总体结果；路线数量不直接决定生活场景权重。
3. **应适用但 `unable_to_determine` 的路线阻止不完整正式总分。** 已成功测量的路线仍展示，并可在未来展示各自局部结果；`unable_to_determine` 不按 0 分处理，但 HPE 不得生成看似完整的正式总分。`not_applicable` 与之不同：不存在的路线不进入适用范围；本应测量但数据不足或无法可靠判断才是 `unable_to_determine`。

继续保持当前边界：`turnCount` 仅为测量证据，不进入正式评分；S1-PCI 的路径交叉、重叠和共用对象也仍是独立证据，不进入当前 HPE 正式评分。HPE 只作为五轴之一进入 S1 aggregate，不单独定义另一套总分。

### 8.6 评分输入与有效住宅室内面积

每条正式 `measured` 路线计算：

`normalizedDistance = actualPathLengthMeters / sqrt(effectiveResidentialIndoorAreaSquareMeters)`。

`effectiveResidentialIndoorAreaSquareMeters` 是本 v0.1 Demo 专用归一化口径：只使用合法 `spaceFunctionCode`，先把 Zone 与其可靠 `RoomRegion` 的有效交集作为候选几何，再按楼层求并集并相加，因此开放客餐厨的重叠 Zone 不会重复计面积。计入 SF00—SF33 的正常住宅室内功能空间；排除 `SF24` 设备空间、`SF30` 车库、`SF32` 电梯、`SF50+` 户外空间。未编码 Zone 不计入，也不得依据名称猜测。任何应计入 Zone 缺少可靠 Zone–RoomRegion 有效几何时，本项面积为 `unable_to_determine`，不生成正式 HPE 分数。

### 8.7 单路线评分

卧室→卫生间相对距离锚点：`≤0.20=100`、`0.35=90`、`0.50=75`、`0.70=50`、`0.90=25`、`≥1.10=0`；归家→厨房相对距离锚点：`≤0.35=100`、`0.55=90`、`0.75=75`、`1.00=50`、`1.25=25`、`≥1.50=0`。各锚点之间线性插值。

所有路线使用同一绕行比锚点：`≤1.10=100`、`1.20=90`、`1.35=75`、`1.50=60`、`1.75=35`、`≥2.00=0`；各锚点之间线性插值。

`routeScore = normalizedDistanceScore × 0.60 + detourScore × 0.40`。保留 `normalizedDistance`、两项分数及 `routeScore`，报告展示保留一位小数。以上为 v0.1 Demo 校准值，不是国家标准、行业标准或科研标准。

### 8.8 场景汇总与状态

先按生活场景汇总，再汇总 HPE：

1. **卧室→卫生间**：每张正式床到合适卫生间入口的正式路线等权平均。
2. **归家→厨房**：Primary Entry→Kitchen 与 Garage Return→Kitchen 的去重正式路线等权平均；同一实际起点/终点的合并路线只计一次。
3. 两个适用场景等权平均为 HPE 局部分数；只有一个场景适用时，使用该场景分数。

`not_applicable` 路线或场景排除出分母。任一本应适用路线为 `unable_to_determine` 时，已测路线仍计算和展示局部分数，且不记为 0；但该场景和 HPE 整体均为 `unable_to_determine`、总分为空，不得将剩余路线伪装成完整正式分数。

### 8.9 后续校准计划

1. 收集 10—20 套不同面积的真实住宅。
2. 由产品与设计师人工标记路线为优秀、正常、较差。
3. 比较人工判断与 `normalizedDistance`、`detourRatio`、`routeScore`。
4. 调整 anchor。
5. 累积约 30 套后形成 v0.2 校准。
6. 所有阈值变化必须版本化记录。

## 9. 常用路径交汇与冲突：原始测量定义（S1-PCI）

本指标 ID 为 `S1-PCI`，规则版本为 v0.1，状态为“原始测量，尚未评分”。S1-PCI 只读取 S1-HPE 中状态为 `measured` 的正式平滑路线及其 `routeId`、路线组、起终空间、`pathPoints`、RoomRegion、门、楼梯和楼层证据；不重新生成路径，也不接受名称回退形成的新路线。可用路线少于 2 条时整体为 `not_applicable`。

### 9.1 路线配对

可用路线先按 `routeId` 稳定排序，再生成不重复的两两组合。同一路线不与自身配对，A—B 与 B—A 只生成一个稳定 `routePairId`。同一路线组、共用起点或共用终点都不会被预先排除；跨楼层路线只比较相同楼层的折线片段。

### 9.2 几何交叉与共用端点

点状交叉由两条同层正式平滑折线段的几何相交计算。相邻折线段重复产生、且位于 **0.05 m** 点容差内的交点合并为一个稳定交叉点。两条路线的起点或终点在 0.05 m 内完全相同，标记 `shared_endpoint`；该共同端点造成的接触不重复计为普通 `path_crossing`。

### 9.3 路径重叠与方向

仅当两条同层折线段的方向差不超过 **5°**、相互线距不超过 **0.05 m**，且投影共享长度至少为 **0.05 m** 时，才形成路径重叠。沿路线 A 的重叠区间在间隙不超过 **0.05 m** 时合并，防止同一共享通行段被切成大量微段。`sharedPathLengthMeters` 和两条路线各自的共享比例均来自合并后的重叠段。

重叠方向直接比较重叠折线向量：同向为 `same_direction`，反向为 `opposite_direction`；同一路线对同时出现两种方向时为 `mixed`。没有可靠重叠段时方向为 `unable_to_determine`，不得依据空间名称猜测。

### 9.4 共同使用对象与热点

两条路线使用相同 `doorId` 时记录 `shared_door`，使用相同 `stairId` 时记录 `shared_stair`。`sharedRoomRegionIds` 只作为辅助事实，不能单独生成几何冲突标签。每个 Door、Stair 和 RoomRegion 的热点值是经过它的去重 HPE 路线数量；交叉点热点是同一 0.05 m 聚类位置涉及的去重路线数量。这些不是图介数中心性，也不是设计缺陷结论。

路线对可同时包含 `shared_endpoint`、`path_crossing`、同向/反向/混合重叠、`shared_door` 和 `shared_stair`。没有上述事实时为 `no_interaction`；输入片段不足时为 `unable_to_determine`。本指标当前没有分数、权重、扣分、等级或 S1 总分，多维表格抄录区不增加评分规则行。

## 10. 房间形状与碎片空间：原始测量定义（S1-SFS）

本指标 ID 为 `S1-SFS`，规则版本为 v0.1，状态为“原始测量，尚未评分”。第一版只测量室内 SF00–SF33 的功能空间边界与家具后自由空间连通事实，不包含阈值、分数、权重、等级、扣分、修改建议或 S1 总分。SF50 及以上户外功能空间、未编码 Zone 和挑空暂不参与正式测量。

### 10.1 分析单位与边界

每个空间实例由合法 SF 编码与可靠 RoomRegion 共同确定。同编码 Zone 位于同一 RoomRegion 时合并；同编码位于不同 RoomRegion 时分别测量；不同 SF 编码即使处于同一开放 RoomRegion，也分别保留各自功能实例。有效测量边界为实例 Zone polygon 并集与 RoomRegion 多边形的交集。名称回退不能形成正式结果；Zone 几何、交集或一对一/多 Zone 共房间映射不可靠时为 `unable_to_determine`。

### 10.2 结构形状事实

- `footprintAreaSquareMeters` 使用多边形净面积，洞面积从外环扣除。
- `footprintPerimeterMeters` 包含外环和洞边界的周长。
- `compactness = 4 × π × 面积 / 周长²`。
- 凸包由功能边界外环顶点使用稳定单调链算法计算。
- `convexityRatio = 实际净面积 / 凸包面积`。
- `concavePocketAreaSquareMeters = 凸包面积 - 实际净面积`。
- `concavePocketRatio = 凹入面积 / 凸包面积`。

上述数值只作为几何事实。洞会降低凸度并计入凸包与净面积的差；当前不使用“规整、畸形”等质量词，也不制定房间形状阈值。

### 10.3 furnished 自由空间碎片

复用现有 furnished 自由网格，将网格点限制在功能空间有效边界内，再按四邻接计算稳定连通分量。网格边长当前为导航系统既有的 **0.1 m**，每个网格点以 `gridMeters²` 计面积。最大连通分量记录为主要可通行空间，其余所有分量均记录为碎片，不设置最小碎片面积阈值。

输出总可通行面积、连通分量数量、最大分量面积及比例、碎片数量、碎片面积与比例，并保留各分量的网格点供画布定位。功能范围内没有任何可通行网格时，仍返回 0 m² 测量事实和诊断；比例为空，不转换成分数或质量结论。

### 10.4 状态与边界

- `measured`：合法 SF 编码、Zone 几何、可靠 RoomRegion 映射、有效交集和 furnished 网格均可用；零自由网格仍是可报告的测量事实。
- `unable_to_determine`：关键几何、映射或自由网格不足。
- `not_applicable`：项目没有任何可参与的室内编码功能空间。

本项不评价面积是否足够、法规或轮椅净宽、通道宽度、家具使用净距、室内最短路径或交通效率。HPE 已记录的实际路径长度、绕行和转向不在 S1-SFS 重复测量。当前没有评分规则，因此多维表格抄录区不新增 S1-SFS 评分行。

## 11. 核心家具关系与使用空间：原始测量定义（S1-FUR）

本指标 ID 为 `S1-FUR`，规则版本为 v0.1，状态为“原始测量，尚未评分”。它分别记录家具使用/开启空间事实和核心家具关系事实，不把两类测量合成质量结论；当前不产生分数、阈值、等级、权重、扣分或 S1 总分。

### 11.1 正式家具语义

正式用途只读取 Item `functionTags`，并按共享 [object-semantics.ts](</Users/dupanghu/Workspace/pascal-layout-auditor/src/evaluation/object-semantics.ts>) 的标签集合判断角色；一个 Item 可有多个标签，不假设第一项是主功能。`asset.category`、Item 名称、资产名称和资产 ID 仅用于报告与诊断。缺少必要 `functionTags` 时不得用名称回退形成正式结果。

### 11.2 最小使用空间与最大开启范围

S1-FUR 直接复用共享操作区的 `minimumUsePolygon` 与 `openingPolygon`，以及与 G3 相同的显式几何、障碍豁免、轻型可移动座椅、Slab 越界、RoomRegion 包含和入口可达证据，不另建碰撞模型。

每个有显式定义的 Item 分别记录最小使用空间和最大开启范围的面积、重叠面积与比例、冲突 Item、冲突建筑构件、是否可用/可完整展开、状态、置信度、诊断和缺失数据。本来没有相关显式几何的家具为 `not_applicable`，不视为数据错误。使用空间与开启范围是两个独立测量，不合并为“家具得分”。

### 11.3 第一批核心家具关系

第一批关系为餐桌—餐椅、床—床头柜、沙发—茶几、书桌—工作椅。只有两端均可由正式 `functionTags` 识别时才测量。每条关系记录 Item ID、标签、RoomRegion、共同 Zone、中心距离、footprint 边界距离，以及相对家具 A 的方向和角度；这些只表示几何事实。

同类多实例先按同一明确功能 Zone 选候选，其次按同一 RoomRegion，再以边界距离、中心距离和稳定 Item ID 排序。床或餐桌可以对应多个伙伴，不强制一对一。若多个候选在集中配置的 **0.01 m** 并列容差内同样合理，结果为 `ambiguous` / `unable_to_determine`，不得随机选择第一个或跨空间猜配。

### 11.4 边界

S1-FUR 不重复计算空间拓扑、隐私穿越、活动路径、路线交汇、房间形状或全房自由空间碎片。家具碰撞和最低可用条件仍属于 G；S1-FUR 当前只保留复用的原始测量证据，未来评分必须明确避免对同一事实重复处罚。

## S1-SN 收纳配置（v0.1 Demo provisional calibration）

第五个雷达轴正式名称为“收纳配置”，由 SN-01 卧室收纳、SN-02 厨房 / 食品收纳、SN-03 归家收纳组成。三个适用规则等权平均；`not_applicable` 排除后重新归一化；任一正常应评价规则为 `unable_to_determine` 时，已知结果可展示，但轴分为空。该轴进入 S1 v0.1 aggregate 与总分。

所有收纳计算统一采用 `grossStorageVolume = width × depth × height`，直接读取 Item 或 Shelf 的 `dimensionsMeters`，单位为 m³。这是估算收纳体积，不扣除门板、层板、铰链、抽屉或内部结构；同一 Item 只统计一次。尺寸无效或缺失时不猜测，相关应评价规则为 `unable_to_determine`。Item 用途只读取权威 `functionTags`，不根据名称或尺寸推断收纳能力。

### SN-01 卧室收纳

参与的正式卧室为 SF11、SF12、SF13、SF14、SF21。每个卧室的 `bedroomStorageVolume` 等于卧室自身 `wardrobes` 与拓扑上明确 dedicated 给该卧室的 SF15 衣帽间内 `wardrobes` 之和。SF15 只能通过 `RoomConnectivityGraph` 与真实 `DoorPortal` 判定归属：直接或只经明确套房内部辅助空间且唯一服务一个卧室为 `dedicated`；连接公共系统或服务多个卧室为 `shared`，不分摊；不能可靠唯一归属为 `unable_to_determine`，不强行分配。单卧室体积曲线为 0/0，0.8/40，1.5/70，2.2/90，≥3.0/100，中间线性插值；可评分卧室等权平均为 SN-01。

### SN-02 厨房 / 食品收纳

厨房只读取 SF01/SF02，计入 `cabinets`、`base-cabinets`、`open-rack`、`open-shelf`。`kitchen-island` 不计入，因为现有权威语义不能证明其内部一定承担收纳。厨房相连的 SF34 Pantry 沿连续 Pantry RoomRegion 链向内遍历；遇到非 SF34 即停止。每个厨房系统独立计算并评分，多个系统等权平均。体积曲线为 0/0，1.0/40，2.0/70，3.5/90，≥5.0/100，中间线性插值。

### SN-03 归家收纳

SN-03 直接复用 SO-03 已确认的主要入口、车库来源与合法入户序列，不重新猜测入口。只统计进入公共核心前序列中的 SF08 Entry/Foyer、SF10 Entry、SF35 Mudroom 内 `wardrobes`、`cabinets`、`base-cabinets`、`open-rack`、`open-shelf`；厨房、Pantry 或后续功能空间不重复统计。体积曲线为 0/0，0.3/40，0.7/70，1.2/90，≥1.8/100，中间线性插值。

本轴为 v0.1 Demo provisional calibration，不是国家标准、行业标准或真实净容积结论。旧 CJ-01“场景完整度”保持废弃；旧 CJ-02“明确需求容量适配”不进入 S1，明确客户需求仍由 G4 负责。

## 12. 多维表格抄录区

| rule_version | rule_status | metric_id | metric_name | pair_id | pair_name | rule_id | measured_relation | intermediate_space_condition | connection_condition | score | applicability | g4_handling | rationale | implementation_status | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R01 | same_open_space | 无 | 无 | 100 | 两空间可靠识别 | G4覆盖则排除 | 同一开放空间 | 已实现 | 不区分开放/封闭厨房 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R02 | direct_connection | 无 | 门或开放连接且不跨层 | 100 | 两空间可靠识别 | G4覆盖则排除 | 直接连接 | 已实现 | 无 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R03 | one_intermediate_space | pantry/butler pantry/餐厨服务 | 无 | 90 | 中间空间可靠识别 | G4覆盖则排除 | 服务空间过渡 | 已实现 | 语义不足则无法判断 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R04 | one_intermediate_space | 交通空间 | 无 | 70 | 中间空间可靠识别 | G4覆盖则排除 | 交通空间过渡 | 已实现 | 语义不足则无法判断 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R05 | one_intermediate_space | 其他主要功能空间 | 无 | 40 | 中间空间可靠识别 | G4覆盖则排除 | 主要功能空间过渡 | 已实现 | 语义不足则无法判断 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R06 | multiple_intermediate_spaces | 两个及以上 | 无 | 20 | 两空间可靠识别 | G4覆盖则排除 | 多空间绕行 | 已实现 | 无 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R07 | different_level | 无 | 跨楼层 | 0 | 两空间可靠识别 | G4覆盖则排除 | 跨楼层 | 已实现 | 非 G 问题 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-001 | 厨房—餐厅 | S1-FR-001-R08 | disconnected | 无 | 无 | 0 | 两空间存在且证据可靠 | G4覆盖则排除 | 不连通 | 已实现 | 语义或拓扑不可靠则无法判断 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R01 | direct_connection | 无 | 门且不跨层 | 100 | 主卧主卫唯一可靠 | G4覆盖则排除 | 有门直接连接 | 已实现 | 无 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R02 | one_intermediate_space | walk-in closet/dressing room | 无 | 95 | 中间空间可靠识别 | G4覆盖则排除 | 衣帽/更衣过渡 | 已实现 | 语义不足则无法判断 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R03 | one_intermediate_space | 交通空间 | 无 | 60 | 中间空间可靠识别 | G4覆盖则排除 | 交通空间过渡 | 已实现 | 无 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R04 | same_open_space | 无 | 无隔断 | 30 | 主卧主卫唯一可靠 | G4覆盖则排除 | 无隐私分隔 | 已实现 | 无 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R05 | direct_connection | 无 | 开放连接、无门 | 30 | 主卧主卫唯一可靠 | G4覆盖则排除 | 缺少门分隔 | 已实现 | 不根据相邻推定有门 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R06 | one_intermediate_space | 其他主要功能空间 | 无 | 30 | 中间空间可靠识别 | G4覆盖则排除 | 主要功能空间过渡 | 已实现 | 语义不足则无法判断 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R07 | multiple_intermediate_spaces | 两个及以上 | 无 | 10 | 主卧主卫唯一可靠 | G4覆盖则排除 | 多空间绕行 | 已实现 | 无 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R08 | different_level | 无 | 跨楼层 | 0 | 主卧主卫唯一可靠 | G4覆盖则排除 | 跨楼层 | 已实现 | 非 G 问题 |
| v0.1 | 待校准 | S1-FR | 功能空间关系适配度 | S1-REL-002 | 主卧—主卫 | S1-FR-002-R09 | disconnected | 无 | 无 | 0 | 两空间存在且证据可靠 | G4覆盖则排除 | 不连通 | 已实现 | 语义或拓扑不可靠则无法判断 |
| v0.1 | 待校准 | S1-PCP | 公共动线穿越私密空间 | 路线实例 | 公共动线路线 | S1-PCP-R01 | privacy_safe_route_available | 私密空间不是中间通道 | 无 | 100 | SDI 与拓扑可靠 | 不改变 G4 结果 | 存在安全路线 | 已实现 | 路线组内等权 |
| v0.1 | 待校准 | S1-PCP | 公共动线穿越私密空间 | 路线实例 | 公共动线路线 | S1-PCP-R02 | private_space_mandatory | 至少一个私密中间空间 | 无 | 0 | SDI 与拓扑可靠 | 不改变 G4 结果 | 强制穿越私密空间 | 已实现 | 路线组内等权 |
| v0.1 | 待校准 | S1-PCP | 公共动线穿越私密空间 | 路线实例 | 公共动线路线 | S1-PCP-R03 | baseline_unreachable | 无 | 原图不可达 | — | 无法判断 | 不重复评价 G 基本可达 | 无法评价隐私穿越 | 已实现 | 不计 0 分 |
| v0.1 | 待校准 | S1-PCP | 公共动线穿越私密空间 | 路线实例 | 公共动线路线 | S1-PCP-R04 | unable_to_determine | 无 | 语义或拓扑不足 | — | 无法判断 | 不改变 G4 结果 | 不能伪造分数 | 已实现 | 阻止正式组/指标分数 |
| v0.1 | 待校准 | S1-PCP | 公共动线穿越私密空间 | 路线实例 | 公共动线路线 | S1-PCP-R05 | not_applicable | 无 | 无实际适用空间 | — | 不适用 | 不改变 G4 结果 | 排除出分母 | 已实现 | 不适用组重新平均 |

## 13. 变更记录

| 日期 | 版本 | 变更 |
| --- | --- | --- |
| 2026-08-03 | v0.1 | 首次定义厨房—餐厅、主卧—主卫的拓扑评分映射、G4 排除规则与局部汇总。 |
| 2026-08-03 | v0.1 | 增加正式评分的 SDI `spaceFunctionCode` 数据前提、名称回退限制和重复编码候选规则；评分分值不变。 |
| 2026-08-04 | v0.1 | 增加“公共动线穿越私密空间”原始测量定义、四组路线和私密中间空间范围；当前不制定分数、扣分或权重。 |
| 2026-08-04 | v0.1 | 增加 S1-PCP-R01 至 R05、路线组与指标汇总、入户数据要求和局部评分展示；不生成 S1 总分。 |
| 2026-08-04 | v0.1 | 增加 S1-HPE 三组路线、跨房间自由网格路径、原始测量字段、15° 转向阈值及状态规则；当前不制定分数、权重或阈值评价。 |
| 2026-08-04 | v0.1 | 修正 S1-HPE Zone 独立自由网格锚点和房内视线安全平滑；正式长度、绕行比、转向及画布折线改用平滑后路径，仍不评分。 |
| 2026-08-04 | v0.1 | 增加 S1-PCI：稳定 HPE 路线配对、同层交叉、重叠与方向、共用门/楼梯/RoomRegion及路线热点；当前不评分。 |
| 2026-08-04 | v0.1 | 增加 S1-SFS：按 SF+RoomRegion 形成室内功能实例，测量净面积、周长、紧凑度、凸度、凹入面积和 furnished 自由空间碎片；当前不评分。 |
| 2026-08-07 | v0.1 | 增加 S1-FUR：以 `functionTags` 为权威语义，复用最小使用空间与最大开启范围证据，并测量四类核心家具关系；当前不评分，项目进入 S1 评分体系收口阶段。 |
| 2026-08-12 | v0.1 | S1-HPE 正式路径改为 Polygon Visibility Graph + deterministic Dijkstra；按二维实际总长全局选路，卧室路线使用床边到卫生间入口；turnCount 仅为 measurement_only，未增加评分阈值。 |
| 2026-08-13 | v0.1 | S1-HPE 行为端点收口：接入 `isPrimaryEntrance`，归家使用 DoorPortal 住宅侧 landing，Kitchen 使用首次进入边界，多床逐床、床只用可辨识长边，重复归家行为合并；仍不评分。 |
| 2026-08-13 | v0.1 | 修正 S1-HPE 床边方向：用 Item `resolvedRotationRadians` 的局部轴定义左右下床侧；删除近方形床无法判断的错误限制。 |
| 2026-08-13 | v0.1-demo | 完成空间组织轴 S1-SO：复用 SO-01/SO-02 的 S1-FR 分数，新增 SO-03 入户序列语义拓扑评分；三项适用规则等权，不生成 S1 总分。 |
| 2026-08-13 | v0.1-demo | 完成动静分区轴 S1-DZ：冻结完整室内 SDI 动/静/中性分类，新增 DZ-01 动线扰静、DZ-02 静区缓冲及等权轴汇总。 |
| 2026-08-14 | v0.1-demo | 完成空间利用轴 S1-LY：LY-01 只统计 SF09 走道、LY-02 使用 compactness + convexity 双条件，并按两项适用规则等权汇总。 |
| 2026-08-14 | v0.1-demo | 完成收纳配置轴 S1-SN：SN-01 卧室/SF15 拓扑归属、SN-02 连续 SF34 Pantry 链、SN-03 复用 SO-03 入户序列；三项适用规则等权汇总。 |
| 2026-08-14 | v0.1-demo | 完成 S1 aggregate：固定五轴顺序和 20% 基础权重，S1 total 按适用轴等权；增加覆盖、N/A/无法判断保护与正式五轴雷达。 |

## 14. S1-HPE 生产路径定义补充

- 生产 `pathPoints` 只来自 Polygon Visibility Graph，不使用网格 BFS 静默回退。
- RoomConnectivityGraph 提供合法拓扑与 Portal，最终路线按完整二维路径实际长度比较；确定性 tie-break 使用稳定节点和边 ID。
- 卧室到卫生间：每张正式床按 `resolvedRotationRadians` 转出的局部左右侧候选作为起点，目标为卫生间真实 DoorPortal；主卧仍优先主卫，普通卧室不使用主卫。
- 主要归家与车库归家均使用住宅侧 DoorPortal landing；厨房目标为首次进入 SF01/SF02 Zone 的合法边界点，不使用 Zone 技术代表点。
- agent radius 为 0.20 m 技术参数，不是人体法规、评分阈值或 G 结论；技术不可达为 `unable_to_determine`。
- `actualPathLengthMeters` 与 `detourRatio` 使用最终行为端点；`turnCount` 以 15° 阈值记录测量证据，不进入当前评分。
- PCI 只读取新 HPE `pathPoints`，继续 evidence only；PCP 不消费 HPE 路径。

## 15. 空间组织轴：v0.1 Demo（S1-SO）

空间组织轴当前由三个适用规则等权平均：SO-01 厨房—餐厅关系、SO-02 主卧—主卫关系，以及 SO-03 入户序列适配。SO-01、SO-02 直接复用已实现的 S1-FR 正式局部分数；`not_applicable` 排除出分母，任一本应适用规则为 `unable_to_determine` 时，已知规则仍展示，但空间组织轴不生成不完整正式分数。

SO-03 只评价从主要住宅入口进入、到首次进入 SF06 客厅或 SF07 餐厅公共核心之前的**空间拓扑序列**；不评价距离、绕行、转向或隐私穿越。主要入口优先且只使用唯一 `Door.isPrimaryEntrance=true`；没有标记时仅兼容唯一可靠外门。多个标记或多个无法区分外门均为 `unable_to_determine`，不猜测入口。

主要入口 DoorPortal 一侧为 SF30 车库时，入口上下文为 `garage_origin`；否则为普通住宅入口。SO-03 在 RoomConnectivityGraph 上按语义代价选取最低成本、稳定 tie-break 的合法序列，不按实际距离，也不会因为存在一条奇怪备选路径自动扣分。公共核心为 SF06/SF07；普通入口允许 SF08、SF09、SF10、SF19、SF35（泥房）等入户支持/交通空间；车库归家另允许 SF01/SF02、SF34（食品储藏间）、SF35 等卸物支持空间。未明确属于支持空间或无关主要功能的 SF 类型为 `neutral_transition`；卧室、书房、卫生间、娱乐/儿童活动等明显无关主要功能为 `unrelated_major_function`。分类仅依据正式 SF 编码，不读取 Zone 名称。

SO-03 的 Demo provisional calibration 为：中间全为当前入口场景允许的支持空间得 100；出现一个或多个中性过渡空间、但没有无关主要功能得 85；必须经过一个无关主要功能得 60；必须经过两个及以上得 30；入口与可靠公共核心拓扑不连通得 0。空间数量本身不机械扣分；本项不重复评价隐私，也不包含任何文化、国家或地区偏好。未来可用真实住宅样本调整分类和分值，但必须版本化记录。
