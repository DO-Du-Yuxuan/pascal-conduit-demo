# G1–G3 V0.1 阶段交接

> 历史阶段快照：本文中的Bellevue数量、状态和旧字段缺口可能已随后续共享语义更新而变化。当前开发必须先阅读`docs/evaluation-semantic-contract.md`、`docs/evaluation-shared-change-log.md`和`docs/rule-implementation-status.json`；G3模块导航见`docs/g3-rule-index.md`。

冻结对象为默认真实案例 `sample-data/Bellevue demo.json`。本文记录当前代码真实执行结果；`unable_to_determine` 表示证据不足，不代表设计错误。G2 不得把本文中的“基本可用”参数直接当作规范值。

## 1. 当前系统链路

`Pascal JSON → Parser → Evaluation Handoff → Building Envelope → Room Region → Zone–Room 匹配 → Door Portal → Room Connectivity Graph → Obstacle / Operation / Navigable Space → G1 / G3 → 结构化报告 → 页面与画布`

| 层 | 入口 | 职责 |
|---|---|---|
| Parser | `src/parser/parse.ts` | 忠实解析 Pascal 节点，校验基础结构，不写评价结论。 |
| Evaluation Handoff | `src/parser/evaluation-handoff.ts` | 投影稳定 ID、Level、几何、引用、对象语义和 Pascal 源 ID。 |
| Envelope | `src/evaluation/envelope.ts` | 按 Level 从可靠 Slab union 构造 Polygon/MultiPolygon、孔洞与诊断。 |
| Room / Zone | `src/evaluation/room-regions.ts` | Envelope 减 Wall footprint 得到独立 Room Region，并按相交面积匹配 Zone。 |
| Portal / Graph | `src/evaluation/connectivity.ts` | 从门两侧多点采样构造 Room–Room、Room–Exterior 门边及可靠 Stair edge。 |
| 门与障碍 | `src/evaluation/door-operations.ts`、`src/evaluation/physical-placement.ts` | 构造门扇扫掠、入口区、障碍物、建筑越界及三维高度重叠。 |
| 自由空间 | `src/evaluation/navigation.ts` | 对 Room、Portal 和分级障碍栅格化，计算自由空间组件、落点和路径。 |
| 专项使用区 | `src/evaluation/furniture-use.ts`、`fixture-use.ts`、`operation-use.ts` | 统一生成家具、厨卫、柜体、抽屉、设备、洗衣及窗前操作区。 |
| 规则与报告 | `src/evaluation/evaluate.ts`、`src/evaluation/*rules.ts`、`src/evaluation/types.ts` | 执行规则，输出状态、测量、阈值、缺失数据、置信度和诊断。 |
| 页面与画布 | `src/main.tsx`、`src/evaluation-ui/presentation.ts`、`src/evaluation-ui/focus.ts`、`src/evaluation.css` | 人性化卡片、技术折叠、楼层切换、聚焦、高亮和调试图层。 |

## 2. 关键数据结构与文件

- `src/parser/schema.ts`、`src/types.ts`：Parser 运行时输入/输出类型；标准化 JSON Schema 为 `docs/parser-normalized-plan.schema.json`。
- `src/parser/evaluation-handoff.ts`：评价器唯一稳定交接入口 `buildEvaluationHandoff(parsed)`。
- `src/evaluation/types.ts`：统一 `RuleResult`、`EvaluationReport`、几何、Envelope、Room 等类型。
- `src/evaluation/geometry.ts`：Polygon 布尔、面积、相交、点包含、缓冲等公共几何函数。
- `src/evaluation/envelope.ts`：`BuildingEnvelope`。
- `src/evaluation/room-regions.ts`：`RoomRegionAnalysis` 与 `ZoneRoomMatch`。
- `src/evaluation/connectivity.ts`：`DoorPortal`、`RoomConnectivityGraph`、Exterior 与 Stair edge。
- `src/evaluation/door-operations.ts`：`DoorOperation`、单扇/等分双扇的 90° 扫掠和入口矩形。
- `src/evaluation/physical-placement.ts`：`Obstacle`、对象 footprint、建筑越界、墙体侵入及垂直范围碰撞。
- `src/evaluation/navigation.ts`：`RoomNavigableSpace`、Portal 落点、内部锚点、自由空间组件和路径。
- `src/evaluation/furniture-use.ts`：床、座椅、餐椅等 `FurnitureUseZone`。
- `src/evaluation/fixture-use.ts`：厨房和卫生间 `FixtureUseZone`。
- `src/evaluation/operation-use.ts`：柜门、抽屉、设备、洗衣、储藏、窗前 `OperationZone`。
- `src/evaluation/tolerances.ts`：唯一几何容差与 V0.1 使用性参数入口。
- `src/evaluation/evaluate.ts`：G1/G3 执行入口和 G3 汇总。
- `src/evaluation/g1-rules.ts`：12 条已落地 G1。
- `src/evaluation/g3-rules.ts`、`g3-operation-rules.ts`、`g3-navigation-rules.ts`、`g3-furniture-rules.ts`、`g3-fixture-rules.ts`、`g3-final-rules.ts`：43 条 G3。
- `src/evaluation-ui/presentation.ts`：把技术结果转换成设计师标题、原因、建议和可定位目标。
- `src/evaluation-ui/focus.ts`：把规则对象引用适配成楼层、相机和主/关联高亮。
- `src/main.tsx`：评价面板及现有 SVG 画布调试图层；评价规则不直接操作 DOM。

