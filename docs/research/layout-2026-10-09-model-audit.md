# 2026-10-09 Pascal 导出模型逐节点审计

输入：[原始 JSON](/Volumes/DREAM-SHARE/layout管道门窗_2026-10-09.json)。输入 SHA-256：`99a5998900adf1124abbc32ac17e8a85ce9ca1a68a3bc5c1c9c500129bf674c0`。
审计范围：全部非墙体节点，结合本地 editor-main 渲染源码；不修改输入文件或应用代码。

## 已验证文件事实

59 个节点 = 2 面墙 + 3 个容器 + 54 个可见模型实体。54 个模型实体全部对应内置参数几何路径；没有发现 source、asset、artifact、GLB/glTF、HTTP 模型地址或嵌入几何缓存。此结论依据文件实例与当前本地渲染实现，不声称核验了线上部署版本或历史创作全过程。

| 类型 | 数量 | 来源判定 |
| --- | ---: | --- |
| `site` | 1 | 场景容器，不是模型资产 |
| `level` | 1 | 场景容器，不是模型资产 |
| `building` | 1 | 场景容器，不是模型资产 |
| `door` | 5 | 内置程序化几何 |
| `window` | 2 | 内置程序化几何 |
| `duct-fitting` | 5 | 内置程序化几何 |
| `duct-segment` | 4 | 内置程序化几何 |
| `duct-terminal` | 1 | 内置程序化几何 |
| `hvac-equipment` | 1 | 内置程序化几何 |
| `pipe-segment` | 11 | 内置程序化几何 |
| `pipe-fitting` | 12 | 内置程序化几何 |
| `pipe-trap` | 1 | 内置程序化几何 |
| `lineset` | 8 | 内置程序化几何 |
| `liquid-line` | 4 | 内置程序化几何 |

5 个门窗有 metadata.presetId：表示预设关联线索，不是外部模型地址；文件包含完整门窗参数。installedPlugins 列表存在六个插件 ID，但不能据此推出本文件使用了外部模型。materials 和 collections 均为空。

## 需要分开理解的细节

- 门框、门扇、玻璃、把手、轨道、车库门分板，均由所属 door/window 的参数生成，不是独立采购节点。
- 一套模型可有许多 mesh；BOM 应按业务实体和产品组成计量，不能按 mesh 数量计件。
- 尺寸单位混合：门窗/设备外形、世界位置、路径为米；风管截面、DWV 管径、制冷管径为英寸；旋转为弧度，管件 angle 为角度。
- 风管 shape=rect 时使用 width/height；同时存在的 diameter 是未启用截面参数，不表示还有另一根圆管。
- DWV 管径 diameter=2 是公称英寸字段；显示器直接换算直径约50.8mm，不能当作经过厂家核验的真实2英寸管外径。
- 风口 mount=floor，face 为300×150mm；圆形 collarDiameter=6英寸。内部框、叶片和承口由几何函数生成。
- furnace 外形为560×710×1100mm（宽×深×高），两个圆接口均为8英寸。无厂家型号/SKU。
- lineset 的 geometry 只按 suctionDiameter 生成一根铜管和可选保温；liquidDiameter 字段并不让它自动再绘制第二根。此文件另外有4个 liquid-line 实例。
- 本文件8个 lineset 全部保温开启；当前显示代码固定保温厚度10mm，此数值不在这些实例的保温厚度字段中。
- trap 的 armLengthM=0 不意味着没有出水臂；算法仍取半径倍数作为最小臂长。
- 管段关闭 autoHangers，不应把保留的 hangerStyle/Spacing 等字段当作已经生成吊架。缺省的 autoHangers 要按schema/渲染默认值解释，不能简单当true。
- 风管节点 material=flex，而三个弯头为sheet-metal；首段排水管和其第一个弯头为cast-iron，紧邻端盖为PVC，其余管段大多PVC。这些字段应独立用于后续BOM，不能按整条路线统称一种材质。
- 一个弯头 angle≈26.45777°，其余七个约90°；这能被算法显示，但不表示已经匹配到可购买的标准成品弯头。

## 门窗清单

| 实例 ID | 类型 | 宽×高 mm | 开启状态 | 细节 |
| --- | --- | --- | --- | --- |
| `door_6s82h1704v8750cy` | barn | 1000.000×2100.000 | 0 | 扇数1；轨道visible；轮廓rectangle；门槛False；把手True；闭门器False；逃生推杆False |
| `door_ux2x9boa56b9yvqu` | double | 1500.000×2100.000 | 0 | 扇数2；轨道none；轮廓rectangle；门槛True；把手True；闭门器False；逃生推杆False |
| `window_7oeci91tgogoyutk` | single-hung | 1500.000×1500.000 | 0 | 轮廓rectangle；横/竖分格[0.5, 0.5]/[0.5, 0.5]；窗台True |
| `window_3cdjelgyqr146vyi` | fixed | 1439.371×1500.000 | 0 | 轮廓rectangle；横/竖分格[1]/[1]；窗台True |
| `door_7u1kp65mfowrrujc` | hinged | 900.000×2100.000 | 0 | 扇数1；轨道none；轮廓rounded；门槛True；把手True；闭门器False；逃生推杆False |
| `door_bkjv6sa08ts8vv1d` | garage-rollup | 2700.000×2400.000 | 0.38 | 扇数1；轨道overhead；轮廓rectangle；门槛False；把手False；闭门器False；逃生推杆False |
| `door_unvu611sfqgdr7au` | garage-sectional | 2700.000×2400.000 | 0.38 | 扇数1；轨道overhead；轮廓rectangle；门槛False；把手False；闭门器False；逃生推杆False |

operationState=0为关闭端；两个车库门均为0.38，表示动画/操作进度，不能直接换算成38%的洞口净高。JSON内多对象name重复，应以稳定id识别。

## 路径和管件逐实例清单

下表长度为JSON折线路径长度，未计入配件弧线、承插、制造损耗、切割约束，也不是采购数量。

