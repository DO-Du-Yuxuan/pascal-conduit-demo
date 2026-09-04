# S1 二维住宅动线寻路 POC 决赛

> **历史 POC 快照（2026-08-12）。** 本文记录生产迁移前的候选比较与 GO 决策。当前生产 S1-HPE 已使用 Polygon Visibility Graph + deterministic Dijkstra；旧网格、Yuka 与 Recast 仅保留为开发对照或实验。当前事实以 `docs/evaluation-semantic-contract.md`、`docs/evaluation-shared-change-log.md`、代码和测试为准。

> 日期：2026-08-12  
> 结论：**WINNER = Polygon Visibility Graph + deterministic Dijkstra；GO**  
> 本次仅完成实验模块、基准、几何验证和开发调试切换；生产 S1-HPE 仍使用原算法，评分规则与 S1 总分均未改变。

## 1. 决赛范围与共同输入

三套方案都保留现有 `RoomConnectivityGraph`、RoomRegion 序列、Zone 锚点、DoorPortal、楼梯连接和跨层拼接。比赛只替换每个 RoomRegion 内两个固定端点之间的二维求路。

统一实验输入为 RoomRegion polygon（含 hole）、固定建筑障碍与家具实体 footprint、固定起终点/Portal，以及集中配置的 `agentRadiusMeters = 0.20m`。开启空间、家具使用空间、电器操作空间和三维碰撞不参与 HPE 障碍。0.20m 只是本次技术 POC 参数，不是最终人体标准或评分阈值。

## 2. 三套方案

| 方案 | 实现 | 优点 | 本次暴露的问题 |
| --- | --- | --- | --- |
| A Current | Room 拓扑 + 0.1m 四邻接自由网格 BFS + 房内视线平滑 | 已投产、可解释、与 Portal 架构一致 | 路径仍受网格采样约束；精确 clearance 和最短路径不是同一几何模型 |
| B Yuka | clearance polygon → earcut 三角化 → Yuka `NavMesh.fromPolygons()` → `findPath()` corridor/funnel | 查询快；实际使用成熟 Funnel | Yuka 不负责从带洞住宅 polygon 烘焙 NavMesh；复杂自由区三角网格适配产生折返，Bellevue 2/6 路线被自动几何验证拒绝 |
| C Visibility Graph | clearance polygon 顶点 + 同一可通行多边形线段验证 + deterministic Dijkstra | 直接适配当前二维 polygon/hole/footprint；最短路径、Portal 和调试含义直接 | clearance offset 是主要复杂点；朴素全连接图查询比 Yuka 慢，但住宅规模仍可接受 |

## 3. Clearance 与几何验证

`src/evaluation/s1-pathfinding-poc.ts` 先把 Room 外边界向内偏移 0.20m，把 hole 和有效家具/固定障碍向外偏移 0.20m，再执行 polygon difference 得到正式实验可通行面。偏移使用 `clipper-lib` 的整数坐标运算；候选路径自动检查：端点位于可通行面、每一段完整位于可通行面、不会进入 hole/家具膨胀区、固定 Room/Portal 分段不被替换。

自动夹具覆盖：空矩形、L 形、U 形、中央岛障碍、窄门、临界窄走廊、多个障碍、贴墙障碍、固定 Portal 端点、等长双路、极小/共线边、带 hole RoomRegion。相同输入重复运行使用稳定节点排序和 Dijkstra tie-break；Visibility Graph 输出完全一致。

## 4. Bellevue 六条路线

以下为一次基准实测。运行时间受机器与测试进程影响，只用于数量级判断；长度与几何状态由自动测试固定。

