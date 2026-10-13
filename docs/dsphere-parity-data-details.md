# Demo 与当前 dsphere Builder 数据/几何只读审计

审计基准是本机 `dsphere-main`（当前 Builder 实现），不是 `editor-main`。Demo 使用 Pascal 命名的 `@pascal-app/core` / viewer 0.9.2；Builder 参考代码来自 `@dsphere/core` / viewer 0.1.0。`editor-main` 1.0.3只作为未来兼容线索，不用它的新字段定义当前Builder缺口。未修改仓库源码，未运行浏览器或联网。

> 本文 `src/` 路径指 Demo，`packages/` 未注明时指本地 dsphere-main。与渲染/交互对照的合并优先级见[汇总报告](dsphere-integration-parity-audit.md)。

## 覆盖矩阵

| 范围 | Demo 当前实现 | dsphere Builder 当前实现 | 审计结论 |
|---|---|---|---|
| Parser/schema | Project 4.0通用node只检查`id/type`，宽容透传；不会对全部节点应用Builder schema defaults | Builder节点定义/Zod defaults；场景系统以lowercase node kinds分发 | 保留raw正确；缺省字段要由展示adapter按当前dsphere defaults解释 |
| Public type → internal dispatch | 白名单 `BUILDING_TYPES` 决定大写公共type是否转kebab | 当前Builder注册多种构件节点（skylight/dormer/vents/chimney/solar/scan等） | 明确的显示适配遗漏 F1；原始Project仍往返保留 |
| Slab | 按`elevation`正负生成从0到该标高的实体范围 | 同样以`elevation`作为板厚/凹池深度；负值为池底/内壁，不是新SDK的独立`thickness` | 正值范围约定一致；负值闭合/池体几何差异 F2。Editor新`thickness`字段不属于当前Builder |
| Door/Window | 对空宽高均回退0.9×2.0 | Door schema/tool缺省0.9×2.1；Window缺省1.5×1.5 | 2D/3D/CAD/洞口偏差 F3 |
| Wall/Ceiling height | Demo显示/几何碰撞空高统一回退2.7 | DSphere默认层高2.5；Ceiling schema默认2.5，Wall viewer/default亦2.5 | 可复现的2.7 vs 2.5偏差 F4 |
| Level stack | 3D display adapter按同层children算height；Beam及若干系统投影还用索引×3.2m | Builder `getLevelHeight`按Ceiling/Wall最高点取值，缺省2.5m，LevelSystem累计各层高度 | 3D算法基本对齐；通用高程固定3.2造成局部视图/世界Y不一致 F5 |
| Item位置/尺寸 | 直接parent/wall/item/shelf plan transform；未提供dimension的2D Item被略过；3D盒回退1m | DSphere schema dimensions默认1m；Floorplan transform支持wall/item/shelf，Level/slab/ceiling直接使用level-local位置 | 未parse默认造成2D漏项；wall-side footprint中心偏移方向相反 F6 |
| Item host | 支持wall、item、shelf及level/slab/ceiling直系plan位置；Demo的ceiling vertical resolver返回error | DSphere Item有wall/wall-side/ceiling attach；移动工具将ceiling作为host并以Level-local坐标显示plan | Ceiling host高度在Demo 3D位置链未合成 F6；Editor roof/block face等新host是未来兼容项 |
| 2D Floorplan image | alpha裁边后非等比拉伸占满外廓 | `FloorplanImage`默认`xMidYMid meet`等比contain | 可复现显示比例差异 F8，不改变实体坐标 |
| Scene bounds / camera fit | 手算bounds只计wall、slab/ceiling/zone、beam、item | Builder选中实体用实际Object3D `Box3.setFromObject`求外廓；注册系统也有实际几何 | Demo手算bounds遗漏已渲染构件，可能影响interaction bounds和空白平面大小 F7 |
| 材质/SDK来源 | Demo使用`@pascal-app/*` 0.9.2；材质adapter优先读显式schema/preset | dsphere代码使用另一命名的`@dsphere/*` 0.1.0源码线 | 不能把两个SDK数字当同一版本迁移；以本地Builder实际字段和geometry为比较基准，保留显式保存材料 |
| Project 4.0保存 | source clone作为导出底稿；只合并限定的可作者节点和Overlay | Demo Project4.0 public adapter不是Builder自己的schema | 无损透传是保护规则，不应以全量schema parse或默认值写回代替展示adapter |

## Findings

### F1 — P1：合法公开构件类型保留但未转内部kind，因而漏过Demo渲染分发

