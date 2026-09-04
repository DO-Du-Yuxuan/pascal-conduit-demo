# G2 第一批规则人工校准清单

校准对象：`sample-data/Bellevue demo.json`
项目类型：独立住宅（`detached_dwelling`）
评价分支：`agent/g2-batch-1`
评价基线提交：`0d8fb78 fix: resolve G2 plan-derived measurements`
校准日期：2026-07-27

## 1. 验收结论

| 规则 | 名称 | Bellevue 状态 | 检查对象 |
| --- | --- | --- | ---: |
| G2-001 | 住宅单元必要疏散门净开口符合规范 | pass | 4 樘可靠 Room–Exterior 门；其中 1 樘形成可判定的侧铰候选 |
| G2-003 | 住宅走廊净宽符合规范 | pass | 1 个 HALL Room |
| G2-004 | 居住房间平面面积符合规范 | pass | 8 个 Room |
| G2-005 | 居住房间最小水平尺寸符合规范 | pass | 8 个 Room |
| G2-006 | 坐便器平面净空符合规范 | pass | 4 个坐便器 |
| G2-009 | 车库不得直接开口通向睡眠房间 | pass | 1 个 Garage、4 个 Sleeping Room、3 个 Garage Portal |
| G2-010 | 住宅疏散路径不得穿过车库 | pass | 21 个适用起点 Room、4 樘外门候选 |

本轮没有发现 Bellevue 的真实 G2 问题，也没有 `unable_to_determine`。这只表示当前七条已实现规则在现有数据和当前测量口径下通过，不表示整套法规审查完成。

## 2. 共同测量与画布说明

- 长度计算以米为内部单位，法规阈值由美制原值精确换算；面积按 `1 ft² = 0.09290304 m²` 换算。
- Room 的法规平面测量主体是派生 `Room Region`；Zone 仅辅助判断用途，不把同一 Room 中的多个 Zone 自动拆成多个法规房间。
- 门连接使用派生 `Door Portal`；路径使用 `Room Connectivity Graph`。
- 固定墙体边界来自墙几何形成的 Room Region；G2 不使用 G3 的 600 mm 通行宽度、300 mm 人员半径或家具使用区阈值。
- Demo 左栏的通过项默认收起。当前版本的逐对象“在图中查看”只为 `issue` 和 `unable_to_determine` 生成焦点目标；Bellevue 七条均为 `pass`，因此没有自动测量线、净空区或路径叠加。
- 人工校准时可切换到 `G2技术安全`，展开通过项，并在画布开启 Room Region、Connectivity、对象中心和手工测量工具。下文给出的坐标、墙、门、Room 序列是当前版本可用于人工复核的定位依据。
- “画布验收方式”中的手工步骤是当前可执行方式；标为“当前缺口”的内容尚未自动可视化，不能把它理解为已经显示。

## 3. G2-001 住宅单元必要疏散门净开口符合规范

### 3.1 规则基本信息

- 法规条文：IRC R311.2。
- 法规原始阈值：净宽不小于 `32 in`，净高不小于 `78 in`。
- 精确公制换算：`32 in = 0.8128 m`；`78 in = 1.9812 m`。
- Bellevue 状态：`pass`，置信度 `medium (0.75)`。

### 3.2 适用对象

程序不要求主入口或“必要疏散门”字段，而是收集全部可靠 Room–Exterior Door Portal：

| 门 | Level | 室内侧 Room | 门型 | 名义洞口宽×高 | 实际净开口字段 | 判定用途 |
| --- | --- | --- | --- | --- | --- | --- |
| `door_39lvain1x33slnkl` / Door 3 | Level 1 | 开放客餐厨/门厅复合 Room | sliding | 3.0000 × 2.1000 m | 无 | 是可靠外门候选；不是侧铰门，不作为 R311.2 通过证据 |
| `door_63mh4bxrm80jvzw3` / Door 4 | Level 1 | GARAGE | garage-sectional | 4.101136 × 2.4000 m | 无 | 是可靠外门候选；车库卷帘门不作为侧铰门通过证据 |
| `door_ayus02olzi93jnya` / Door 3 | Level 1 | 开放客餐厨/门厅复合 Room | double、两扇、90° | 1.832401 × 2.1000 m | 无 | 侧铰候选；可用平面几何派生净开口 |
| `door_e10ytun62cai4o0h` / Door 4 | Level 1 | GARAGE | garage-sectional | 3.276073 × 2.4000 m | 无 | 是可靠外门候选；车库卷帘门不作为侧铰门通过证据 |

统计：

- 可靠 Room–Exterior 门候选：4 樘。
- 具有名义门洞宽高：4 樘。
- 具有 Pascal 明示实际净开口：0 樘。
- 可由平面可靠派生实际净开口：1 樘。
- 不能直接判定的原因：JSON 提供的是门洞/名义尺寸，没有成品门框后的 `clearOpening`；三樘非侧铰外门也不能证明 R311.2 的必要侧铰门满足要求。

### 3.3 实际测量口径