## 3. G1 完整状态

当前 G1：正式定义并执行 12 条，已实现 12 条。下表只记录真实注册进评价器的规则；未定义、未执行的编号不作为规则记录。

| 规则 | 当前名称 | 实现/执行 | 主要依赖 | Bellevue | 限制或说明 |
|---|---|---|---|---|---|
| G1-001 | 项目单位有效 | 已实现/自动 | unit settings | pass | 长度、面积、角度单位均支持。 |
| G1-002 | 参与评价的对象具有唯一身份 | 已实现/自动 | normalized ID | pass | 296 个评价对象 ID 唯一。 |
| G1-003 | 对象的楼层归属明确 | 已实现/自动 | parent/Level | issue | `item_4akv5mlmq2ywzfyh` Computer 的 `parentId` 为空。 |
| G1-004 | 对象尺寸与坐标有效 | 已实现/自动 | 坐标、尺寸、Wall footprint | issue | `wall_obbuari0p7ilw3lz` 为零长度墙；上述 Computer 无法解析世界坐标。 |
| G1-005 | 对象关联关系有效 | 已实现/自动 | Level、host、parent 引用 | pass | 当前 Stair 的 from/to Level 已修复；旧 Bellevue 失效引用问题不再存在。 |
| G1-006 | 建筑平面边界能够识别 | 已实现/条件自动 | Slab union、Level | pass | 两层均为中置信 Slab 边界；非规范建筑面积。 |
| G1-007 | 应封闭空间的边界闭合 | 已实现/条件自动 | Room、Zone 语义 | pass | 14 个明确需封闭 Zone 匹配单一 Room。 |
| G1-009 | 不同空间不存在异常重叠 | 已实现/条件自动 | Zone polygon、Room 匹配 | issue | 两个 `GARAGE` Zone 重叠 78.807 m²。开放空间多 Zone 不自动报错。 |
| G1-012 | 不存在错误空间 | 已实现/条件自动 | Room 形状、面积、来源诊断 | pass | 3 个约 0.000011–0.000025 m² 的细长片确认是墙体布尔/曲墙端部数值残差，仅 diagnostic。 |
| G1-013 | 门窗位于有效开口边界 | 已实现/自动 | host Wall、洞口宽度、投影 | pass | 当前 Bellevue 全部在宿主墙有效区间；旧版窗越界已修复。 |
| G1-019 | 主要空间具有明确名称 | 已实现/条件自动 | usable Room、Zone–Room、Zone name | pass | 22 个可用 Room 均匹配命名 Zone；不再把 Zone 直接当 Room。 |
| G1-023 | 家具与设备位于有效建筑范围 | 已实现/自动+条件 | Envelope、footprint、vertical range | issue | 6 个越界、21 个墙体侵入、9 组三维实体碰撞；嵌墙和同高度碰撞会报告。 |

## 4. G3 完整状态

43 条均注册且真实执行；已实现 42，部分/调整 1（G3-018），未实现 0。没有“只在 UI 展示、实际未执行”的规则。

