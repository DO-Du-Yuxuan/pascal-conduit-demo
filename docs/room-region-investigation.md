# Room Region 识别调查

Room Region 是由建筑边界与固定墙体分隔得到的物理区域；Zone 是设计师标注的功能区域。二者在 `src/evaluation/room-regions.ts` 中通过面积相交独立匹配，不再由 Zone 一对一派生 Room。

| 数据 | 当前能力与位置 | Bellevue 质量 | 用法与风险 |
| --- | --- | --- | --- |
| Building Envelope | `src/evaluation/envelope.ts`，可见 Slab 并集 | 两个 Level 均可用 | Room 分割的外部约束；孔洞保留 |
| Wall footprint | `buildExperimentalWalls`；Handoff 新增 `footprintValidation.footprint` | Level 1 有 48 个有效墙；Level 2 有 53 个有效墙、1 个无效墙被排除 | 从 Envelope 中扣除；1 mm 派生坐标吸附只用于避免浮点 union 失败 |
| Door / opening | 门窗属于 Wall，但现有 wall footprint 没有切除门洞 | 数据存在 | 本阶段仍把宿主墙视为空间分隔；门连通留给下一阶段 |
| Wall connection | Handoff `relationships.wallConnections` 只记录严格重合端点 | 存在小数误差与小缝隙 | 不作为强制闭合依据；不修补大缺口 |
| 曲墙 | 墙体构造层可生成离散 footprint | Bellevue 存在 | 只接收已经通过 footprint validation 的曲墙；离散产生的极小碎片交给 G1-012 |
| Column / Shaft | 有对象和 Shaft polygon | 存在 | 当前不作为房间分隔；Slab hole 已保留。未来可核验 shaft 与 hole 一致性 |
| Zone | Handoff `zones[].outline` | 当前 Demo 31 个 | 只做 polygon 面积匹配与重叠检查，不生成 Room |

## 识别算法

1. 为 Level 获取可靠 Building Envelope。
2. 排除零长度、自相交或无效墙体 footprint。
3. 将有效墙体 footprint 在 1 mm 派生网格上吸附并求并集。
4. 计算 `Envelope - WallUnion`，每个不连通 polygon 成为候选 Room Region。
5. 保留孔洞，计算净面积、周长、紧凑度与边界墙映射。
6. 面积不超过 0.001 m² 的候选标记为几何计算残留，只保留技术诊断；面积高于该残留阈值但小于 0.5 m²或紧凑度小于 0.03 的候选标记为异常碎片，不参与主要空间匹配。
7. Zone 与可靠 Room 计算相交面积、Zone 覆盖率和 Room 覆盖率；不使用中心点或名称推断匹配。

墙端缺口不自动补线：无论小于还是大于当前 20 mm 诊断容差，都不会凭空创建墙体。小缺口可能使相邻区域保持连通，并在人工可视化中核验；较大缺口同样不会被强制闭合。

## Bellevue 数据结果

- Level 1：12 个候选，10 个可靠 Room Region，2 个约 0.000025 m² 的墙端计算残留。
- Level 2：13 个候选，12 个可靠 Room Region，1 个约 0.000011 m² 的曲墙/墙端计算残留；1 个无效墙 footprint 被排除。
- 合计 25 个候选、22 个可靠 Room Region、3 个低于 0.001 m² 残留阈值的几何碎片；它们仅保留在 G1-012 技术诊断中，不作为设计师级别问题。
- 31 个 Zone：20 个一对一匹配，另有 9 个 Zone 分布在 2 个“单 Room、多 Zone”关系中，2 个 `OPEN TO BELOW` 为部分匹配；0 个 Zone 跨多个 Room，0 个可靠 Room 未匹配。

该方法可以支持房间级规则和下一阶段门连接建图，但开放边界、小缝隙、曲墙离散和 Slab 语义仍需要画布人工核验。

G1-012 的三个 Bellevue 微小区域均邻近曲墙与墙端，面积分别约为 0.000025、0.000025、0.000011 m²。它们由 `Envelope - WallUnion` 后产生，明确低于 0.001 m² 数值残差阈值，因此只保留面积、周长、紧凑度、Level、邻近墙和推测来源诊断，不影响 G1 状态。
