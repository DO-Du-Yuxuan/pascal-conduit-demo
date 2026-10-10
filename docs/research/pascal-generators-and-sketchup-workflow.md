# Pascal 几何生成器、JSON 参数与 SketchUp 工作流

日期：2026-10-09。范围：用户项目JSON、本地editor-main源码、用户供暖炉截图与官方SketchUp文档。只做研究，不修改应用代码。两名gpt-6-luna/high子智能体协助核查生成器清单和自定义模型工作流。

## 术语

读取/校验器读取JSON并校验字段；注册表按type查找构件定义；几何生成器根据参数创建形状；渲染器显示网格与材质；交互/动画系统更新部件。用户所称“解析器”覆盖了这几层，不应把它们混为一个只能加载模型文件的模块。

普通门窗不把每根框材起终点、把手顶点与全部面写入JSON。JSON存宽高、门型、框厚、分格、把手开关/位置等高层参数，生成器内存放装配规则和细部几何。截图中的灰外壳、蓝色离心风机、橙色燃气管、黑色控制面板对应furnace几何分支，部件仍是程序构造的。

## 用户文件中的实际字段摘选

下列片段从真实实例摘取，仅用于讲解，省略ID、父级和其他字段，不是完整可导入项目。所有path/position为米；这里的风管截面、管径字段为英寸，设备外壳宽深高为米；rotation通常为弧度，angle是度。

### 矩形风管

```json
{
  "type": "duct-segment",
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
  "shape": "rect",
  "width": 14,
  "height": 8,
  "ductMaterial": "flex",
  "insulated": false,
  "system": "supply"
}
```

### 矩形90度风管弯头

```json
{
  "type": "duct-fitting",
  "fittingType": "elbow",
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
  "shape": "rect",
  "width": 14,
  "height": 8,
  "angle": 90,
  "ductMaterial": "sheet-metal",
  "system": "supply"
}
```

### 排水管

```json
{
  "type": "pipe-segment",
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
  "diameter": 2,
  "pipeMaterial": "cast-iron",
  "system": "waste"
}
```

### 排水三通

```json
{
  "type": "pipe-fitting",
  "fittingType": "sanitary-tee",
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
  "diameter": 2,
  "diameter2": 2,
  "pipeMaterial": "pvc",
  "system": "waste"
}
```

### 供暖炉

```json
{
  "type": "hvac-equipment",
  "equipmentType": "furnace",
  "position": [
    2.2640431307613675,
    0,
    8.379147153911557
  ],
  "rotation": 0,
  "width": 0.56,
  "depth": 0.71,
  "height": 1.1,
  "supplyShape": "round",
  "returnShape": "round",
  "supplyDiameter": 8,
  "returnDiameter": 8
}
```

## 对应生成代码

