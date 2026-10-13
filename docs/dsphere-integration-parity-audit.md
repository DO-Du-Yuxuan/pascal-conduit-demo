# Conduit Demo 与 dsphere 整合差异审计

日期：2026-10-13。目的：找出共有能力在解析、参数解释、几何、渲染和编辑框架上的差异，为施工能力接入 dsphere 排序；这不是像素验收，也不是宣布两端实现等价。

## 基准与证据

- **主基准是本地 `dsphere-main` Builder**。它的 `packages/nodes/src/index.ts` 注册 27 个 built-in kind；节点覆盖以这个集合为准。
- `editor-main` 1.0.3 仅用于成熟实现和后续兼容性参考。新版 Level 的 `height/baseElevation`、Slab 的独立 `thickness` 等，不能倒推为当前 dsphere 已实现的合同。
- Demo 使用当前工作区，包括此前尚未提交的改造；Git HEAD 为 `947aa46`，不是全部改造的提交标识。dsphere 为本地源码工作树，未获取可用 Git 提交号。
- Demo 实际运行的依赖为 `@pascal-app/core/viewer 0.9.2`、Three 0.185；dsphere 是 `@dsphere/*` 工作区包、Three ^0.184；Editor 是 `@pascal-app/* 1.0.3`、Three ^0.186。函数名称相同不代表实现版本相同。
- 主任务和三位 Luna 子智能体分别检查数据/2D、建筑渲染、编辑框架。主任务复核了关键结论，纠正了把新版 Editor 参数当成当前 Builder 参数的推断，以及对 Site 与 ink 算法的误分类。
- 以整合样例临时加入七种 PascalCase 节点，运行真实 `decodeUnifiedProject → encodeUnifiedProject`：**七种类型在内部仍未规范化，七个原节点导出均保持不变**。临时诊断测试 1/1 通过，文件已移除。该证据证明解析分发缺口与原始数据保存是两件事；没有测试其实际渲染输出。
- 本次未启动浏览器、没有修改实现，未做所有参数组合的数值/几何/像素差分。下文明确区分源码已确认差异与需要差分实验的风险；不把既有 782 项功能测试当成与 Builder 的等价证明。

## 总判断

当前已对齐不少界面和手势，部分建筑算法也有复用或移植，但**共有节点的参数解释、几何生成和编辑框架仍未同源**。下一阶段应优先让共有建筑能力消费 dsphere 的同一套只读有效参数和纯几何实现，然后把 Demo 的施工工具接入宿主命令、事务和选择接口。继续逐个仿制外观会增加维护两套实现的成本。

现状可分成四类：

| 类别 | 代表能力 | 如何理解 |
| --- | --- | --- |
| 发布包函数复用 | 屋面生成器、Fence 生成器、Column 基础 primitive、墙材质解析 | 复用了函数，但来自 Pascal 0.9.2；还需与当前 dsphere 源码做版本和输出比较 |
| 本地移植/重建 | 墙 footprint/CSG、楼梯与栏杆路径、柱部件组装、天窗、ink | 有真实实现；复制后的默认值、更新路径、材质组和宿主上下文可能继续漂移 |
| 外廓代理/简化 | 门、窗、Shelf、Item | 门窗与 Shelf 仍缺参数化部件；Item 真实 GLB 延后是已确认范围 |
| 尚未接入 | Elevator、若干屋顶附件、Site polygon/boundary 等 | Raw 可以保存，不等于画布已经支持这些节点 |

## 优先差异清单

P1 表示应先解决的确定语义差异或整合必需接口；P2 表示其后需要补齐的几何/能力和维护风险；P3 表示当前尚需实验验证的视觉或性能差异。不是线上事故严重度。

