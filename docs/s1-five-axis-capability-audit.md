# S1 五轴能力与成熟开源方案专项审计

> **历史审计快照（已过时，不是当前规则）。** 本文记录当时的能力判断与候选方向；当前正式 S1 v0.1 五轴、总分与废弃项以 [s1-scoring-rules.md](./s1-scoring-rules.md) 为唯一真相源。特别是“场景适配”、CJ-01、CJ-02 已不再是当前 S1 正式规则。

日期：2026-08-12  
性质：产品与技术决策审计；不新增评分、不实现 S1 总分、不修改生产算法。

## 1. 结论摘要

当前仓库已经具备可靠的空间语义、RoomRegion、DoorPortal、楼梯、二维多边形和家具 `functionTags` 数据链，但“已有测量”不等于“可以正式评分”。严格按正式评分所需的稳定性、误判风险和样本校准判断：

- **空间组织**：厨房—餐厅、主卧—主卫已接近可直接评分，是当前最成熟的两条；玄关—公共区尚未实现。
- **动线效率**：路线语义、Room 拓扑、Portal 和画布链可信；房内路径仍不是全局欧氏最短。正式评分前应升级房内寻路底座，`turnCount` 只保留证据。
- **动静分区**：PCP 的“删除特定 Room 后复测可达性”可复用，但现有 `private` 分类不能直接等同于 active/quiet。需要产品分类和新样本，不应沿用现有 PCP 分数冒充新轴。
- **空间利用**：Zone/Room 几何和显式交通 SF 面积可算；家具后的 furnished-grid 碎片不应进入 S1 正式评分。纯建筑几何与家具影响必须拆开。
- **场景适配**：现有家具配对能够证明“对象关系存在”，不能证明“生活场景完整”。CJ-01 不适合 v0.1 正式评分；CJ-02 只有客户明确给出容量目标且 Item 具备结构化容量时才成立，当前 Requirement Handoff 尚不支持。

因此，本审计推荐的 v0.1 目标结构是 **9 条产品规则**：空间组织 3、动线效率 1、动静分区 2、空间利用 2、场景适配 1。当前真正达到 `ready_for_scoring` 的只有前两条空间组织关系；其余必须先补算法、产品定义、数据或样本。9 条是目标数量，不表示当前可以生成 S1/100。

## 2. 五轴能力矩阵

推荐状态只使用任务指定枚举。

