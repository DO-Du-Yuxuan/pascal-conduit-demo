# G3规则实现索引

G3按能力拆分代码是有意设计：避免一个超大文件同时维护连接、门、自由空间、家具和厨卫算法。本文件提供唯一导航入口，不复制44条规则正文。

## 注册与汇总

- 产品执行白名单：`src/evaluation/product-rule-scope.ts`
- 报告执行入口：`src/evaluation/evaluate.ts`
- 统一结果类型：`src/evaluation/types.ts`
- 实现状态、规则名称、依赖和源文件：`docs/rule-implementation-status.json`
- 用户卡片与定位：`src/evaluation-ui/presentation.ts`、`src/evaluation-ui/focus.ts`
- 共同语义：`docs/evaluation-semantic-contract.md`

## 模块归属

| 规则范围 | 主文件 | 能力边界 |
|---|---|---|
| G3-001、G3-005 | `src/evaluation/g3-rules.ts` | 跨Room/跨层可达、无入口空间；当前只注册G3-001 |
| G3-002、G3-007、G3-008 | `src/evaluation/g3-operation-rules.ts` | 门入口、门扇开启、门扇互锁；当前只注册G3-002 |
| G3-003、G3-004、G3-006 | `src/evaluation/g3-navigation-rules.ts` | 自由空间、通行路径、障碍归因；当前只注册G3-003 |
| G3-014至G3-024 | `src/evaluation/g3-furniture-rules.ts` | 历史家具专项规则；当前不注册 |
| G3-025至G3-038 | `src/evaluation/g3-fixture-rules.ts` | 厨房、厨电、卫生间和洁具；当前只注册G3-025、G3-027、G3-031 |
| G3-009至G3-012、G3-039至G3-044 | `src/evaluation/g3-final-rules.ts` | 历史操作专项规则；当前不注册。G3-013实现已删除 |

模块中的历史数组不代表产品规则范围。任何规则只有进入`product-rule-scope.ts`白名单后才会出现在报告和页面中。

## 共享分析层

| 能力 | 文件 |
|---|---|
| Room Region与Zone匹配 | `room-regions.ts`、`space-semantics.ts` |
| Door Portal与Connectivity Graph | `connectivity.ts` |
| 门扇与障碍 | `door-operations.ts`、`physical-placement.ts` |
| 自由空间与路径 | `navigation.ts` |
| 家具、厨卫、操作区 | `furniture-use.ts`、`fixture-use.ts`、`operation-use.ts` |
| 对象用途和开启空间 | `object-semantics.ts`、`object-use-space.ts` |
| 使用性参数与几何容差 | `tolerances.ts` |

规则文件可以继续按能力拆分，但不得跨模块重复实现同一底层几何。新增或迁移规则时必须同步更新本索引和`rule-implementation-status.json`。
