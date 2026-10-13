# Demo 与 Dsphere Builder 交互框架对照

范围：只读对照 Pascal Conduit Demo 与本机 `dsphere-main` Builder 实现；`editor-main` 仅作为成熟参考，以下结论优先以 Dsphere 当前代码为准。未修改仓库文件，未运行浏览器或网络工具。该报告关注合并接口与迁移风险，不将已批准的 Demo 近距离穿墙、2D 施工表达只读、Demo 对导入节点只读等产品决定列为缺陷。

## 结论

Demo 目前是围绕单一 Project JSON 与施工 Overlay 搭建的宿主；Dsphere Builder 是由 `useScene`、`useViewer`、`useEditor`、节点注册表及事件总线组成的编辑框架。主要工作不是把一组控件直接搬过来，而是在宿主边界映射工具命令、层级选择、历史栈和视图状态。鼠标导航语义已基本对齐，树与可见性也有可复用的只读基础。

## 需要优先设计的接口

### P1 — 编辑状态和撤销历史必须经过宿主适配器

Demo 的页面状态、工程状态和 Overlay 历史分开持有：页面组件管理导入数据、选中对象、可见性、视图模式和 Builder 命令（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:201)、[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:220)）；Overlay store 用 Workspace 快照维护 `project`、`overlay` 与各自 dirty 状态（[store.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/domain/store.ts:54)、[workspace.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/domain/workspace.ts:99)）。Demo 的场景可见性另有独立撤销栈，而且撤销快捷键在页面级 capture 监听器内处理（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:358)、[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:396)）。

Dsphere 则把场景修改交给 `useScene.temporal`，撤销/重做后清空 live override 并标记全部场景节点 dirty（[history.ts](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/lib/history.ts:3)、[history.ts](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/lib/history.ts:13)）；编辑工具、phase、mode 在 `useEditor`，相机/选择在 `useViewer`（[use-editor.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/store/use-editor.tsx:125)、[use-editor.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/store/use-editor.tsx:206)、[use-viewer.ts](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/store/use-viewer.ts:25)）。

**根因与风险：** 两端的“撤销”含义不同。直接接入 Dsphere 全局 undo 会把 Demo 的工程树/Beam 编辑、施工 Overlay 和 session 隐藏操作混为一个历史源；页面 capture shortcut 与编辑器快捷键也可能双重处理。导入 Project 的只读策略要求源场景的历史继续受宿主控制。

**迁移方式：** 复用 Dsphere store 的交互状态模型和命令习惯，但给宿主加明确的 command/history adapter：按当前编辑上下文将撤销路由到 Demo Project（仅明确允许的 Beam）、施工 Overlay workspace、或 session 可见性历史。不要直接把 `useScene.temporal` 当成 Demo 的统一历史。

### P1 — 工具 registry 与 Demo 卡片/命令不是同一种扩展接口

Demo 的 Builder 工具是固定 union 与卡片数据，卡片锁约束工具、系统、设备类型（[builder-workbench.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/builder-workbench.ts:3)、[builder-workbench.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/builder-workbench.ts:15)）；页面通过 `ThreeDAuthorCommand` 把选择送给工作区（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:238)、[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:416)）。当前建造主栏只开放 Beam，其余建筑工具明确待 Builder 合并（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:594)）。

Dsphere 的 `NodeDefinition` 可提供 `tool`、`floorplan`、几何、系统及能力等扩展点（[types.ts](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/registry/types.ts:538)、[types.ts](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/registry/types.ts:581)、[types.ts](/Users/dupanghu/Workspace/dsphere-main/packages/core/src/registry/types.ts:624)）；`ToolManager` 根据当前 phase/mode/tool 从 registry 懒加载工具，再回退到尚未迁移的静态工具（[tool-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/tools/tool-manager.tsx:22)、[tool-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/tools/tool-manager.tsx:52)、[tool-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/tools/tool-manager.tsx:123)）。

