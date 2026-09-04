# G1 解析器数据对齐与评价边界

## 结论

本轮以 `buildEvaluationHandoff(parsed)` 为唯一评价输入，不读取解析器内部节点，也不把规则判断写入解析器。首批执行 G1-001、G1-002、G1-003、G1-004、G1-005、G1-019，并有条件执行 G1-013。G1-006、G1-009、G1-023 暂不执行。

> 关键限制：`Space` 由 `Zone` 一对一派生（`spaces[].source === "derived-from-zone"`）。Zone 是作者绘制区域，不保证是封闭房间、完整房间分区或主要空间。因此不得把 Space 当成已经可靠识别出的封闭房间。

## 候选规则数据对齐表

| 规则 | 所需对象与字段 | 当前提供与代码位置 | 派生几何 | 可靠程度 | 当前能力 | 最小补充方案 |
|---|---|---|---|---|---|---|
| G1-001 项目单位有效 | `units.length/area/angles/planCoordinates` | 已提供；`src/parser/evaluation-handoff.ts` 返回值 `units`，Schema `properties.units`，样例 `units` | 否 | 高；值由交接契约固定 | 自动判断 | 若未来支持其他 Pascal 单位，增加来源单位与显式换算记录 |
| G1-002 参与评价的对象具有唯一身份 | 各评价集合的 `id/rawPascalId` | 已提供；`base()` 和各集合投影；Schema `$defs.baseNode` | 否 | 高；原始字典键作为 ID | 自动判断 | 在未来独立 Space 引入时规定跨类型命名空间；当前 Zone→Space 是来源投影，不把 Zone 与 Space 同时作为两个参评实体 |
| G1-003 对象的楼层归属明确 | 各对象 `levelId`、`levels[].id` | 已提供；`levelIdOf()` → `resolveAncestorLevelId`；`relationships.levelMembership` | 祖先链解析，不是几何 | 高/中；有效父链可靠，缺父、环路明确失败 | 自动判断 | 在交接中增加 level-resolution 状态和失败原因，避免仅以 `null` 表示 |
| G1-004 对象尺寸与坐标有效 | 墙 `start/end/thickness`；门窗宽高与局部位置；物体 `dimensionsMeters/resolvedWorldPosition/transformStatus`；空间轮廓/面积；架体尺寸 | 已提供；`evaluation-handoff.ts` 的 wall/opening/item/zone/shelf 投影；运行时来源 `src/types.ts` 仍为宽松 `NodeData` | 需要有限性、正值、零长度/零面积计算 | 中高；可验证已提供数据，但 Pascal 变体未完全验证 | 自动判断已提供字段 | 为 stair/shaft 等建立按类型必填字段契约；交接显式携带墙 footprint validation 状态 |
| G1-005 对象关联关系有效 | `parentId`、`hostWallId`、`sourceZoneId`、楼梯层引用、Shelf 子对象引用及目标集合 | 已提供；base、opening、spaces、stairs、shelves 与 `relationships` | 否 | 高；仅验证引用存在性，不证明建筑语义正确 | 自动判断 | 为每种关系增加关系类型、解析状态和来源路径；明确可选引用与必填引用 |
| G1-006 建筑平面边界能够识别 | 有效外墙 footprint、墙连接闭环、层归属、外/内侧可信度，或可靠 Slab 外轮廓 | 墙中心线/厚度/side/连接及 `walls[].footprintValidation` 已提供；但 handoff 未提供 footprint 顶点或 Slab | 是；footprint、拓扑闭环、轮廓合并/选外环 | 低；样例含无效墙，side 不能单独证明边界 | 无法判断 | 向几何关系层提供已验证 footprint 顶点；按楼层构建闭环候选并输出边界来源、缺口与置信度；或新增经验证的 Slab 轮廓 |
| G1-009 不同空间不存在异常重叠 | 独立 Space 多边形、空间语义、楼层、合法重叠例外 | 仅提供 Zone 及 Zone 派生 Space；`zones/spaces[].outline/areaSquareMeters/source` | 是；多边形修复、相交面积、重叠比例 | 低；Zone 可重叠且不等同房间 | 无法判断 | 增加独立封闭房间识别结果、polygon-valid 状态、用途/例外语义，再按统一面积容差计算相交 |
| G1-013 门窗位于有效开口边界 | 门窗 `hostWallId/rawWallLocalPosition/widthMeters`；墙 `start/end/curveOffsetMeters`；宿主几何有效性 | 已提供；opening/wall 投影；交接文档明确曲墙解析不可靠 | 是；直墙长度与开口区间比较 | 直墙中高；曲墙低；无效 footprint 低 | 部分判断 | 本轮只判断有效直墙，曲墙/无效几何输出 `unable_to_determine`；后续提供沿曲线弧长位置与有效 wall footprint/opening cutout |
| G1-019 主要空间具有明确名称 | 独立 Space、主要空间分类/用途、`name` | `name` 已提供；Space 由 Zone 派生，且没有“主要空间”标记 | 否 | 名称字段高；空间完整性和主要性低 | 部分判断；总体必须 `unable_to_determine` | 增加独立 Space、用途分类及 `isPrimary`（含来源/置信度）；当前仅报告已知派生 Space 的空名情况 |
| G1-023 家具与设备位于有效建筑范围 | 可信家具/设备分类、完整 footprint、有效建筑边界、楼层 | item 中心、旋转、尺寸、category 已提供；分类仅为 category heuristic；建筑边界未提供 | 是；旋转矩形 footprint、包含/越界面积 | 低；类别与边界均不足 | 无法判断 | 提供经验证建筑边界和 item footprint；分类增加来源、置信度与排除策略；低可信类别保留诊断而不猜测 |