- 以 `Door Portal` 识别 Room–Exterior 连接，不把普通室内门纳入。
- 不猜测主入口；四樘外门均先作为出口候选，再按门型筛出侧铰候选。
- 对双开侧铰 Door 3，当前按整个可开启洞口计算，不按单扇门宽的一半计算。
- 宽度从名义门洞两侧各扣除常见门框止口 `5/8 in`：总扣除 `1.25 in = 0.03175 m`。
- 高度扣除一个 `5/8 in` 上框止口和 `0.0200 m` 门槛。
- 没有使用 Pascal `frameThickness = 0.0500 m` 直接双边扣减，也没有把墙洞宽度原样当作净开口。
- 该扣减是平面估算，不是现场成品门实测；因此通过结果保持中等置信度。

### 3.4 Bellevue 实测结果

双开侧铰 Door 3：

- 派生净宽：`1.832401 - 0.031750 = 1.800651 m`（约 `70.892 in`），要求 `≥ 32 in / 0.8128 m`，`pass`。
- 派生净高：`2.100000 - 0.015875 - 0.020000 = 2.064125 m`（约 `81.265 in`），要求 `≥ 78 in / 1.9812 m`，`pass`。
- 至少一樘候选同时满足净宽和净高，因此规则最终 `pass`。
- 其余三樘外门没有被错误地作为室内门排除，但也没有用非侧铰门的名义洞口证明法规通过。

### 3.5 画布验收方式

1. 在评价面板选择 `G2技术安全`，展开 G2-001 通过项。
2. 切到 Level 1，开启 Door Portal/门对象显示。
3. 定位开放复合 Room 外侧的双开 Door 3；同时核对另一樘 sliding Door 3 和 Garage 的两樘 sectional Door 4。
4. 当前画布可以显示门和相邻 Room，但通过项没有自动“在图中查看”焦点，也没有自动绘制扣框后的净开口宽高线。
5. 人工校准可使用手工测量工具量名义洞口，再按上述扣减复核。自动净开口线属于当前校准可视化缺口。

## 4. G2-003 住宅走廊净宽符合规范

### 4.1 规则基本信息

- 法规条文：IRC R311.6。
- 法规原始阈值：`3 ft`。
- 精确公制换算：`3 ft = 36 in = 0.9144 m`。
- Bellevue 状态：`pass`。

### 4.2 适用对象

- 纳入：Level 2 的 `HALL` Zone 所在 Room `level_tf1ug5dswkkzfhqa-room-2`。
- Room Region 面积：`38.710220 m²`。
- 真实 polygon：1 个外环、无洞，约 61 个顶点；边界范围 `x = -6.300…3.077 m`、`z = -10.750…0.150 m`。
- 形状是带多个转折、楼梯连接和局部支路的凹多边形，填充率约 `0.3787`，不是矩形走廊。
- 排除：普通 Room 内的通行路线、卧室/起居室内部过道、可移动家具形成的临时通道。

### 4.3 实际测量口径

- 使用 Room Region 的真实边界，不使用轴对齐 bounding box。
- 对每条长度不小于 `0.25 m` 的边，向 Room 内侧偏移 `0.002 m`，在边长的 20%、35%、50%、65%、80% 位置发射垂直射线。
- 每条边至少获得 3 个有效截面才参与；宽度不大于 `0.10 m` 的数值视为退化命中。
- 每条边取有效样本中位数，最终取所有边中位截面的最小值，避免单个顶点或支路交叉处的偶然射线造成误报。
- 固定且会永久缩小边界的非墙障碍物参与扣除；可移动家具不参与。
- 这是派生几何测量。没有采用 G3 通行宽度，也没有将 Zone 面积或最长轴当作走廊宽度。

### 4.4 Bellevue 候选窄点与实测结果

下表为当前算法产生的候选截面中位宽；坐标为截面在边界上的采样位置：

| 候选点 `(x,z) m` | 中位宽 m | 候选点 `(x,z) m` | 中位宽 m |
| --- | ---: | --- | ---: |
| `(-5.450,-5.245)` | 5.391 | `(-4.600,-7.172)` | 2.960 |
| `(-4.125,-8.550)` | 6.191 | `(-3.475,-8.500)` | 8.856 |
| `(-2.950,-8.325)` | 8.710 | `(-2.400,-7.975)` | 3.289 |
| `(-1.775,-7.325)` | 6.035 | `(-1.125,-6.500)` | 6.280 |
| `(-0.750,-6.025)` | 2.393 | `(1.013,-5.900)` | 2.434 |
| `(2.279,-5.250)` | 1.784 | `(3.077,-4.671)` | 9.377 |
| **`(2.864,-4.091)`** | **1.159** | `(2.650,-3.779)` | 4.257 |
| `(1.130,-3.466)` | 2.434 | `(0.311,-2.456)` | 1.461 |
| `(-1.150,-1.808)` | 1.368 | `(-1.250,-3.200)` | 4.500 |
| `(-1.575,-3.750)` | 2.877 | `(-2.100,-4.075)` | 2.592 |
| `(-2.650,-4.200)` | 4.000 | `(-2.925,-3.600)` | 3.378 |
| `(-3.250,-2.925)` | 5.566 | `(-3.775,-2.675)` | 3.256 |
| `(-4.200,-2.275)` | 2.810 | `(-4.500,-1.750)` | 1.897 |
| `(-4.600,-0.654)` | 1.700 | `(-5.450,0.146)` | 5.391 |
| `(-6.300,-2.548)` | 2.361 |  |  |