Demo `src/domain/unified-project.ts:7-8` 的 `BUILDING_TYPES` 包含 Site/Building/Level/Wall/Door/Window/Item/Shelf/Slab/Ceiling/Column/Fence/Beam/Roof/RoofSegment/Stair/StairSegment/Guide/Spawn/Zone/Elevator，但不含DSphere已注册的Skylight、Scan、BoxVent、RidgeVent、Chimney、SolarPanel、Dormer等。`decodeUnifiedProject`只转换白名单类型（`src/domain/unified-project.ts:220-223`）；其它public PascalCase类型按原大小写留在内部。Demo scene分发检查lowercase类型（`src/three/PascalScenePreview.tsx:337-350`）；天窗屋面扣洞只匹配`entry.type === "skylight"`（`src/three/builder-geometry.ts:318`）。DSphere存在对应registry/definitions，例如`packages/nodes/src/skylight/definition.ts:23-31`、`packages/nodes/src/chimney/definition.ts:33-41`、`packages/nodes/src/solar-panel/definition.ts:16-24`。

例：Project节点 `{type:"Skylight", roofSegmentId:"roof-1", position:[0,0,0]}` 会保留在raw与导出JSON里，但不会转为`skylight`参加Demo renderer/roof cutter。Root已用decode→encode probe验证Skylight/Scan/BoxVent/RidgeVent/Chimney/SolarPanel/Dormer这7类均未normalize，且原节点保留1/1。建议加显式public-to-internal alias map及只读renderer dispatch；raw type保留，不支持时给节点级诊断。不要改变Project 4.0 source passthrough。

### F2 — P2：负标高Slab被Demo作为闭合实体挤出，与Builder凹池几何语义不同

Positive elevation几何范围在当前Builder和Demo相符。DSphere `packages/viewer/src/systems/slab/slab-system.tsx:79-112` 以正elevation向上挤出；负elevation走`generatePoolGeometry`，说明为底面Y=0(local)、内壁到`|elevation|`且没有顶部盖板（`:115-127`）。Viewer将negative mesh移到`y=elevation`（`:70-73`）。Demo `src/three/PascalScenePreview.tsx:337` 不区分pool模式，统一将polygon用Shape+holes Extrude成闭合实体（Surface构造见`:131-150`），负值时从`levelY+elevation`挤至Level平面；`src/domain/physical-positioning-surfaces.ts:174-183`也用普通earcut实体面/厚度近似。

例：`{type:"Slab", elevation:-0.2, polygon:[...]}`在两边显示范围相近，但Builder是向下的池底和内壁、Level平面敞口；Demo形成封顶的负标高实体。会影响从上往下的可见遮挡以及负Slab的实体交点/净距见证。建议只读显示层按符号选择pool几何并为物理表面标记开口语义。当前dsphere SlabNode只有`elevation`、没有`thickness`（`packages/core/src/schema/nodes/slab.ts:7-16`）；Editor 1.0.3新增独立厚度/顶标高规则不能被当作当前Builder缺口。

### F3 — P1：Door/Window raw节点缺width/height时，Demo统一取错默认值

Demo defaults出现在多个实际几何路径：开口mesh `src/three/PascalScenePreview.tsx:242-250`，墙CSG开洞`src/three/builder-wall-geometry.ts:104-108`，实体墙投影/碰撞`src/domain/physical-positioning-surfaces.ts:147-162`和Inspector `src/main.tsx:1447`全部采用width .9/height 2。当前DSphere schema Door为`.9 × 2.1`（`packages/core/src/schema/nodes/door.ts:45-52`），Window为`1.5 × 1.5`（`.../window.ts:25-34`）；放置工具也分别用默认`.9 × 2.1`、`1.5 × 1.5`（`packages/nodes/src/door/tool.tsx:150-154`、`window/tool.tsx:156-162`）。

例：合法Door `{type:"Door",width:undefined,height:undefined}`会在Demo得到`.9×2.0m`洞口/实体，而Builder schema解析默认`.9×2.1m`；Window会由预期`1.5×1.5`降成`.9×2.0`。建议统一调用按kind分支的view-only node defaults，让实体开口、mesh、碰撞/量距、Inspector都用同一解析值；不要将默认物化回源JSON。

### F4 — P1/P2：无height Wall/Ceiling在Demo高出当前Builder默认面200mm

Demo wall normal geometry/fallback使用2.7m（`src/three/PascalScenePreview.tsx:197-212`），物理定位mesh也使用2.7m（`src/domain/physical-positioning-surfaces.ts:136-151`）。Demo ceiling在3D放到`levelY+2.7`（`PascalScenePreview.tsx:338`）并在物理表面以2.7补高（`physical-positioning-surfaces.ts:174-183`）。当前DSphere Viewer `DEFAULT_LEVEL_HEIGHT=2.5`，`getLevelHeight`用Ceiling `height ?? 2.5`、Wall `height ?? 2.5`推层（`packages/viewer/src/systems/level/level-utils.ts:9,31-49`）；墙实际挤出也取`wallNode.height ?? DEFAULT_WALL_HEIGHT`，后者来自`packages/core/src/systems/wall/wall-footprint.ts:11`、调用见`packages/viewer/src/systems/wall/wall-system.tsx:482-495`。CeilingNode schema直接默认2.5（`packages/core/src/schema/nodes/ceiling.ts:8-18`）。