| 编号 | 优先级 | 已确认的差异与影响 | 下一步 |
| --- | --- | --- | --- |
| A01 | P1 | Project 4.0 的 Site/Building/十系统/Drawing、公开 PascalCase 类型与 Builder 小写 SceneGraph 不是同一格式；Beam 与施工实体也没有对应的 built-in 注册 | 保留单一 Project 合同和稳定 ID，设计受控 codec 与节点插件映射；不能把原 JSON 直接塞入 Builder loader |
| A02 | P1 | `BUILDING_TYPES` 未列 Skylight/Scan/BoxVent/RidgeVent/Chimney/SolarPanel/Dormer，合法 4.0 源节点保留大写；小写渲染/cut 分支进不去 | 集中维护已知类型别名，保持 raw 未编辑值；测试导入、渲染分发和原样导出三个路径 |
| A03 | P1 | Demo 门窗只是盒体；Builder 有门框/门扇/窗格/窗台、多种门窗族及开合状态 | 复用当前 Builder 参数解析与纯 mesh factories，避免复制整套含 store 的 renderer/system |
| A04 | P1 | Demo 所有墙洞都是矩形；Builder 有 `openingKind` 与 arch/rounded cutters；Demo 可能把纯开口画成实物门窗 | 同一有效开口参数同时供门窗可见几何、墙切口、碰撞和量测使用 |
| A05 | P1 | Demo 门窗缺省 `.9 × 2m`；Builder Door `.9 × 2.1m`、Window `1.5 × 1.5m`；部分墙/天花 helper 默认 2.7m 与当前 Builder 2.5m 路径不同 | 建立只读有效参数解析，统一 2D、3D、CSG、Inspector、实体见证的默认值 |
| A06 | P1 | 目前 display transform、编辑高程、2D/实体 helper 分别计算层高与宿主坐标；Item wall-side 外廓中心偏移的正负号与 Builder 相反，Ceiling 子 Item 未合成宿主 Y；不同层高和宿主姿态有多套解释路径 | 明确 Level-local、Demo editing 和 Builder world 三种坐标的读写责任，集中转换，禁止迁移时重复加变换 |
| A07 | P1 | Demo 工作区快照/Overlay 与 Builder `useScene.temporal` 是不同事务源；工具 union/卡片也未成为 NodeDefinition 扩展 | 给施工命令和预览/提交建立宿主 Adapter，定义一次操作一次历史提交，避免双 undo 或双写 |
| A08 | P2 | Slab 正 elevation 在当前 Builder 本来就是挤出深度，不能按新版 Editor 的 thickness 判错；但负 Slab 的开放凹池、Site 地面扣洞，与 Demo 封闭实体/通用平面不同 | 复用当前 Builder slab/Site 纯几何，保留施工孔槽额外处理；新版 slab 合同另列兼容阶段 |
| A09 | P2 | Slab/Ceiling/门窗/Shelf proxy 未完整消费显式材质；纹理 loader 固定 RepeatWrapping，缺 Builder 的 rotation/flipY/channel/cache 等路径 | 复用材料解析与纹理属性配置，统一材质组、UV/UV2，再接主题选择 |
| A10 | P2 | Site polygon/boundary、Elevator、Shelf 参数化本体，以及 vents/chimney/dormer/solar-panel 未完整显示；屋顶切口只接入 skylight 路径 | 按 27-kind 覆盖表补接口和诊断；未知合法节点继续无损保存 |
| A11 | P2 | 墙曲线/拼接/内外面标签、Stair/rail 与 Column 部件是本地移植；Fence/Roof 来自不同版本发布包 | 对同一原始节点比较 bbox、关键端点、法线、材质组和宿主洞口；争取共享纯模块，减少长期维护双份算法 |
| A12 | P2 | 选择路径、事件 emitter、phase/tool、场景树层级和可见性与 Builder 不同；现在图层/眼睛同步只解决 Demo 内部状态一致 | 通过宿主选择/命令接口接入，保留源 visible、会话隐藏、渲染图层的独立意义 |
| A13 | P2 | Demo projection 切换以 `key={projection}` 重建 Canvas；首次 3D 是冷启动；相机 framing 的 source bounds 未覆盖全部新增参数几何 | 与宿主相机状态/边界接口统一，区分首帧调度修复、初始化成本和 fit 范围；性能需运行时测量 |
| A14 | P2/P3 | ink 基础算法已移植当前 Builder 同一 depth/normal 公式；差异在 WebGL targets 与 WebGPU/TSL MRT、缺 selection/hover outline，部分 buffer/色彩差异尚未实测 | 保留本期 WebGL决定，整合时接宿主后处理；不能通过另加三角网格边线冒充同源轮廓 |

