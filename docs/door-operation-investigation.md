# Door Operation 数据调查

Bellevue 原始 Pascal JSON 的 26 扇 Door 均记录 `doorType`、`width`、`hingesSide`、`swingDirection`、`swingAngle`、`leafCount`、`slideDirection` 和 `trackStyle`。其中类型包括 `hinged`、`sliding`、`pocket`、`garage-sectional`、`double`；铰链侧为 left/right，开向为 inward/outward，平开角度为 90°。

Evaluation Handoff 在 `src/parser/evaluation-handoff.ts` 忠实传递这些字段，并额外给出已解析的墙上中心点、切向和门自身的局部旋转。门自身旋转约180°时，Handoff 与画布采用同一规则翻转有效铰链侧和有效开向；原始字段仍保留用于追溯。评价器不根据门框包围盒推断铰链或开向。

操作模型要求直墙宿主、门洞宽度、铰链侧、开向和至少 90°开启角。单开门以门洞宽度为门扇长度、0.04 m 为计算厚度，扫掠使用扇形近似；`sliding`、`pocket` 和 `garage-sectional` 不运行平开门扫掠规则。普通 `double` 门在 `leafCount=2` 且具有现有开向字段时，按两片等宽门扇计算，每片长度取门洞总宽的一半；该假设记录为 `double_door_equal_leaf_assumption`。不等宽子母门仍需要独立门扇数据，不能套用该假设。

入口阻挡使用门洞两侧各 0.45 m 的检测带；保留至少 20% 清空比例即不视为完全阻断。门扇碰撞和门扇互锁使用 0.01 m² 面积容差。所有数值集中于 `src/evaluation/tolerances.ts`。

## Bellevue 结果

- Door 总数：26
- 可可靠生成单扇平开操作几何：17
- 推拉、口袋或车库门：7（不适用门扇扫掠）
- 双开门：2（按两片等宽门扇及JSON现有开向参与计算）
- G3-002：pass；26 扇门均保留基本入口区域
- G3-007：`pass`；19 扇单开/双开门均能达到90°。MEP双开门的原始 `inward` 经自身180°旋转后有效开向为 `outward`，不会与室内两台 AC block 相交
- G3-008：`pass`；未发现严重门扇互锁，2 扇普通双开门已按等宽假设参与检查

双开门结果依赖“两片等宽”的明确评价假设；若后续数据表明某扇门实际是不等宽子母门，应重新生成两片独立门扇几何后复核。此前评价器漏用了门自身180°旋转，导致MEP双开门的红色扫掠方向与画布相反；这属于评价器方向映射错误，现已修正并增加Bellevue回归测试。