| 轴 / 候选规则 | 产品问题 | 当前算法与数据 | Bellevue | 稳定性与正式评分判断 | 重复与阈值风险 | 推荐状态 |
| --- | --- | --- | --- | --- | --- | --- |
| 空间组织 / 厨房—餐厅 | 备餐与用餐空间是否形成合理拓扑关系 | `S1-REL-001`；SDI、Zone–Room 映射、Room 最短拓扑、门/开放连接、中间空间语义 | 可测，当前局部分数 100 | 测量稳定、解释直接；现有分档仍标记待校准，但可作为正式规则候选 | G4 明确邻接要求已排除；不能再按相同拓扑在 HPE 扣分 | `ready_for_scoring` |
| 空间组织 / 主卧—主卫 | 主套房是否具备合理连接与隐私分隔 | `S1-REL-002`；同上，额外区分 DoorPortal 与开放连接 | 可测，当前局部分数 100 | 测量稳定；多个候选不会随机选择 | 与动静分区、PCP 共享证据但问题不同；分档需样本复核 | `ready_for_scoring` |
| 空间组织 / 玄关—公共区 | 入户过渡是否自然到达客厅/餐厅等公共区 | 已有 SF08/SF10、Room 图、入口候选；尚无该关系测量/规则 | Bellevue 有 SF08、无 SF10，可做样本 | 算法不难，但“公共区集合”和多个入口处理未冻结 | 可能与 HPE 入户路线及动静分区重复 | `needs_more_samples` |
| 动线效率 / 高频路线绕行 | 日常路线是否产生不必要绕行 | HPE：Room 拓扑、Zone 锚点、Portal、0.1m grid、BFS、视线平滑、长度与 detourRatio | 当前测试为 6 条 measured | 路线成立、无穿墙证据；房内折线不是全局欧氏最短，正式分数会受底层偏差影响 | 路线阈值和不同户型尺度归一化尚未确认 | `needs_algorithm_upgrade` |
| 动线效率 / 转向 | 路径是否简洁 | 当前统计平滑 `pathPoints` 中方向变化超过 15° 的内部点 | 可输出 | 测到的是算法折线 corner 数，不等于人的认知转弯；不同求路器会改变结果 | 15° 是工程阈值，缺少产品/行为依据 | `measurement_only` |
| 动线效率 / PCI 交叉重叠 | 多条路线是否交叉、重叠或共用 Portal | PCI 直接比较 HPE 正式折线、门、楼梯和 Room | 当前 6 路线形成 15 对；1 对交叉、1 对重叠 | 几何结果可复现，但没有活动频率、时间、宽度和同时发生证据，不能称拥堵或冲突 | 与 HPE 双扣风险高；容差需更多样本 | `measurement_only` |
| 动静分区 / DZ-01 动线扰静 | 去往活动空间的公共路线是否必须穿过静区 | PCP 的“原图可达 → 删除私密中间节点 → 再判可达”可以复用 | 现有 PCP 可运行，但不是 active/quiet 口径 | 图算法稳定；缺 active/quiet/neutral 映射、起终集合和多路径产品语义 | 不能把旧 private 直接改名；与空间组织、HPE 只共享证据 | `needs_more_samples` |
| 动静分区 / DZ-02 静区缓冲 | 静区与活动区之间是否存在中性过渡 | Room 图、DoorPortal、SF 语义足以测拓扑间隔和中间空间类型 | Bellevue 可形成测试样本 | 不缺新底层算法；缺缓冲定义、合格中性类型和开放空间处理 | 直接用“拓扑步数越多越好”会拍脑袋 | `needs_more_samples` |
| 空间利用 / 纯交通面积占比 | 住宅面积中有多少由明确交通空间占用 | SFS 的 Zone–Room 多边形交集、净面积；SF09 走道、SF19 楼梯间可明确汇总 | Bellevue 有编码交通空间，可测显式交通面积 | 对显式交通 Zone 稳定；开放空间内隐含交通带无法从 SF 面积自动分割 | 不能把 HPE 路线走廊缓冲重复计入；分母口径需冻结 | `measurement_only` |
| 空间利用 / 二维平面碎片与低效边界 | 建筑边界本身是否形成凹入、小岛或低效区域 | SFS 已有面积、周长、compactness、convexity、凹入；polygon-clipping | 24 个编码实例可测 | 几何稳定，但 compactness/convexity 不天然等于使用质量；需功能类型样本 | 通用阈值会误罚 L 形或功能性凹入 | `needs_more_samples` |
| 空间利用 / furnished 自由空间碎片 | 家具后自由空间是否被切碎 | SFS 的 furnished 0.1m grid 连通分量 | Bellevue 可测 | 数据混入家具 footprint、网格精度与摆放后果，不再是纯平面空间利用 | 与 G/FUR 物理问题重复；任务边界已明确移出 S1 正式分 | `remove_from_s1` |
| 场景适配 / CJ-01 场景完整 | 房间是否形成合理生活场景 | FUR 以 `functionTags` 配对餐桌椅、床/床头柜、沙发/茶几、书桌/工作椅 | Bellevue 17 条关系可测 | 只能证明传统对象组合存在；无法证明没有配对物就不完整，风格误判高 | 与审美、生活方式和家具物理规则混杂 | `remove_from_s1` |
| 场景适配 / CJ-02 明确需求容量匹配 | 已声明的就餐、睡眠或工作人数是否有相应承载对象 | `functionTags` 可数对象；当前 Requirement Handoff 只有空间 presence/count/area/关系等，没有人数目标；Item 也没有统一 `capacity` | 当前 Bellevue 不能形成正式需求—容量对照 | 产品逻辑可靠，但数据前提未完成；不得猜家庭人口或按桌子尺寸猜座位 | 客户明确数量若已由 G4 检查，S1 需评价“适配表现”而非重复不满足 | `defer` |