- 最窄可靠截面：`1.159 m`，约 `45.63 in`。
- 法规要求：`≥ 0.9144 m / 36 in`。
- 子项和最终结果：`pass`。
- 旧算法曾因复杂分支形状不能可靠确定最窄截面而 `unable_to_determine`；当前局部边界截面算法已消除该原因。剩余人工问题不是 Pascal 必然缺数据，而是 HALL 的整个复杂 polygon 是否都应按走廊用途纳入。

### 4.5 画布验收方式

1. 选择 `G2技术安全`，展开 G2-003；切到 Level 2，开启 Room Region。
2. 定位 HALL Room，核对其楼梯段、转折和支路都属于同一 polygon。
3. 人工重点复核边段 `[(3.077,-4.091),(2.650,-4.091)]` 附近、候选点 `(2.864,-4.091)` 的垂直截面，程序值为 `1.159 m`。
4. 当前通过项不会自动高亮候选截面，也不会显示全部射线；可用手工测量工具复核。

## 5. G2-004 居住房间平面面积符合规范

### 5.1 规则基本信息

- 法规条文：IRC R304.1；可计入净高依据 R304.3。
- 法规原始阈值：面积 `70 ft²`；平顶/吊顶可计入净高 `7 ft`；坡顶可计入净高 `5 ft`。
- 精确公制换算：`70 ft² = 6.5032128 m²`；`7 ft = 2.1336 m`；`5 ft = 1.5240 m`。
- Bellevue 状态：`pass`。

### 5.2 适用对象和实测结果

Room Region 是测量主体；Zone 只用于用途识别。面积均为二维派生 Room 面积，不是法定建筑面积。

| Level / Room | 匹配 Zone | 平面面积 m² | 70 ft² 初检 | Ceiling 覆盖/最低高度 | 最终 |
| --- | --- | ---: | --- | --- | --- |
| Level 1 / 开放复合 Room | PLAY AREA、STAIR、FOYER、DINNING、LIVING ROOM、OPEN KITCHEN、HALL | 128.663966 | pass | 100% / 3.10 m | pass |
| Level 1 / RECREATION ROOM | RECREATION ROOM | 32.077500 | pass | 100% / 3.10 m | pass |
| Level 1 / BEDROOM 1 | BEDROOM 1 | 16.660000 | pass | 100% / 3.10 m | pass |
| Level 1 / OFFICE 1 | OFFICE 1 | 9.573846 | pass | 100% / 3.10 m | pass |
| Level 2 / MASTER BEDROOM | MASTER BEDROOM | 39.146178 | pass | 100% / 2.79 m | pass |
| Level 2 / BEDROOM 3 | BEDROOM 3 | 17.130422 | pass | 100% / 2.79 m | pass |
| Level 2 / BEDROOM 2 | BEDROOM 2 | 14.296500 | pass | 100% / 2.79 m | pass |
| Level 2 / READING | READING | 12.158167 | pass | 100% / 2.79 m | pass |

全部 8 个适用 Room 的二维面积均大于 `6.5032128 m²`。当前 Ceiling polygon 与 Room Region 的覆盖率均为 100%，且最低高度均高于 `2.1336 m`，所以不存在“垂直净高证据不足”的 `unable_to_determine`。

排除对象：

- Level 1 `CHINESE KITCHEN` 是纯厨房 Room，按规则例外排除。
- GARAGE、BATH、CLOSET/WIC、PANTRY、MUD、HALL、LAUNDRY、MEP 等非居住房间按用途排除。
- 开放客餐厨没有按多个 Zone 拆成多个法规房间；整个 Room Region 作为一个测量对象。

### 5.3 实际测量口径

- 平面面积来自 Room Region polygon 的二维面积。
- Ceiling polygon 与 Room Region 求交；低于相应净高阈值的区域不计入。
- Bellevue 的 Ceiling 记录提供高度且完整覆盖，因此可从原先的严格 `unable` 收口为 `pass`。
- 当前数据未显示坡顶分段；如果真实建筑存在坡顶、但 JSON 仍只给一个平顶高度，程序无法从平面自行推断坡面。此项是模型真实性校准问题，不是本次 Bellevue 的数据缺失结论。
- 不扣除可移动家具；墙体已经通过 Room Region 边界排除。固定结构若形成 Room 洞或障碍，则由真实 polygon 反映。

### 5.4 画布验收方式