| 路线 | RoomRegion 序列 | Current m / corner | Yuka m / corner | Visibility m / corner | Visibility 相对 Current | 几何 / clearance / Portal |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| FOYER → OPEN KITCHEN | L1 room-1 | 8.115 / 3 | 39.872 / 14 | 7.971 / 3 | -0.144m | Visibility 全通过；Yuka 虽合法但明显折返 |
| GARAGE → OPEN KITCHEN | L1 room-2 → room-6 → room-1 | 18.987 / 8 | 51.520 / 23 | 18.312 / 8 | -0.675m | Visibility 全通过；Yuka 明显折返 |
| BEDROOM 1 → BATH 1 | L1 room-4 → room-1 → room-9 | 5.353 / 4 | 7.054 / 7 | 5.353 / 4 | 0.000m | Visibility 全通过 |
| MASTER BEDROOM → MASTER BATH | L2 room-1 → room-6 | 5.031 / 1 | 无法判断 | 5.033 / 1 | +0.002m | Visibility 全通过；Yuka 路径被几何验证拒绝 |
| BEDROOM 3 → BATH 3 | L2 room-3 → room-11 | 2.599 / 1 | 4.239 / 4 | 2.600 / 1 | +0.001m | Visibility 全通过 |
| BEDROOM 2 → BATH 2 | L2 room-4 → room-10 | 3.211 / 2 | 无法判断 | 3.225 / 2 | +0.014m | Visibility 全通过；Yuka 路径被几何验证拒绝 |

Visibility Graph 六条全部 measured、clearance valid、Portal valid、deterministic；与 Current 的最大长度差为 **0.675m**，发生在车库到厨房。明显变化为前两条开放区路线；另外四条长度几乎一致。没有发现 Visibility 路径穿墙、擦入 clearance 边界或穿家具。用同一套精确 clearance polygon 反查 Current 时，6 条中仅 BEDROOM 1—BATH 1 完整通过，另外 5 条至少有一个旧网格线段未通过精确 0.20m clearance；其中四条长度虽几乎一致，仍存在边界模型不一致。这说明旧自由网格覆盖判定与精确 polygon clearance 不等价，而不是画布坐标转换问题。

一次测试进程中，Visibility 六条累计构建约 11ms、查询约 254ms；Yuka 累计构建约 34ms、查询约 2ms。Visibility 的节点规模约 28–132/房间分段。对非实时住宅评价完全可接受；正式迁移时应按 Room 几何和障碍签名缓存图，查询成本会进一步下降。

## 5. Yuka 结论

Yuka 0.7.8（MIT、零自身依赖）确实提供真实 NavMesh corridor/funnel，Funnel 本身不是伪实现。但它要求调用方先提供正确共享边的凸 polygon NavMesh。当前项目的原生数据是带洞的二维 Room polygon 与障碍 footprint；从自由面三角化成 Yuka 可稳定消费的 NavMesh，反而引入一层不必要且难调试的烘焙适配。

本次 Bellevue 中，Yuka 只有 4/6 路线形成通过验证的候选；其中两个复杂开放区产生 39.872m 和 51.520m 折返，另两条被几何验证拒绝。Funnel 没有让最终 `pathPoints` 比 Visibility Graph 更稳定。因此 **不建议正式引入 Yuka**。

## 6. Recast fallback

Yuka 已出现结构性失败，因此按任务条件触发最小 Recast fallback。`@recast-navigation/core` / `generators` / `wasm` 0.43.1 均为 MIT；带 hole 的二维三角面可以初始化 WASM、生成 NavMesh 并稳定 `computePath()`。

但 Recast 引入约 2MB unpacked WASM、异步全局初始化、体素化参数、额外缓存与资源生命周期；它解决的是更通用的 3D/游戏 NavMesh 问题。对当前已有明确二维 Room/Portal polygon 的住宅评价器属于过度能力，因此不进入 Bellevue 三方主表，也不建议生产采用。

## 7. 代码、依赖与维护成本