| 规则 | 名称 | 实现方式与依赖 | Bellevue | 数据缺口 / V0.1建议 |
|---|---|---|---|---|
| G3-001 | 主要空间均可正常到达 | 条件自动；Graph、外门候选、Stair | pass | 14 个主要空间可从任一可靠外门到达；当前 Stair edge 有效。失效 Level 引用时跨层为 unable；保留。 |
| G3-002 | 空间入口不得被完全阻断 | 自动；Portal、Obstacle、入口区 | pass | 26 扇门入口可用；保留。 |
| G3-003 | 主要空间之间的基本通行路径应连续 | 自动；Navigable Space | pass | 13 个主要 Room 路径连续；保留。 |
| G3-004 | 正常通行不得依赖移动大型家具 | 自动对比；固定/大型家具 | pass | 21 个 Room 不依赖移动大型家具；保留。 |
| G3-005 | 已定义的使用空间不能成为无入口封闭空间 | 条件自动；Room、Zone 语义、Portal | pass | 22 个可用 Room 有入口；保留。 |
| G3-006 | 日常通行路径不得穿越实体对象 | 条件自动；固定障碍归因 | unable | Level 2 MEP Room 受两台分类不完全可靠设备影响；需可靠 category/mobility，无需新增结构即可改资产分类；保留。 |
| G3-007 | 平开门应能达到基本开启状态 | 条件自动；Door Operation、Obstacle | pass | 19 扇平开/等分双开门达到 90°；保留。 |
| G3-008 | 不存在严重门扇互锁 | 条件自动；门扇扫掠 | pass | 无严重互锁；顺序开关冲突仅 diagnostic。 |
| G3-009 | 门后具有基本停留空间 | 条件/去重 | not_applicable | 当前相关阻断由 G3-006 归因，不重复卡片；保留。 |
| G3-010 | 固定柜门能够正常开启 | 条件检查；Operation Zone | unable | 2 个固定柜缺少独立门片数量、宽度、铰链和开向；需新增资产门片元数据才能确定。 |
| G3-011 | 主要抽屉能够基本拉出 | 保守上界；家具朝向+柜深 | pass | 3 个抽屉按“不超过柜深”包络畅通；真实拉出深度仍非源事实。 |
| G3-012 | 主要设备门能够正常开启 | 保守上界；设备朝向+宽度 | pass | 1 台洗衣设备按“不超过设备宽度”包络畅通；厨房设备由 G3-029。 |
| G3-013 | 需要日常操作的窗户能够接近 | 自动分级；可开启状态、600 mm 窗前区 | issue | 3 扇窗仅 16%/13%/0% 可用；6 扇部分受阻仅 diagnostic。当前检查可开启窗接近，不模拟真实窗扇。 |
| G3-014 | 床能够完整放置 | 自动；床 footprint、卧室 Room | issue | 2 张床约 97% 位于 Room 内；需核验 Room 减墙边界。 |
| G3-015 | 床至少具有一个有效上下床位置 | 自动；Bed Use Zone | pass | 5 张床至少一侧可用。 |
| G3-016 | 双人床具备基本双人使用条件 | 条件自动；asset 名称/category | pass | 4 张 Double Bed；至少一侧可用即 G3 通过，双侧舒适度留 S1。 |
| G3-017 | 家具布置后卧室入口仍可使用 | 自动/去重；Navigation | pass | 5 个卧室入口可用。 |
| G3-018 | 衣柜能够正常开启和取物 | 部分/人工复核 | unable | 已识别 21 个衣柜，但 JSON 无门片数量、门宽、铰链和开向；只有项目完全没有衣柜时才为 not applicable。柜前取物由 G3-042。 |
| G3-019 | 床不得阻断卧室房门、套内卫生间入口及已建立的主要通行路径 | 自动/引用基础路径 | pass | 正式定义已调整，不再因窗用途语义 unable；保留。 |
| G3-020 | 客厅主要坐具能够正常使用 | 自动；朝向、Seating Use Zone | pass | 5 件主要坐具有进入区。 |
| G3-021 | 客厅家具不得阻断主要通行 | 自动/去重；Navigation | pass | 必要 Portal 连通。 |
| G3-022 | 餐桌具有与计划人数相符的基本座位 | 条件检查 | unable | 2 张餐桌缺计划人数/座位目标；需新增项目或资产语义。 |
| G3-023 | 餐椅能够完成基本拉出和入座 | 自动；椅子朝向反方向 600 mm | pass | 8 把餐椅可拉出。 |
| G3-024 | 客厅、餐厅和通道等复合功能能够同时成立 | 条件自动；复合 Zone、使用区、路径 | pass | 1 个复合空间成立。 |
| G3-025 | 厨房具有连续的基本操作关系 | 条件检查；厨房 Room、核心设备语义 | unable | 开放厨房缺 Sink；中厨缺 Sink/Fridge 语义。需规范 asset category/标签，不必改节点结构。 |
| G3-026 | 厨房核心设备能够正常接近 | 自动；Fixture Use Zone、路径 | issue | 中厨 Stove 前 600 mm 区 0% 可用。 |
| G3-027 | 厨房具有基本可用操作台面 | 条件自动；Counter、Sink/Stove | pass | 2 个核心设备附近有可识别台面。 |
| G3-028 | 对向橱柜、岛台之间可以基本通行 | 自动；Navigation | pass | 2 个厨房有 600 mm 基本通行。 |
| G3-029 | 厨房设备门能够完成基本开启和操作 | 条件检查 | unable | Big Fridge 缺门宽、铰链、开向、角度；需设备门元数据。 |
| G3-030 | 厨房入口能够正常进出 | 自动/去重；Portal、Navigation | pass | 2 个厨房入口可用。 |
| G3-031 | 厨房核心工作区不得成为通往其他主要空间的唯一通道 | 条件拓扑；Graph、核心区 | pass | 未发现唯一通道穿过核心区。 |
| G3-032 | 高柜和设备之间不存在完全无法使用的死角 | 条件检查 | not_applicable | 无可靠高柜实体死锁；门数据缺口已归 G3-029。 |
| G3-033 | 卫生间能够正常进入和退出 | 自动/去重；Portal、Door Operation、Navigation | pass | 4 个卫生间可进出。 |
| G3-034 | 坐便器具备基本坐下和起身空间 | 自动；Fixture Use Zone | pass | 4 个坐便器可用；不是规范净空。 |
| G3-035 | 洗手盆具备基本站立和操作位置 | 自动；Fixture Use Zone | pass | 4 个洗手盆可用。 |
| G3-036 | 淋浴或浴缸能够正常进入 | 条件自动；入口区、路径 | pass | 7 个淋浴/浴缸可进入；未知淋浴门不猜。 |
| G3-037 | 卫生间门不得造成使用者被困风险 | 条件自动；Door Operation、洁具 | pass | 未确认被困风险；缺门操作字段时应 unable。 |
| G3-038 | 卫生设备之间不存在完全功能冲突 | 自动；多个 Fixture Use Zone | pass | 允许部分重叠及顺序使用。 |
| G3-039 | 洗衣设备能够正常操作 | 自动；Room、入口、Laundry Operation Zone | pass | 1 台 Washing Machine 可到达且可操作。 |
| G3-040 | 洗衣设备不得阻断必要通道 | 自动/去重；Navigation | pass | 未切断必要路径。 |
| G3-041 | 储藏空间能够正常进入 | 条件自动；Zone 语义、Portal、Navigation | pass | 4 个储藏 Room 可进入。 |
| G3-042 | 储物柜具备基本取物条件 | 条件自动；600 mm Storage Zone | issue | 2 个柜前仅约 3%/1% 可用；柜门开启仍未知。 |
| G3-043 | 家务设备之间不存在完全功能冲突 | 条件检查；Laundry Room、Operation Zone | not_applicable | 可靠洗衣区域内不足 2 个家务设备。 |