1. 选择 `G2技术安全`，展开 G2-004，逐层开启 Room Region 和 Zone 标签。
2. 在 Level 1 核对开放客餐厨等 Zone 共用一个 Room Region；确认 CHINESE KITCHEN 独立 Room 被排除。
3. 在 Level 2 核对四个适用 Room 和对应 Ceiling 覆盖。
4. 当前画布没有面积填色、可计入净高区域或自动“在图中查看”；可通过 Room Region 边界和技术详情中的面积逐项人工对照。

## 6. G2-005 居住房间最小水平尺寸符合规范

### 6.1 规则基本信息

- 法规条文：IRC R304.2。
- 法规原始阈值：`7 ft`。
- 精确公制换算：`7 ft = 2.1336 m`。
- Bellevue 状态：`pass`。

### 6.2 实际测量口径

- 使用与 G2-004 相同的 8 个适用 Room；纯厨房及其他非居住房间排除。
- 使用真实 Room polygon，不使用轴对齐 bounding box。
- 当前算法在 Room polygon 内寻找一个边长恰为 `2.1336 m` 的有效旋转正方形；结构柱/井道从可用区域扣除。
- 中心搜索网格最大步长约 `0.10 m`，候选方向来自 polygon 边方向，边界包含判断采用约 `1e-7 m` 的数值容差。
- 输出是“存在至少 `2.1336 m` 的有效水平尺寸”的阈值见证，不是房间精确最大内接正方形，也不是单一 bounding-box 宽度。

### 6.3 Bellevue 实测结果

“测量线位置”以下用见证正方形中心、方向表示；从中心沿该方向及其垂线各向两侧量 `1.0668 m`。

| Level / Room | polygon 类型 | 见证中心 `(x,z) m` | 方向 | 开放复合 | 凹形/柱影响 | 结果 |
| --- | --- | --- | ---: | --- | --- | --- |
| Level 1 / 开放复合 Room | 约 65 顶点凹多边形 | `(-2.580,-1.072)` | 0° | 是 | 1 个结构障碍参与扣除；仍可容纳 | pass |
| Level 1 / RECREATION ROOM | 5 顶点矩形 | `(8.770,-6.130)` | 0° | 否 | 1 个结构障碍；无结论影响 | pass |
| Level 1 / BEDROOM 1 | 5 顶点矩形 | `(3.910,-7.590)` | 0° | 否 | 1 个结构障碍；无结论影响 | pass |
| Level 1 / OFFICE 1 | 约 29 顶点曲边/凹多边形 | `(0.501,0.778)` | 75.96° | 否 | 斜边影响方向；旋转见证仍成立 | pass |
| Level 2 / MASTER BEDROOM | 9 顶点凹多边形 | `(7.750,-7.850)` | 0° | 否 | 2 个结构障碍参与；仍可容纳 | pass |
| Level 2 / BEDROOM 3 | 9 顶点凹多边形 | `(-9.326,1.542)` | 0° | 否 | 2 个结构障碍参与；仍可容纳 | pass |
| Level 2 / BEDROOM 2 | 5 顶点矩形 | `(-7.130,-7.463)` | 0° | 否 | 2 个结构障碍参与；仍可容纳 | pass |
| Level 2 / READING | 约 30 顶点曲边/凹多边形 | `(0.984,-0.766)` | 61.11° | 否 | 斜边影响方向；旋转见证仍成立 | pass |

- 八个 Room 都能在真实 polygon 内形成 `2.1336 m × 2.1336 m` 的见证区域，因此均 `pass`。
- 开放客餐厨使用完整 Room Region，没有因一个 Room 匹配多个 Zone 而 `unable`。
- 纯 CHINESE KITCHEN 不触发本规则。
- 目前没有 Room 因窄颈、凹角、斜边或柱子而跌破阈值；OFFICE 1 和 READING 的旋转见证最值得人工复核。

### 6.4 画布验收方式

1. 选择 `G2技术安全`，展开 G2-005，开启 Room Region。
2. 按表中 Level、Room 和中心坐标定位；使用手工测量工具沿给定方向和垂线绘制 `2.1336 m` 的两条相交测量线。
3. 核对整个见证正方形是否落在 Room Region 内且不穿过结构障碍。
4. 当前通过项没有自动见证正方形或测量线；这是画布校准缺口，但不影响当前几何判定已从 `unable` 收口为明确 `pass`。

## 7. G2-006 坐便器平面净空符合规范

### 7.1 规则基本信息

- 法规条文：WAC 51-56-0400 / UPC 402.5。
- 法规原始阈值：
  - 坐便器中心至侧墙或固定障碍物 `15 in`；
  - 同类洁具中心距 `30 in`；
  - 住宅单元/睡眠单元前方净空 `21 in`；
  - 非住宅普通情形前方净空 `24 in`。
- 精确公制换算：
  - `15 in = 0.3810 m`；
  - `30 in = 0.7620 m`；
  - `21 in = 0.5334 m`；
  - `24 in = 0.6096 m`。