**根因与风险：** Demo 卡片代表受限的业务流程入口，Dsphere registry 代表按节点类型注册的编辑能力；将 Demo 卡片直接转成 `tool` 会丢失 `catalogLock` 范围，将 registry 工具直接接入 Demo 又可能突破导入节点只读边界。

**迁移方式：** 保留 registry 为 Builder 能力来源。增加 adapter 将卡片意图映射为 registry tool/mode/节点 capability，并将 `catalogLock` 作为宿主授权约束单独传入；执行端仍须遵守 Demo 的 Project/Overlay 写入策略。registry 的 lazy component 与节点级贡献可直接复用，Demo 的卡片 schema 不建议复制进 core registry。

### P1 — 选择状态和 picking 路由需要统一桥接

Demo 主页面是单一 `selectedId`，同时清理尺寸、手动测量和 callout 选择状态（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:344)）；3D 场景的视觉节点直接调用 `onSelect`（[PascalScenePreview.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/PascalScenePreview.tsx:333)），Overlay 路由元素另有局部多选（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:391)）。Canvas 的未命中会清空所选对象（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:2376)）。

Dsphere `useViewer` 选择路径包含 building、level、zone 和多选 IDs，父级改变时会清理下级选择（[use-viewer.ts](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/store/use-viewer.ts:13)、[use-viewer.ts](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/store/use-viewer.ts:207)）。`SelectionManager` 按 phase 使用策略，支持 Ctrl/Meta 多选，并会按节点类型切换 phase/structure layer，再从统一事件 emitter 消费 node click 与 grid click（[selection-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/selection-manager.tsx:264)、[selection-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/selection-manager.tsx:284)、[selection-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/selection-manager.tsx:549)、[selection-manager.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/selection-manager.tsx:700)）。

**根因与风险：** Demo 的拾取入口分散在视觉组件、R3F `onPointerMissed` 和原生 Beam/参考面拾取器；Dsphere 则由 Viewer 事件加 SelectionManager 集中决策。若把 Builder 的 phase 策略直接嫁接到 `selectedId`，节点多选、楼层/区域父子清理及施工对象选择都会互相覆盖；导航手势也必须在所有拾取器前退出，否则可能触发清选或误放置。

**迁移方式：** 复用 Dsphere 的选择路径和策略分层，在 Demo 外围实现 `SelectionAdapter`，由它把 Viewer 的 `{buildingId, levelId, zoneId, selectedIds}` 转成宿主当前 selection，并把 `grid:click`/node pick 交给适配器。现有 `builderCanvasEvents` 的导航过滤与坐标变换可直接承担 R3F 边界；native picker 也应调用同一个导航事件判定。保持 Demo 的 2D 施工只读选择语义。

## 可复用实现及迁移约束

### P2 — SceneTree 与 SitePanel 展示的是不同的树语义；可见性需保持三态

Demo `SceneTree` 是通用、只读的源节点浏览器，树通过 `parentId` 建立，分别显示源 JSON 的 `visible`、session 隐藏和图层隐藏，并只为允许的节点提供隐藏/恢复入口（[SceneTree.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/ui/SceneTree.tsx:8)、[SceneTree.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/ui/SceneTree.tsx:55)、[SceneTree.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/ui/SceneTree.tsx:76)）。源可见性沿父链继承，不修改源数据；session hide 有独立历史（[scene-visibility.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/scene-visibility.ts:28)、[scene-visibility.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/scene-visibility.ts:40)）。3D 使用源可见性、session hide、Demo 图层、楼层过滤共同决定渲染（[PascalScenePreview.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/PascalScenePreview.tsx:328)）。

Dsphere `SitePanel` 面向可编辑 Site→Building→Level 工作流：从 root `Site` 列出建筑，再从建筑 children 列出楼层（[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx:1542)、[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx:1554)、[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx:895)）。其“结构/布置/空间”切换实际操作 phase 与 structureLayer（[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx:967)）；这不是 Demo 建筑类型可见性开关（Demo 的 3D building/system toggles 见 [ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:1287)）。