| 实例 ID | 子类型/材料 | 关键规格 | 折线路径长度 m |
| --- | --- | --- | ---: |
| `duct-fitting_yh83cyn8jb3aq5gp` | end-cap / flex | `{"shape":"rect","width":14,"height":8,"diameter":11.941642642883693,"diameter2":11.941642642883693,"angle":90}` | — |
| `duct-segment_82091zr2ya74vftf` | duct-segment / flex | `{"shape":"rect","width":14,"height":8,"diameter":6,"insulated":false}` | 1.620853 |
| `duct-fitting_77jg82iskvm67abl` | elbow / sheet-metal | `{"shape":"rect","width":14,"height":8,"diameter":11.941642642883693,"diameter2":11.941642642883693,"angle":90}` | — |
| `duct-segment_4qckokrvi4agb65f` | duct-segment / flex | `{"shape":"rect","width":14,"height":8,"diameter":6,"insulated":false}` | 2.741706 |
| `duct-fitting_i1o22ylpbxqbrsty` | elbow / sheet-metal | `{"shape":"rect","width":14,"height":8,"diameter":11.941642642883693,"diameter2":11.941642642883693,"angle":90}` | — |
| `duct-segment_zuomst6kh08u7p4r` | duct-segment / flex | `{"shape":"rect","width":14,"height":8,"diameter":6,"insulated":false}` | 0.241706 |
| `duct-fitting_842ut49pt6zz4tyr` | elbow / sheet-metal | `{"shape":"rect","width":14,"height":8,"diameter":11.941642642883693,"diameter2":11.941642642883693,"angle":90}` | — |
| `duct-fitting_vgxaxuezbn2z2u0v` | end-cap / flex | `{"shape":"rect","width":14,"height":8,"diameter":11.941642642883693,"diameter2":11.941642642883693,"angle":90}` | — |
| `duct-segment_qmdeteuvlqlhrpv1` | duct-segment / flex | `{"shape":"rect","width":14,"height":8,"diameter":6,"insulated":false}` | 0.120853 |
| `duct-terminal_w4fhn32dr3pnzlzo` | supply-register | `{"width":0.3,"depth":0.15,"mount":"floor","collarShape":"round","collarDiameter":6}` | — |
| `hvac-equipment_rtb7u9suzendj0mm` | furnace | `{"width":0.56,"height":1.1,"depth":0.71}` | — |
| `pipe-segment_orcog7rz0za4v4dd` | pipe-segment / cast-iron | `{"diameter":2}` | 2.495819 |
| `pipe-fitting_ye79dkn2y6x5wfdl` | end-cap / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-fitting_4mmgeeu6xdffl2rr` | elbow / cast-iron | `{"diameter":2,"diameter2":2,"angle":89.99999999999999}` | — |
| `pipe-segment_xcv3c8cz7mwes061` | pipe-segment / pvc | `{"diameter":2}` | 0.610726 |
| `pipe-fitting_j2sithca3hmddadt` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_m6fvk0wva14z22v2` | pipe-segment / pvc | `{"diameter":2}` | 0.193439 |
| `pipe-fitting_ukjtifbf0dj0jerf` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":26.45777008086786}` | — |
| `pipe-segment_2ntyb8gwai4976bc` | pipe-segment / pvc | `{"diameter":2}` | 0.366864 |
| `pipe-fitting_ykc7yc8uk17bqcyk` | end-cap / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-fitting_02z46toof56ahxui` | sanitary-tee / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_qpcl8ux488i36356` | pipe-segment / pvc | `{"diameter":2}` | 0.402507 |
| `pipe-segment_z6yprz70c4kazpul` | pipe-segment / pvc | `{"diameter":2}` | 0.860000 |
| `pipe-fitting_z5hk95qf1ya0zok5` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_67bl76al4g057wbf` | pipe-segment / pvc | `{"diameter":2}` | 1.360000 |
| `pipe-fitting_kdr7j675s7ullslb` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_4p77kwk47ggd92jq` | pipe-segment / pvc | `{"diameter":2}` | 0.860000 |
| `pipe-fitting_wpsfv1d0w2ouz3bb` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_5rg48pbva99nonj6` | pipe-segment / pvc | `{"diameter":2}` | 0.447823 |
| `pipe-fitting_827s1dn4rmoivjzt` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_oz6yqjbb9qpnrtbb` | pipe-segment / pvc | `{"diameter":2}` | 0.860000 |
| `pipe-fitting_69vmwsleu7sqeagz` | elbow / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-segment_dqpqipbe65lpwyq7` | pipe-segment / pvc | `{"diameter":2}` | 0.342177 |
| `pipe-fitting_xo8t4c51xxovb81l` | end-cap / pvc | `{"diameter":2,"diameter2":2,"angle":90}` | — |
| `pipe-trap_bt7tg6d2tpbpwnlz` | pipe-trap / cast-iron | `{"diameter":2,"armLengthM":0}` | — |
| `lineset_nmxb9bdze6pir80d` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 1.000000 |
| `lineset_xosmgtifc16q0puk` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 0.500000 |
| `lineset_4rj2qq8ky9pyrrqq` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 1.000000 |
| `lineset_5ugn4xwizclt6m5d` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 1.500000 |
| `lineset_nqoazchmylr10ar8` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 1.000000 |
| `lineset_05rsm5em19uh5p49` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 1.000000 |
| `lineset_89jml2yrwfurbr8w` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 0.500000 |
| `lineset_29j2a07hj04vzz4z` | lineset | `{"suctionDiameter":0.875,"liquidDiameter":0.375,"insulated":true}` | 1.000000 |
| `liquid-line_kvp3oi27739hqzro` | liquid-line | `{"diameter":0.375}` | 1.000000 |
| `liquid-line_70p78x1edocelerw` | liquid-line | `{"diameter":0.375}` | 0.500000 |
| `liquid-line_o0wi0iwqcubtmmn5` | liquid-line | `{"diameter":0.375}` | 1.000000 |
| `liquid-line_l5yhgofbzxc9jkc2` | liquid-line | `{"diameter":0.375}` | 1.118034 |

## 从 JSON 到实际几何的证据

以下路径均在本机 `/Users/dupanghu/Workspace/editor-main`，本报告相对链接可直接打开。

- [内置注册清单](../../../editor-main/packages/nodes/src/index.ts#L72)：这些节点对应内置 definitions；MEP 注册在126—136行。
- [门生成系统](../../../editor-main/packages/viewer/src/systems/door/door-system.tsx#L2316)、[窗生成系统](../../../editor-main/packages/viewer/src/systems/window/window-system.tsx#L3381)：有 source 时走另一分支；本文件所有门窗无 source，采用普通参数路径。
- [脚本门窗产物加载路径](../../../editor-main/packages/nodes/src/shared/scripted-opening.tsx#L27)：只有具有 source 的门、窗或柱才构造 artifact URL 并加载 ScriptedModel；本文件没有这类实例。
- [风管](../../../editor-main/packages/nodes/src/duct-segment/geometry.ts#L382)、[风管件](../../../editor-main/packages/nodes/src/duct-fitting/geometry.ts#L225)、[风口](../../../editor-main/packages/nodes/src/duct-terminal/geometry.ts#L36)。
- [排水管](../../../editor-main/packages/nodes/src/pipe-segment/geometry.ts#L43)、[管件承口](../../../editor-main/packages/nodes/src/pipe-fitting/geometry.ts#L36)、[存水弯](../../../editor-main/packages/nodes/src/pipe-trap/geometry.ts#L24)。
- [暖炉外壳](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L69)、[离心风机14片叶片](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L210)、[燃烧管与阀](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L262)、[燃气管](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L310)：内部细部仍由盒、圆柱、圆环生成，尺寸按系数/常量指定，不是厂商零件清单。
- [制冷吸气管与保温](../../../editor-main/packages/nodes/src/lineset/geometry.ts#L59)、[独立液管](../../../editor-main/packages/nodes/src/liquid-line/geometry.ts#L32)。

暖炉按本地代码显示的壳厚为 min(20mm,宽×0.04,深×0.04)，本实例为20mm；这只是程序的视觉构造规则，不能作为实际设备钣金厚度。风口显示框厚18mm、4片叶片，也不是文件输入的厂家百叶数据。存水弯直管臂取 max(半径×3.2,armLengthM)，本实例显示最小约81.28mm。缺省 autoHangers 在 schema 注释中明确表示关闭，所以11根排水管均不生成自动吊架。

## 预设标记与库的管理建议

本文件有5个门窗带 presetId，但本地开源包中没有发现按该字段下载门窗GLB的渲染路径。两个不同门（barn 与 rounded/hinged/glass）具有同一 presetId，说明当前实例可与原预设参数不同；该ID不能直接当作当前产品型号或采购凭证。由于云端预设记录不在这个JSON和本地开源快照里，无法仅凭文件确认该记录的原始缩略图、参数或发布信息。

可采用可配置构件目录，但把以下内容分开：

| 管理层 | 存储内容 | 非程序员看到的界面 |
| --- | --- | --- |
| 构件族 | 生成规则/程序与版本、参数说明、允许范围、接口、运动规则 | 平开门/卷帘门/PVC底盒/直接等分类卡片 |
| 规格预设 | 默认或已核验的参数组合、PNG/WebP、产品型号、计量规则、来源和版本 | 规格选择、尺寸表、材质选项、3D预览 |
| 项目实例 | 稳定对象ID、当前参数、位置、连接、操作状态、选用规格与版本 | 实际安装对象和属性面板 |

这是后续设计建议，不声称当前 Pascal 已提供完整产品库后台。生成器通常每个构件族共享一份，不需要给每个尺寸复制一份代码。GLB 可选作固定零件、某规格预览、缓存或发布产物；PNG/WebP 是缩略图；JSON/数据库表保存参数和产品数据。仅保存生成出的 GLB 会丢失重建所需的工程规则，必须同时保留可编辑源数据。

GLB不是天然静止：glTF/GLB支持部件变换动画、骨骼和形变；软件可驱动模型中分开的门扇旋转。标准文件不自动定义用户界面、参数约束、SKU规则或任意尺寸重建算法。[Khronos动画规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#animations)。参数化模型也不自动具备真实产品精度。可混合使用程序化框/管体与GLB固定五金，但需明确每部分的尺寸依据和连接规则。

若用于采购BOM，规格只能来自真实产品或明确标为待选型；用户改动导致超出产品规格时，应重新选型或标为定制件，不能保留原SKU假装仍是同一产品。JSON未记录生成器版本，后续库设计应考虑版本锁定，以免程序升级改变旧项目显示或计量。

## 完整非墙体实例字段

以下保留每个非墙体节点的全部字段，便于检查位置、旋转、宿主、预设关联、默认但未启用的字段。包含3个容器，合计57条。墙体字段按用户要求不展开。

### site_ol5d33k8fl7hebov

```json
{
  "id": "site_ol5d33k8fl7hebov",
  "type": "site",
  "object": "node",
  "polygon": {
    "type": "polygon",
    "points": [
      [
        -15,
        -15
      ],
      [
        15,
        -15
      ],
      [
        15,
        15
      ],
      [
        -15,
        15
      ]
    ]
  },
  "visible": true,
  "children": [
    "building_zgz2lmistq9ed58z"
  ],
  "metadata": {},
  "parentId": null
}
```

### level_efk4tz5b76ozr428

```json
{
  "object": "node",
  "id": "level_efk4tz5b76ozr428",
  "type": "level",
  "name": "Level 0",
  "parentId": "building_zgz2lmistq9ed58z",
  "visible": true,
  "metadata": {},
  "children": [
    "wall_ixeb9ulrullkp3dv",
    "wall_cc5vmkv8a73noih3",
    "duct-fitting_yh83cyn8jb3aq5gp",
    "duct-segment_82091zr2ya74vftf",
    "duct-fitting_77jg82iskvm67abl",
    "duct-segment_4qckokrvi4agb65f",
    "duct-fitting_i1o22ylpbxqbrsty",
    "duct-segment_zuomst6kh08u7p4r",
    "duct-fitting_842ut49pt6zz4tyr",
    "duct-fitting_vgxaxuezbn2z2u0v",
    "duct-segment_qmdeteuvlqlhrpv1",
    "duct-terminal_w4fhn32dr3pnzlzo",
    "hvac-equipment_rtb7u9suzendj0mm",
    "pipe-segment_orcog7rz0za4v4dd",
    "pipe-fitting_ye79dkn2y6x5wfdl",
    "pipe-fitting_4mmgeeu6xdffl2rr",
    "pipe-segment_xcv3c8cz7mwes061",
    "pipe-fitting_j2sithca3hmddadt",
    "pipe-segment_m6fvk0wva14z22v2",
    "pipe-fitting_ukjtifbf0dj0jerf",
    "pipe-segment_2ntyb8gwai4976bc",
    "pipe-fitting_ykc7yc8uk17bqcyk",
    "pipe-fitting_02z46toof56ahxui",
    "pipe-segment_qpcl8ux488i36356",
    "pipe-segment_z6yprz70c4kazpul",
    "pipe-fitting_z5hk95qf1ya0zok5",
    "pipe-segment_67bl76al4g057wbf",
    "pipe-fitting_kdr7j675s7ullslb",
    "pipe-segment_4p77kwk47ggd92jq",
    "pipe-fitting_wpsfv1d0w2ouz3bb",
    "pipe-segment_5rg48pbva99nonj6",
    "pipe-fitting_827s1dn4rmoivjzt",
    "pipe-segment_oz6yqjbb9qpnrtbb",
    "pipe-fitting_69vmwsleu7sqeagz",
    "pipe-segment_dqpqipbe65lpwyq7",
    "pipe-fitting_xo8t4c51xxovb81l",
    "pipe-trap_bt7tg6d2tpbpwnlz",
    "lineset_nmxb9bdze6pir80d",
    "lineset_xosmgtifc16q0puk",
    "lineset_4rj2qq8ky9pyrrqq",
    "lineset_5ugn4xwizclt6m5d",
    "lineset_nqoazchmylr10ar8",
    "lineset_05rsm5em19uh5p49",
    "lineset_89jml2yrwfurbr8w",
    "lineset_29j2a07hj04vzz4z",
    "liquid-line_kvp3oi27739hqzro",
    "liquid-line_70p78x1edocelerw",
    "liquid-line_o0wi0iwqcubtmmn5",
    "liquid-line_l5yhgofbzxc9jkc2"
  ],
  "level": 0,
  "baseElevation": 0,
  "height": 2.5
}
```

### building_zgz2lmistq9ed58z

```json
{
  "id": "building_zgz2lmistq9ed58z",
  "type": "building",
  "object": "node",
  "visible": true,
  "children": [
    "level_efk4tz5b76ozr428"
  ],
  "metadata": {},
  "parentId": "site_ol5d33k8fl7hebov",
  "position": [
    0,
    0,
    0
  ],
  "rotation": [
    0,
    0,
    0
  ]
}
```

### door_6s82h1704v8750cy

```json
{
  "object": "node",
  "id": "door_6s82h1704v8750cy",
  "type": "door",
  "name": "Door 4",
  "parentId": "wall_ixeb9ulrullkp3dv",
  "visible": true,
  "metadata": {
    "presetId": "item_N4xSHlr0EmGEQ91L"
  },
  "position": [
    0.9146611696293174,
    1.05,
    0
  ],
  "rotation": [
    0,
    3.141592653589793,
    0
  ],
  "side": "back",
  "floorThresholdVersion": 1,
  "wallId": "wall_ixeb9ulrullkp3dv",
  "width": 1,
  "height": 2.1,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "doorCategory": "interior",
  "doorType": "barn",
  "leafCount": 1,
  "operationState": 0,
  "slideDirection": "left",
  "trackStyle": "visible",
  "garagePanelCount": 4,
  "openingKind": "door",
  "openingShape": "rectangle",
  "openingRadiusMode": "all",
  "openingTopRadii": [
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.45,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "threshold": false,
  "thresholdHeight": 0.02,
  "hingesSide": "left",
  "swingDirection": "inward",
  "swingAngle": 0,
  "segments": [
    {
      "type": "panel",
      "heightRatio": 1,
      "columnRatios": [
        1
      ],
      "dividerThickness": 0.02,
      "panelDepth": 0.008,
      "panelInset": 0.025
    }
  ],
  "handle": true,
  "handleHeight": 1.05,
  "handleSide": "right",
  "contentPadding": [
    0.035,
    0.045
  ],
  "doorCloser": false,
  "panicBar": false,
  "panicBarHeight": 1
}
```

### door_ux2x9boa56b9yvqu

```json
{
  "object": "node",
  "id": "door_ux2x9boa56b9yvqu",
  "type": "door",
  "name": "Door 2",
  "parentId": "wall_ixeb9ulrullkp3dv",
  "visible": true,
  "metadata": {},
  "position": [
    2.487911699175302,
    1.05,
    0
  ],
  "rotation": [
    0,
    0,
    0
  ],
  "side": "front",
  "floorThresholdVersion": 1,
  "wallId": "wall_ixeb9ulrullkp3dv",
  "width": 1.5,
  "height": 2.1,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "doorCategory": "interior",
  "doorType": "double",
  "leafCount": 2,
  "operationState": 0,
  "slideDirection": "left",
  "trackStyle": "none",
  "garagePanelCount": 4,
  "openingKind": "door",
  "openingShape": "rectangle",
  "openingRadiusMode": "all",
  "openingTopRadii": [
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.45,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "threshold": true,
  "thresholdHeight": 0.02,
  "hingesSide": "left",
  "swingDirection": "inward",
  "swingAngle": 0,
  "segments": [
    {
      "type": "panel",
      "heightRatio": 0.4,
      "columnRatios": [
        1
      ],
      "dividerThickness": 0.03,
      "panelDepth": 0.01,
      "panelInset": 0.04
    },
    {
      "type": "panel",
      "heightRatio": 0.6,
      "columnRatios": [
        1
      ],
      "dividerThickness": 0.03,
      "panelDepth": 0.01,
      "panelInset": 0.04
    }
  ],
  "handle": true,
  "handleHeight": 1.05,
  "handleSide": "right",
  "contentPadding": [
    0.04,
    0.04
  ],
  "doorCloser": false,
  "panicBar": false,
  "panicBarHeight": 1
}
```

### window_7oeci91tgogoyutk

```json
{
  "object": "node",
  "id": "window_7oeci91tgogoyutk",
  "type": "window",
  "name": "Window 5",
  "parentId": "wall_ixeb9ulrullkp3dv",
  "visible": true,
  "metadata": {
    "presetId": "item_GKRAVNlfj8mFpvUV"
  },
  "position": [
    7,
    1.05,
    0
  ],
  "rotation": [
    0,
    3.141592653589793,
    0
  ],
  "side": "back",
  "floorThresholdVersion": 1,
  "wallId": "wall_ixeb9ulrullkp3dv",
  "width": 1.5,
  "height": 1.5,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "openingKind": "window",
  "windowType": "single-hung",
  "operationState": 0,
  "awningDirection": "up",
  "casementStyle": "single",
  "hingesSide": "left",
  "openingShape": "rectangle",
  "openingRadiusMode": "all",
  "openingCornerRadii": [
    0.15,
    0.15,
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.35,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "columnRatios": [
    0.5,
    0.5
  ],
  "rowRatios": [
    0.5,
    0.5
  ],
  "columnDividerThickness": 0.03,
  "rowDividerThickness": 0.03,
  "sill": true,
  "sillDepth": 0.08,
  "sillThickness": 0.03
}
```

### window_3cdjelgyqr146vyi

```json
{
  "object": "node",
  "id": "window_3cdjelgyqr146vyi",
  "type": "window",
  "name": "Window 2",
  "parentId": "wall_ixeb9ulrullkp3dv",
  "visible": true,
  "metadata": {},
  "position": [
    8.939096465076775,
    1.35,
    0
  ],
  "rotation": [
    0,
    0,
    0
  ],
  "side": "front",
  "floorThresholdVersion": 1,
  "wallId": "wall_ixeb9ulrullkp3dv",
  "width": 1.4393713847287692,
  "height": 1.5,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "openingKind": "window",
  "windowType": "fixed",
  "operationState": 0,
  "awningDirection": "up",
  "casementStyle": "single",
  "hingesSide": "left",
  "openingShape": "rectangle",
  "openingRadiusMode": "all",
  "openingCornerRadii": [
    0.15,
    0.15,
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.35,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "columnRatios": [
    1
  ],
  "rowRatios": [
    1
  ],
  "columnDividerThickness": 0.03,
  "rowDividerThickness": 0.03,
  "sill": true,
  "sillDepth": 0.08,
  "sillThickness": 0.03
}
```

### door_7u1kp65mfowrrujc

```json
{
  "object": "node",
  "id": "door_7u1kp65mfowrrujc",
  "type": "door",
  "name": "Door 4",
  "parentId": "wall_ixeb9ulrullkp3dv",
  "visible": true,
  "metadata": {
    "presetId": "item_N4xSHlr0EmGEQ91L"
  },
  "position": [
    4.560632197855554,
    1.05,
    0
  ],
  "rotation": [
    0,
    3.141592653589793,
    0
  ],
  "side": "back",
  "floorThresholdVersion": 1,
  "wallId": "wall_ixeb9ulrullkp3dv",
  "width": 0.9,
  "height": 2.1,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "doorCategory": "interior",
  "doorType": "hinged",
  "leafCount": 1,
  "operationState": 0,
  "slideDirection": "left",
  "trackStyle": "none",
  "garagePanelCount": 4,
  "openingKind": "door",
  "openingShape": "rounded",
  "openingRadiusMode": "all",
  "openingTopRadii": [
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.45,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "threshold": true,
  "thresholdHeight": 0.02,
  "hingesSide": "left",
  "swingDirection": "outward",
  "swingAngle": 0,
  "segments": [
    {
      "type": "glass",
      "heightRatio": 1,
      "columnRatios": [
        1
      ],
      "dividerThickness": 0.03,
      "panelDepth": 0.01,
      "panelInset": 0.04
    }
  ],
  "handle": true,
  "handleHeight": 1.05,
  "handleSide": "right",
  "contentPadding": [
    0.04,
    0.04
  ],
  "doorCloser": false,
  "panicBar": false,
  "panicBarHeight": 1
}
```

### door_bkjv6sa08ts8vv1d

```json
{
  "object": "node",
  "id": "door_bkjv6sa08ts8vv1d",
  "type": "door",
  "name": "Door 4",
  "parentId": "wall_cc5vmkv8a73noih3",
  "visible": true,
  "metadata": {
    "presetId": "item_IAr3n70DyDNQT509"
  },
  "position": [
    1.9916489777083584,
    1.2,
    0
  ],
  "rotation": [
    0,
    3.141592653589793,
    0
  ],
  "side": "back",
  "floorThresholdVersion": 1,
  "wallId": "wall_cc5vmkv8a73noih3",
  "width": 2.7,
  "height": 2.4,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "doorCategory": "garage",
  "doorType": "garage-rollup",
  "leafCount": 1,
  "operationState": 0.38,
  "slideDirection": "left",
  "trackStyle": "overhead",
  "garagePanelCount": 4,
  "openingKind": "door",
  "openingShape": "rectangle",
  "openingRadiusMode": "all",
  "openingTopRadii": [
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.45,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "threshold": false,
  "thresholdHeight": 0.02,
  "hingesSide": "left",
  "swingDirection": "inward",
  "swingAngle": 0,
  "segments": [
    {
      "type": "panel",
      "heightRatio": 1,
      "columnRatios": [
        1
      ],
      "dividerThickness": 0.02,
      "panelDepth": 0.008,
      "panelInset": 0.025
    }
  ],
  "handle": false,
  "handleHeight": 1.05,
  "handleSide": "right",
  "contentPadding": [
    0.04,
    0.04
  ],
  "doorCloser": false,
  "panicBar": false,
  "panicBarHeight": 1
}
```

### door_unvu611sfqgdr7au

```json
{
  "object": "node",
  "id": "door_unvu611sfqgdr7au",
  "type": "door",
  "name": "Door 4",
  "parentId": "wall_cc5vmkv8a73noih3",
  "visible": true,
  "metadata": {
    "presetId": "item_Z1ABmmdPH60bsimR"
  },
  "position": [
    5.534859326967387,
    1.2,
    0
  ],
  "rotation": [
    0,
    3.141592653589793,
    0
  ],
  "side": "back",
  "floorThresholdVersion": 1,
  "wallId": "wall_cc5vmkv8a73noih3",
  "width": 2.7,
  "height": 2.4,
  "constructionType": "framed",
  "dimensionReference": "nominal",
  "doorCategory": "garage",
  "doorType": "garage-sectional",
  "leafCount": 1,
  "operationState": 0.38,
  "slideDirection": "left",
  "trackStyle": "overhead",
  "garagePanelCount": 4,
  "openingKind": "door",
  "openingShape": "rectangle",
  "openingRadiusMode": "all",
  "openingTopRadii": [
    0.15,
    0.15
  ],
  "cornerRadius": 0.15,
  "archHeight": 0.45,
  "openingRevealRadius": 0.025,
  "frameThickness": 0.05,
  "frameDepth": 0.07,
  "threshold": false,
  "thresholdHeight": 0.02,
  "hingesSide": "left",
  "swingDirection": "inward",
  "swingAngle": 0,
  "segments": [
    {
      "type": "panel",
      "heightRatio": 1,
      "columnRatios": [
        1
      ],
      "dividerThickness": 0.02,
      "panelDepth": 0.008,
      "panelInset": 0.025
    }
  ],
  "handle": false,
  "handleHeight": 1.05,
  "handleSide": "right",
  "contentPadding": [
    0.04,
    0.04
  ],
  "doorCloser": false,
  "panicBar": false,
  "panicBarHeight": 1
}
```

### duct-fitting_yh83cyn8jb3aq5gp

```json
{
  "object": "node",
  "id": "duct-fitting_yh83cyn8jb3aq5gp",
  "type": "duct-fitting",
  "name": "End Cap",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {
    "automaticRunEndCapOwnerId": "duct-segment_82091zr2ya74vftf",
    "automaticRunEndCapEndpoint": "start"
  },
  "position": [
    1,
    0.1016,
    6.975
  ],
  "rotation": [
    0,
    1.5707963267948966,
    0
  ],
  "fittingType": "end-cap",
  "shape": "rect",
  "width": 14,
  "height": 8,
  "shape2": "rect",
  "width2": 14,
  "height2": 8,
  "angle": 90,
  "branchAngle": 90,
  "diameter": 11.941642642883693,
  "diameter2": 11.941642642883693,
  "ductMaterial": "flex",
  "system": "supply",
  "damperAngle": 0,
  "panelWidth": 0.25,
  "panelHeight": 0.15
}
```

### duct-segment_82091zr2ya74vftf

```json
{
  "object": "node",
  "id": "duct-segment_82091zr2ya74vftf",
  "type": "duct-segment",
  "name": "Trunk",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      1,
      0.1016,
      7
    ],
    [
      1.0000000000000002,
      0.1016,
      8.620852846088443
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "shape": "rect",
  "diameter": 6,
  "width": 14,
  "height": 8,
  "roll": 0,
  "ductMaterial": "flex",
  "seamDetail": false,
  "insulated": false,
  "insulationR": 0.5,
  "system": "supply"
}
```

### duct-fitting_77jg82iskvm67abl

```json
{
  "object": "node",
  "id": "duct-fitting_77jg82iskvm67abl",
  "type": "duct-fitting",
  "name": "Elbow",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    1.0000000000000002,
    0.1016,
    9
  ],
  "rotation": [
    -1.5707963267948966,
    0,
    -1.5707963267948966
  ],
  "fittingType": "elbow",
  "shape": "rect",
  "width": 14,
  "height": 8,
  "shape2": "rect",
  "width2": 14,
  "height2": 8,
  "angle": 90,
  "branchAngle": 90,
  "diameter": 11.941642642883693,
  "diameter2": 11.941642642883693,
  "ductMaterial": "sheet-metal",
  "system": "supply",
  "damperAngle": 0,
  "panelWidth": 0.25,
  "panelHeight": 0.15
}
```

### duct-segment_4qckokrvi4agb65f

```json
{
  "object": "node",
  "id": "duct-segment_4qckokrvi4agb65f",
  "type": "duct-segment",
  "name": "Trunk",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      1.0000000000000002,
      0.4807471539115572,
      9
    ],
    [
      1.0000000000000002,
      3.2224528460884425,
      9
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "shape": "rect",
  "diameter": 6,
  "width": 14,
  "height": 8,
  "roll": 3.141592653589793,
  "ductMaterial": "flex",
  "seamDetail": false,
  "insulated": false,
  "insulationR": 0.5,
  "system": "supply"
}
```

### duct-fitting_i1o22ylpbxqbrsty

```json
{
  "object": "node",
  "id": "duct-fitting_i1o22ylpbxqbrsty",
  "type": "duct-fitting",
  "name": "Elbow",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    1.0000000000000002,
    3.6016,
    9
  ],
  "rotation": [
    -3.141592653589793,
    0,
    -1.5707963267948968
  ],
  "fittingType": "elbow",
  "shape": "rect",
  "width": 14,
  "height": 8,
  "shape2": "rect",
  "width2": 14,
  "height2": 8,
  "angle": 90,
  "branchAngle": 90,
  "diameter": 11.941642642883693,
  "diameter2": 11.941642642883693,
  "ductMaterial": "sheet-metal",
  "system": "supply",
  "damperAngle": 0,
  "panelWidth": 0.25,
  "panelHeight": 0.15
}
```

### duct-segment_zuomst6kh08u7p4r

```json
{
  "object": "node",
  "id": "duct-segment_zuomst6kh08u7p4r",
  "type": "duct-segment",
  "name": "Trunk",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      1.0000000000000002,
      3.6016,
      8.620852846088443
    ],
    [
      1.0000000000000002,
      3.6016,
      8.379147153911557
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "shape": "rect",
  "diameter": 6,
  "width": 14,
  "height": 8,
  "roll": 0,
  "ductMaterial": "flex",
  "seamDetail": false,
  "insulated": false,
  "insulationR": 0.5,
  "system": "supply"
}
```

### duct-fitting_842ut49pt6zz4tyr

```json
{
  "object": "node",
  "id": "duct-fitting_842ut49pt6zz4tyr",
  "type": "duct-fitting",
  "name": "Elbow",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    1.0000000000000002,
    3.6016,
    8
  ],
  "rotation": [
    1.5707963267948966,
    0,
    -1.5707963267948966
  ],
  "fittingType": "elbow",
  "shape": "rect",
  "width": 14,
  "height": 8,
  "shape2": "rect",
  "width2": 14,
  "height2": 8,
  "angle": 90,
  "branchAngle": 90,
  "diameter": 11.941642642883693,
  "diameter2": 11.941642642883693,
  "ductMaterial": "sheet-metal",
  "system": "supply",
  "damperAngle": 0,
  "panelWidth": 0.25,
  "panelHeight": 0.15
}
```

### duct-fitting_vgxaxuezbn2z2u0v

```json
{
  "object": "node",
  "id": "duct-fitting_vgxaxuezbn2z2u0v",
  "type": "duct-fitting",
  "name": "End Cap",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {
    "automaticRunEndCapOwnerId": "duct-segment_qmdeteuvlqlhrpv1",
    "automaticRunEndCapEndpoint": "end"
  },
  "position": [
    1.0000000000000002,
    3.0766,
    8
  ],
  "rotation": [
    1.5707963267948968,
    -1.5707963267948966,
    0
  ],
  "fittingType": "end-cap",
  "shape": "rect",
  "width": 14,
  "height": 8,
  "shape2": "rect",
  "width2": 14,
  "height2": 8,
  "angle": 90,
  "branchAngle": 90,
  "diameter": 11.941642642883693,
  "diameter2": 11.941642642883693,
  "ductMaterial": "flex",
  "system": "supply",
  "damperAngle": 0,
  "panelWidth": 0.25,
  "panelHeight": 0.15
}
```

### duct-segment_qmdeteuvlqlhrpv1

```json
{
  "object": "node",
  "id": "duct-segment_qmdeteuvlqlhrpv1",
  "type": "duct-segment",
  "name": "Trunk",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      1.0000000000000002,
      3.2224528460884425,
      8
    ],
    [
      1.0000000000000002,
      3.1016,
      8
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "shape": "rect",
  "diameter": 6,
  "width": 14,
  "height": 8,
  "roll": 3.141592653589793,
  "ductMaterial": "flex",
  "seamDetail": false,
  "insulated": false,
  "insulationR": 0.5,
  "system": "supply"
}
```

### duct-terminal_w4fhn32dr3pnzlzo

```json
{
  "object": "node",
  "id": "duct-terminal_w4fhn32dr3pnzlzo",
  "type": "duct-terminal",
  "name": "Register",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    0,
    0,
    8.379147153911557
  ],
  "rotation": 0,
  "terminalType": "supply-register",
  "mount": "floor",
  "width": 0.3,
  "depth": 0.15,
  "collarShape": "round",
  "collarDiameter": 6,
  "collarWidth": 10,
  "collarHeight": 6
}
```

### hvac-equipment_rtb7u9suzendj0mm

```json
{
  "object": "node",
  "id": "hvac-equipment_rtb7u9suzendj0mm",
  "type": "hvac-equipment",
  "name": "Furnace",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    2.2640431307613675,
    0,
    8.379147153911557
  ],
  "rotation": 0,
  "equipmentType": "furnace",
  "width": 0.56,
  "depth": 0.71,
  "height": 1.1,
  "supplyShape": "round",
  "returnShape": "round",
  "supplyDiameter": 8,
  "returnDiameter": 8,
  "supplyWidth": 12,
  "supplyHeight": 8,
  "returnWidth": 14,
  "returnHeight": 8
}
```

### pipe-segment_orcog7rz0za4v4dd

```json
{
  "object": "node",
  "id": "pipe-segment_orcog7rz0za4v4dd",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      3,
      0.0254,
      9
    ],
    [
      2.9999999999999996,
      0.0254,
      6.50418058646718
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "cast-iron",
  "system": "waste"
}
```

### pipe-fitting_ye79dkn2y6x5wfdl

```json
{
  "object": "node",
  "id": "pipe-fitting_ye79dkn2y6x5wfdl",
  "type": "pipe-fitting",
  "name": "End Cap",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {
    "automaticRunEndCapOwnerId": "pipe-segment_orcog7rz0za4v4dd",
    "automaticRunEndCapEndpoint": "start"
  },
  "position": [
    3,
    0.0254,
    9.07
  ],
  "rotation": [
    0,
    -1.5707963267948966,
    0
  ],
  "fittingType": "end-cap",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_4mmgeeu6xdffl2rr

```json
{
  "object": "node",
  "id": "pipe-fitting_4mmgeeu6xdffl2rr",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    2.9999999999999996,
    0.0254,
    6.434180586467179
  ],
  "rotation": [
    3.141592653589793,
    -1.5707963267948966,
    0
  ],
  "fittingType": "elbow",
  "angle": 89.99999999999999,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "cast-iron",
  "system": "waste"
}
```

### pipe-segment_xcv3c8cz7mwes061

```json
{
  "object": "node",
  "id": "pipe-segment_xcv3c8cz7mwes061",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      2.9299999999999997,
      0.0254,
      6.434180586467179
    ],
    [
      2.3192739501800346,
      0.0254,
      6.434180586467179
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_j2sithca3hmddadt

```json
{
  "object": "node",
  "id": "pipe-fitting_j2sithca3hmddadt",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    2.2492739501800347,
    0.0254,
    6.434180586467179
  ],
  "rotation": [
    -3.141592653589793,
    0,
    -3.141592653589793
  ],
  "fittingType": "elbow",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_m6fvk0wva14z22v2

```json
{
  "object": "node",
  "id": "pipe-segment_m6fvk0wva14z22v2",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      2.2492739501800347,
      0.0254,
      6.364180586467179
    ],
    [
      2.2492739501800347,
      0.0254,
      6.1707414288181415
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_ukjtifbf0dj0jerf

```json
{
  "object": "node",
  "id": "pipe-fitting_ukjtifbf0dj0jerf",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    2.2492739501800347,
    0.0254,
    5.558234678290322
  ],
  "rotation": [
    0,
    1.5707963267948966,
    0
  ],
  "fittingType": "elbow",
  "angle": 26.45777008086786,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_2ntyb8gwai4976bc

```json
{
  "object": "node",
  "id": "pipe-segment_2ntyb8gwai4976bc",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      2.280461615751215,
      0.0254,
      5.495566269053928
    ],
    [
      2.4439135027133325,
      0.0254,
      5.167126497913492
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_ykc7yc8uk17bqcyk

```json
{
  "object": "node",
  "id": "pipe-fitting_ykc7yc8uk17bqcyk",
  "type": "pipe-fitting",
  "name": "End Cap",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {
    "automaticRunEndCapOwnerId": "pipe-segment_2ntyb8gwai4976bc",
    "automaticRunEndCapEndpoint": "end"
  },
  "position": [
    2.4751011682845125,
    0.0254,
    5.104458088677098
  ],
  "rotation": [
    0,
    1.1090211261481058,
    0
  ],
  "fittingType": "end-cap",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_02z46toof56ahxui

```json
{
  "object": "node",
  "id": "pipe-fitting_02z46toof56ahxui",
  "type": "pipe-fitting",
  "name": "Sanitary tee",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    2.2492739501800347,
    0.0254,
    6.100741428818141
  ],
  "rotation": [
    0,
    1.5707963267948966,
    0
  ],
  "fittingType": "sanitary-tee",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_qpcl8ux488i36356

```json
{
  "object": "node",
  "id": "pipe-segment_qpcl8ux488i36356",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      2.2492739501800347,
      0.0254,
      6.030741428818141
    ],
    [
      2.2492739501800347,
      0.0254,
      5.6282346782903225
    ]
  ],
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_z6yprz70c4kazpul

```json
{
  "object": "node",
  "id": "pipe-segment_z6yprz70c4kazpul",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      2.3192739501800346,
      0.0254,
      6.100741428818141
    ],
    [
      3.179273950180035,
      0.0254,
      6.100741428818141
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_z5hk95qf1ya0zok5

```json
{
  "object": "node",
  "id": "pipe-fitting_z5hk95qf1ya0zok5",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    3.2492739501800347,
    0.0254,
    6.100741428818141
  ],
  "rotation": [
    -1.5707963267948963,
    0,
    0
  ],
  "fittingType": "elbow",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_67bl76al4g057wbf

```json
{
  "object": "node",
  "id": "pipe-segment_67bl76al4g057wbf",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      3.2492739501800347,
      0.09540000000000001,
      6.100741428818141
    ],
    [
      3.2492739501800347,
      1.4554,
      6.100741428818141
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_kdr7j675s7ullslb

```json
{
  "object": "node",
  "id": "pipe-fitting_kdr7j675s7ullslb",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    3.2492739501800347,
    1.5254,
    6.100741428818141
  ],
  "rotation": [
    1.5707963267948966,
    1.5707963267948966,
    0
  ],
  "fittingType": "elbow",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_4p77kwk47ggd92jq

```json
{
  "object": "node",
  "id": "pipe-segment_4p77kwk47ggd92jq",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      3.3192739501800346,
      1.5254,
      6.100741428818141
    ],
    [
      4.1792739501800344,
      1.5254,
      6.100741428818141
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_wpsfv1d0w2ouz3bb

```json
{
  "object": "node",
  "id": "pipe-fitting_wpsfv1d0w2ouz3bb",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    4.249273950180035,
    1.5254,
    6.100741428818141
  ],
  "rotation": [
    -3.141592653589793,
    0,
    0
  ],
  "fittingType": "elbow",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_5rg48pbva99nonj6

```json
{
  "object": "node",
  "id": "pipe-segment_5rg48pbva99nonj6",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.249273950180035,
      1.5254,
      6.030741428818141
    ],
    [
      4.249273950180035,
      1.5254,
      5.582918243638736
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_827s1dn4rmoivjzt

```json
{
  "object": "node",
  "id": "pipe-fitting_827s1dn4rmoivjzt",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    4.249273950180035,
    1.5254,
    5.512918243638736
  ],
  "rotation": [
    1.5707963267948966,
    0,
    -1.5707963267948966
  ],
  "fittingType": "elbow",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_oz6yqjbb9qpnrtbb

```json
{
  "object": "node",
  "id": "pipe-segment_oz6yqjbb9qpnrtbb",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.249273950180035,
      1.4554,
      5.512918243638736
    ],
    [
      4.249273950180035,
      0.5954000000000002,
      5.512918243638736
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_69vmwsleu7sqeagz

```json
{
  "object": "node",
  "id": "pipe-fitting_69vmwsleu7sqeagz",
  "type": "pipe-fitting",
  "name": "Bend",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    4.249273950180035,
    0.5254000000000001,
    5.512918243638736
  ],
  "rotation": [
    -3.141592653589793,
    0,
    1.5707963267948968
  ],
  "fittingType": "elbow",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-segment_dqpqipbe65lpwyq7

```json
{
  "object": "node",
  "id": "pipe-segment_dqpqipbe65lpwyq7",
  "type": "pipe-segment",
  "name": "Drain",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.249273950180035,
      0.5254000000000001,
      5.4429182436387356
    ],
    [
      4.249273950180035,
      0.5254000000000001,
      5.100741428818141
    ]
  ],
  "autoHangers": false,
  "hangerStyle": "single",
  "hangerSpacing": 1.5,
  "hangerMaxReach": 2,
  "diameter": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-fitting_xo8t4c51xxovb81l

```json
{
  "object": "node",
  "id": "pipe-fitting_xo8t4c51xxovb81l",
  "type": "pipe-fitting",
  "name": "End Cap",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {
    "automaticRunEndCapOwnerId": "pipe-segment_dqpqipbe65lpwyq7",
    "automaticRunEndCapEndpoint": "end"
  },
  "position": [
    4.249273950180035,
    0.5254000000000001,
    5.030741428818141
  ],
  "rotation": [
    0,
    1.5707963057214724,
    0
  ],
  "fittingType": "end-cap",
  "angle": 90,
  "diameter": 2,
  "diameter2": 2,
  "cleanoutStyle": "end",
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### pipe-trap_bt7tg6d2tpbpwnlz

```json
{
  "object": "node",
  "id": "pipe-trap_bt7tg6d2tpbpwnlz",
  "type": "pipe-trap",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "position": [
    3.5257238395731605,
    0,
    5.530741428818141
  ],
  "rotation": 0,
  "diameter": 2,
  "pipeMaterial": "cast-iron",
  "armLengthM": 0
}
```

### lineset_nmxb9bdze6pir80d

```json
{
  "object": "node",
  "id": "lineset_nmxb9bdze6pir80d",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      5.5,
      0,
      5
    ],
    [
      4.5,
      0,
      5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_xosmgtifc16q0puk

```json
{
  "object": "node",
  "id": "lineset_xosmgtifc16q0puk",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.5,
      0,
      5
    ],
    [
      4.5,
      0,
      4.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_4rj2qq8ky9pyrrqq

```json
{
  "object": "node",
  "id": "lineset_4rj2qq8ky9pyrrqq",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.5,
      0,
      4.5
    ],
    [
      4.5,
      1,
      4.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_5ugn4xwizclt6m5d

```json
{
  "object": "node",
  "id": "lineset_5ugn4xwizclt6m5d",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.5,
      1,
      4.5
    ],
    [
      3,
      1,
      4.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_nqoazchmylr10ar8

```json
{
  "object": "node",
  "id": "lineset_nqoazchmylr10ar8",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      3,
      1,
      4.5
    ],
    [
      3,
      0,
      4.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_05rsm5em19uh5p49

```json
{
  "object": "node",
  "id": "lineset_05rsm5em19uh5p49",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      3,
      0,
      4.5
    ],
    [
      3,
      0,
      3.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_89jml2yrwfurbr8w

```json
{
  "object": "node",
  "id": "lineset_89jml2yrwfurbr8w",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      3,
      0,
      3.5
    ],
    [
      2.5,
      0,
      3.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### lineset_29j2a07hj04vzz4z

```json
{
  "object": "node",
  "id": "lineset_29j2a07hj04vzz4z",
  "type": "lineset",
  "name": "Lineset",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      -5,
      0,
      -0.5
    ],
    [
      -5,
      1,
      -0.5
    ]
  ],
  "suctionDiameter": 0.875,
  "liquidDiameter": 0.375,
  "insulated": true
}
```

### liquid-line_kvp3oi27739hqzro

```json
{
  "object": "node",
  "id": "liquid-line_kvp3oi27739hqzro",
  "type": "liquid-line",
  "name": "Liquid Line",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.5,
      0,
      7
    ],
    [
      4.5,
      0,
      6
    ]
  ],
  "diameter": 0.375
}
```

### liquid-line_70p78x1edocelerw

```json
{
  "object": "node",
  "id": "liquid-line_70p78x1edocelerw",
  "type": "liquid-line",
  "name": "Liquid Line",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      4.5,
      0,
      6
    ],
    [
      5,
      0,
      6
    ]
  ],
  "diameter": 0.375
}
```

### liquid-line_o0wi0iwqcubtmmn5

```json
{
  "object": "node",
  "id": "liquid-line_o0wi0iwqcubtmmn5",
  "type": "liquid-line",
  "name": "Liquid Line",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      5,
      0,
      6
    ],
    [
      5,
      1,
      6
    ]
  ],
  "diameter": 0.375
}
```

### liquid-line_l5yhgofbzxc9jkc2

```json
{
  "object": "node",
  "id": "liquid-line_l5yhgofbzxc9jkc2",
  "type": "liquid-line",
  "name": "Liquid Line",
  "parentId": "level_efk4tz5b76ozr428",
  "visible": true,
  "metadata": {},
  "path": [
    [
      5,
      1,
      6
    ],
    [
      6,
      1,
      5.5
    ]
  ],
  "diameter": 0.375
}
```