| 方案 | 新增核心代码 | 额外依赖 | WASM / 异步 | 缓存 | 调试难度 |
| --- | --- | --- | --- | --- | --- |
| Current | 无 | 无 | 无 | 已有 navigation 分析 | 中 |
| Yuka | 三角化与 Yuka adapter | `yuka` 0.7.8 MIT、`earcut` 3.0.2 ISC | 无 | NavMesh/Room | 高：问题可能在 offset、三角化、共享边或 Funnel |
| Visibility | offset、线段合法性、图与 Dijkstra | `clipper-lib` 6.4.2 BSL；现有 `polygon-clipping` | 无 | clearance polygon/visibility edges | 中：节点和每条可见边可直接画出 |
| Recast fallback | smoke adapter | `@recast-navigation/*` 0.43.1 MIT | 有，约 2MB unpacked | NavMesh/WASM 生命周期 | 高 |

实验依赖全部位于 `devDependencies`，生产入口不静态导入。Vite 正式 bundle 不包含 POC 算法；开发 UI 通过动态 import 在选择 HPE 路线后加载。依赖审计报告仍显示仓库既有依赖树共有 1 个 moderate、2 个 high 漏洞，本次未运行自动修复以避免无关升级。

## 8. 开发调试视图

现有 S1 路径开发调试区保留原始网格、平滑段、Zone 锚点、Portal/楼梯点和正式 Polyline 开关，并新增 `Current / Yuka / Visibility Graph` 切换。候选路径只在 `import.meta.env.DEV` 下动态计算和绘制，不进入正式用户报告。

计算和正式画布仍共用生产 HPE 的 `pathPoints`；POC overlay 是独立开发图层，不改变报告事实。

## 9. Winner 与迁移建议

**WINNER：Polygon Visibility Graph + deterministic Dijkstra。**

原因依次为：6/6 Bellevue 几何与 clearance 正确；Portal 和 Room 序列稳定；路径接近二维几何最短路径；直接匹配项目现有 polygon 数据；依赖与调试成本低于 NavMesh 烘焙；住宅规模性能足够。

**GO：建议下一任务正式替换 HPE 的房内求路层，但仍先保留 Current 作为影子对照与回退。** 正式迁移前不再需要新评分规则，只需补充更多真实户型回归，并冻结 Portal landing 与 clearance 边界接触的数值策略。

预计迁移范围：

- `src/evaluation/s1-high-frequency-path.ts`：把 `freeCellPath + smoothNavigablePath` 调用替换为可注入 RoomPathProvider；Zone 锚点、Room 拓扑、Portal、楼梯、路线选择与汇总继续复用。
- `src/evaluation/navigation.ts`：复用障碍分类证据；正式化 polygon clearance 缓存时可能增加只读派生结果，不改变 G 结论。
- `src/evaluation/s1-path-conflict.test.ts` 与 passing-demo 基准：PCI 读取 HPE `pathPoints`，只需重新生成交叉/重叠基准，不需要改 PCI 算法。
- PCP 只使用 RoomConnectivityGraph 和私密节点删除后的可达性，**完全不受影响**。

## 10. 开源参考

- Recast Navigation / recast-navigation-js：将可通行区域、查询 corridor、straight path 与调试绘制分层；适合通用 NavMesh，但本项目无需其 3D 体素化复杂度。
- Yuka：实际 `NavMesh.findPath()` 证明 Funnel 可用，但 NavMesh 构建责任仍在项目侧。
- rowanwins/visibility-graph 与 ilyanikolaevsky/navmesh：确认二维 polygon 障碍、外部端点、visibility edges 和 A*/Dijkstra 是与住宅平面最贴近的模型；后者也把 agent 大小归结为障碍膨胀。

最终结论不是“当前算法全部算错”：四条卧室—卫生间与 Visibility 几乎一致；主要偏差集中在两个复杂开放区。当前渲染使用的确是生产 `pathPoints`，不是坐标转换错误。应替换的是房内求路几何内核，而不是 Room、Portal、楼梯或画布坐标体系。
