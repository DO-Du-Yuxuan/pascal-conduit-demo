# Conduit Demo → dsphere 集成交接

**目标产品：** [DREAM-ONE-DEV/dsphere_builder](https://github.com/DREAM-ONE-DEV/dsphere_builder)

**读者：** dsphere_builder 工程团队和执行 agents；供需求方审核产品边界、建议和验收结果。
**目标：** 把 Pascal 施工管线 Demo 的施工编辑能力整合到 dsphere_builder。dsphere 继续拥有建筑、门窗、家具和资产；施工对象和图纸在同一 dsphere 项目中编辑、保存并重新打开。

## 交接基线与阅读顺序

本轮核对日期：**2026-10-15**；Demo 实现基线：`c08fb27`（`feat: add construction datums and floor positioning`）。接收方应记录实际拿到的 Demo commit、目标 dsphere commit 和验收用 JSON，后续变更按两端差异复核。本文件描述 Demo 已有能力和目标接入建议，**不表示 dsphere 已完成这些功能**；目标侧接口、schema 和 UI 挂载点仍需接收团队在其固定版本上确认。

建议先读本页的系统清单、数据与坐标约束、验收清单，再沿 [README](../README.md) 和专题合同进入代码。交付应包含完整源码、`package.json` / `package-lock.json`、`docs/` 与测试，而不是只交界面截图或构建后的 `dist/`。代码入口是内部模块，当前没有可直接安装进 dsphere 的完整施工插件或稳定 SDK。

## 产品范围

以下保留目标集成的范围建议；实现与排期由接收团队确定。Demo 的当前实现范围以下文系统表和专题合同为准：

- 建议首期最终验收覆盖当前 Demo 的**全部施工编辑功能**，包括点位、管线、HVAC、施工图、Beam、施工基准与完成面；具体清单以 Demo 当前 README 和可执行代码为准。实现可以分阶段，最终交付覆盖全量功能。
- 建议施工设备、路由和可编辑图纸与建筑一起保存在同一份 dsphere 项目 JSON 中。导出后再次导入，用户能恢复项目并继续编辑。
- 建议将 Beam 创建和编辑纳入首期，由 dsphere 的建筑工具和建筑数据模型承接，Demo Beam 行为作为参考。
- 建议首期导出单一 JSON，其中包含可编辑的施工和图纸数据；PDF 或图片导出不在本轮首期范围内。临时手工测量留在当前会话，不写入项目。

## 四个整合边界

| 边界 | dsphere_builder 提供/负责 | Demo 提供/已实现 | 建议接法 | 验收重点 |
| --- | --- | --- | --- | --- |
| **UI 与 Viewer** | 编辑器页面和统一 UI 语言；建筑/资产 Viewer；选择、相机、视图状态；目标节点可见性与视图显隐机制；ActionMenu、左侧面板和选中对象 Inspector。 | 底部主栏“系统”入口及系统子栏；固定左栏中的系统工具/参数卡；选中对象后的右侧浮动属性面板；3D 建筑和十个系统的图层显隐。Demo 设计工作区提供操作流程参考。 | 建议在目标底部 ActionMenu 增加“系统”入口，左侧 Scene/Items/Settings 面板按目标布局承载系统工具与参数；选中对象沿用目标现有 Inspector。沿用目标可见性/视图显隐交互，并新增施工系统分组显隐。统一使用 dsphere UI 语言。 | 建筑、门窗、家具和资产仍由目标 Viewer 正常操作/显示；施工工具、参数与 Inspector 符合目标布局；施工系统分组显隐可用，且与对象可见性、视图状态正确配合。 |
| **施工数据与保存** | Building、门窗、家具和资产节点；项目 JSON 的打开、保存和重开流程。 | Project JSON 中 Site、Building、system、Drawing 的结构，稳定节点/端口 ID 和跨节点引用；施工对象、连接、宿主与图纸数据。 | 以 Demo 的 Site/Building/system/Drawing 层级及 ID/引用关系作为目标项目施工数据的参考与复用起点，将建筑和资产保留在 dsphere 原有节点/服务。明确施工节点映射、序列化/校验、版本演进、未知字段保留和失败回滚。 | 同一项目 JSON 保存建筑、施工对象和可编辑 Drawing；重开后可继续编辑；建筑/资产字段及节点 ID、端口、宿主、连接、图纸来源引用保持；反复往返无静默丢失。 |
| **几何与路由** | 建筑坐标和单位；墙、洞口、楼板、天花、梁的宿主几何、表面命中与碰撞查询；资产外形；Beam 的建筑工具和数据模型。 | 设备端口、逐点路由、正交约束、吸附、碰撞/净空规则、HVAC 行为；Beam 创建/编辑、施工基准和完成面定位行为参考。 | 将 Demo 路由规则适配到目标建筑几何与工具接口，保留逐点确认及明确连接语义。Beam 在目标建筑工具和模型中实现，并提供施工对象所需宿主查询。 | 覆盖墙/洞口、楼板、天花和梁；验证吸附、端口连接、正交路由、碰撞拒绝及设备移动后的连接处理；Beam 在目标模型中创建/编辑并保存重开，宿主关系符合约定。 |
| **图纸与测量** | 项目 JSON 导入/导出和重开；项目建筑几何；目标图纸导出流程。 | Drawing 标注、尺寸、来源关系和布局；显式/派生测量依据、假设、置信度；会话内手工测量行为。 | 将可编辑 Drawing 数据与建筑、施工对象保存在同一项目 JSON；保留 source object IDs 和测量证据，几何改变时按规则更新派生值。临时手工测量仅留在会话内。 | 重开后图纸布局和记录可继续编辑；依据、假设、置信度和来源 ID 一致；几何改变只更新受影响的派生值；临时手工测量不写入 JSON。 |

## 整合样例

样例文件：[dsphere-builder-integration-sample.json](examples/dsphere-builder-integration-sample.json)。这是用于整合验证的项目样例，文件按原始字节复制，SHA-256 为 `703a6c39c077ca483ef9b63b055e388793291df14db511827925afe3af2cf7f9`。样例不作为 Demo 生产资产目录或公共类型清单。

验证时至少检查：

1. dsphere 能打开样例中的 Building、门窗、家具和资产引用；家具模型由 dsphere 资产体系加载。
2. 无修改导入、保存、重开后，建筑 ID、施工 ID、端口/宿主/连接关系、图纸来源 ID 和关键建筑/资产字段保持。
3. 施工对象可在 dsphere 中继续创建和编辑，结合新增验收副本覆盖点位、管线、HVAC、施工图、Beam、施工基准与完成面。
4. Drawing 数据与建筑、施工对象同处一个 JSON，布局和来源证据仍可编辑；临时手工测量没有被保存。

Demo 对样例的既有检查发现 682 个节点组成完整可达的父子树，解码/编码往返后节点 ID 集合及 `pascalConduitProjectId` 保持。该检查说明源样例内部结构可往返，目标项目仍需独立完成上述验收。

### 样例覆盖边界

本轮重新核对原样例 SHA-256 与上值一致，`schemaVersion` 为 4.0，682 个节点均从根可达。该样例有建筑、设备、管线、Drawing 和 5 根 Beam，但 **没有 `constructionDatums`、`finished-floor` 挂载，也没有新墙顶支承梁的 `topElevation` 字段**；它不能独自证明新增能力集成成功。原样例保持原字节，新增能力请在副本中通过作者工具创建后另存验收文件，并记录来源 commit；不依赖个人 `/Volumes/...` 路径。

## Demo 已有约定与跨项目工程决策

### Demo 已解决、可直接参考的语义

- 单个 Project JSON 承载建筑、十个系统容器和 Drawing；Overlay 是 Demo 的内部编辑快照。
- 节点和端口使用稳定 ID，跨系统连接、宿主、图纸来源通过 ID 引用；Drawing 保存可编辑的尺寸/标注布局和测量证据。
- 建筑及资产由原 Project 数据保留；Beam 是 Demo 的建筑编辑扩展。施工基准及安装/布局参考面元数据归所属 Level；临时手工测量仅属于会话。
- Demo 当前使用 `schemaVersion: "4.0"`，十个系统容器和具体施工类型目录见 [统一 Project JSON](unified-project-json.md)。这些信息用于识别样例和复用数据语义。

### 接入 dsphere 时需工程团队确定

- **项目类型与层级：** 将 Demo 的 Site/Building/system/Drawing 层级和节点关系映射到 dsphere 项目树时，哪些结构可以原样复用，哪些需对齐 dsphere 现有建筑类型和系统容器？施工类型走目标核心 schema、插件注册还是项目扩展节点？
- **序列化与状态：** 目标 parser、store、undo/redo 和自动保存的哪些边界要承载施工节点和 Drawing？怎样保留未知字段、稳定 ID 和跨节点引用，并保证失败回滚？
- **坐标和几何：** Demo 世界坐标与单位如何映射到 dsphere；哪些目标接口提供宿主面、洞口、端口放置、几何命中及碰撞/净空查询？
- **UI 扩展：** ActionMenu、系统切换、左侧 Scene/Items/Settings 面板、Viewer 图层和浮动 Inspector 各自接在哪些现有扩展点？哪些类型或工具注册需要改目标核心？
- **资产映射：** 样例中的资产 ID、URL、草稿状态、标签、尺寸和宿主信息如何映射到 dsphere 目录和权限模型，并在项目 JSON 往返中保留？
- **Drawing 更新：** 几何编辑后，目标如何定位受影响的派生尺寸并重算，同时保留用户调整过的图纸布局及 measurement evidence？

这些问题是跨项目实现需要定下的接口和映射；对应施工业务语义已在 Demo 中实现，可从下方入口和专题文档追踪。

## 接入时必须保留的业务约束

### 数据、状态与兼容

- 文件打开入口是 `importProjectJson`，不是直接拿 parser 读取整份文件：原生 4.0 严格校验；无版本小写 Pascal 建筑树及可明确转换的 1.0 / 2.0 / 3.0 树在副本上适配后仍须通过 4.0 校验。损坏树、未知版本和无法转换的退休类型不能以补默认值方式强行打开；失败保留当前项目。统一导出始终为 4.0，旧双文件不在此入口自动合并。
- 公共文件中的 `Site` / `Building` / 系统 / `Drawing` 类型与内部小写建筑节点、Overlay discriminator 有适配关系，不能直接把内部 store 快照作为公共 JSON。保留未知合法未来节点及字段、项目/节点/端口 ID 和双向连接引用；`pascalConduitProjectId` 是身份，内容 SHA 是修订指纹。
- 建筑原始参数与有效显示值分离，不能把渲染缺省值批量写回源文件。Demo 只允许作者工具编辑 Beam 几何；施工基准、安装/布局参考面是 Demo 拥有的 Level 元数据扩展，不能因此开放其他建筑参数的改写。
- Project 与 Overlay 是同一项目的内部快照，Beam 与施工变化应进入统一事务、撤销/重做及未保存状态。2D/3D 编辑不能用旧快照覆盖另一视图刚保存的 Drawing 布局。取消保存、写入或导入失败不清除脏状态，也不替换有效工作区。
- 旧 `Spotlight` 按合同适配为 `LightingJunctionBox`，保留稳定 ID、端口和线路；旧 `lightingControlGroups` 被忽略并在导出清理。仓库仍有旧灯控模块，不能据其文件存在就重新接入已撤掉的分组 UI。完整公开类型与兼容例外以统一 JSON 合同为准。

### 坐标、实体几何与操作

- 模型使用米、Y 向上、XZ 为水平面；UI 大部分尺寸使用毫米。Demo 编辑楼层使用 `level * 3.2`，Builder 显示另外处理 Building 位姿、楼层叠加与高程修正，见 `src/three/builder-display-transform.ts`。目标应明确双向变换；拾取结果先变回编辑坐标，再生成设备、端口、路由与测量数据，不把显示变换重复写入文件。
- 墙体缺省厚度 100 mm、有效高度、曲墙、斜接、真实洞口和楼板孔洞参与实体命中与碰撞。尺寸量至可见墙面交界棱/洞口边/实体面，不取墙中心线；橙色尺寸端点、红色垂直基线和面板距离应共用见证。普通点位从中心起算；强弱电箱、内机等实体净距从外廓起算。不要用渲染包围盒或无限平面代替有限实体查询。
- 路由逐点确认，Shift 切换正交，方向键锁世界轴，Esc 逐点撤回，Enter 完成已确认点；不共线目标先确认辅助点，不能建立假连接。世界轴到墙/梁/Ceiling 的预览和确认共用有限面求交，洞口或面外命中不能虚构宿主。放置点位模式的 Esc 则退出放置。
- 红/蓝/白网络管和消防信号、HVAC 控制管的过桥/换面按各系统合同处理；消防水管不自动过桥。HVAC 控制管归 HVACSystem，不能因为显示同为白色而合并成网络管。FCU 的电源端由 ElectricalSystem 接入；送回风管使用 HVAC 的矩形截面、端口与连续路线规则。没有自动布管或施工合规判断。

### 施工基准、完成面与地面点位

- Level 数值 H01 覆盖本层墙面；输入基线离毛坯高度及基线离完成面高度。`elevationMm = rawReference.elevationMm + heightAboveRawMm`；完成面偏移为 `heightAboveRawMm - 基线离完成面高度`。未定义与明确 0 不同，局部 Zone 高差是对本层完成面的增量。
- 已确认完成面按同层真实 Slab 范围和唯一明确 Zone 派生定位面，保留孔洞；不另存砂浆/面层实体，不修改 Slab。墙上显示 H01 及“地面完成面”贴墙线，两侧沿真实斜接边界收口，按各自高度的门窗洞口中断；文字随墙方向，不面向相机悬浮。
- 地面盒体世界坐标仍为中心，默认上口齐完成面、盒体向下。`mount.kind = "finished-floor"` 保存 `levelId`、`datumId`、`sourceSlabId`、可选 `regionId` 和最近定位的 `topOffsetMm`；当前上口偏差必须按实际坐标与当前完成面重算，不能直接复用旧偏差。
- 改基线或完成面不自动移动既有设备、端口和路线；“对齐完成面”是明确定位事务，连接中的点位沿用移动锁。地面点位四向中心尺寸与 G 编号参考线共用解析，不显示 H01 竖直偏差；没有可靠实体见证时不编造尺寸。

### Beam 与图纸

- 新梁从真实墙面起画，梁顶跟随起点墙顶；终点必须落在同层同顶标高的墙、受支持柱或已有梁面。保存 `topElevation` 与两端 `supports`。旧 Ceiling 基准梁保留其原高度依据，不能导入时统一迁到墙顶。选择后通过字段与横向实体净距编辑，不提供梁体/端点拖拽；具体限制见 Beam 合同。
- 修改梁不自动移动已挂载设备、端口和线路，只清理失效宿主与穿孔；仍承载设备或支承其他有效梁时按合同拒绝删除。梁面明敷不生成墙槽。目标拥有建筑编辑权，但不能因此悄悄改成“所有施工对象自动跟随梁”。
- Drawing 保存标注分组、顺序、数字位置、尺寸线偏移、隐藏决定和来源证据；高度变化只更新相应派生读数，不能全量重排用户图面。零张图纸允许往返，首次有持久图纸内容才创建默认施工图，同层其他 Drawing 不被覆盖。临时测量不保存；显式/派生依据、假设、置信度及 source IDs 一并保留。

## 建议实施顺序

1. 定义目标项目树映射、稳定 ID 保留方式和目标几何查询接口；先完成整合样例的打开、无修改保存和重开检查。
2. 接入 JSON 读写、撤销/重做和保存状态；在目标 ActionMenu、左侧面板及 Viewer 控件中打通一个施工对象的创建、编辑、保存和重开闭环。
3. 接入完整施工对象与路由行为，按系统分批完成；覆盖宿主、端口、吸附、碰撞、非法操作和编辑后连接关系。
4. 接入 Level 施工基准、完成面解析与地面挂载，再接入 Drawing 数据和测量证据、基于目标建筑模型的 Beam 创建/编辑行为；验证单 JSON 往返后仍可编辑。
5. 使用原整合样例及新增能力验收副本完成全量施工编辑验收，并回归 dsphere 原有建筑与资产流程。

## 目标端验收清单

以下是接入后的验收项，**不是已经在 dsphere 完成的测试记录**。每项应留存目标 commit、输入 JSON、操作结果和导出重开结果；单纯能显示模型不算通过。

| 场景 | 必须核验的结果 |
| --- | --- |
| 原整合样例无修改往返 | 建筑/资产、施工/端口/宿主/图纸引用与未知字段保留，682 节点原样例无静默丢失；导出后可重开继续编辑。 |
| 旧项目与无效文件 | 可转换旧树生成合法 4.0，稳定身份不随文件名变化；损坏/未知版本导入失败不替换现有项目，取消保存保留未保存状态。 |
| 电气与照明 | 强弱电箱、墙插、地插、网络面板、开关、灯位接线盒可放置与定位；真实孔位连接、主管分支、续画和删除后双向引用正确，照明复用同一强电箱，旧 Spotlight 兼容且不恢复灯控组。 |
| 空调 | FCU、控温器、温湿度传感器、送回风管和风口可编辑；红色电源归电气、白色控制归 HVAC，一对一端口限制、已连接对象移动锁、风口不得越出所在管面。 |
| 智能与消防 | RFID 定位、烟感和喷淋、消防水管/信号管可往返；消防信号与其他白线系统隔离，消防水管不自动过桥。 |
| 其他五系统 | 系统入口/图层和未知合法数据保留；给排水、净水、卫浴、灌溉、燃气不被误报为已有作者工具。 |
| 实体宿主与约束 | 斜墙、曲墙、门窗、梁面、楼板/孔洞与 Ceiling 的有限面命中正确；轴锁、正交、辅助点、Tab 穿透、合法过桥/碰撞拒绝、Esc 撤点符合各系统规则。 |
| 坐标变换 | 非零 Building 位姿、非默认楼层高度/高程场景中，预览、确认、2D/3D、导出重开位置一致；不会重复加楼层偏移。 |
| H01 与完成面 | 创建基线、确认完成面、Zone 高低差、未定义和明确 0 均可区分；墙角收口、门窗断开、贴墙文字及完成面高度线正确，保存重开后保留。 |
| 地面点位 | 上口齐平/偏差、透明定位面选取、四向 G 基线/面板数字一致；改完成面不移动旧点位，明确对齐才移动，连接锁生效；孔洞和歧义区域不接受虚构落点。 |
| 新旧 Beam | 新梁同高实体支承有效，悬空/异高拒绝；旧 Ceiling 梁不漂移。编辑/删除同步 Level.children 与宿主/穿孔检查，不自动改线。 |
| Drawing | 2D/3D 改高度只更新读数，分组/数字/尺寸线位置保留；隐藏和撤销可往返；无 Drawing、同层多 Drawing、缺少可靠见证和局部完成面均按合同处理。 |
| 历史与恢复 | 建筑与施工共享撤销/重做；反复切视图不丢编辑；错误恢复导出最后已提交快照及诊断，不把临时预览或会话手工测量写入项目。 |
| 原有 dsphere 回归 | 建筑、门窗、家具和资产加载、选择、图层、保存及历史不因施工接入退化。 |

### 本地启动与核验

```bash
npm ci
npm test
npm run build
npm run dev
```

`npm run verify:sample` 只校验旧 `sample-data/default-layout.json`，不是本页整合样例的验收。整合样例指纹应单独运行：

```bash
shasum -a 256 docs/examples/dsphere-builder-integration-sample.json
```

本仓库部分真实项目测试由环境变量启用，默认跳过不等于该场景已经验收；参阅 `src/domain/construction-datum.project.test.ts`、`src/components/wall-dimension-placement.project.test.ts` 的 fixture 约定。不能把任意整合样例传给依赖特定项目 ID 的 fixture 测试。目标团队应另外添加自己的宿主适配、保存往返与 UI 验收，Demo 单元测试通过不能替代目标端验证。

## 按任务查阅 Demo 文档

- **文件结构、旧项目导入和 ID/引用语义：** [统一 Project JSON](unified-project-json.md)、[导入兼容 ADR 0014](adr/0014-backward-compatible-project-import.md)。
- **3D 系统图层和 Viewer 行为：** [3D Viewer 边界](3d-readonly-viewer.md)。
- **施工能力全量索引：** [README](../README.md)。路由、HVAC、系统归属和图纸能力以当前 README/代码为准。
- **Beam 创建与编辑：** [Demo Beam 作者工具](beam-authoring.md)、[墙顶支承梁 ADR 0016](adr/0016-wall-supported-beam-authoring.md)。
- **施工基准、完成面和地面点位：** [施工基准](construction-datum.md)、[完成面定位 ADR 0015](adr/0015-derived-finished-floor-placement.md)。
- **保存、撤销与错误恢复：** [工作区持久化](editable-project-workspace.md)。
- **建筑有效参数与复用边界：** [只读参数模型](parametric-building-read-model.md)、[dsphere 差异审计](dsphere-integration-parity-audit.md)。
- **图纸尺寸与临时测量：** [手工测量](manual-measurement.md)和[外部尺寸](exterior-dimensions.md)。

## 关键代码入口

以下是阅读起点，不是完整清单；实现前应沿调用链和相关测试继续追踪。

- 十个 Project 系统容器的精确名称依次为：`ElectricalSystem`（电气）、`PlumbingSystem`（给排水）、`LightingSystem`（照明）、`HVACSystem`（空调）、`SmartSystem`（智能）、`WaterPurificationSystem`（净水）、`BathroomSystem`（卫浴）、`FireProtectionSystem`（消防）、`IrrigationSystem`（灌溉）、`GasSystem`（燃气）。以下按系统列出当前 Demo 的作者能力和追代码入口；“暂无作者工具”表示当前不支持新增/编辑该系统施工实体，导入数据仍可保留。

| Project 系统 | Demo 当前施工能力 | 关键实现与测试入口 |
| --- | --- | --- |
| `ElectricalSystem`（电气） | 可放置强/弱电箱、插座、网络面板并绘制电源/网络管线。 | 设备与端口：`src/domain/devices.ts`、`src/domain/device-positioning.ts`；路由与碰撞：`src/domain/routing.ts`、`src/domain/routing-collision.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/routing-collision.test.ts`、`src/domain/unified-project.test.ts`。 |
| `LightingSystem`（照明） | 可放置开关和灯位接线盒，并绘制照明管线；强电箱的物理端口与电气系统共享。不维护开关—灯位接线盒逻辑分组，接线盒四个物理端口独立。 | 设备/路由：`src/domain/devices.ts`、`src/domain/routing.ts`；照明物理接线与端口：`src/domain/routing.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/devices.test.ts`、`src/domain/unified-lighting-fire.test.ts`。 |
| `HVACSystem`（空调） | 可放置 FCU、温控器、温湿度传感器和风口，绘制风管及温控器到 FCU 的控制管；FCU 电源管由电气系统绘制。 | HVAC 模型/路由：`src/domain/hvac.ts`；设备端口：`src/domain/devices.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/hvac.test.ts`、`src/domain/unified-hvac-reference-planes.test.ts`。 |
| `SmartSystem`（智能） | 可放置和定位 RFID 读写器；当前没有智能系统管线编辑能力。 | 设备目录/端口和定位：`src/domain/devices.ts`、`src/domain/device-positioning.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/builder-workbench.test.ts`、`src/domain/unified-project.test.ts`。 |
| `FireProtectionSystem`（消防） | 可放置喷淋头和烟雾传感器，绘制消防水管及独立消防信号管。 | 设备与管线共用实现：`src/domain/devices.ts`、`src/domain/routing.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/unified-lighting-fire.test.ts`、`src/domain/unified-project.test.ts`。 |
| `PlumbingSystem`（给排水）、`WaterPurificationSystem`（净水）、`BathroomSystem`（卫浴）、`IrrigationSystem`（灌溉）、`GasSystem`（燃气） | 当前均无施工实体作者工具；系统入口和图层开关保留，导入的系统数据可往返保留。 | 空状态与系统入口：`src/main.tsx`；系统容器解析/编码：`src/domain/unified-project.ts`；图层目录：`src/three/system-layer-visibility.ts`；测试：`src/builder-workbench.test.ts`、`src/three/system-layer-visibility.test.ts`、`src/domain/unified-project.test.ts`。 |

- 十系统目录、空容器要求及实体归属合同：`src/domain/unified-project.ts`、`src/domain/unified-project.test.ts`；公开类型完整表见 [统一 Project JSON](unified-project-json.md)。
- Demo UI 与通用验证：`src/main.tsx`、`src/three/ThreeDWorkspace.tsx`、`src/workspace-ui.test.ts`、`src/three/system-layer-visibility.test.ts`。
- 文件打开与编码：`src/domain/project-import.ts` 的 `importProjectJson`、`src/domain/unified-project.ts` 的 `decodeUnifiedProject` / `encodeUnifiedProject`；公共建筑转内部场景：`src/parser/parse.ts`、`src/three/scene-input.ts`。
- 工作区状态与事务：`src/domain/store.ts`、`src/domain/workspace.ts`；渲染错误恢复：`src/crash-recovery.ts`。
- 建筑有效参数与坐标变换：`src/geometry/effective-building.ts`、`src/three/builder-display-transform.ts`。前者提供有来源的显示/几何值，后者只是显示与拾取的坐标桥，不能充当公共序列化格式。
- 物理测量和有限面约束：`src/domain/physical-positioning-surfaces.ts`、`src/domain/world-axis-surface.ts`；墙面斜接端点：`src/geometry/walls/rendered-face-endpoint.ts`；场景标记：`src/components/wall-dimension-placement.ts`、`src/components/ground-positioning-guides.ts`。
- 施工基准与完成面：`src/domain/construction-datum.ts`、`src/domain/finished-floor.ts`、`src/three/FinishedFloorScene.tsx`、`src/three/PascalScenePreview.tsx`；完成面设备创建/对齐：`src/domain/devices.ts`；集成回归：`src/finished-floor-integration.test.ts`、`src/domain/construction-datum-contract.test.ts`。
- Beam 本地模块组合入口：`src/nodes/beam/definition.ts`；它不是现成的 dsphere 插件。Beam 数据、路由和定位：`src/domain/beams.ts`、`src/domain/beam-routing.ts`、`src/domain/beam-positioning.ts`。
- Drawing 与测量模型：`src/domain/drawing.ts`、`src/plan/model.ts`、`src/plan/construction-drawings.ts`、`src/plan/manual-callout-model.ts`。

目标 UI 的历史定位可从 [EditorLayoutV2](https://github.com/DREAM-ONE-DEV/dsphere_builder/blob/main/packages/editor/src/components/editor/editor-layout-v2.tsx)、[ActionMenu](https://github.com/DREAM-ONE-DEV/dsphere_builder/blob/main/packages/editor/src/components/ui/action-menu/index.tsx)和 [PanelManager](https://github.com/DREAM-ONE-DEV/dsphere_builder/blob/main/packages/editor/src/components/ui/panels/panel-manager.tsx)开始，再沿当前实现和测试追踪；链接指向目标仓库 `main` 分支路径，本轮未核验这些目标侧路径，不表示已确定开发基线或已存在可直接使用的扩展接口。