双开门说明：早期版本因缺少独立门扇关系而 `unable_to_determine`；当前 V0.1 对明确 `double`/`french` 门采用“两片等宽、各不超过总门洞一半”的显式假设，因此 Bellevue 可执行。子母门、不等宽门或缺开向数据仍不能据此确认。

## 5. Bellevue 最终评价摘要

### G1

- 12 条执行：pass 8、issue 4、unable 0、not applicable 0。
- 真实/需处理问题：G1-003 无 Level Computer；G1-004 一段零长度墙及该 Computer 无有效坐标；G1-009 两个 GARAGE Zone 重叠；G1-023 6 个建筑越界、21 个嵌墙、9 组三维实体碰撞。
- 待核验：G1-012 的 3 个微小片已确认是评价几何数值残差，只保留 diagnostic；G1-023 中 mesh-only 嵌套关系不作为硬碰撞。

### G3

- 43 条执行：pass 30、issue 4、unable 6、not applicable 3。
- 真实/需处理问题：G3-013 三扇可开启窗接近区几乎封堵；G3-014 两张床约 3% 越出所属 Room；G3-026 中厨 Stove 前方操作区为 0%；G3-042 两个柜前取物区约 3%/1%。
- 待核验：G3-006 Level 2 MEP 固定属性；G3-010 两个固定柜体门片；G3-018 21 个衣柜门片；G3-022 两张餐桌计划人数；G3-025 两个厨房缺核心设备语义；G3-029 Big Fridge 门几何。

