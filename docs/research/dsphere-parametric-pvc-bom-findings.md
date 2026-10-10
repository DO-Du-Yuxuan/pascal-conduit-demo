# DSphere 参数化构件与 PVC 电工材料 BOM 调研

日期：2026-10-08。范围：本机 dsphere-main 与 conduit demo 源码，以及 Khronos glTF 官方规范。按用户要求不修改应用代码；由两名 gpt-6-luna / high 子智能体分别核查几何和库的扩展边界。用户确认优先支持 PVC 电工线管、86 底盒和配件。

## 已验证结论

- Builder 的一个内置插件 `dsphere:core` 实际注册 **27 种节点**，不含管道、管件和底盒。源码目录还包含 shared，不能把目录数当注册节点数。[注册清单](../../../dsphere-main/packages/nodes/src/index.ts#L46)。此前已有研究文件写的 28 个节点不能沿用，本次直接统计注册项确认 27。
- 墙、楼板、天花、柱、楼梯、围栏、门窗由代码按参数生成几何；Item 是另一种资产目录模式，本次没有深入调查 Item 库。[柱 renderer](../../../dsphere-main/packages/nodes/src/column/renderer.tsx#L3)、[围栏 builder](../../../dsphere-main/packages/nodes/src/fence/geometry.ts#L25)、[楼梯生成](../../../dsphere-main/packages/viewer/src/systems/stair/stair-system.tsx#L133)、[门重建](../../../dsphere-main/packages/viewer/src/systems/door/door-system.tsx#L1895)。
- 门窗的 schema 描述尺寸、操作类型、框、分格等；复杂参数面板由 customPanel 提供，提交后更新 node，几何系统重建。[门 schema](../../../dsphere-main/packages/core/src/schema/nodes/door.ts#L40)、[窗 schema](../../../dsphere-main/packages/core/src/schema/nodes/window.ts#L20)、[门面板接入](../../../dsphere-main/packages/nodes/src/door/parametrics.ts#L12)。
- 门动画逐帧插值交互状态并标记 dirty；窗动画可直接平移命名窗扇或旋转部件。这些建筑件的开合不依赖导入模型自带动画。[门动画](../../../dsphere-main/packages/viewer/src/systems/door/door-animation-system.tsx#L13)、[窗动画](../../../dsphere-main/packages/viewer/src/systems/window/window-animation-system.tsx#L31)。
- 新构件可通过 NodeDefinition 和 Plugin 注册 schema、参数、geometry/renderer、工具等。[定义接口](../../../dsphere-main/packages/core/src/registry/types.ts#L524)、[插件加载](../../../dsphere-main/packages/core/src/registry/registry.ts#L88)。默认外部插件发现返回空列表；并未发现可直接使用的第三方 MEP 模型商城。
- 通用 NodeRenderer 当前只接受 `renderer.kind: 'parametric'`。类型声明中的 glb/instanced-glb 不能当作已实现功能；若加载 GLB，现有可行实现路径是在自定义 React renderer 中调用 useGLTF。[实际分派](../../../dsphere-main/packages/viewer/src/components/renderers/node-renderer.tsx#L11)、[GLB 加载例子](../../../dsphere-main/packages/nodes/src/item/renderer.tsx#L130)。
- `.glb/.gltf` 的现有站点上传 UI 生成 scan 参考节点，并不自动生成带产品、端口与 BOM 的构件。[上传分流](../../../dsphere-main/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx#L435)。
- dsphere-main 快照没有 .git 和顶层 LICENSE，无法确认公开仓库地址、许可证和公共写入资格。Item 中的 public 存储 URL 不证明代码/资产允许再分发，也不证明有公共上传权限。本次没有对资产服务做写操作。

## Demo 的现状与 BOM 缺口

- 管段用圆柱生成，长度为端点距离加 2 mm，圆周 12 段；底盒按 sizeMm 生成盒体；直接接头长度为经验公式。这些是显示几何，不是产品厂家尺寸。[显示实现](../../src/components/ConduitScene.tsx#L26)。
- 插座/开关默认 86×86×50 mm，四边各两个端口，以横向比例 ±0.22 布置。这是 Demo 模板，并非已核验的真实底盒型号。[尺寸默认值](../../src/domain/devices.ts#L29)、[端口生成](../../src/domain/devices.ts#L78)。
- 已有稳定对象/端口 ID、管径、中心线、弧线和连接关系；当前类型没有产品型号、资产版本、承插深度等产品绑定。[数据结构](../../src/domain/overlay.ts#L36)。
- 直线和相切大弯已有解析中心线长度，路由也按 stockLengthMm 分段并创建直接。但它们尚不能等同采购 BOM 或完整下料方案。[长度函数](../../src/domain/route-length.ts#L3)、[定尺分段](../../src/domain/routing.ts#L74)。

## 面向 PVC、86 底盒的建议（非现有实现）

每个产品版本应拥有统一规格数据、连接与计量规则、可视化几何。实例绑定产品 ID 和版本，显示、碰撞、路由和 BOM 读取同一规格；继续保留 schema 4.0 Project JSON 的系统归属及稳定对象 ID，不另建 Overlay 导出文件。

产品规格包括品牌、型号、材质、尺寸、采购单位、定尺/包装、尺寸来源和版本。接口包括局部坐标、方向、真实孔径、连接方式、插入深度和兼容范围。不要从 GLB 网格数量、显示长度或视觉颜色反推产品与材料数量。

底盒、直接、锁母/盒接、成品弯头等离散件，可用经校核的参数化几何，也可用厂家 CAD 转 GLB。连续线管宜按真实外径、壁厚和中心线生成，不宜随意非等比拉伸固定模型。成品管件禁止借缩放把一个规格变成另一规格。

86 型应按实际选定型号核验外包尺寸、深度、开孔、安装基准及面板/底盒的采购拆分。PVC 管应确认规格含义、外径、壁厚、长度、等级与配套接头。现场弯管按弧长计管材，成品弯头按件计配件；不能把每个内部 elbow 节点都直接算作采购弯头。还要明确盒接/锁母、管卡、损耗等是否纳入第一版 BOM。

管段端点是端面、插入终点还是接口基准，必须先统一。举例：若两个承口入口端面间距为 1000 mm，且每端实际插入 15 mm，则管子理论切长为 1030 mm；这些数字仅说明计算关系，不是任何产品规格。定尺采购要根据各段切长、切割约束及余料策略计算，而非仅对总长取整。

浏览器资产建议采用 GLB / glTF 2.0，业务规格可用 mm，模型空间换算成 m；glTF 定义右手坐标系、Y 向上及米单位。[Khronos 官方规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)。模型需统一原点、安装方向和部件层级，校验尺寸/孔位，提供简化碰撞与安装净空数据。当前没有发现 STEP、RFA、IFC 直接成为 MEP 构件的加载路径；可作为上游来源，需转换并补业务数据。

精度分为产品数据、连接/计量、可视网格三个层面。产品与端口以厂家图纸及其公差为依据；计量采用解析数据；网格只负责足够准确地显示。不存在由 GLB 格式自动保证的施工精度。以外径 20 mm 的内接正多边形圆截面为例，12 段径向误差约 0.341 mm，24 段约 0.086 mm，32 段约 0.048 mm（r×[1−cos(π/n)]）。24—32 段可作为显示起点，最终需结合视距、实例数量与性能验证；这不是工程验收标准。

建议第一步选择一套真实供应商系列，先建立一种管径、一种底盒、一种直接与配套盒接的完整产品数据，再验证显示、连接、下料与 BOM 一致性。选型之前可以建立明确标为通用/待选型的产品族，不能把默认几何当作已确认采购型号。
