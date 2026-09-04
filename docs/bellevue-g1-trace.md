# Bellevue G1 结果溯源与误判校准

本文针对 Demo 使用的真实 Bellevue Pascal JSON（`sample-data/9618b316-3eab-4fcf-9a21-0f7316479968.json`）逐项追踪：原始 Pascal 节点 → `parseProject` → `buildEvaluationHandoff` → G1 规则 → 报告。

## 结论摘要

| 规则 | 对象 | 根因分类 | 结论 |
|---|---|---|---|
| G1-004 | `wall_s036gfqzmc1miaps`、`wall_2lndng4qf6ayungu` | 1. 原始 Pascal 数据真实错误 | 两条独立、无子对象的 Wall 起终点完全相同，长度为 0；Parser/Handoff 均忠实保留，非系统误判。 |
| G1-005 | `stair_dyp7dqxtm1mg9fxb` | 1. 原始 Pascal 数据失效引用；楼梯真实跨层语义为 6. 当前信息不足 | 原始/标准化 `fromLevelId` 和 `toLevelId` 一致，且均不在项目节点表。没有过滤、重命名或合并发生。其 3.5 m 总高、20 级、spiral 类型表明它意图跨层，但不能确认应关联到哪两个实际 Level。 |
| G1-013 | `window_u6yp3z754ya6gqkq` | 1. 原始 Pascal 几何不一致 | 直墙和 footprint 均有效。Pascal `position[0]` 是洞口中心沿墙距离，`width` 是洞口宽度；右端超出 40.3 mm，超出 10 mm 容差后仍有 30.3 mm。不是窗框、模型包围盒或 Handoff 映射混淆。 |

## G1-004：两个零长度 Wall

| 字段 | Wall 107 | Wall 100 |
|---|---:|---:|
| 标准化 ID / Pascal ID | `wall_s036gfqzmc1miaps` | `wall_2lndng4qf6ayungu` |
| Level | `level_tf1ug5dswkkzfhqa` / Level 2 | `level_tf1ug5dswkkzfhqa` / Level 2 |
| 原始 `start` | `[-5.8998934462129204, -3.3000256132108987]` | `[4.932036399841309, -5.7]` |
| 原始 `end` | 与 `start` 相同 | 与 `start` 相同 |
| 长度 | `0 m` | `0 m` |
| 厚度 | 未提供，Handoff 使用 Pascal 默认 `0.1 m` | 未提供，Handoff 使用 Pascal 默认 `0.1 m` |
| 高度 | 未提供（`null`） | 未提供（`null`） |
| 曲墙 | 否，`curveOffset=0` | 否，`curveOffset=0` |
| footprint | 无效，`wall_zero_length`，面积 `0 m²` | 无效，`wall_zero_length`，面积 `0 m²` |
| 触发字段/阈值 | `wall.lengthMeters=0`；要求 `> 1e-6 m` | `wall.lengthMeters=0`；要求 `> 1e-6 m` |

两条墙都没有 children，且没有曲线偏移或特殊连接数据。因此当前证据不支持将其视为可接受的极短墙、曲墙或特殊连接墙；最合理分类是源数据中的残留退化节点。

## G1-005：楼梯 Level 引用

楼梯原始与 Handoff 字段完全一致：

| 字段 | 值 |
|---|---|
| Stair ID | `stair_dyp7dqxtm1mg9fxb` |
| `fromLevelId` | `level_fkoejbpxrc8pfko1` |
| `toLevelId` | `level_3xsbeo3c6y50zj52` |
| 当前全部 Level ID（标准化 ID = Pascal ID） | `level_jwi4ovhyra2ayxa5`（Level 1）、`level_tf1ug5dswkkzfhqa`（Level 2） |

这两个被引用 ID 只出现在该 Stair 字段中，未作为任意 Pascal 节点的字典键出现。Parser 不过滤 Level；Handoff 也没有重命名或合并 ID，而是直接透传 Stair 字段。因此失效引用在源 JSON 已存在，页面应标注为“源数据”。

## G1-013：Window 1 与宿主墙

| 字段 | 值 |
|---|---:|
| Window ID / Pascal ID | `window_u6yp3z754ya6gqkq` |
| Host Wall ID / Pascal ID | `wall_twjrbha7gdx24q8c` |
| 墙起点 / 终点 | `[-3.7828824995228247, 2.9499636829170583]` / `[-1.9504812955856323, 2.9499636829170583]` |
| 墙长 | `1.8324012039371924 m` |
| footprintValidation | 有效；面积 `0.18324012039371773 m²` |
| 曲墙 | 否，`curveOffset=0` |
| Pascal `position[0]` / 洞口中心 | `0.957665610141416 m` |
| Pascal `width` / 洞口宽度 | `1.83 m` |
| 世界中心投影 | `[-2.8252168893814087, 2.9499636829170583]` |
| 洞口区间 | `[0.04266561014141601, 1.872665610141416] m` |
| 墙有效区间 | `[0, 1.8324012039371924] m` |
| 右端实际超出 | `0.04026440620422359 m`（约 `40.3 mm`） |
| 容差 | `0.01 m`（`10 mm`） |

规则使用 `position[0] ± width/2`。`frameThickness=0.05 m`、`frameDepth=0.07 m` 仅为框体字段，未参与洞口边界判断；模型包围盒也未参与。该结论为高置信度。

## G1-019

Bellevue 当前的 10 个 Zone 派生 Space 均有名称。由于不存在独立房间识别和“主要空间”分类，结果保留为 `unable_to_determine`；这不代表发现了未命名房间。

