# Door Portal 与 Room Connectivity Graph 调查

本阶段将门洞连接作为评价器几何关系层的独立派生结果。Room Region 仍由 Building Envelope 减去完整 Wall footprint 得到；门洞不会切开墙体 Polygon，而是通过 Door Portal 单独建立拓扑边。Window 不参与通行连接。

## Door Portal 方法

对每个直墙门：

1. 验证宿主墙、门洞中心、Pascal `width`、墙上局部位置和所属 Level。
2. 使用门洞中心与墙切向计算 opening segment；不使用门框厚度、模型包围盒或门扇尺寸。
3. 由墙切向得到法向，在门洞宽度的 `-25% / 0 / +25%` 三个位置、墙体两侧各两个距离进行采样。
4. 每侧六个样本通过 Room Region Polygon（含 holes）和 Building Envelope 判断为 Room、Exterior 或 unresolved。
5. 仅 Room–Room、Room–Exterior 生成连接边；两侧同一 Room、采样不一致或无效几何不生成边。

采样距离为墙体半厚度加 0.05 m，并在更外侧再采样一次。门洞距离墙端不超过 0.02 m 时保留 `door_near_wall_end`，连接可继续使用但置信度降为 medium。曲墙门由于当前缺少可靠局部弧长定位与法向，返回 `curved_door_portal_unsupported`。

## 楼梯连接

楼梯只有在 `fromLevelId`、`toLevelId` 都指向现有 Level，并且楼梯 footprint 中心在两层分别落入唯一可靠 Room Region 时才建立跨层边。Bellevue 楼梯引用两个不存在的 Level，因此只输出 `stair_connection_unresolved`，不会猜测楼层或落地区域。

## Bellevue 结果

- Door：26
- Room–Room Portal：22
- Room–Exterior Portal：4
- 无法解析 Portal：0
- 墙端低置信 Portal：1（`door_ayus02olzi93jnya`）
- 连接图节点：24（22 Room + 2 Exterior）
- 门连接边：26
- 楼梯连接边：0
- 可靠外门：4；G3-001 采用“任意一扇可靠外门可通达全部主要空间”的口径，不要求唯一住宅主入口
- Level 1：10 个可靠 Room，门连接形成 1 个同层连通分量
- Level 2：12 个可靠 Room，门连接形成 1 个同层连通分量
- G3-005：pass，22 个已定义使用 Room 均至少有一个有效入口
- G3-001：unable_to_determine；至少一个外门可覆盖入口层主要空间，但楼梯层引用失效，跨层可达性不能成立结论

每个 Room 的有效入口数量：

| Level | Room | Zone 名称 | 入口数 |
| --- | --- | --- | ---: |
| Level 1 | room-1 | PLAY AREA / STAIR / FOYER / DINNING / LIVING ROOM / OPEN KITCHEN / HALL | 9 |
| Level 1 | room-2 | GARAGE / GARAGE | 3 |
| Level 1 | room-3 | RECREATION ROOM | 1 |
| Level 1 | room-4 | BEDROOM 1 | 1 |
| Level 1 | room-5 | WALK-IN CLOSET | 2 |
| Level 1 | room-6 | MUD | 4 |
| Level 1 | room-7 | OFFICE 1 | 1 |
| Level 1 | room-8 | CHINESE KITCHEN | 2 |
| Level 1 | room-9 | BATH 1 | 1 |
| Level 1 | room-10 | PANTRY | 2 |
| Level 2 | room-1 | MASTER BEDROOM | 3 |
| Level 2 | room-2 | HALL | 5 |
| Level 2 | room-3 | BEDROOM 3 | 2 |
| Level 2 | room-4 | BEDROOM 2 | 2 |
| Level 2 | room-5 | READING | 1 |
| Level 2 | room-6 | MASTER BATH | 1 |
| Level 2 | room-7 | WALK-IN CLOSET | 1 |
| Level 2 | room-8 | LAUNDRY | 2 |
| Level 2 | room-9 | WIC 2 | 2 |
| Level 2 | room-10 | BATH 2 | 1 |
| Level 2 | room-11 | BATH 3 | 1 |
| Level 2 | room-12 | MEP | 1 |

## 人工画布抽查建议

由于本任务约定不使用浏览器检查，以下对象留给页面人工验收：

- 室内门：`door_235p9ofj5w88jxbh`、`door_b1riqeap8023qles`、`door_gkfoks7c5i9ssnke`、`door_d81levvdt4tmt02q`、`door_p2yxrdash2rgc49t`
- 外门：`door_39lvain1x33slnkl`、`door_63mh4bxrm80jvzw3`
- 墙端外门：`door_ayus02olzi93jnya`
- 卫生间：Level 1 room-9、Level 2 room-6/10/11
- 卧室：Level 1 room-4、Level 2 room-1/3/4
- 楼梯附近：Level 1 room-1；楼梯跨层关系应显示未解析提示

当前图只表达空间拓扑，不代表实际步行路径；家具阻挡、门扇碰撞、通道净宽和精细寻路仍不在本阶段范围内。