关键源码锚点：

- 类型和文件接口：[unified-project.ts](../src/domain/unified-project.ts:7)、[Builder NodeRenderer](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/components/renderers/node-renderer.tsx:26)、[Builder NodeDefinition](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/registry/types.ts:524)。`NodeRenderer` 对未注册类型返回 null，系统容器也需要有递归/分发能力；不能只注册叶子施工对象。
- 门窗代理：[PascalScenePreview.tsx](../src/three/PascalScenePreview.tsx:242)；默认值：[Builder Door schema](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/schema/nodes/door.ts:51)、[Builder Window schema](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/schema/nodes/window.ts:33)。
- 原始保存与宿主加载不可互换：[Demo 编码](../src/domain/unified-project.ts:305)、[Builder setScene](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/store/use-scene.ts:588)。Builder loader 会执行迁移并清理孤立/不可达节点；其运行图不能无条件作为 Demo 未编辑原始文件的导出源。
- 工作区权限与事务：[workspace.ts](../src/domain/workspace.ts:99)、[Builder SceneApi](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/registry/scene-api.ts:39)。
- 层高映射：[builder-display-transform.ts](../src/three/builder-display-transform.ts:61)；Source bounds：[scene-input.ts](../src/three/scene-input.ts:60)。
- Site 与负板：[Builder SiteRenderer](/Users/dupanghu/Workspace/dsphere-main/packages/nodes/src/site/renderer.tsx:146)、[Builder pool geometry](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/systems/slab/slab-system.tsx:115)。
- 同公式 ink：[Builder ink-edges.ts](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/lib/ink-edges.ts:57)、[Demo BuilderInk.tsx](../src/three/BuilderInk.tsx:59)。

## 应保留的差异

以下不按缺陷处理：Demo 近距离与穿墙导航；只在 3D 创作、2D 保留施工图符号/颜色/尺寸/证据；本期 WebGL 按需渲染；阴影默认关闭；真实家具 GLB 后续接入；导入建筑只读、Beam 是明确例外；Project 4.0 与未知字段/稳定 ID 保留。后续整合应改变宿主 Adapter，而不是删除这些施工能力或绕过权限。

## 推荐推进顺序

1. **先统一有效参数与坐标解释。** 建立只读 `effective node/host frame` 接口，定义缺省值、别名、宿主、单位与错误输出。Raw Project 保存与解析副本分离。优先覆盖门窗、墙/天花高度、Item wall-side/ceiling 宿主、层高及真实几何 bounds。
2. **让门窗与宿主切口同源。** 从当前 dsphere 抽取纯生成器与 cut volume，供门窗可见几何、墙 CSG、施工实体见证共同使用；补 Slab/Ceiling/Shelf/Site 后再补屋顶附件。保留 Demo 的孔槽与失败诊断。
3. **用相同 fixture 做输出差分。** 27-kind 覆盖表中的函数复用不等于输出证明；按默认/显式参数、曲墙、arch/rounded/opening-only、负板、双平台/旋梯、Column cluster、Roof accessory、材质 UV 制定 fixture。比关键坐标、bbox、法线/组、洞口及只读保存，不靠源码字符串测试证明等价。
4. **最后接宿主编辑框架。** 为施工插件定义工具/选择/事务/预览接口，接入 Builder registry、Viewer camera/state 与 undo；迁移既有施工领域代码和 Drawing 证据，避免整页复制或建立另一份项目 authority。

## 详细检查附件

- [共有节点几何、材质与渲染覆盖](dsphere-parity-rendering-details.md)：27-kind 逐项、Door/Window、wall/CSG、Site/slab、Stair/Column/Fence、屋顶附件、UV/theme/ink。
- [解析、默认值、坐标与 2D](dsphere-parity-data-details.md)：当前 Builder 差异与 Editor-only 演进分别记录。
- [工具、状态、选择、历史及相机接口](dsphere-parity-interaction-details.md)：宿主接入方式、已对齐行为与保留约束。

该报告是当前源码快照的审计结果。没有据此修改实现或迁移旧项目；建议不是已完成行为，当前功能合同仍以 README、专题合同和可执行代码为准。