**根因与风险：** Dsphere SitePanel 是编辑层级/当前创作 phase，Demo SceneTree 是兼容未知未来节点且保护源 JSON 的检查器。将 SitePanel 的创建、删除、改名回调原样接到 Demo 会越过只读导入策略；把 Demo 图层开关映射到 Dsphere phase 会改变工具上下文而不只是显隐。

**迁移方式：** 可复用层级路径和活动楼层选择交互；第一阶段让 SitePanel 的变更回调转为只读/禁用，或封装 Project capability。保留 Demo 的源 `visible`、session hidden、render layer 三种独立状态，不把这些状态写回 `useScene` 或折叠成 Dsphere phase。

### P2 — 鼠标导航基本对齐；事件仲裁接口要继续共享

Demo `cameraMouseButtons` 是左键默认无动作、Space+左键屏幕平移、中键屏幕平移、右键旋转，透视滚轮 dolly/正交 zoom（[camera-navigation.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/camera-navigation.ts:19)）；`BuilderNavigation` 处理 Space focus guard、禁用视图时解除状态、blur 时取消 tracking（[BuilderNavigation.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/BuilderNavigation.tsx:75)）。`builderCanvasEvents` 在原生 DOM 仍可交给 CameraControls 的同时阻止导航手势进入 R3F picks，并可在拾取后还原编辑坐标 ray/hit（[camera-navigation.ts](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/camera-navigation.ts:107)）。

Dsphere 桌面鼠标映射与上述相同（[custom-camera-controls.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/custom-camera-controls.tsx:105)）；触控为单指默认旋转、交互工具激活时禁用单指相机、双指 pinch+pan、三指旋转（[custom-camera-controls.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/custom-camera-controls.tsx:122)）。2D floorplan 的右键拖拽明确 preventDefault、stopPropagation 并 capture pointer（[floorplan-panel.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/floorplan-panel.tsx:6756)）。

**根因与风险：** CameraControls 与 Dsphere Viewer 的事件通道天然分层；Demo 同时有 R3F 与原生拾取器，因此需要显式过滤同一手势，且不能用拦截 wheel 的方式阻断 CameraControls。空间快捷键、手势跟踪若跨多个 Canvas 共用模块级状态，未来 split/multi-canvas 同时活动时会需要 viewport scope。当前 Demo 一处 ThreeDWorkspace Canvas 的导航匹配是正向的；移动端复杂手势尚不等同于 Dsphere 的 tool-aware 触控策略。

**迁移方式：** 直接复用鼠标按钮语义、`isBuilderNavigationEvent` 和导航 guard。将 pointer tracking 状态按 Canvas/viewport scope 管理；触控策略适配 Demo 的活动工具与放置/绘制优先级。保留已批准的无限远/近距离相机策略，不复制 Dsphere 的 10–100 距离范围。

### P2 — 相机模式/预设适合映射到 Viewer 状态；Demo 投影切换会重建 Canvas

Demo 有自己的 projection、preset request 和 cameraRight state（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:257)），标准视角和投影控件由 ThreeDWorkspace 私有 UI 管理（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:1277)）。Canvas 使用 `key={projection}`，切换透视/正交会卸载重建 Canvas、camera、controls 和 GPU side resources（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:2376)）。`BuilderNavigation` 已接收 preset/presetRevision 并通过 `setLookAt(..., false)` 执行即时 preset（[BuilderNavigation.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/BuilderNavigation.tsx:136)）。顶部 toolbar 的 command 当前只声明 top preset（[ThreeDWorkspace.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/three/ThreeDWorkspace.tsx:238)）。

