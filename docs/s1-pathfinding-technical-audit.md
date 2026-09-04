# S1 动线效率路径算法专项技术校准

> **历史技术审计快照（2026-08-11）。** 下文前半部分描述的是生产迁移前的网格 BFS 基线与比较实验。当前生产 S1-HPE 已迁移至 Polygon Visibility Graph + deterministic Dijkstra；旧网格只作开发 shadow，对照实验不进入正式路径或评分。当前事实以 `docs/evaluation-semantic-contract.md`、`docs/evaluation-shared-change-log.md`、代码和测试为准。

日期：2026-08-11。范围仅限 S1-HPE 与依赖其正式折线的 S1-PCI；不改变评分规则、路线范围或 Bellevue 数据。

## 结论（产品视角）

Bellevue 的六条已测 HPE 路线没有出现穿墙、跨越不可通行自由空间或“计算路径与画布路径不一致”的证据。当前视觉上的折线复杂，主要是**路径算法的离散网格近似**，不是画布坐标渲染错误；因此结论是 **B 为主、兼有 A 的局部精度限制**，不是 C（现在必须立即整套替换）。

当前 `Room 拓扑 + 0.1 m furnished 自由网格 BFS + 房内视线平滑` 可以继续作为 v0.1 的可解释测量底座。它的已知代价是：平滑是贪心的，不保证房内全局最短；四邻接生成的原始路径节点多，最终转向仍会受网格边界影响。对照实验显示 Visibility Graph 在两条开放大空间路径上更短 0.202 m / 0.798 m，另外四条与当前结果相同。这不足以证明 Bellevue 当前“算错”，但足以证明 Visibility Graph 是后续校准的优先候选。

建议：在产品继续讨论动线效率评分的同时，保留当前 HPE 生产实现；收集更多复杂户型并把本次实验扩展为基准集。只有基准集反复显示长度、转向或路径形态系统偏差时，再以 `RoomConnectivityGraph` 保持不变、替换**房内**求路器为 Visibility Graph + A*。不建议为当前二维住宅 v0.1 引入完整 Recast。

## 当前实现链路

代码入口在 `src/evaluation/s1-high-frequency-path.ts`：

1. `findShortestRoomPath`（`src/evaluation/connectivity.ts`）用稳定 BFS 选择 RoomRegion、DoorPortal 与楼梯连接序列。
2. 每个 Zone 的独立锚点从其 polygon 内、且处在对应 `RoomNavigableSpace.navigableFreeCells` 的自由网格点中稳定选择；找不到即 `unable_to_determine`。
3. `freeCellPath` 在每个 RoomRegion 内做四邻接 BFS；`smoothNavigablePath` 只在 `segmentIsNavigable` 确认可通行时贪心删除网格中间点。
4. 各房间平滑段与 Portal/楼梯连接拼接为 `pathPoints`；长度、绕行比和 15° 阈值转向数均从该正式路径计算。
5. `src/main.tsx` 的 `S1PathOverlay` 直接把同一 `pathPoints` 输出为 SVG `polyline` 的 `x,z` 坐标。画布的楼层图和 overlay 同处一个 SVG group；本链路没有第二份坐标转换或重采样。`src/evaluation/s1-path-conflict.ts` 也只消费同一正式 `pathPoints`。

当前 `src/evaluation/navigation.ts` 的 HPE 输入是 furnished 自由网格：家具实体 footprint 仍是二维行走障碍；门扇、家电开启、衣柜开启等操作空间不在本次 HPE 障碍输入内。这符合当前 S1 边界；本审计没有改变它。

## Bellevue 实测与 Visibility Graph 对照

实验实现：`src/evaluation/s1-visibility-graph-experiment.ts`。它**不接入生产**：保留相同 Room 拓扑、Zone 锚点与 furnished 自由网格，只把每个房内 BFS+贪心平滑段替换为自由网格边界顶点构成的二维 Visibility Graph 和稳定 Dijkstra 搜索。每一条实验线段再由 `segmentIsNavigable` 验证；这意味着实验和生产使用相同的不可通行区域，不会把差异误归因于家具或净距规则。

| Bellevue 路线 | 当前长度 m | Visibility Graph m | 差值 m | 当前/实验转向 | 自由空间验证 |
| --- | ---: | ---: | ---: | ---: | --- |
| FOYER → OPEN KITCHEN | 8.115 | 7.913 | -0.202 | 3 / 4 | 通过 |
| GARAGE WEST / GARAGE EAST → OPEN KITCHEN | 18.987 | 18.189 | -0.798 | 8 / 9 | 通过 |
| BEDROOM 1 → BATH 1 | 5.353 | 5.353 | 0.000 | 4 / 4 | 通过 |
| MASTER BEDROOM → MASTER BATH | 5.031 | 5.031 | 0.000 | 1 / 1 | 通过 |
| BEDROOM 3 → BATH 3 | 2.599 | 2.599 | 0.000 | 1 / 1 | 通过 |
| BEDROOM 2 → BATH 2 | 3.211 | 3.211 | 0.000 | 2 / 2 | 通过 |

结果解释：实验路径不穿墙；两条差异路径表明当前贪心平滑不是全局最短，但幅度分别约为当前路径的 2.5% 和 4.2%。实验转向更高并不表示其更差：当前 15° 计数与“人类一步转弯”不是同一概念，需在未来评分前单独校准。

## 算法方案比较