例：Project4中未写height的Wall或Ceiling在Builder显示2.5m，在Demo为2.7m；同层墙顶、梁碰撞、天花/楼板间距和视图接缝会不一致。建议只读adapter使用当前Builder default 2.5m，并统一几何/实体测距的解析入口。Demo Beam当前2.7m derived ceiling evidence是Beam专属合同，不能随墙/天花全局fallback一起改。

### F5 — P2：Demo通用Level高程按3.2m索引，DSphere按每层实际最高Wall/Ceiling高度堆叠

Demo `src/domain/building.ts:12-23`按排序Level index得`levelElevation=index*3.2m`；该值仍在Beam定位尺寸`src/domain/beam-routing.ts:24-31`和2D管线悬空分类`src/plan/ConduitPlan.tsx:34-55`中使用。3D Builder display adapter另用子节点推层高：`src/three/builder-display-transform.ts:26-43,69-89`。当前DSphere无Level height/baseElevation schema字段；其Builder `getLevelHeight`取Ceiling height或`wall meshY + wall.height`的最大值，缺省2.5m，再由LevelSystem累计前序层（`packages/viewer/src/systems/level/level-utils.ts:17-49`、`level-system.tsx:15-44`）。因此Demo的3D堆层接近同源公式，但Demo通用高程仍固定3.2m。

例：两层均只有缺省2.5m Wall/Ceiling时，Builder upper level baseY=2.5m；Demo Beam/线管楼层基准按level index会取3.2m（偏高0.7m）。会误分类悬浮虚线，且Beam尺寸局部world Y可能与建筑堆层不共面。建议抽一个适配器统一从同一nodes计算累积层高，Beam及Plan使用；保持每节点Level-local保存位置不动。Editor 1.0.3 `Level.height/baseElevation`不在当前DSphere Level schema，不列为当前问题，仅作为升级时的兼容需求。

### F6 — P1/P2：Item plan变换有一处墙面侧偏移方向相反；缺省尺寸和Ceiling vertical host需补齐

**墙侧plan位置：P1。** DSphere `packages/nodes/src/item/floorplan.ts:57-73`按wall center + side×thickness/2解item transform，之后在`:135-140`把wall-side footprint中心向wall方向偏`-depth/2`。Demo `src/geometry/transform.ts:18`同样先加wall side/thickness，之后却用`rotatePascalPlanVector(0,+dimensions.depth/2,rotationY)`作为中心偏移。两边采用同一clockwise旋转函数（Demo `transform.ts:6-7`; DSphere floorplan `:29-40`），故偏移符号相反。

例：wall-side Item `{position:[1,0,0], side:"front", asset:{attachTo:"wall-side", dimensions:[.2,.4,.2]}}` 的Demo plan中心相对墙面向外多偏约0.2m，Builder footprint中心朝墙退0.1m。Demo手工measurement snap也基于该Item plan矩阵（`src/geometry/manual-measurement.ts:20-34`），所以这会同时改变2D可见位置和测量吸附边。建议修正中心偏移方向并添加front/back测试。

**缺省尺寸：P2。** DSphere asset dimensions default `[1,1,1]`、item transform/scale default `[0,0,0]`/`[1,1,1]`（position/rotation/scale见`packages/core/src/schema/nodes/item.ts:78-105,117-133`）；`getScaledDimensions`统一用于空间计算（`:164-171`）。Demo `finalDimensions`仅读取raw `asset.dimensions`，缺失即null（`src/geometry/transform.ts:11-13`），2D组件直接不画且measurement不生成corners（`src/main.tsx:1331-1334`、`manual-measurement.ts:20-24`）；3D则以1m做显示fallback（`PascalScenePreview.tsx:54-57`），scene bounds又把缺省dimension按0计（`src/three/scene-input.ts:75-81`）。建议Adapter在副本上按DSphere Item schema materialize默认值，且让2D/3D/bounds/measurement共用结果。