### 派生模型统计

- Level：2。
- Envelope：Level 1，Slab union，319.270 m²，1 Polygon/0 holes；Level 2，Slab union，179.277 m²，1 Polygon/4 holes；均 usable、中置信。
- Room Region：25 个（Level 1 为 12、Level 2 为 13）；22 个 usable，3 个数值残差。
- Zone–Room：31 个 Zone；一对一 20；一个 Room 对多个 Zone 的关系 9；跨多个 Room 0；未匹配 Room/Zone 均 0。
- Door Portal：26 个，26 个 usable；4 个 Room–Exterior；26 条 Door edge。
- Stair：1 条有效跨层 edge，Level 1 Room 连接 Level 2 Room；无 unresolved Stair。
- Navigable Space：22 个 Room；21 个加入家具后保持连通；5 个 Room 的自由空间有多个组件；48 个 Portal 落点。
- 专项对象：Furniture 81、Equipment 10、Column 5、Shelf 8；家具/厨卫语义对象各分析 96 个，生成 23 个使用区；30 个对象具有操作能力，共生成 57 个操作区。

## 6. 当前参数和容差

唯一来源为 `src/evaluation/tolerances.ts`。

| 参数 | 当前值 | 性质 |
|---|---:|---|
| length / area | 0.000001 m / 0.00000001 m² | 纯数值几何容差 |
| point on boundary | 0.01 m | 边界接触容差 |
| overlap area | 0.01 m² | 几何重叠忽略量 |
| Room 最小面积 / 数值碎片面积 | 0.5 / 0.001 m² | V0.1 空间筛选启发式 / 数值残差阈值 |
| Room 紧凑度 / 墙端小缝 | 0.03 / 0.02 m | 启发式 / 几何容差 |
| Zone 匹配 / 跨 Room / 异常重叠比例 | 0.50 / 0.20 / 0.05 | V0.1 关系启发式 |
| Door 侧采样 / 墙端避让 | 0.05 / 0.02 m | Portal 几何容差 |
| Door 入口深度 / 最小清晰比例 | 0.45 m / 0.20 | V0.1 使用参数 |
| 门最小开启 / 扫掠碰撞面积 / 假定门厚 | 90° / 0.01 m² / 0.04 m | V0.1 使用参数 / 几何容差 / 模型假设 |
| 基本通行净宽 / 人员半径 | 0.60 / 0.30 m | V0.1 基本使用参数，非规范值 |
| 栅格 / Portal 落点搜索 | 0.10 / 0.75 m | 算法精度 / 搜索参数 |
| 大型家具最小面积 / 小对象上限 | 1.00 / 0.35 m² | 分类启发式 |
| 家具使用区清晰比例 | 0.80 | V0.1 使用参数 |
| 床 / 座椅 / 餐椅操作深度 | 0.60 / 0.45 / 0.60 m | V0.1 使用参数 |
| 洁具站立 / 浴缸进入 | 0.60 / 0.60 m | V0.1 使用参数 |
| 厨房台面关系 | 1.50 m | 语义关系启发式 |
| 柜门 / 抽屉 / 设备操作深度 | 0.60 / 0.45 / 0.60 m | V0.1 使用参数 |
| 窗前深度 / pass / issue | 0.60 m / 50% / 20% | V0.1 接近性参数 |
| 实体碰撞面积 / 垂直间隔 | 0.01 m² / 0.005 m | 数值碰撞容差 |
| Stair 落地采样避让 / 深度 | 0.10 / 0.20 m | 派生连接参数 |

上述没有任何一项被声明为建筑规范值。G2 必须为具体法规条文建立独立参数、适用条件和版本来源。

