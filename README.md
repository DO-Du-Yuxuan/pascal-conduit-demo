# pascal-layout-auditor

一个独立、只读的 Pascal JSON 平面布局核验 Demo。它与 Pascal Editor / dsphr editor 的关系是：这里抽取可迁移的 JSON 解析、诊断、家具尺寸和坐标变换逻辑，验证通过后可由维护团队集成；本项目不是 Fork，也不复制完整编辑器。

## 支持范围

浏览器本地导入或拖入 JSON；支持 site、building、level、zone、wall、door、window、item、slab、ceiling、shelf、stair 的最小宽容解析；未知节点保留并诊断。SVG 显示 Zone、墙体、门窗、家具数学占地框、PNG、中心点和局部 +Z 方向轴。点击家具可查看原始字段、坐标链路、尺寸和图片加载信息。

工作区可在 2D 平面与只读 3D 查看间切换。3D 使用轻量 WebGL 适配层只读渲染墙、门窗、楼板、天花、楼梯、屋顶、Shelf 与家具尺寸占位，支持鼠标环绕/平移/缩放、视角预设、透视/正交、楼层叠放/爆炸/单层和墙体展示模式。它从 Parser 输出制作独立副本载入，不写回 JSON，也不改变任何 G1/G2/G3/S1 的证据或结论；评价卡片的“在图中查看”始终回到 2D。无 `roof` 或 `roof-segment` 时会明确提示，绝不自动生成屋顶；为保证大量家具场景稳定，3D 不加载 GLB。

家具尺寸公式为 `finalWidth/Height/Depth = asset.dimensions × item.scale`，`asset.scale` 是 GLB 校正变换，不参与二维尺寸。局部 +Z 轴不等于家具语义正面。图片校验只能人工观察，尚未从 GLB 自动生成对比图。

明确不支持：3D 编辑/建模/移动/保存、自动生成缺失建筑构件或屋顶、自动评分、PNG 图像分析/修复、复杂空间规则、后端、数据库、登录、上传服务。

## 运行

```bash
npm install
npm run dev
npm test
npm run build
```

应用只在浏览器内读取 JSON，不修改原始对象、不上传服务器。后续迁移建议复用 `src/parser/parse.ts`、`src/geometry/transform.ts` 和 `src/diagnostics/check.ts` 的纯函数。