- Bellevue 状态：`pass`。
- 项目类型明确为独立住宅，因此四个坐便器只应用 `21 in`，不同时强制 `24 in`。

### 7.2 实际测量口径

- 中心来自坐便器节点的 `resolvedWorldPosition`；朝向来自 `resolvedRotationRadians`，按 `2π` 周期归一化后构造左右和前方射线。
- 左右侧距从坐便器中心量到同一 Room Region 的最近边界或同层固定障碍物。
- 前方净空从坐便器前缘方向量到 Room Region 边界或最近固定障碍物；不使用 G3 坐便器使用区。
- 可移动家具不作为法定固定障碍物；墙、固定洁具和可靠固定构件参与。
- 当前结果保留命中距离，但没有保留“是哪一条墙/哪一个固定构件终止射线”的对象 ID。下表列出卫生间的边界墙集合；终止对象仍需在画布人工确认。
- 同类中心距只在同一 Room 或同一无墙分隔的开放洁具区域内比较相邻坐便器。Bellevue 每个适用卫生间只有一个坐便器，因此四个中心距子项均为 `not_applicable`。

### 7.3 Bellevue 逐对象实测

| Level / 卫生间 / 坐便器 | 中心 `(x,z) m` / 归一化朝向 | 左 / 右侧距 | 最小侧距结果 | 前方净空结果 | 同 Room 第二坐便器 | 最终 |
| --- | --- | ---: | --- | --- | --- | --- |
| Level 2 / MASTER BATH / `item_a720h5x84l8enxab` | `(3.527,-4.661)` / 90° | 0.5704 / 0.5886 m | 0.5704 ≥ 0.3810，pass | 0.8010 ≥ 0.5334，pass | 无；中心距 N/A | pass |
| Level 2 / BATH 3 / `item_p68narnplomx7l54` | `(-7.620,-0.348)` / 原始 45.553 rad，归一化约 90° | 0.5184 / 0.381573 m | 0.381573 ≥ 0.3810，pass | 0.8698 ≥ 0.5334，pass | 无；中心距 N/A | pass |
| Level 1 / BATH 1 / `item_rpameqlewfesmqq3` | `(4.325,-2.275)` / 原始 `3π`，归一化 180° | 0.5300 / 0.6250 m | 0.5300 ≥ 0.3810，pass | 1.3150 ≥ 0.5334，pass | 无；中心距 N/A | pass |
| Level 2 / BATH 2 / `item_ttq70o7yr8l4lhwf` | `(-10.126,-5.292)` / 原始 `2.5π`，归一化 90° | 0.4670 / 0.6530 m | 0.4670 ≥ 0.3810，pass | 0.9258 ≥ 0.5334，pass | 无；中心距 N/A | pass |

边界墙集合：

- MASTER BATH：`wall_216oeqpngzy1zbae`、`wall_310ivdyjq4bc30oo`、`wall_8dgmd7npuiiwfp5u`、`wall_ffpd0by6ja6762jr`、`wall_kl7y48oc2hxpi2k9`、`wall_lgrehtk44a3ftjdn`、`wall_psgvvgjyt3h5mqs9`。
- BATH 3：`wall_1al1baxmm5ck5dib`、`wall_1oavpa3822gmh9fe`、`wall_ajixfm922nen33am`、`wall_b2orpcv271ydxy7h`、`wall_l0wduir1mgtwld7f`、`wall_x0l6a948vo278i9a`。
- BATH 1：`wall_0f6gpecryeqyyjk1`、`wall_c783g0mjvk11z4he`、`wall_f7d71yf5kpffhcl0`、`wall_t0oca55j4qm6ubxa`。
- BATH 2：`wall_7s021sc63nm7hmrl`、`wall_lgb7shys1pvu6m0x`、`wall_n8p4o7n2gxnaqwde`、`wall_zgt30hblc7v8tpgm`。

BATH 3 最小侧距只比阈值大 `0.000573 m`（约 `0.023 in`），属于人工校准重点。其原始旋转为多圈角度，程序归一化后方向合理，但应确认源数据确实以弧度表达朝向。

### 7.4 5.542 m 原始原因和修正结果

- 原始 `5.542 m` 来自把同一 Level 上、但位于不同卫生间且被墙分隔的两个坐便器配成“同类洁具中心距”。
- 修正后先按 Room/无墙开放区域分组，再只比较组内相邻同类洁具。
- Bellevue 四个卫生间各只有一个坐便器，中心距比较对数量从错误的跨 Room 配对变为 0；四个中心距子项均为 `not_applicable`，总规则仍由侧距和前距共同判定为 `pass`。

### 7.5 画布验收方式

1. 选择 `G2技术安全`，展开 G2-006，切换到对应 Level 和卫生间。
2. 开启对象中心显示，按表中中心坐标定位四个坐便器；开启 Room Region 查看卫生间边界。
3. 用手工测量工具沿归一化朝向的左右法线量侧距，并沿前向量前方净空。
4. 当前画布没有为通过项自动绘制坐便器中心、左右测量线和前方净空区，也不能点击结果直接识别终止墙/障碍物。这是本次报告确认的最主要校准可视化缺口。