## 7. 页面与画布能力

用户可手动“运行基础检查”，查看 G1/G3 汇总、按问题优先排序的人性化卡片、规则编码、理由/建议、数量和楼层；技术详情默认折叠。卡片和画布问题标记可双向定位，自动切换 Level；问题对象红色、关联对象橙色。运行后先显示全部问题，聚焦卡片时只显示该项；返回空白/ESC 可回到总览，再按 ESC 或“关闭高亮”关闭。

调试图层包括 Building Envelope、Room/Zone、空间连接、门扇扫掠、可通行空间/路径、家具使用区、厨卫使用区、操作与窗前接近区；多对象支持逐项查看。

当前仍缺：正式报告/PDF 导出、按模块和严重度筛选、派生几何专用 Inspector、三维模型精确轮廓显示、对诊断项的批量确认/忽略、人工修正语义回写。这些不在本冻结任务实现。

## 8. 已知限制与风险

1. 当前 Bellevue Stair 已修复；其他项目若 from/to Level 失效，跨层可达只能 unable，不能猜楼层。
2. 双开门使用等宽双扇假设；不等宽、子母门和独立门扇关系仍缺事实字段。
3. 无真实异形 footprint 的家具/设备采用旋转矩形；mesh 外形凹凸不会进入平面碰撞。
4. 家具、设备、厨卫语义依赖 Pascal category、asset name/tags；MEP mobility 仍可能不可靠。
5. 柜门、抽屉、冰箱/洗碗机等门片字段不足；保守包络不是源数据事实。
6. G3-013 当前把可开启窗纳入日常接近检查，但没有“必须日常操作”的用途语义，也不模拟真实窗扇碰撞。
7. 曲墙以离散/缓冲几何参与 Room、门窗和采样，曲率高或墙端复杂时置信度下降。
8. Room 是 Envelope 减 Wall footprint 的派生结果；门洞仍视作完整墙，连接另由 Portal 建立，布尔运算会产生微小残差。
9. 100 mm 栅格可能使窄边界、斜向通道和 Portal 落点产生约一个网格的误差。
10. 规则已做入口/通行/专项去重，但同一根因在 G1 几何与 G3 使用性间仍可能出现不同角度的两张卡。
11. 这些能力不能证明防火、疏散、无障碍、结构、产品安装或任何法规符合性。

## 9. Parser 是否被修改

Parser 核心 `src/parser/parse.ts` 未因 G1/G3 评价逻辑修改，规则判断未写入 Parser。`Evaluation Handoff` 以增量方式提供 Level/Zone/Slab/Wall/门窗/Item/Shelf/Stair、Pascal 源 ID、解析后的世界坐标和旋转、尺寸、垂直范围、Door 明确字段及 Window `operationState`。

G2 可依赖 Handoff 中稳定的标准化 ID、`rawPascalId`、Level/host/parent 引用、显式尺寸和分类原值。以下均是派生事实，不能冒充 Pascal 原始事实：resolved world transform、effective hinge/swing、Wall footprint validation、Item footprint/vertical range、Envelope、Room、Zone 匹配、Portal、Graph、Obstacle、Operation Zone、Navigable Space 和路径。

## 10. 给 G2 线程的使用建议

- 可直接复用：Handoff 追溯、单位、Level、墙/Slab/开口几何、Envelope、Room、Portal、测量/阈值/置信度/诊断报告结构和画布定位。
- 不可直接复用：G3 的 600 mm 通行、300 mm 半径、90°基本开门、操作区深度、面积比例和家具大小阈值；它们不是规范值。
- 数据较充分、可自动化的方向：单位与 ID、平面几何有效性、明确尺寸/间距、开口宿主关系、可靠边界内外关系。
- 只能条件检查：依赖 Room 语义、可开启窗用途、门扇关系、设备门、家具类别、楼梯落地区域的规则；证据不足必须 unable。
- 需人工复核：曲墙复杂节点、异形资产、边界布尔残差、用途/人数/主入口意图以及产品安装要求。
- V0.1 应暂缓：缺少净高/垂直净空、耐火等级、防火分区、结构承载、材料/产品认证、占用人数、无障碍构造细节的条文。
- 每条 G2 必须记录法规来源、版本、适用建筑/地区和法定阈值，明确区分“基本能使用”与“符合规范”。
