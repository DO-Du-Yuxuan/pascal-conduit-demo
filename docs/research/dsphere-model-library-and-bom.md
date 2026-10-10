# DSphere Builder 构件模型与 BOM 调研

调查日期：2026-10-08。证据范围：本机 `dsphere-main` 快照与 `pascal-conduit-demo` 当前源码。没有修改应用代码。线上部署可能与快照不同；除一个匿名资产 HEAD 请求外，未验证线上管理后台。

## 结论

Builder 并非所有 node 都连接外部模型库。它有一个内置构件插件/注册体系，墙、楼板、天花板、门窗等主要由代码按参数生成几何；Item 才明确走 catalog-backed GLB。当前内置列表 28 个 node definition，不含管道、管件、底盒、电箱等施工节点。因此这里没有可以直接拿来使用的 MEP 专用模型库，也没有相应的产品选型/BOM接线。

- [内置插件和28个节点定义](../../../dsphere-main/packages/nodes/src/index.ts#L30)：源码注释说明新增 built-in 节点要增加文件夹及 NodeDefinition；实际列表在50—80行。
- [渲染分派](../../../dsphere-main/packages/viewer/src/components/renderers/node-renderer.tsx#L11)：自定义 React renderer 或纯 geometry builder。16—18行明确仅处理 `parametric` 模块形式的 renderer source；类型中出现 GLB 并不代表声明式 GLB renderer 已实现。Item 在这种 React renderer 内自行 useGLTF。
- [楼板定义](../../../dsphere-main/packages/nodes/src/slab/definition.ts#L36)：polygon/holes/elevation 参数，79行绑定 buildSlabGeometry。
- [墙几何](../../../dsphere-main/packages/viewer/src/systems/wall/wall-system.tsx#L545)：ExtrudeGeometry；[天花几何](../../../dsphere-main/packages/viewer/src/systems/ceiling/ceiling-system.tsx#L70)：多边形生成 ShapeGeometry。
- [供应选品页面](../../../dsphere-main/apps/web/app/[locale]/(app)/supply/page.tsx#L17)：ModulePlaceholder/comingSoon。需求计划与翻译中描述的采购/BOM目标不能作为已实现功能的证据。

## “几个库”、在哪里看、是否公开

围绕本次构件问题，区分三种概念：

1. 一个内置 node 插件 `dsphere:core`，28个节点类型，是代码库，不是28个模型资产库。入口是 `packages/nodes/src/index.ts`，每种构件的 schema/definition/geometry 或 renderer 在对应文件夹。
2. Item资产目录：`packages/editor/src/components/ui/item-catalog/catalog-items.tsx`，以及 `apps/web/public/items/`；不进一步做 Item 选型调查。Library/Community/Mine 是来源分类，不是已证明的三个独立存储库。[来源字段](../../../dsphere-main/packages/core/src/schema/nodes/item.ts#L78)；[目录fallback](../../../dsphere-main/packages/editor/src/components/ui/item-catalog/item-catalog.tsx#L43)。
3. Scan 是用户导入的参考网格，不是具有产品型号、接口和BOM语义的构件库。[Scan schema](../../../dsphere-main/packages/core/src/schema/nodes/scan.ts#L5)。

当前发现的 MEP 专用资产库数量为0。不能据此推断组织其他私有服务里也没有；这份快照没有它的接入证据。

硬编码目录有 Supabase `/storage/v1/object/public/items/` 地址。本次对其中 cactus/model.glb 发匿名 HEAD 返回200、content-type为model/gltf-binary、CORS允许*，证明这个样本可以公开读取；不证明整个目录可枚举、允许公共写入，或所有资产都有商业使用/再分发许可。未发现非Item模型库管理/上传/贡献入口。

## 能否添加与怎么调用

能够开发自己的构件及资产集合，但不是把GLB丢进现有公共库后就自动变成施工节点。

- 新节点开发：沿 `NodeDefinition`/`Plugin`/`loadPlugin` 路径接入 schema、默认参数、renderer或geometry、工具及能力。需要补充施工端口、规格和BOM规则，现有28类建筑节点没有这些MEP能力。
- 外部资产加载：[URL resolver](../../../dsphere-main/packages/viewer/src/lib/asset-url.ts#L3) 对https原样返回，对普通路径加 NEXT_PUBLIC_ASSETS_CDN_URL；异步resolver支持IndexedDB的asset://。[Item renderer](../../../dsphere-main/packages/nodes/src/item/renderer.tsx#L129) 是 `useGLTF(resolveCdnUrl(node.asset.src))`。这只是加载原理，不是现成施工节点调用API。同步Item路径不能直接解析asset://。
- Scan导入UI接受 `.glb/.gltf` 或图片，限制200MB，并依赖宿主上传回调。[上传UI](../../../dsphere-main/packages/editor/src/components/ui/sidebar/panels/site-panel/index.tsx#L435)、[回调注册](../../../dsphere-main/packages/editor/src/store/use-upload.ts#L14)。不应把Scan上传能力视为MEP库发布能力。
- Item资产描述包含src、dimensions、offset、rotation、scale等字段；没有证明它提供管接口兼容性、产品SKU或采购计量契约。

## Conduit Demo 当前情况

“手搓”准确地说是参数化生成，已拥有一定工程数据，但未绑定真实产品：

- [管段渲染](../../src/components/ConduitScene.tsx#L26)：半径diameterMm/2000，圆柱长度比端点距离额外加2mm，圆周12段；因此不可从渲染网格长度反推BOM。
- [管件渲染](../../src/components/ConduitScene.tsx#L31)：弯头/桥弯生成TubeGeometry；直接长度使用max(35mm,diameterMm×2)等经验公式，不是某厂商承插接头尺寸。
- [接线盒与设备渲染](../../src/components/ConduitScene.tsx#L36)：接线盒由sizeMm生成方盒；设备按类型生成简化几何。
- [默认规格](../../src/domain/devices.ts#L29)：插座/开关默认86×86×50mm，强电箱500×600×120mm等，为Demo默认值，不是经产品图纸确认的SKU规格。
- [端口](../../src/domain/devices.ts#L78)：底盒类按上下左右各两个槽位、横向比例±0.22生成端口；这不等于真实产品敲落孔的位置与规格。
- [数据类型](../../src/domain/overlay.ts#L38)：管段/管件/接线盒存diameterMm、sizeMm、位置、端口等，没有产品型号/资产版本/BOM产品绑定字段。
- [路径长度](../../src/domain/route-length.ts#L3)：直管计算中心线长度，sweep计算圆弧长度；[路由生成](../../src/domain/routing.ts#L74)已有stockLengthMm分段和直接生成。这是计量基础，仍需实际接头长度、插入深度、切割与采购规则。

## 面向后续BOM的建议契约（建议，非现有实现）

建议维护同一产品版本的三部分：产品规格记录、连接/计量数据、可视化资产。实例绑定productId+revision；显示和BOM共同读取同一个规格版本。

- 产品：品牌、型号/SKU、材质、规格、尺寸、采购单位、包装/定尺、来源图纸和版本。
- 接口：各端口局部坐标、轴向、口径、连接制式、插入深度、兼容产品/规格。
- 几何：校核后的参数几何或GLB、统一单位/朝向/原点、包围尺寸、简单碰撞体及安装净空。
- 计量：按个/米/根/套统计，现场弯管与购买弯头分别处理，明确是否包含底盒/面板/锁母；按对象ID去重。

固定离散件如底盒、直接、成品弯头、电箱可使用厂商CAD转出的GLB，也可以按已验证图纸参数化生成。连续管道更适合由中心线和真实截面参数生成；不应靠拉长一个含接头/纹理的固定模型替代任意长度管线。

推荐浏览器发布格式glTF2.0的GLB，自包含纹理优先；厂商RFA/IFC/STEP等可作为上游依据，当前代码没有它们作为施工构件的直接加载链。glTF规范定义右手坐标、Y向上、距离单位米：[Khronos规范](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#coordinate-system-and-units)。业务规格可用mm，导出时86mm应成为0.086m。必须明确安装基准/局部原点；不要依赖随意非等比缩放来匹配规格。

模型来源优先真实供应商图纸/CAD，确认资产使用条件。例：厂商[Legrand产品页](https://www.legrand.com/ecatalogue/en/catalog/products/flush-mounting-box-4-18-modules-3-phase-neutral-metal-ip41-grey-402516)提供产品型号与RFA BIM数据；这是存在厂商数据来源的例子，不代表它适合中国86底盒或项目选型。

### 底盒精度例子

“86型”不能直接当成每个产品实测外壳都是86×86×50mm。先选实际型号，确认外包尺寸/开口、安装基准、深度、壁厚、孔位/孔径、螺钉位置，以及底盒与面板是否两个采购件。外观可以省略螺纹、商标和不影响安装的小倒角；影响连接、碰撞、安装的轮廓和孔位必须跟规格一致。BOM按产品实例计数，不按网格数计数。

### 管道精度例子

规格中的公称口径、外径、内径不可混用。按SKU确认外径/壁厚/材质/定尺，路径由解析中心线确定。成品弯头要确认角度、中心到端面尺寸、承口与插入深度；现场弯管按实际弧长计入管长，不自动再采购一个成品弯头。采购根数不能在没有切割策略时简单等同ceil(总长/定尺)。

精度不存在GLB/BOM通用强制毫米指标。初期可把显示网格对规格几何的偏差≤0.5mm作为试行验收目标，接口数据严格来自图纸并记录其精度/公差；该目标只是软件显示建议，不能替代产品公差或施工验收要求。OD20mm圆管：若用规则内接多边形，12段最大径向误差约0.34mm，24段约0.086mm，32段约0.048mm。可先试24—32段，再根据大场景性能与近看效果优化；计量仍用解析几何，不用三角网格近似。

未解决的外部事实：组织是否已有另一套私有MEP目录、实际产品范围及供应商、实际线上部署与本地快照的差异。源码不能替代这些信息。