| 方案 | 当前 JSON 适配与跨层 | 长度/转向可信度 | 复杂度与测试 | 建议 |
| --- | --- | --- | --- | --- |
| A：Room 拓扑 + 网格 BFS + 平滑 | 已实现；Portal、楼梯、家具 free-grid 都已接入 | 可行但非房内全局最短；转向受网格影响 | 最低；现有 HPE/PCI 直接复用 | 保留为当前生产基线 |
| B：Room 拓扑 + Visibility Graph + A* | 与现有二维 polygon/free-grid、Portal、楼梯分段最贴合；跨层继续由现有拓扑处理 | 房内欧氏最短折线更可信、节点更少；仍需净距/贴边策略 | 中等；需边界提取、可见性、稳定 tie-break 和复杂户型基准测试 | 推荐的后续替换候选 |
| C：完整 NavMesh / Recast | 需把平面与障碍转为 NavMesh 构建输入；楼层/Portal 仍需自定义拼接 | 成熟 corridor/straight-path，但二维住宅收益不抵集成代价 | 高：WASM、构建、坐标约定、navmesh 调试、版本维护 | 当前不建议 |

参考实现的分工也支持这一判断：Recast 把体素化、region/polygon navmesh、query 与 straight path 分开；`recast-navigation-js` 暴露 `NavMeshQuery.computePath`。`visibility-graph` 则直接以 GeoJSON Polygon/MultiPolygon 构图，加入起终点后做 A*；其构图成本随顶点数上升。`ilyanikolaevsky/navmesh` 的二维实现同样围绕障碍顶点、可见性、A* 与 agent radius 展开。当前产品已有可靠 Room/Portal 分层，B 可以只替换房内段，避免把游戏 NavMesh 基础设施引入住宅评价器。

## 调试能力与迁移影响

开发环境的“显示图层 → S1路径开发调试”可独立开关原始网格路径、房内平滑路径、Zone 起终锚点、Portal/楼梯落点和最终画布 Polyline。Trace 从 HPE 的实际计算步骤产生，画布不进入正式用户报告。此能力用于定位异常在哪一层，且不修改任何评分结果。

如果未来采用方案 B：

- HPE：替换房内路径生成与长度/转向基准；Route 选择、Zone 锚点、Room 拓扑、Portal 与楼梯复用。
- PCI：直接继续消费 HPE 的正式 `pathPoints`，需要重新固定交叉/重叠基准结果。
- PCP：没有直接依赖 HPE polyline，只用 RoomConnectivityGraph；除共享拓扑与 Portal 数据外，测量/评分不变。

## 当前限制与下一步

实验目前以现有 0.1 m free-grid 的边界顶点近似二维可通行 polygon，尚不是直接从墙和家具 footprint 构建的精确 polygon visibility graph；跨楼层实验也明确返回无法比较。下一步是由产品确认是否把 HPE 评分讨论建立在当前测量基线之上，同时用更多 L 形、窄门、岛台、跨层样本校准方案 A 与 B；不是现在重写生产路径系统。
# 生产迁移结论（2026-08-12）

POC 胜出的 Polygon Visibility Graph 已正式迁移为 S1-HPE 生产二维寻路底座。生产链路为：行为锚点候选 → RoomConnectivityGraph 合法 Room/Portal/楼梯节点 → 各 Room clearance MultiPolygon → 房内 Visibility Graph → 全局 deterministic Dijkstra → 原始几何独立复核 → 正式 `pathPoints`。旧 0.1 m 网格 BFS 仅以相同房内端点生成开发 shadow，可在路径调试图层显示；不允许正式失败时静默回退。

几何模型使用 0.20 m 技术 agent radius、Clipper round offset（圆形 agent 与家具角部 clearance 更一致）、0.02 m 圆弧离散容差、0.03 m 最大 anchor snap，以及与圆弧离散误差一致的 0.021 m 独立复核容差。复核直接读取原始 RoomRegion、hole 和障碍 footprint，而不是复用求路 MultiPolygon。该 clearance 不是法规、人体尺寸、G 阈值或评分标准。

全局搜索不会先选最少 Room。每个真实 DoorPortal/楼梯 landing 与行为锚点成为全局图节点；房内边权是 Visibility Graph 实际长度，跨门边权是两侧 landing 距离，楼梯使用现有步行长度。Dijkstra 以总长选择结果，并用稳定节点/边 ID 处理等长。房内边按搜索展开惰性计算并缓存，避免住宅公共空间 Portal 组合爆炸。

卧室路线按每张正式 `functionTags` 床独立生成，只从可靠矩形 footprint 的两条长边采样，终点为目标卫生间真实 DoorPortal。主要归家和车库归家均从真实 DoorPortal 的住宅侧 landing 出发，厨房终点为首次进入正式 Kitchen Zone 的合法可通行边界；多个厨房按完整二维实际路径选择。主入口依赖显式 `isPrimaryEntrance`，只保留唯一可靠住宅外门兼容回退。

Bellevue 新基准：FOYER→OPEN KITCHEN 5.075 m；GARAGE→OPEN KITCHEN 13.325 m；BEDROOM 1→BATH 1 3.283 m；MASTER BEDROOM→MASTER BATH 4.331 m；BEDROOM 3→BATH 3 1.914 m；BEDROOM 2→BATH 2 2.161 m。PCI 仍为 6 条路线、15 对，新正式几何下交叉 0、重叠 0、共用门 0、共用楼梯 0；PCP 未改。

家具没有 `groundOccupancy` / `floorStanding` 等权威字段。生产 HPE 目前保守纳入有可靠 footprint 的 fixed、large-movable 与 small（含轻型座椅），排除车辆和不确定对象；不纳入开启区、最小使用区或三维操作空间。后续应由数据层补充落地占用语义，而不是扩大名称硬编码。

`clipper-lib` 6.4.2 已移入生产 dependencies（Boost Software License 1.0）。`yuka`、`earcut`、`@recast-navigation/core`、`@recast-navigation/generators` 仅供 POC/实验，后续可在归档实验后清理，本任务未删除。