- [门几何](../../../editor-main/packages/viewer/src/systems/door/door-system.tsx#L2316)、[窗几何](../../../editor-main/packages/viewer/src/systems/window/window-system.tsx#L3381)。
- [风管](../../../editor-main/packages/nodes/src/duct-segment/geometry.ts#L382)、[风管件](../../../editor-main/packages/nodes/src/duct-fitting/geometry.ts#L225)。
- [排水管](../../../editor-main/packages/nodes/src/pipe-segment/geometry.ts#L43)、[管件](../../../editor-main/packages/nodes/src/pipe-fitting/geometry.ts#L239)。
- [供暖炉外壳](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L69)、[风机](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L210)、[燃烧组件](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L262)、[燃气管](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L310)。
- [统一渲染分派](../../../editor-main/packages/viewer/src/components/renderers/node-renderer.tsx#L31)、[统一几何系统调用生成器](../../../editor-main/packages/viewer/src/systems/geometry/geometry-system.tsx#L238)。

供暖炉JSON中没有风机14片叶片逐片位置、燃烧管逐根几何、箱壳每块板的顶点。程序内用尺寸比例、固定数量、固定常量补出这些内容。它们不是独立采购节点，也不是经过厂商验证的内部工程模型。

程序化模型便于访问类型/参数/端口/中心线，但不自动提供物理仿真能力。供暖炉还需要额定功率、效率、性能曲线、运行工况；管网需要真实内径、粗糙度、局部阻力等计算数据。外观细部和计算参数应分别管理，并按真实产品版本绑定。

## 内置定义清单

本地builtinPlugin注册55种节点定义，不是55个独立JSON解析器；其中还包含容器、参考数据和外部模型加载路径。额外插件可继续注册类型，不能用本地55推断线上总数。

定义字段统计：19种有geometry、33种有renderer、21种有system；这些可以重叠。lean-to-extension同时有geometry和renderer。4种没有这三个字段：floor-opening、unit、construction-dimension、structural-grid；它们的开口、引用/标注/轴线等行为由其他能力和2D路径提供。unit是区域引用分组，明确不是场景容器。

| 序号 | 定义 | 源码 |
| ---: | --- | --- |
| 1 | `shelfDefinition` | [shelf](../../../editor-main/packages/nodes/src/shelf/definition.ts) |
| 2 | `blockDefinition` | [block/definition](../../../editor-main/packages/nodes/src/block/definition.ts) |
| 3 | `spawnDefinition` | [spawn](../../../editor-main/packages/nodes/src/spawn/definition.ts) |
| 4 | `wallDefinition` | [wall](../../../editor-main/packages/nodes/src/wall/definition.ts) |
| 5 | `separatorDefinition` | [separator/definition](../../../editor-main/packages/nodes/src/separator/definition.ts) |
| 6 | `floorOpeningDefinition` | [floor-opening/definition](../../../editor-main/packages/nodes/src/floor-opening/definition.ts) |
| 7 | `leanToExtensionDefinition` | [lean-to-extension](../../../editor-main/packages/nodes/src/lean-to-extension/definition.ts) |
| 8 | `fenceDefinition` | [fence](../../../editor-main/packages/nodes/src/fence/definition.ts) |
| 9 | `fenceGateDefinition` | [fence-gate](../../../editor-main/packages/nodes/src/fence-feature/definition.ts) |
| 10 | `fenceOpeningDefinition` | [fence-opening](../../../editor-main/packages/nodes/src/fence-feature/definition.ts) |
| 11 | `slabDefinition` | [slab](../../../editor-main/packages/nodes/src/slab/definition.ts) |
| 12 | `ceilingDefinition` | [ceiling](../../../editor-main/packages/nodes/src/ceiling/definition.ts) |
| 13 | `doorDefinition` | [door](../../../editor-main/packages/nodes/src/door/definition.ts) |
| 14 | `windowDefinition` | [window](../../../editor-main/packages/nodes/src/window/definition.ts) |
| 15 | `cabinetDefinition` | [cabinet](../../../editor-main/packages/nodes/src/cabinet/definition.ts) |
| 16 | `cabinetModuleDefinition` | [cabinet-module](../../../editor-main/packages/nodes/src/cabinet/definition.ts) |
| 17 | `itemDefinition` | [item](../../../editor-main/packages/nodes/src/item/definition.ts) |
| 18 | `proceduralItemDefinition` | [procedural-item/definition](../../../editor-main/packages/nodes/src/procedural-item/definition.ts) |
| 19 | `importedMeshDefinition` | [imported-mesh](../../../editor-main/packages/nodes/src/imported-mesh/definition.ts) |
| 20 | `columnDefinition` | [column](../../../editor-main/packages/nodes/src/column/definition.ts) |
| 21 | `elevatorDefinition` | [elevator](../../../editor-main/packages/nodes/src/elevator/definition.ts) |
| 22 | `unitDefinition` | [unit](../../../editor-main/packages/nodes/src/unit/definition.ts) |
| 23 | `roofDefinition` | [roof](../../../editor-main/packages/nodes/src/roof/definition.ts) |
| 24 | `roofSegmentDefinition` | [roof-segment](../../../editor-main/packages/nodes/src/roof-segment/definition.ts) |
| 25 | `stairDefinition` | [stair](../../../editor-main/packages/nodes/src/stair/definition.ts) |
| 26 | `stairSegmentDefinition` | [stair-segment](../../../editor-main/packages/nodes/src/stair-segment/definition.ts) |
| 27 | `zoneDefinition` | [zone](../../../editor-main/packages/nodes/src/zone/definition.ts) |
| 28 | `siteDefinition` | [site](../../../editor-main/packages/nodes/src/site/definition.ts) |
| 29 | `buildingDefinition` | [building](../../../editor-main/packages/nodes/src/building/definition.ts) |
| 30 | `levelDefinition` | [level](../../../editor-main/packages/nodes/src/level/definition.ts) |
| 31 | `guideDefinition` | [guide](../../../editor-main/packages/nodes/src/guide/definition.ts) |
| 32 | `scanDefinition` | [scan](../../../editor-main/packages/nodes/src/scan/definition.ts) |
| 33 | `measurementDefinition` | [measurement](../../../editor-main/packages/nodes/src/measurement/definition.ts) |
| 34 | `constructionDimensionDefinition` | [construction-dimension](../../../editor-main/packages/nodes/src/construction-dimension/definition.ts) |
| 35 | `structuralGridDefinition` | [structural-grid](../../../editor-main/packages/nodes/src/structural-grid/definition.ts) |
| 36 | `boxVentDefinition` | [box-vent](../../../editor-main/packages/nodes/src/box-vent/definition.ts) |
| 37 | `ridgeVentDefinition` | [ridge-vent](../../../editor-main/packages/nodes/src/ridge-vent/definition.ts) |
| 38 | `turbineVentDefinition` | [turbine-vent](../../../editor-main/packages/nodes/src/turbine-vent/definition.ts) |
| 39 | `cupolaDefinition` | [cupola](../../../editor-main/packages/nodes/src/cupola/definition.ts) |
| 40 | `eyebrowVentDefinition` | [eyebrow-vent](../../../editor-main/packages/nodes/src/eyebrow-vent/definition.ts) |
| 41 | `chimneyDefinition` | [chimney](../../../editor-main/packages/nodes/src/chimney/definition.ts) |
| 42 | `solarPanelDefinition` | [solar-panel](../../../editor-main/packages/nodes/src/solar-panel/definition.ts) |
| 43 | `skylightDefinition` | [skylight](../../../editor-main/packages/nodes/src/skylight/definition.ts) |
| 44 | `dormerDefinition` | [dormer](../../../editor-main/packages/nodes/src/dormer/definition.ts) |
| 45 | `gutterDefinition` | [gutter](../../../editor-main/packages/nodes/src/gutter/definition.ts) |
| 46 | `downspoutDefinition` | [downspout](../../../editor-main/packages/nodes/src/downspout/definition.ts) |
| 47 | `ductSegmentDefinition` | [duct-segment](../../../editor-main/packages/nodes/src/duct-segment/definition.ts) |
| 48 | `ductFittingDefinition` | [duct-fitting](../../../editor-main/packages/nodes/src/duct-fitting/definition.ts) |
| 49 | `ductTerminalDefinition` | [duct-terminal](../../../editor-main/packages/nodes/src/duct-terminal/definition.ts) |
| 50 | `hvacEquipmentDefinition` | [hvac-equipment](../../../editor-main/packages/nodes/src/hvac-equipment/definition.ts) |
| 51 | `linesetDefinition` | [lineset](../../../editor-main/packages/nodes/src/lineset/definition.ts) |
| 52 | `liquidLineDefinition` | [liquid-line](../../../editor-main/packages/nodes/src/liquid-line/definition.ts) |
| 53 | `pipeSegmentDefinition` | [pipe-segment](../../../editor-main/packages/nodes/src/pipe-segment/definition.ts) |
| 54 | `pipeFittingDefinition` | [pipe-fitting](../../../editor-main/packages/nodes/src/pipe-fitting/definition.ts) |
| 55 | `pipeTrapDefinition` | [pipe-trap](../../../editor-main/packages/nodes/src/pipe-trap/definition.ts) |

## 从 SketchUp 到可配置构件（建议流程）

1. 用SketchUp做准确参考模型：将壳体、盖板、孔口、固定五金、运动件拆成命名组件，设置单位/局部轴/安装基准。提供至少几个目标规格的尺寸或参考图，单个形状不能唯一确定变化规则。
2. 定义可变和固定规则：例如底盒宽/高/深、壁厚、孔位数量与位置规则；把“可自由改尺寸”与“只能选择已确认商品规格”分开。
3. AI或开发者据模型和尺寸资料编写参数化构造/部件装配规则；保留复杂固定小件网格也可以。当前没有证据表明导入SKP就会自动恢复建模历史并生成正确的Pascal参数化规则。
4. 根据目标接入：展示和可调尺寸对象可走现有authored-object脚本；要成为会自动接管、参与路由和专门BOM的施工构件，需要定义真实端口和领域数据，并注册专门节点或插件。
5. 在几种尺寸和极限状态下预览、测量、开合与接口检查，通过后发布为带版本的构件族；每种产品保存自己的规格预设和来源。
6. 用户通过卡片、缩略图、规格表、属性面板管理；不需要亲自维护生成代码。

[SketchUp官方Dynamic Components](https://help.sketchup.com/en/sketchup/making-dynamic-component)可以在SketchUp中用组件属性和公式定义变化，是描述规则的一种方式；当前没有查到其公式自动转换为Pascal规则的导入链。

## 模型及规则存在哪里

内置模型：程序/规则在节点代码包；项目JSON存type和实例参数。增加一个尺寸预设通常不增加一个新生成器。

自定义脚本模型：已有source.script、source.params、source.artifact、source.manifest。script是代码产物引用；params是输入；artifact是编译出的GLB；manifest是界面/放置等可同步读取的描述。代码和GLB由artifact store保存，项目JSON不内嵌代码。[现有合同](../../../editor-main/wiki/architecture/authored-objects.md#L9)、[编译并存储](../../../editor-main/packages/editor/src/lib/geometry-script/author.ts#L24)。改参数时重新运行脚本生成新的产物，浏览/发布时加载既有产物。

源码已有面向用户的参数滑块、开关和选项面板：[authored-params](../../../editor-main/packages/nodes/src/item/authored-params.tsx#L22)。本地MCP编译需要宿主启用，缺少脚本宿主时返回scripts_unavailable；不能假定每个安装版本已经启用该功能。另有procedural-item配方JSON和部件树，但它也不是从任意SKP网格恢复规则的转换器。

完整自定义构件插件：NodeDefinition包含schema、geometry/renderer、ports、工具、面板等，经Plugin注册。普通脚本对象并不自动获得DWV/电气路由和产品BOM语义；名称或metadata不能代替这些领域合同。
