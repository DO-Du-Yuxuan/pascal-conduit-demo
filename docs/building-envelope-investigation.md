# 建筑有效范围来源调查

本阶段只把可见、按 Level 归属的 Pascal `slab`（Floor/Slab）轮廓作为建筑有效范围候选。派生工作位于 `src/evaluation/envelope.ts`，Parser 核心不改动。

| 来源 | Pascal 字段 / 代码位置 | Bellevue | Level | 闭合与孔洞 | 正式依据 |
| --- | --- | --- | --- | --- | --- |
| Floor / Slab | `nodes.*.type === "slab"`、`polygon`、`holes`；`src/geometry/slab.ts`；Handoff `slabs` | 19 个可见 Slab | 是 | 每个外环直接闭合；Level 2 合并后有 5 个孔洞 | 是，`slab-union`，中等置信度 |
| Zone | `type === "zone"`、polygon；Handoff `zones/spaces` | 有 | 是 | 可有任意功能语义，不能证明室内或完整房间 | 否；Space 仅由 Zone 派生 |
| Wall footprint | `Wall.start/end/thickness`；`buildExperimentalWalls` | 有，且含两段零长度墙 | 是 | 单墙占地，不等价于封闭室内区域；曲墙和失效 footprint 存在 | 否，仅可作为将来诊断线索 |
| 外墙/闭合墙集合 | 未见显式 `exterior` 或可靠闭合标记 | 无 | 部分 | 需要推断连通与内外侧，当前不猜测闭合 | 否 |
| Level 区域 / 其他 Polygon | Level 本身无室内轮廓；shaft 有 `polygon` | Shaft 有 | 是 | Shaft 是孔洞/竖井语义，不是建筑外边界 | 否；未来可与 Slab 孔洞交叉核验 |

Bellevue 结果：Level 1 的 11 个可见 Slab 合并为 2 个不相连区域，净面积约 319.862 m²；Level 2 的 8 个可见 Slab 合并为 1 个区域、5 个孔洞，净面积约 175.977 m²。

## 采用策略与限制

优先级目前只有一项：有效、可见的 Slab 外环与孔洞 → polygon-clipping 并集。任一候选 Slab 自相交、面积退化或无法合并时，不生成虚假边界。无 Slab 的 Level 返回 `unable_to_determine`。

不把 Zone 集合当作建筑边界；不以吊顶、屋顶、室外平台或功能 Zone 补线。当前数据没有可稳定识别这些对象为室内/室外的独立语义，因此 Slab 边界报告始终附带“Slab 语义有限”的中等置信诊断。

统一使用 G1 容差：长度 `1e-6 m`、面积 `1e-8 m²`、边界接触 `0.01 m`；G1-023 对贴边微小残差采用由 10 mm 接触容差导出的 `0.0002 m²` 接触面积阈值。曲墙、无效墙 footprint 不参与本阶段边界生成。

G1-023 后续扩展为“有效放置范围”检查：除 Slab 建筑范围外，还使用可靠 Wall footprint 检查家具嵌墙，并使用对象旋转 footprint 与垂直高度区间检查家具/设备实体碰撞。仅平面投影相交而高度区间错开的对象（如地柜与吊柜）不构成碰撞。桌椅和嵌入式灶具等可正常穿插的组合，当前长方体包围盒不足以代表模型实体，保留诊断而不猜测失败。