## 评价器分层

数据流保持单向：

```text
Pascal JSON → parseProject → buildEvaluationHandoff
            → evaluation/geometry（派生关系）
            → evaluation/g1-rules（规则）
            → evaluation/evaluate（结构化报告）
            → UI（只负责触发与展示）
```

- 解析器忠实保留与标准化 Pascal 数据，本轮不加入评分逻辑。
- Evaluation Handoff 是稳定边界，规则不读取 `Parsed.nodes`。
- `src/evaluation/geometry.ts` 负责包含、相交、邻接、距离、连通等派生关系。本轮仅实现直墙开口区间关系。
- `src/evaluation/g1-rules.ts` 只消费 handoff 和派生关系。
- `src/evaluation/evaluate.ts` 汇总统一结果与计数。

## 统一几何容差与无效几何策略

所有容差集中在 `src/evaluation/tolerances.ts`，均为模型坐标单位，不使用屏幕像素：

| 容差 | 当前值 | 用途 |
|---|---:|---|
| 长度容差 | `1e-6 m` | 零长度、正尺寸和数值退化判断 |
| 面积容差 | `1e-8 m²` | 零面积/退化轮廓判断 |
| 点在线段或墙体上的容差 | `0.01 m` | 门窗开口端点与宿主墙端点比较 |
| 重叠判断容差 | `0.01 m²` | 将来 G1-009 的实质性重叠阈值；本轮不执行该规则 |

任何非有限坐标、退化轮廓、无效墙 footprint、缺失宿主或不受支持的曲墙定位都不得进入后续几何计算。已能证明违反要求时输出 `issue`；证据不足或置信度不足时输出 `unable_to_determine`，并在 `missingData`、`confidence.reasons` 与 `diagnostics` 中保留原因。曲墙门窗、无效 wall footprint、类别不可信的家具设备均遵循该策略。

## 统一规则结果

`src/evaluation/types.ts` 定义每条规则的固定字段：`ruleId`、`ruleName`、`status`、`severity`、`summary`、`details`、`normalizedObjectIds`、`pascalSourceIds`、`measurements`、`thresholds`、`missingData`、`confidence`、`diagnostics`。报告还包含整体状态、四类计数、实际使用的容差、handoff 诊断和生成时间。