## 8. G2-009 车库不得直接开口通向睡眠房间

### 8.1 规则基本信息

- 法规条文：IRC R302.5.1。
- 法规原始阈值：无数值阈值；禁止 Garage 与 Sleeping Room 形成直接 Door Portal 边。
- 精确公制换算：不适用。
- Bellevue 状态：`pass`。

### 8.2 适用对象

Garage：

- Level 1 `GARAGE`，Room `level_jwi4ovhyra2ayxa5-room-2`，面积 `77.209488 m²`。

Sleeping Rooms：

- Level 1 `BEDROOM 1`。
- Level 2 `MASTER BEDROOM`。
- Level 2 `BEDROOM 3`。
- Level 2 `BEDROOM 2`。

Garage 的全部 Door Portal：

| Portal / 门 | 另一侧 | 连接性质 | 结果 |
| --- | --- | --- | --- |
| `door_235p9ofj5w88jxbh` | Level 1 `MUD` | Garage–Room | 不是 Sleeping Room，允许 |
| `door_63mh4bxrm80jvzw3` | Exterior | Garage–Exterior | 不形成卧室直连 |
| `door_e10ytun62cai4o0h` | Exterior | Garage–Exterior | 不形成卧室直连 |

不存在 Garage–Sleeping Room 的直接边。Garage 经 MUD 再连接其他空间属于间接连接，不触发本规则。

### 8.3 实际测量口径

- 用 Room Region 和 Zone 识别 Garage/Sleeping 用途。
- 用 Door Portal 判断一樘门两侧的直接相邻 Room。
- 不按空间距离、不按视觉接近、不沿最短路径推断“直接开口”；只有同一 Portal 的两侧正好是 Garage 和 Sleeping Room 才判 `issue`。
- 本规则是拓扑判定，没有长度容差和几何近似。

### 8.4 画布验收方式

1. 选择 `G2技术安全`，展开 G2-009，切到 Level 1。
2. 开启 Room Region、Door Portal 和 Connectivity，定位 GARAGE 边界。
3. 核对两樘车库外门和一樘通向 MUD 的门；确认没有 Portal 直接进入 BEDROOM 1。
4. 再切 Level 2 核对三个卧室不可能与 Level 1 Garage 共用门 Portal。
5. 当前通过项没有自动高亮 Garage 边界、三樘门和相邻 Room；需按上述图层手工查看。

## 9. G2-010 住宅疏散路径不得穿过车库

### 9.1 规则基本信息

- 法规条文：IRC R311.1。
- 法规原始阈值：无数值阈值；适用 Room 必须存在至少一条不经过 Garage 的可靠路径到任一可靠外门。
- 精确公制换算：不适用。
- Bellevue 状态：`pass`。
- 项目已明确为独立住宅，不因缺少“住宅单元 Room 范围”或主入口字段而 `unable_to_determine`。

### 9.2 实际测量口径

- 四樘可靠 Room–Exterior 门全部先作为出口候选，不依赖主入口：
  - 开放复合 Room 外侧 sliding Door `door_39lvain1x33slnkl`；
  - 开放复合 Room 外侧 double Door `door_ayus02olzi93jnya`；
  - Garage 外侧 sectional Door `door_63mh4bxrm80jvzw3`；
  - Garage 外侧 sectional Door `door_e10ytun62cai4o0h`。
- 以全部可靠住宅使用 Room 为起点，排除 Garage 本身。
- 在完整 Room Connectivity Graph 中移除 Garage 节点后做可达性检查；这等价于证明“至少存在一条不经过 Garage 的路径”，不是只检查最短路径。
- 两樘 Garage–Exterior 门仍被统计为外门候选，但移除 Garage 后不能为其他 Room 提供避开 Garage 的路径。
- 全部起点都能到达开放复合 Room 的两樘外门；`onlyThroughGarageCount = 0`。

### 9.3 Bellevue 逐起点路径

下表列出每个起点的一条不经过 Garage 的 Room 序列；每个起点实际均可到达开放复合 Room 的两樘外门 `door_39…` 和 `door_ayus…`。