**Ceiling-host：P2。** DSphere支持`asset.attachTo:"ceiling"`并将ceiling作为parent host（`item.ts:99-105,126-141`；move-tool `packages/nodes/src/item/move-tool.tsx:38-56`）。其2D plan按Level-local `[x,z]`投影，ceiling item也是可支持父级（`packages/nodes/src/item/floorplan.ts:15-17,115-121`）；mesh在Ceiling父级变换下展示。Demo `resolveItemVerticalRange`遇到ceiling parent直接返回`ceiling_elevation_unresolved`（`src/geometry/transform.ts:14`）；3D item渲染将error回退为`levelY + item.position[1]`，并不加ceiling node的height（`PascalScenePreview.tsx:342-344`）。例：`Ceiling.height=2.5`且子Item `position[1]=0`，Demo会把盒子放在Level平面附近而非天花宿主上。建议按Builder ceiling child transform合成其host Y，并让plan/3D/vertical range读取同一函数。

**Editor-only host扩展。** roofSegment/blockFace Item hosts以及Dormer/RoofSegment开口face hosts出现在`editor-main` 1.0.3 schema，不出现在本次基准dsphere Item/Door/Window schema中。因此它们属于未来SDK升级适配，不列为当前DSphere缺陷；迁移时需避免当前`unsupported_parent_transform`静默把face-local pose当世界坐标。

### F7 — P2：Demo hand-computed scene bounds漏算实际渲染构件

Demo `src/three/scene-input.ts:59-86`只按wall、slab/ceiling/zone、beam、item建立bounds；没有column、fence、stair、roof/roof-segment或skylight。可是当前Preview会渲染column/fence/stair（`PascalScenePreview.tsx:347-350`）、roof-segment和skylight（`:354,374-381`）；故只有这些外伸构件的场景仍使用其他主体估算center/span，创建的ground/layout plane及interaction bounds中心/尺寸会偏。Demo还把bounds用于PointerCapture半径与layout plane范围（`src/three/ThreeDWorkspace.tsx:118-134`）。DSphere editor对focus的具体注册对象用真实几何 `Box3.setFromObject`（`packages/editor/src/components/editor/custom-camera-controls.tsx:77-99,292-313`），但这不证明Builder有同样的全场景fit算法。建议将支持的实际几何外廓计入Demo bounds，至少补Column/Fence/Stair/Roof/Skylight tests；未知未来节点继续保持不虚构外廓。

### F8 — P3：Item Floorplan图片在Demo被拉伸，Builder默认等比contain

Demo crop helper分别计算X/Y比例并压到整个目标框，`src/geometry/floorplan-image-crop.ts:38-42`；`main.tsx:1345-1348`使用`preserveAspectRatio="none"`。DSphere `FloorplanImage`默认使用`xMidYMid meet`并注明letterboxing（`packages/editor/src/components/editor-2d/renderers/floorplan-geometry-renderer.tsx:168-220`、`packages/core/src/registry/types.ts:225-245`）；item floorplan产生的image尺寸是实际`width×depth`（`packages/nodes/src/item/floorplan.ts:176-187`）。

例：一张2:1图放入1:1 item footprint时，Demo拉伸为正方形，Builder按比例显示并留白。属于纯图像表现差异，不影响物理外廓、吸附或施工尺寸。建议采用Builder的等比contain默认；alpha裁边功能可以保留。

## 来源版本与Editor-only项

- Demo依赖`package.json:13-17`锁定`@pascal-app/core/viewer 0.9.2`；Demo node adapter和几何实现应以已验证的本地DSphere源码作行为基准，不能从SDK semver数字推断其等价。
- `editor-main` 1.0.3是后续代码线，不是本次用户指定的当前Builder。其Slab独立`thickness`、Ceiling follows-level/clamp和Level `height/baseElevation`不在DSphere本次schema（DSphere Slab `packages/core/src/schema/nodes/slab.ts:7-16`；Ceiling `:8-18`；Level `packages/core/src/schema/nodes/level.ts:18-42`）。这些字段应记为升级适配输入，不能说Demo偏离当前Builder。
- 当前`dsphere-main`支持Item wall/wall-side/ceiling attach、`wallT`，但不支持新的roof/block-face item host；当前Floorplan将Item旋转应用到 footprint，并直接使用`asset.floorPlanUrl`的width/depth box。

## 应保持的保护边界

`src/parser/schema.ts:1-5`与`src/parser/parse.ts:4-29`保持原始node/未知future字段，不给source节点补SDK defaults；`src/domain/unified-project.ts:210-224,304-320,434-437`以原始Project为导出底稿。显示层可以在clone上解析当前Builder defaults，但只可读；不要覆盖unknown node/field、稳定ID或源type。其他导入建筑保持只读，Beam仍是唯一建筑作者路径。Beam的explicit/derived elevation与证据字段由`src/domain/beams.ts:30,64-90`独立负责，不随一般level display fix改写。Editor-only字段只在明确升级适配时支持，不能为了当前parity写入Project 4.0。
