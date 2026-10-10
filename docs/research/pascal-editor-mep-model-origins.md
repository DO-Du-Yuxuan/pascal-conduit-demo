# 新版 Pascal Editor 模型来源与插件入口

调研日期：2026-10-08。只读调查 `/Users/dupanghu/Workspace/editor-main` 与必要的 dsphere 对照；两名 gpt-6-luna / high 子智能体分别检查 MEP 和门窗调用链。应用代码未修改。用户称 EMP，本报告按源码菜单 MEP 解释。

## 门窗是否下载模型

普通参数门窗是在浏览器执行 Three.js 建模算法产生网格。门类型只是选择算法分支，尺寸和分格等字段是算法输入；不是由 doorType 查询门模型下载地址。

调用链：definition 注册 renderer/system → React renderer 建立占位 mesh 并注册引用 → dirty 节点触发 system → 从参数生成框、扇、玻璃、五金 → 渲染。改参数后更新几何，系统包含缓存和 dirty 生命周期，不等于每帧无条件重建整个场景。

- [门 definition](../../../editor-main/packages/nodes/src/door/definition.ts#L274)、[门 renderer](../../../editor-main/packages/nodes/src/door/renderer.tsx#L12)、[门 system bundle](../../../editor-main/packages/nodes/src/door/system.tsx#L8)。
- 实际建模：[addBox 创建 BoxGeometry](../../../editor-main/packages/viewer/src/systems/door/door-system.tsx#L277)、[updateDoorMesh](../../../editor-main/packages/viewer/src/systems/door/door-system.tsx#L2316)。
- 窗同样由 [updateWindowMesh](../../../editor-main/packages/viewer/src/systems/window/window-system.tsx#L3381) 按类型选择视觉构造函数。

新版另有显式 `node.source` 分支：脚本创建的门、窗、柱使用 source.artifact 和 manifest，转为 ScriptedModel 加载产物，保留其材质、交互/动画。这与普通参数门窗不同，不能将所有门窗一概称为无模型资产路径。[脚本产物加载](../../../editor-main/packages/nodes/src/shared/scripted-opening.tsx#L21)。

## MEP 的模型来源

本地入口为 Build → MEP，代码中 MEP tile 在 Advanced 区；其中有 Duct、Register、HVAC Unit、Lineset、Liquid Line、DWV Pipe，子菜单提供配件。[菜单](../../../editor-main/apps/editor/lib/build-palette.ts#L79)。

内置节点包括 6 类 HVAC/制冷节点（duct-segment、duct-fitting、duct-terminal、hvac-equipment、lineset、liquid-line）和 3 类 DWV 节点（pipe-segment、pipe-fitting、pipe-trap）。这些是 9 种节点类型，并非 9 个外部模型库。[注册清单](../../../editor-main/packages/nodes/src/index.ts#L126)。

查到的实际建模均为程序化几何：

- [管段](../../../editor-main/packages/nodes/src/pipe-segment/geometry.ts#L43)：路径逐段生成截面圆管。
- [管件](../../../editor-main/packages/nodes/src/pipe-fitting/geometry.ts#L36)：CylinderGeometry、RingGeometry、TubeGeometry 等生成承口与主体。
- [存水弯](../../../editor-main/packages/nodes/src/pipe-trap/geometry.ts#L24)：圆环和圆柱等生成。
- [HVAC 设备](../../../editor-main/packages/nodes/src/hvac-equipment/geometry.ts#L69)：盒体、圆柱等部件组合。

没有在这些 MEP 节点中发现 GLB 下载或厂家模型 URL 路径。定义里的 icon URL 是菜单图标；[管件缩略图 README](../../../editor-main/apps/editor/public/icons/fittings/README.md#L1) 明确这些图标由图像生成工具生成，再转成 WebP。二维缩略图不等于场景中的三维模型。

管件的一些外形尺寸来自经验公式：承口深度由端口距离及半径推算，支腿长度取至少 70 mm 或半径倍数。[承口尺寸](../../../editor-main/packages/nodes/src/pipe-fitting/geometry.ts#L42)、[支腿长度](../../../editor-main/packages/nodes/src/pipe-fitting/ports.ts#L6)。因此不能把外观精细视为厂商尺寸、承插深度与采购规格已经验证。

DWV 是排水/污水/通气系统；schema 的 PVC/ABS/cast-iron 和英寸尺寸不是中国 PVC 电工线管产品目录。当前内置注册和 MEP 菜单没有电气 conduit 或 86 底盒节点，相关 schema 也没有产品 SKU、厂家和采购绑定。该结论限于本地内置节点，不排除线上宿主另装插件或模型。

## 内置插件是什么，以及可点击网页

`@pascal-app/nodes` 导出 `builtinPlugin`，ID 为 `pascal:core`，把节点 schema、默认值、几何算法、渲染器、编辑工具、面板参数和系统注册给应用。可以理解成随 Pascal 提供的“构件功能包”，不只是静态模型集合。[包说明](../../../editor-main/packages/nodes/README.md#L16)。

- [Pascal 在线入口](https://editor.pascal.app/)：进入编辑器体验构件。
- [Pascal Next 展示](https://editor.pascal.app/next)：查看建筑内部与门交互。仓库 README 明确该展示体验不等同于开源发行版全部能力。
- [官方插件说明](https://editor.pascal.app/docs/developers/plugins)：介绍内置及额外插件。
- [公开源仓库](https://github.com/pascalorg/editor)：本地 LICENSE 明确 MIT。
- [内置构件目录](https://github.com/pascalorg/editor/tree/main/packages/nodes/src)：代码而非模型缩略图下载商城。
- [管件生成源码](https://github.com/pascalorg/editor/blob/main/packages/nodes/src/pipe-fitting/geometry.ts)：已在线核实可访问。

官方插件说明当前列出 Bones、Nature、Streetscape、Mint、Boots、Bloblins 六个宿主捆绑插件；这个清单不是核心节点类型清单。Plugins 面板的 Install 启用宿主已捆绑代码，并不从 GitHub/npm 实时下载并安装代码。

另有 [Bones 插件](https://github.com/pascalorg/plugin-bones)，官方 README 描述从建筑模型派生结构、电气、管道和暖通，可从生成构件输出 takeoff CSV；声明无外部网络请求，使用典型/近似值。它是不同于手动 MEP 节点的自动派生系统，不应直接视为国内 PVC 电工线管/86 底盒的厂家采购 BOM 库。若用户看到的是 X-Ray 自动系统，很可能指的是 Bones；当前没有用户画面证据，不能确定。

对于 conduit demo：可以借用或扩展这些公开几何算法和插件机制，但仍需绑定真实产品规格、连接口与计量规则。下载一个代码包可以获得建模能力；选择一种型号时是否加载模型文件，是该构件自己的渲染策略。