| Level / 起点 Room | 一条不经过 Garage 的路径 |
| --- | --- |
| Level 1 / 开放复合 Room | 开放复合 Room → Exterior |
| Level 1 / RECREATION ROOM | RECREATION ROOM → 开放复合 Room → Exterior |
| Level 1 / BEDROOM 1 | BEDROOM 1 → 开放复合 Room → Exterior |
| Level 1 / WALK-IN CLOSET | WALK-IN CLOSET → 开放复合 Room → Exterior |
| Level 1 / MUD | MUD → 开放复合 Room → Exterior |
| Level 1 / OFFICE 1 | OFFICE 1 → 开放复合 Room → Exterior |
| Level 1 / CHINESE KITCHEN | CHINESE KITCHEN → 开放复合 Room → Exterior |
| Level 1 / BATH 1 | BATH 1 → 开放复合 Room → Exterior |
| Level 1 / PANTRY | PANTRY → CHINESE KITCHEN → 开放复合 Room → Exterior |
| Level 2 / MASTER BEDROOM | MASTER BEDROOM → HALL → 开放复合 Room → Exterior |
| Level 2 / HALL | HALL → 开放复合 Room → Exterior |
| Level 2 / BEDROOM 3 | BEDROOM 3 → HALL → 开放复合 Room → Exterior |
| Level 2 / BEDROOM 2 | BEDROOM 2 → WIC 2 → HALL → 开放复合 Room → Exterior |
| Level 2 / READING | READING → HALL → 开放复合 Room → Exterior |
| Level 2 / MASTER BATH | MASTER BATH → MASTER BEDROOM → HALL → 开放复合 Room → Exterior |
| Level 2 / WALK-IN CLOSET | WALK-IN CLOSET → MASTER BEDROOM → HALL → 开放复合 Room → Exterior |
| Level 2 / LAUNDRY | LAUNDRY → HALL → 开放复合 Room → Exterior |
| Level 2 / WIC 2 | WIC 2 → HALL → 开放复合 Room → Exterior |
| Level 2 / BATH 2 | BATH 2 → BEDROOM 2 → WIC 2 → HALL → 开放复合 Room → Exterior |
| Level 2 / BATH 3 | BATH 3 → BEDROOM 3 → HALL → 开放复合 Room → Exterior |
| Level 2 / MEP | MEP → LAUNDRY → HALL → 开放复合 Room → Exterior |

没有起点只可经 Garage 到达外部，因此不存在“必须经过 Garage”的证据，也没有 `unable_to_determine`。当前语义和连接图足以判定。

### 9.4 画布验收方式

1. 选择 `G2技术安全`，展开 G2-010，开启 Connectivity 和 Room Region。
2. 在 Level 1 确认开放复合 Room 的两樘外门、Garage 的两樘外门和 MUD–Garage 边。
3. 在 Level 2 逐个核对起点到 HALL 的连接，再通过楼梯边连接 Level 1 开放复合 Room。
4. 当前画布只能显示整体 Connectivity Graph；通过项没有单独“在图中查看”，也不能选择某个起点后高亮一条避开 Garage 的路径。路径序列需按上表手工追踪。

## 10. 需要用户人工确认的产品问题

### 问题 1：G2-001 平面派生净开口能否直接形成 pass

- 对应规则：G2-001。
- 画布位置：Level 1 开放复合 Room 外侧双开 Door 3。
- 当前程序处理方式：按整个可开启双开洞口扣除两侧 `5/8 in` 止口，并扣除上框和门槛；结果以中等置信度 `pass`。
- 可选口径 A：允许可靠平面几何派生值形成 `pass`，同时标注需现场复核。
- 可选口径 B：派生值只能形成 `unable_to_determine`，只有显式成品净开口字段才能 `pass`。
- 建议：A；符合“尽量给出通过/不通过”的产品目标，同时保留置信度和测量来源。
- 影响：G2-001 当前会保持 `pass`；选 B 会变为 `unable_to_determine`。

### 问题 2：G2-003 的 HALL 复杂 polygon 是否全部属于法规走廊

- 对应规则：G2-003。
- 画布位置：Level 2 HALL 的楼梯口、转折和多个支路。
- 当前程序处理方式：整个 HALL Room Region 都作为走廊测量。
- 可选口径 A：只要 Room/Zone 语义为 HALL，就测完整 Room Region。
- 可选口径 B：由设计师标出真正的走廊主段，楼梯平台或开放前厅另行排除。
- 建议：先采用 A，并在画布展示候选截面；只有确认语义标注过宽时再引入 B。
- 影响：会改变候选窄点集合和最窄宽度，可能改变 G2-003 结果。

### 问题 3：开放客餐厨是否作为一个法规居住房间

- 对应规则：G2-004、G2-005。
- 画布位置：Level 1 PLAY/STAIR/FOYER/DINNING/LIVING/OPEN KITCHEN/HALL 复合 Room。
- 当前程序处理方式：以一个完整 Room Region 测面积和水平尺寸，Zone 不拆房间。
- 可选口径 A：无墙分隔时按一个法规房间测量。
- 可选口径 B：按功能 Zone 分别形成法规测量对象。
- 建议：A；与 Room 是测量主体的既定原则一致。
- 影响：选 B 会重新计算 G2-004/005 的对象数和结果，并可能制造小 Zone 误报。

### 问题 4：Ceiling.height 是否足以证明没有坡顶低净高区

- 对应规则：G2-004。
- 画布位置：Level 2 MASTER BEDROOM、BEDROOM 2/3、READING。
- 当前程序处理方式：Ceiling polygon 100% 覆盖且高度高于 7 ft 时直接计入；不从屋顶形状自行推断坡顶。
- 可选口径 A：接受 Ceiling polygon/height 作为完成面净高证据。
- 可选口径 B：顶层必须另有坡度/分段净高证据，否则严格结果仍为 `unable_to_determine`。
- 建议：A；若 Pascal 后续能输出坡顶分段，再按真实分段收紧。
- 影响：选 B 会把顶层 G2-004 从 `pass` 改为 `unable_to_determine`。

