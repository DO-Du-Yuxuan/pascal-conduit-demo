# 建筑只读参数与 Demo 梁节点模块

本轮只修改 Demo。建筑模型仍只读；只有既有 Beam 工作流能创建、编辑和删除建筑节点。本轮没有引入门窗、墙、楼梯或屋顶建模工具，也没有把 dsphere 的场景 store 或历史系统搬进 Demo。

## 参数读取与保存

`src/geometry/effective-building.ts` 提供只读参数索引，记录 `raw`、`value` 与来源。几何、实体定位和相机范围读取有效值；原节点不填默认值，导出仍以原 Project 为底稿。

- 显式的门窗尺寸、墙高和天花高度优先。缺省 Door 为 0.9 × 2.1 m、Window 为 1.5 × 1.5 m、墙厚为 0.1 m。
- 源 Level 有明确 `height` 时，缺省墙高读取该层高，缺省天花按层顶/覆盖楼板下表面减 0.01 m 解析。没有明确 Level height 的旧文件，建筑显示使用当前 Builder 的 2.5 m 缺省。这是 Demo 的源格式兼容策略，不把新版字段倒推为本地 dsphere 已支持的合同。
- 显式 Slab `thickness` 与顶面 `elevation` 分开读取；缺少 thickness 的旧节点仍按旧 Builder 从楼层基准向 elevation 挤出。显示与实体定位共用竖向范围，不改源 polygon/holes/标高。
- Building 位姿、Level 明确 height/baseElevation 只用于显示变换。保存的设备、管线和编辑坐标仍不重写，不对既有项目自动移位、改线或重接。
- 旧 Beam 继续读取保存的源 Ceiling 显式/派生依据，缺省 Ceiling 的旧 `derived-default-2700mm` 合同不自动转换。新建墙面支承梁读取起点 Wall 的有效顶标高，并在 `topElevation` 保留源 Wall 与明确/推导依据；详见[梁作者合同](beam-authoring.md)。

Project 4.0 的已识别建筑别名增加 Skylight、Scan、BoxVent、RidgeVent、Chimney、SolarPanel、Dormer。规范化只发生在内部 kind；未编辑的源字段、类型、稳定 ID 和未知字段继续往返保留。

墙侧 Item 的平面外廓中心偏移已对齐 Builder 的向墙半深度约定，缺省 side 使用 front。该修正不修改任何保存的 Item position/rotation。真实家具仍按本期既定范围使用尺寸占位。

## 门窗只读几何

`builder-opening-geometry.ts` 返回可见部件、墙切口几何和降级诊断；`BuilderOpeningPreview.tsx` 渲染局部部件。父墙与门窗保存的 XYZ rotation 分层组合，保留原始角度，避免重复旋转。

本轮重点支持实际验收文件的 fixed 窗和 hinged/barn 门：框深与框厚、行列分格、玻璃/门板 segment、窗台、门槛、把手、hinged `swingAngle` 和 barn `operationState/slideDirection`。hinged 的 operationState 不会被误当成铰链角度。门窗材质可读取保存的 material，其他角色继续使用 Builder Studio 材质。

墙切口共用矩形、圆角、拱形轮廓，`openingKind: opening` 不生成实物部件。门窗实体定位见证使用同一部件几何，所以已开启的门扇不再被当作原来的闭合占位盒。其它门窗族以及非矩形框扇的完整构造仍是后续范围；当前 helper 对不支持的变体返回明确降级诊断，不宣称所有 Builder 变体完全一致。施工墙面的分区见证仍有自己的有限三角投影模型，非矩形洞口的完整几何等价需要后续差分验证。

## 梁模块与宿主责任

`src/nodes/beam/` 包含：

- `definition.ts`：Demo 本地节点定义，参数元数据、默认截面、domain 校验/创建/编辑与净距/长度动作入口。
- `geometry.ts`：局部棱柱/显式穿孔、显示变换、可用梁面的命中描述和纯 2D 足迹布局。
- `BeamRenderer.tsx`：选中、预览、穿孔、净距标签与物理表面事件。
- `BeamFootprint.tsx`：只读平面显示与选择，不新增 2D 创作。

3D、2D 和作者命令已使用该模块。它是 Demo 的独立节点贡献接口，组织方式接近 Builder 参数化节点；它不是 `@dsphere/core` NodeDefinition 的直接可装载对象，也不建立第二套 Beam 模型或持久化 authority。现有 `domain/beams`、定位、碰撞和穿孔规则继续负责工程语义。

工作区继续拥有临时手势、布局参考面、ID/名称分配、面板和键盘、事务/撤销、设备/端口及管线再校验。梁截面默认 300 × 500 mm；梁体和端点不可拖动，定位净距按原 5 mm 精度编辑。移梁不自动跟随设备或管线，仍承载设备的梁拒绝删除。源梁的 ID、Ceiling 引用、有效标高与依据不重写。

## 指定 JSON 的验收

输入为用户提供的 `layout_2026-10-10招商局广场19B-export.json`，只读使用外置文件，不把原项目内容复制进仓库。

源码检查记录：Project 4.0 共 1,067 节点；4 扇门、7 扇窗、56 个 Item、5 根 Beam；门窗尺寸和 Item dimensions 全部明确。11 面墙缺厚度，1 面墙和 1 块天花缺高度；Level height=4.2 m。天花缺省解析为 4.19 m，墙厚缺省为 0.1 m。5 根源 Beam 保存的有效标高均为 4.19 m，保持原 explicit-ceiling-height 依据。

验收入口通过 `CONDUIT_PROJECT_FIXTURE_PATH` 指定输入：

```sh
CONDUIT_PROJECT_FIXTURE_PATH='/绝对路径/项目-export.json' npm test
```

外置验收测试检查导入、有效参数、门窗几何、梁校验与显示读取、源节点往返、节点 ID 全集以及保存的空间字段和端口/连接引用。未设置路径时这三项明确跳过；常规合成夹具仍运行。本轮不使用浏览器验收，不能据这些测试宣称完整像素等价。

2026-10-13 最终结果：指定该外置文件运行完整 `npm test`，89 个测试文件、802 项测试全部通过，无跳过；`npm run build` 与 `git diff --check` 通过。原项目只读保留，不提交原文件或真实几何快照进仓库。

决策见 [ADR 0012](adr/0012-source-aware-read-model-and-local-beam-node.md)。本轮没有自动改线、迁移已保存几何或改变建筑编辑权限。
