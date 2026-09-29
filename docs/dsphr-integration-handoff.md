# 建议产品范围

**目标产品：** [DREAM-ONE-DEV/dsphere_builder](https://github.com/DREAM-ONE-DEV/dsphere_builder)

**读者：** dsphere_builder 工程团队和执行 agents；供需求方审核产品边界、建议和验收结果。
**目标：** 把 Pascal 施工管线 Demo 的施工编辑能力整合到 dsphere_builder。dsphere 继续拥有建筑、门窗、家具和资产；施工对象和图纸在同一 dsphere 项目中编辑、保存并重新打开。

## 产品范围

以下是本轮建议的产品范围，提交需求方确认；保留此前讨论的全部首期要求，便于逐项确认：

- 建议首期最终验收覆盖当前 Demo 的**全部施工编辑功能**，包括但不限于点位、管线、HVAC、施工图和 Beam；具体清单以 Demo 当前 README 和可执行代码为准。实现可以分阶段，最终交付覆盖全量功能。
- 建议施工设备、路由和可编辑图纸与建筑一起保存在同一份 dsphere 项目 JSON 中。导出后再次导入，用户能恢复项目并继续编辑。
- 建议将 Beam 创建和编辑纳入首期，由 dsphere 的建筑工具和建筑数据模型承接，Demo Beam 行为作为参考。
- 建议首期导出单一 JSON，其中包含可编辑的施工和图纸数据；PDF 或图片导出不在本轮首期范围内。临时手工测量留在当前会话，不写入项目。

## 四个整合边界

| 边界 | dsphere_builder 提供/负责 | Demo 提供/已实现 | 建议接法 | 验收重点 |
| --- | --- | --- | --- | --- |
| **UI 与 Viewer** | 编辑器页面和统一 UI 语言；建筑/资产 Viewer；选择、相机、视图状态；目标节点可见性与视图显隐机制；ActionMenu、左侧面板和选中对象 Inspector。 | 底部主栏“系统”入口及系统子栏；固定左栏中的系统工具/参数卡；选中对象后的右侧浮动属性面板；3D 建筑和十个系统的图层显隐。Demo 设计工作区提供操作流程参考。 | 建议在目标底部 ActionMenu 增加“系统”入口，左侧 Scene/Items/Settings 面板按目标布局承载系统工具与参数；选中对象沿用目标现有 Inspector。沿用目标可见性/视图显隐交互，并新增施工系统分组显隐。统一使用 dsphere UI 语言。 | 建筑、门窗、家具和资产仍由目标 Viewer 正常操作/显示；施工工具、参数与 Inspector 符合目标布局；施工系统分组显隐可用，且与对象可见性、视图状态正确配合。 |
| **施工数据与保存** | Building、门窗、家具和资产节点；项目 JSON 的打开、保存和重开流程。 | Project JSON 中 Site、Building、system、Drawing 的结构，稳定节点/端口 ID 和跨节点引用；施工对象、连接、宿主与图纸数据。 | 以 Demo 的 Site/Building/system/Drawing 层级及 ID/引用关系作为目标项目施工数据的参考与复用起点，将建筑和资产保留在 dsphere 原有节点/服务。明确施工节点映射、序列化/校验、版本演进、未知字段保留和失败回滚。 | 同一项目 JSON 保存建筑、施工对象和可编辑 Drawing；重开后可继续编辑；建筑/资产字段及节点 ID、端口、宿主、连接、图纸来源引用保持；反复往返无静默丢失。 |
| **几何与路由** | 建筑坐标和单位；墙、洞口、楼板、天花、梁的宿主几何、表面命中与碰撞查询；资产外形；Beam 的建筑工具和数据模型。 | 设备端口、逐点路由、正交约束、吸附、碰撞/净空规则、HVAC 行为；Beam 创建/编辑行为参考。 | 将 Demo 路由规则适配到目标建筑几何与工具接口，保留逐点确认及明确连接语义。Beam 在目标建筑工具和模型中实现，并提供施工对象所需宿主查询。 | 覆盖墙/洞口、楼板、天花和梁；验证吸附、端口连接、正交路由、碰撞拒绝及设备移动后的连接处理；Beam 在目标模型中创建/编辑并保存重开，宿主关系符合约定。 |
| **图纸与测量** | 项目 JSON 导入/导出和重开；项目建筑几何；目标图纸导出流程。 | Drawing 标注、尺寸、来源关系和布局；显式/派生测量依据、假设、置信度；会话内手工测量行为。 | 将可编辑 Drawing 数据与建筑、施工对象保存在同一项目 JSON；保留 source object IDs 和测量证据，几何改变时按规则更新派生值。临时手工测量仅留在会话内。 | 重开后图纸布局和记录可继续编辑；依据、假设、置信度和来源 ID 一致；几何改变只更新受影响的派生值；临时手工测量不写入 JSON。 |

## 整合样例

样例文件：[dsphere-builder-integration-sample.json](examples/dsphere-builder-integration-sample.json)。这是用于整合验证的项目样例，文件按原始字节复制，SHA-256 为 `703a6c39c077ca483ef9b63b055e388793291df14db511827925afe3af2cf7f9`。样例不作为 Demo 生产资产目录或公共类型清单。

验证时至少检查：

1. dsphere 能打开样例中的 Building、门窗、家具和资产引用；家具模型由 dsphere 资产体系加载。
2. 无修改导入、保存、重开后，建筑 ID、施工 ID、端口/宿主/连接关系、图纸来源 ID 和关键建筑/资产字段保持。
3. 施工对象可在 dsphere 中继续创建和编辑，最终覆盖当前 Demo 全部施工编辑能力，包括但不限于点位、管线、HVAC、施工图与 Beam。
4. Drawing 数据与建筑、施工对象同处一个 JSON，布局和来源证据仍可编辑；临时手工测量没有被保存。

Demo 对样例的既有检查发现 682 个节点组成完整可达的父子树，解码/编码往返后节点 ID 集合及 `pascalConduitProjectId` 保持。该检查说明源样例内部结构可往返，目标项目仍需独立完成上述验收。

## Demo 已有约定与跨项目工程决策

### Demo 已解决、可直接参考的语义

- 单个 Project JSON 承载建筑、十个系统容器和 Drawing；Overlay 是 Demo 的内部编辑快照。
- 节点和端口使用稳定 ID，跨系统连接、宿主、图纸来源通过 ID 引用；Drawing 保存可编辑的尺寸/标注布局和测量证据。
- 建筑及资产由原 Project 数据保留；Beam 是 Demo 的建筑编辑扩展。临时手工测量仅属于会话。
- Demo 当前使用 `schemaVersion: "4.0"`，十个系统容器和具体施工类型目录见 [统一 Project JSON](unified-project-json.md)。这些信息用于识别样例和复用数据语义。

### 接入 dsphere 时需工程团队确定

- **项目类型与层级：** 将 Demo 的 Site/Building/system/Drawing 层级和节点关系映射到 dsphere 项目树时，哪些结构可以原样复用，哪些需对齐 dsphere 现有建筑类型和系统容器？施工类型走目标核心 schema、插件注册还是项目扩展节点？
- **序列化与状态：** 目标 parser、store、undo/redo 和自动保存的哪些边界要承载施工节点和 Drawing？怎样保留未知字段、稳定 ID 和跨节点引用，并保证失败回滚？
- **坐标和几何：** Demo 世界坐标与单位如何映射到 dsphere；哪些目标接口提供宿主面、洞口、端口放置、几何命中及碰撞/净空查询？
- **UI 扩展：** ActionMenu、系统切换、左侧 Scene/Items/Settings 面板、Viewer 图层和浮动 Inspector 各自接在哪些现有扩展点？哪些类型或工具注册需要改目标核心？
- **资产映射：** 样例中的资产 ID、URL、草稿状态、标签、尺寸和宿主信息如何映射到 dsphere 目录和权限模型，并在项目 JSON 往返中保留？
- **Drawing 更新：** 几何编辑后，目标如何定位受影响的派生尺寸并重算，同时保留用户调整过的图纸布局及 measurement evidence？

这些问题是跨项目实现需要定下的接口和映射；对应施工业务语义已在 Demo 中实现，可从下方入口和专题文档追踪。

## 建议实施顺序

1. 定义目标项目树映射、稳定 ID 保留方式和目标几何查询接口；先完成整合样例的打开、无修改保存和重开检查。
2. 接入 JSON 读写、撤销/重做和保存状态；在目标 ActionMenu、左侧面板及 Viewer 控件中打通一个施工对象的创建、编辑、保存和重开闭环。
3. 接入完整施工对象与路由行为，按系统分批完成；覆盖宿主、端口、吸附、碰撞、非法操作和编辑后连接关系。
4. 接入 Drawing 数据和测量证据，再接入基于目标建筑模型的 Beam 创建/编辑行为；验证单 JSON 往返后仍可编辑。
5. 使用整合样例完成全量施工编辑验收，并回归 dsphere 原有建筑与资产流程。

## 按任务查阅 Demo 文档

- **文件结构和 ID/引用语义：** [统一 Project JSON](unified-project-json.md)。
- **3D 系统图层和 Viewer 行为：** [3D Viewer 边界](3d-readonly-viewer.md)。
- **施工能力全量索引：** [README](../README.md)。路由、HVAC、系统归属和图纸能力以当前 README/代码为准。
- **Beam 创建与编辑：** [Demo Beam 作者工具](beam-authoring.md)。
- **图纸尺寸与临时测量：** [手工测量](manual-measurement.md)和[外部尺寸](exterior-dimensions.md)。

## 关键代码入口

以下是阅读起点，不是完整清单；实现前应沿调用链和相关测试继续追踪。

- 十个 Project 系统容器的精确名称依次为：`ElectricalSystem`（电气）、`PlumbingSystem`（给排水）、`LightingSystem`（照明）、`HVACSystem`（空调）、`SmartSystem`（智能）、`WaterPurificationSystem`（净水）、`BathroomSystem`（卫浴）、`FireProtectionSystem`（消防）、`IrrigationSystem`（灌溉）、`GasSystem`（燃气）。以下按系统列出当前 Demo 的作者能力和追代码入口；“暂无作者工具”表示当前不支持新增/编辑该系统施工实体，导入数据仍可保留。

| Project 系统 | Demo 当前施工能力 | 关键实现与测试入口 |
| --- | --- | --- |
| `ElectricalSystem`（电气） | 可放置强/弱电箱、插座、网络面板并绘制电源/网络管线。 | 设备与端口：`src/domain/devices.ts`、`src/domain/device-positioning.ts`；路由与碰撞：`src/domain/routing.ts`、`src/domain/routing-collision.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/routing-collision.test.ts`、`src/domain/unified-project.test.ts`。 |
| `LightingSystem`（照明） | 可放置开关和灯位接线盒，并绘制照明管线；强电箱的物理端口与电气系统共享。 | 设备/路由：`src/domain/devices.ts`、`src/domain/routing.ts`；照明控制布局：`src/domain/lighting-controls.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/lighting-controls.test.ts`、`src/domain/unified-lighting-fire.test.ts`。 |
| `HVACSystem`（空调） | 可放置 FCU、温控器、温湿度传感器和风口，绘制风管及温控器到 FCU 的控制管；FCU 电源管由电气系统绘制。 | HVAC 模型/路由：`src/domain/hvac.ts`；设备端口：`src/domain/devices.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/hvac.test.ts`、`src/domain/unified-hvac-reference-planes.test.ts`。 |
| `SmartSystem`（智能） | 可放置和定位 RFID 读写器；当前没有智能系统管线编辑能力。 | 设备目录/端口和定位：`src/domain/devices.ts`、`src/domain/device-positioning.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/builder-workbench.test.ts`、`src/domain/unified-project.test.ts`。 |
| `FireProtectionSystem`（消防） | 可放置喷淋头和烟雾传感器，绘制消防水管及独立消防信号管。 | 设备与管线共用实现：`src/domain/devices.ts`、`src/domain/routing.ts`；3D 交互：`src/three/ThreeDWorkspace.tsx`；测试：`src/domain/unified-lighting-fire.test.ts`、`src/domain/unified-project.test.ts`。 |
| `PlumbingSystem`（给排水）、`WaterPurificationSystem`（净水）、`BathroomSystem`（卫浴）、`IrrigationSystem`（灌溉）、`GasSystem`（燃气） | 当前均无施工实体作者工具；系统入口和图层开关保留，导入的系统数据可往返保留。 | 空状态与系统入口：`src/main.tsx`；系统容器解析/编码：`src/domain/unified-project.ts`；图层目录：`src/three/system-layer-visibility.ts`；测试：`src/builder-workbench.test.ts`、`src/three/system-layer-visibility.test.ts`、`src/domain/unified-project.test.ts`。 |

- 十系统目录、空容器要求及实体归属合同：`src/domain/unified-project.ts`、`src/domain/unified-project.test.ts`；公开类型完整表见 [统一 Project JSON](unified-project-json.md)。
- Demo UI 与通用验证：`src/main.tsx`、`src/three/ThreeDWorkspace.tsx`、`src/workspace-ui.test.ts`、`src/three/system-layer-visibility.test.ts`。
- 工作区状态：`src/domain/store.ts`。
- Beam 数据、路由和定位：`src/domain/beams.ts`、`src/domain/beam-routing.ts`、`src/domain/beam-positioning.ts`。
- Drawing 与测量模型：`src/domain/drawing.ts`、`src/plan/model.ts`、`src/plan/construction-drawings.ts`。

目标 UI 可从 [EditorLayoutV2](https://github.com/DREAM-ONE-DEV/dsphere_builder/blob/main/packages/editor/src/components/editor/editor-layout-v2.tsx)、[ActionMenu](https://github.com/DREAM-ONE-DEV/dsphere_builder/blob/main/packages/editor/src/components/ui/action-menu/index.tsx)和 [PanelManager](https://github.com/DREAM-ONE-DEV/dsphere_builder/blob/main/packages/editor/src/components/ui/panels/panel-manager.tsx)开始，再沿当前实现和测试追踪；链接指向目标仓库 `main` 分支路径，不表示已确定开发基线。