### 问题 5：G2-005 的“有效水平尺寸”产品解释

- 对应规则：G2-005。
- 画布位置：Level 1 OFFICE 1、Level 2 READING 及开放复合 Room。
- 当前程序处理方式：真实 polygon 内能容纳一个旋转的 `7 ft × 7 ft` 正方形即通过。
- 可选口径 A：采用当前“7 ft 正方形见证”。
- 可选口径 B：实现更严格的专用宽度算法，检查法规意义上的每个有效水平尺寸和窄颈。
- 建议：短期 A 用于明确判定，同时把见证正方形显示在画布；法规解释确认后再决定是否升级 B。
- 影响：B 可能改变凹形、斜边或窄颈 Room 的结果；Bellevue 当前八个 Room 需重新校准。

### 问题 6：BATH 3 的多圈旋转是否可自动归一化

- 对应规则：G2-006。
- 画布位置：Level 2 BATH 3 的坐便器。
- 当前程序处理方式：原始 `45.553 rad` 按 `2π` 周期归一化为约 90°。
- 可选口径 A：自动归一化，只在技术详情提示原始角度异常。
- 可选口径 B：超过 `2π` 的原始角度一律视为朝向不可靠。
- 建议：A，并重点人工复核 BATH 3；旋转的周期等价性明确。
- 影响：选 B 会使 BATH 3 及 G2-006 最终变为 `unable_to_determine`。

### 问题 7：哪些内置柜体应视为 G2-006 固定障碍物

- 对应规则：G2-006。
- 画布位置：四个卫生间内坐便器相邻的洗手台、柜体和固定洁具。
- 当前程序处理方式：墙、固定洁具及被标记为固定的构件参与；可移动家具不参与。
- 可选口径 A：可靠标记为 built-in/fixed 的洗手台和柜体都参与。
- 可选口径 B：只有墙和洁具参与，其他柜体忽略。
- 建议：A；法定净空不应穿过永久柜体，但需要保证 mobility 标签可靠。
- 影响：可能缩小四个坐便器的侧距/前距；BATH 3 最接近阈值，最可能改变结果。

### 问题 8：G2-010 的疏散起点范围

- 对应规则：G2-010。
- 画布位置：PANTRY、CLOSET/WIC、BATH、LAUNDRY、MEP 等附属 Room。
- 当前程序处理方式：除 Garage 外，所有可靠住宅使用 Room 都作为起点，共 21 个。
- 可选口径 A：保留所有可进入的住宅 Room。
- 可选口径 B：只检查居住/睡眠及主要使用 Room，不把小型储藏和设备间作为独立起点。
- 建议：A；覆盖更保守，且当前不会产生误报。
- 影响：改变检查对象数量和报告长度；Bellevue 最终仍预计 `pass`。

### 问题 9：Garage sectional door 是否保留为“外门候选”

- 对应规则：G2-001、G2-010。
- 画布位置：Level 1 Garage 的两樘 Door 4。
- 当前程序处理方式：拓扑上计入全部可靠 Room–Exterior 门；G2-001 不把它们当作侧铰门通过证据，G2-010 移除 Garage 后也不会用它们证明其他 Room 有避开 Garage 的路径。
- 可选口径 A：继续计入“全部外门候选”，但在报告中单列门型与法规资格。
- 可选口径 B：一开始就从疏散出口候选中排除车辆门。
- 建议：A；保留真实连接信息，同时避免把车辆门误作合规侧铰出口。
- 影响：改变 G2-001/G2-010 的候选统计；Bellevue 最终状态不变。

### 问题 10：通过项是否需要校准模式的测量叠加

- 对应规则：全部七条，重点 G2-003、G2-005、G2-006、G2-010。
- 画布位置：评价面板的通过项和对应 Room/Fixture/Path。
- 当前程序处理方式：通过项默认收起，且只有 issue/unable 结果生成“在图中查看”焦点；测量线、净空区和路径没有自动叠加。
- 可选口径 A：增加“校准模式”，允许通过项逐对象聚焦并显示截面、见证正方形、坐便器净空和路径。
- 可选口径 B：维持当前 UI，只对 issue/unable 自动定位。
- 建议：A；不会改变法规判定，却能让设计师验证程序量的具体位置。
- 影响：只影响验收效率和可解释性，不改变七条规则状态。

## 11. 冻结与复验

- 本报告冻结 G2 第一批七条规则的人工校准结论；后续第二批实现不改变上述测量口径。
- 当前完整复验：`npm test` 通过，27 个测试文件通过、1 个跳过，218 个测试通过、1 个跳过。
- `npm run build` 通过；仅有 Vite 大 chunk 提示，无构建错误。
- Parser、Editor 和 Pascal JSON 结构均未修改。