## 3. 动线效率专项决策

### 3.1 必须选择的结论

选择 **C：S1 正式评分前必须做独立寻路底座升级，否则不应该给动线效率打分。**

这里的“升级”不是推翻当前系统，也不是引入完整 Recast。保留：

- `RoomConnectivityGraph`、RoomRegion 和稳定 Room 路径；
- SDI 路线选择、Zone 独立锚点；
- DoorPortal、楼梯及跨层分段；
- HPE 结果结构、报告、画布与开发调试层；
- PCI 继续消费 HPE 唯一正式 `pathPoints`；
- PCP 的图删除/可达性算法。

替换目标仅为：每个 RoomRegion 内的 `freeCellPath` 四邻接 BFS 与贪心 `smoothNavigablePath`。推荐先建立准确二维可通行 polygon（含 agent radius/clearance），再使用稳定 Visibility Graph + A*，或三角化 NavMesh corridor + funnel/straight-path。升级风险为中等：HPE 长度、detourRatio、corner 会改变；PCI 的交叉/重叠基准需重跑；PCP 不消费 HPE polyline，原则上不变。

### 3.2 Recast / Detour 能借什么

Recast 把 NavMesh **构建**、Detour **polygon corridor 查询**、`findStraightPath` **拉直输出**和 DebugUtils **调试绘制**分离。这种职责分层值得直接借鉴。Detour `findPath` 返回 polygon corridor，再由 straight-path/funnel 产生最终 corner；agent radius 在 NavMesh 构建阶段进入可行走表面，off-mesh connection 适合表达楼梯等特殊连接，query filter/custom area 可表达不同通行代价。[核心仓库](https://github.com/recastnavigation/recastnavigation)、[Detour 查询源码](https://github.com/recastnavigation/recastnavigation/blob/main/Detour/Source/DetourNavMeshQuery.cpp)、[测试目录](https://github.com/recastnavigation/recastnavigation/tree/main/Tests)、[路径调试工具](https://github.com/recastnavigation/recastnavigation/blob/main/RecastDemo/Source/Tools/NavMeshTesterTool.cpp)。

但当前输入已经是干净二维住宅 polygon、Room 和 Portal，而 Recast 的强项是从三角网格经过体素化、region、contour、polygon mesh 建立通用 3D/2.5D NavMesh。为当前问题引入体素参数、tile cache、WASM 生命周期、Y-up/XZ 坐标、off-mesh authoring 和 navmesh 序列化，会把简单二维问题复杂化。因此不建议完整 Recast 进入 v0.1 生产。

### 3.3 recast-navigation-js POC 成本

当前 Vite/TypeScript 技术栈可以做隔离 POC：它提供 ESM、浏览器/Node、WASM 初始化、solo/tiled generator、`findClosestPoint`、`computePath`、custom areas、debug navmesh；官方也给出 Vite Worker 示例和 NavMesh 导入/导出方式。`computePath` 源码明确执行 nearest-poly → polygon `findPath` → `findStraightPath`。[项目与接入说明](https://github.com/isaac-mason/recast-navigation-js)、[NavMeshQuery 源码](https://github.com/isaac-mason/recast-navigation-js/blob/main/packages/recast-navigation-core/src/nav-mesh-query.ts)、[Vite Worker 示例](https://github.com/isaac-mason/recast-navigation-js/tree/main/examples/three-vite-worker-example)。

POC 成本可控，生产成本不低：必须转换当前 2D polygon/洞/家具为三角输入，校准 agent radius 和 cell 参数，处理每层坐标与 Portal，并接受 WASM 包体积、异步初始化和 Worker 通信。建议 POC 用于验证结果，不作为默认生产方向。

### 3.4 当前 Visibility Graph 实验离生产还差什么

`src/evaluation/s1-visibility-graph-experiment.ts` 没有重造 Room 拓扑；它只在当前 furnished free-grid 边界顶点上构图并求最短路，适合作为公平对照。生产化缺口：

1. **polygon 来源**：应从 RoomRegion 减去明确二维障碍并做 agent-radius offset，而不是从 0.1m cell 反推边界。
2. **clearance**：统一处理墙、固定物和保留的家具 footprint；不能仅靠顶点内缩常数。
3. **Portal**：将 Portal 两侧落点作为强制 corridor 节点，验证门宽与 agent 半径，不跨房间偷拉直。
4. **corner cutting**：稳定处理恰好擦边、凹角、洞、窄门和共线边。
5. **数值稳定性**：统一 epsilon、坐标量化、节点和 A* tie-break；保留完整诊断。
6. **性能**：按 Room 缓存静态 visibility graph，仅动态加入起终/Portal；避免每条路线 O(n²) 重建。
7. **测试**：补 L/U 形、多洞、岛台、窄门、贴墙、极小边、重复顶点、多 Portal、跨层和随机回归样本。

### 3.5 转向结论

当前 `turnCount` 是对 HPE 最终平滑折线按楼层分段，再删除不超过 15° 的小方向变化后，统计剩余内部顶点。它测的是**当前求路器输出折线的 corner 数**，不是人的身体转弯次数、视觉决策次数或空间句法中的 direction change。

NavMesh 的 funnel/straight-path 会给出更稳定的 corridor corner，Visibility Graph 也会输出障碍必要拐点；两者都优于网格锯齿，但仍需定义：Portal 穿越是否算一次、短折线如何合并、转角权重是否连续。因此建议 v0.1 删除“路径简洁/转向”正式评分，只在报告保留证据。

## 4. depthmapX 对住宅产品的价值

depthmapX 包含 Visibility Graph Analysis、axial/segment network analysis、agent analysis以及 integration/depth 等空间句法指标，并有 CLI、回归测试和跨平台 CI。适合借鉴的不是其代码，而是“最短路线以外的空间结构”视角：[depthmapX](https://github.com/SpaceGroupUCL/depthmapX)、[salalib](https://github.com/SpaceGroupUCL/depthmapX/tree/master/salalib)、[发布与测试记录](https://github.com/SpaceGroupUCL/depthmapX/releases)。

适合住宅评价研究的候选证据：

- 从入口、客厅或走道观察的局部可视连通性；
- 静区到活动区的拓扑 depth / 必经层数；
- 交通节点的选择度/潜在穿越集中度，用于解释 PCI 热点。

不宜直接产品化：全局 integration 的“高即好”、城市尺度 segment choice、无家庭行为约束的 agent simulation，以及把 VGA 可见性直接等同生活质量。这些指标对边界采样、门状态、家具高度和观察尺度敏感，且用户难以理解；最多作为研究/证据，不应成为 v0.1 分数。

## 5. 场景适配专项审计

### 5.1 当前 FUR 能回答什么

`src/evaluation/s1-furniture.ts` 能稳定回答：具有正式 `functionTags` 的两个 Item 是否位于同一功能 Zone/Room、它们的 footprint/中心距离/相对方向如何、候选是否唯一。它不能回答“没有某个传统配件时，场景是否不完整”。物理碰撞、开启与最小使用净空已移出 S1；FUR 中仍保留的相关数据只能作共享诊断，不应恢复为场景分数。

ATISS 之所以能做 scene completion、object suggestion 和 failure correction，是因为它依赖按 room type 筛选的大量 3D-FRONT/3D-FUTURE 场景，学习对象类别序列、位置、尺寸和角度的联合先验，而不是四组固定配对。[ATISS](https://github.com/nv-tlabs/ATISS) 的 scene completion 和 failure correction 说明“场景合理性”需要 scene prior。MIT-SPARK/ThreedFront 延续的布局表达也是 `class_label + translations + sizes + angles`；其 evaluation 主要比较类别分布、FID/KID、真实/合成分类、越界和 bbox IoU，并没有给单个真实住宅一个可解释的“完整生活场景分”。[ThreedFront](https://github.com/MIT-SPARK/ThreedFront)、[结果表达](https://github.com/MIT-SPARK/ThreedFront/blob/main/threed_front/evaluation/__init__.py)、[bbox 分析](https://github.com/MIT-SPARK/ThreedFront/blob/main/scripts/bbox_analysis.py)。

### 5.2 挑战 CJ-01 与 CJ-02

**CJ-01 场景完整：建议从 v0.1 删除。** 餐桌没有餐椅可能是吧台/长凳方案；床没有床头柜、客厅没有茶几、书桌没有办公椅都可能是合理风格或使用选择。现有四类配对可作为“已识别家具组织关系”证据，不能升级成完整性结论。若保留名称，应改为“核心对象关系证据”，且仍为 `measurement_only`。

**CJ-02 容量匹配：保留为未来唯一正式规则，但改名为“明确需求容量适配”。** 只在客户需求 JSON 明确给出目标时评价：

- 就餐人数：需正式 dining seat 实例或桌/岛台显式 `capacity`，不能按桌长猜。
- 睡眠人数：需床的结构化睡眠容量；`single/double` functionTag 可作为类型证据，但仍应明确人数口径。
- 工作位：需 desk/workstation 与可用座位的结构化实例定义。
- 其他容量：只有建立明确对象类型与容量字段后才能加入。

当前 `src/requirements/requirement-handoff.ts` 不支持 occupancy/scene-capacity 需求类型；Item 也没有统一容量字段，所以 Bellevue 不能正式评价 CJ-02。

### 5.3 若需保留“场景适配”轴，可选定义

推荐 v0.1 只保留 1 条正式规则：**明确需求容量适配**。未来可考虑、但不纳入本次 v0.1 的两个解释性规则：

1. **目标活动支撑证据**：仅当客户明确要求“就餐/居家办公/多人睡眠”等活动时，检查目标空间是否存在相应正式功能对象；不要求床头柜、茶几等风格配件。
2. **多功能场景边界一致性**：当一个 RoomRegion 内有多个已编码 Zone 时，检查所需对象是否落在对应功能 Zone；只评价语义归属，不评价审美。

可复用 FUR 的 `functionTags`、Item ID、Zone/RoomRegion 归属、footprint 和配对歧义处理；不得复用开启、最小使用空间或碰撞作为 S1 分数。

## 6. 空间利用拆分建议

SFS 当前把两类事实装在一个报告：

- **纯二维建筑几何**：Zone–RoomRegion 交集、面积、周长、凸包、compactness、convexity、凹入；可继续作为空间利用候选。
- **家具后自由空间**：`navigableFreeCells` 的连通分量和碎片；受家具 footprint、人员半径、0.1m 网格和摆放影响，应从正式空间利用评分输入中剔除，仅保留调试/证据。

交通面积占比可以以显式 SF09/SF19 与住宅净室内面积计算，但只代表“明确标注的纯交通空间”。开放空间中隐含的通行面积尚无可靠分割，不能把 HPE path buffer 直接当交通面积。正式评分前需冻结：楼梯是否计入、SF08/SF10 是否计入、重叠 Zone 如何去重、分母是否包含车库/设备房。

## 7. 动静分区复用与缺口

DZ-01 可复用 PCP 的 `findPrivacySafeRoomPath` 思路，改为“从指定公共/活动起点到指定活动目的地，移除 quiet 中间节点后是否仍可达”。需要新增的是产品配置，不是新寻路器：SF → `active | quiet | neutral_transition` 映射、路线组、允许人工覆盖、同一 RoomRegion 混合 Zone 的处理。

DZ-02 可直接使用 Room 拓扑、DoorPortal 和 SF 语义测量 active 与 quiet 之间的拓扑 depth、中间 neutral 类型和是否直接开门；不需要 HPE 几何路径升级。缺口是产品规则与样本，而不是算法。旧 PCP 的 private 集合包括卧室、主卫、衣帽间，不能无条件替代 quiet；卫生间、书房、走道和多功能开放区都需要单独决策。

## 8. 开源引用与许可决策

| 项目 | 可借用途 | License | 允许程度 | 建议 |
| --- | --- | --- | --- | --- |
| Recast Navigation / Detour | corridor、straight path/funnel、agent radius、off-mesh、debug/tests 的架构与算法；必要时原生依赖 | Zlib-style，允许商业使用、修改和分发，须保留声明且不得冒充原作 | 可直接集成；当前产品不需要整套 | `adapt_algorithm` |
| recast-navigation-js | 浏览器/Vite/WASM NavMesh 独立 POC，computePath、closest point、custom area、Worker | MIT，保留版权与许可声明 | 可直接依赖；建议只做隔离 POC | `direct_dependency` |
| depthmapX | VGA、segment、agent、integration/depth 的研究方法和验证口径 | GPLv3 | 商业闭源产品不应复制/链接其代码，除非接受 GPL 传播义务并经法务确认 | `reference_only` |
| ATISS | room-conditioned scene representation、scene completion、object suggestion、failure correction 的方法理解 | NVIDIA Source Code License；仅非商业研究/评估并要求 NVIDIA processors | 不复制、不集成、不使用其权重进入商业产品 | `do_not_use` |
| MIT-SPARK/ThreedFront | 3D-FRONT scene representation 和评估脚本的结构参考 | BSD-2-Clause；同时仍需分别遵守 3D-FRONT/3D-FUTURE 数据许可 | 代码可按 BSD 集成，但数据权利需单独审查；本项目只需参考表达 | `reference_only` |

许可证原文：[Recast](https://github.com/recastnavigation/recastnavigation/blob/main/License.txt)、[recast-navigation-js](https://github.com/isaac-mason/recast-navigation-js/blob/main/LICENSE)、[depthmapX GPL 声明](https://github.com/SpaceGroupUCL/depthmapX#readme)、[ATISS 限制](https://github.com/nv-tlabs/ATISS/blob/master/LICENSE)、[ThreedFront BSD-2](https://github.com/MIT-SPARK/ThreedFront/blob/main/LICENSE)。该表是工程引用建议，不替代正式法律意见。

## 9. v0.1 推荐规则与优先缺口

推荐目标 9 条：

1. 空间组织：厨房—餐厅、主卧—主卫、玄关—公共区（3）。
2. 动线效率：高频路线绕行表现（1）；不含 turnCount 独立评分，不含 PCI 独立扣分。
3. 动静分区：动线扰静、静区缓冲（2）。
4. 空间利用：显式纯交通面积占比、纯二维边界碎片/低效形状（2）；不含 furnished-grid 碎片。
5. 场景适配：明确需求容量适配（1）；删除 CJ-01 场景完整。

当前立即可正式进入评分收口的只有前两条 FR；其余状态见能力矩阵。最大技术风险是用非全局最短 HPE 路径和未定义 corner 对动线打分；最大产品误判风险是用传统家具配对代替场景合理性。

下一步优先补 **二维房内寻路底座与基准样本**：先冻结可通行 polygon/clearance/Portal 接口，用现有 Visibility Graph 实验和 `recast-navigation-js` 隔离 POC 对照，再决定生产采用 polygon Visibility Graph 还是 NavMesh funnel。完成前可以继续讨论其他轴规则，但不应冻结动线效率分数。

## 10. 当前仓库事实与文档漂移

本审计以当前代码与 `src/evaluation/passing-demo.test.ts` 为准。2026-08-12 单测实际确认：Bellevue HPE 为 6 条 `measured`；PCI 为 15 个路线对，其中 1 对交叉、1 对重叠；FR 为 100/100；PCP 整体仍因入口组 `unable_to_determine` 而无正式局部分数。路线图和评分收口文档中仍有“4 条 measured / 2 条 unable、PCI 6 对无交互”的旧快照，不能继续作为当前事实。