Dsphere 将 `cameraMode` 作为 Viewer store 状态（[use-viewer.ts](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/store/use-viewer.ts:34)），相机控制器根据正交/透视配置 wheel action，并从 camera-controls emitter 接收 top-view/orbit/view 命令（[custom-camera-controls.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/custom-camera-controls.tsx:105)、[custom-camera-controls.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/custom-camera-controls.tsx:335)）。

**根因与风险：** Demo 投影是 Canvas mount identity，而 Dsphere 投影是相机/Viewer 状态。合并两套相互独立状态会出现 toolbar 与 camera mode 不一致；Canvas remount 还会丢相机状态并重新创建 Ink/渲染资源。

**迁移方式：** 相机模式接入 Viewer cameraMode 的 adapter，预设接入统一 camera-controls command interface；保留 Demo 现有即时 view preset 和近距离行为。移除 `key={projection}` 前需改成 Canvas 内 camera 更新或投影专属 camera switch，确保切换不丢场景/Ink 资源。扩展 top-only command 为已支持的标准预设，不要求改变父层 author command 的其它语义。

### P2 — split 布局共享状态可借鉴，但 Demo 首次 3D 激活是一次性冷启动

Demo 页面管理 `workspaceViewMode`、`threeDActivated` 和 split ratio（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:220)）；只在 3D 首次激活后挂载 ThreeDWorkspace，之后 2D 隐藏时保留该工作区 DOM（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:587)）。`showBuilderTopView` 同时激活 3D、切换视图并发出 preset command（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:422)）。当前 Demo 只显示第一个 2D canvas（[main.tsx](/Users/dupanghu/Workspace/pascal-conduit-demo/src/main.tsx:400)）。

Dsphere `ViewerCanvas` memoized 并在内部订阅 viewMode/ratio，减少 Editor 父组件因分栏变化重渲染（[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/index.tsx:649)）；split 的 2D/3D 两侧都保持 mounted，通过 CSS 隐藏以保留 floorplan 与 WebGL context（[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/index.tsx:717)、[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/index.tsx:723)、[index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/editor/src/components/editor/index.tsx:744)）。其 Canvas 使用 `frameloop="never"`（[viewer/index.tsx](/Users/dupanghu/Workspace/dsphere-main/packages/viewer/src/components/viewer/index.tsx:183)）。

**根因与风险：** 两端均保留已创建的 3D context，但 Demo 的第一次顶视图/打开 3D 请求会与场景、Canvas、Shader/target 的首次创建竞争；这属于 cold-start 路径，不能归因于 `setLookAt(..., false)` 的相机过渡。Demo split UI 目前也是单一 2D viewport，不等价于 Dsphere 的完整多 viewport 状态。

**迁移方式：** 复用 ViewerCanvas 的 memoized view container 与 ratio store 订阅方式。若产品要求第一次顶视图即时响应，将 3D 初始化提前到数据就绪后的后台/隐藏 mount，或等 Canvas ready 后应用仍有效的最新 preset command；不要靠增加相机动画/改手势来掩盖冷启动。不同场景数/设备下的性能需再做运行时 profiling，本次静态对照不声称已量化帧率。

## 已对齐或不列为缺陷的行为

- 桌面 3D 鼠标手势与 Dsphere Builder 一致：默认左键不导航、中键平移、右键旋转、滚轮按 projection 缩放；Space+左键提供平移。2D 右键拖拽也符合 Dsphere floorplan。
- Demo 的 Project JSON 节点浏览、session 隐藏与保存数据分离是合并约束，不应通过 Dsphere SitePanel 的写操作绕过。
- Demo 近距离穿墙与 Dsphere 相机距离限制不同是明确批准的体验差异；不应复制 Builder 的最小/最大距离上限。
- Demo 当前 2D 施工图层为只读展示，不能把 Builder phase/tool 状态误当成 2D 写入授权。

## 检查范围

只对照上述本地源文件与行号；没有修改仓库实现，也没有运行构建/测试或浏览器。若后续更改任一引用文件，合并前应重新确认行号和行为。
