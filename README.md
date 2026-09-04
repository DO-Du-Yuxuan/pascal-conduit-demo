# Pascal 施工管线路由 Demo

这是独立的管线编辑 Demo。它以 `pascal-layout-auditor` 的 Parser、二维画布和只读 3D Viewer 为底座，但不展示、不运行或写入任何 G1/G2/G3/G4/S1 评价结论。

默认建筑底图是用户提供的 `sample-data/default-layout.json`，SHA-256：`32d135bef65a6a0fdb06485cc24a68a68cd864e9a4322907971c659b26c7e167`。它默认加载且 Overlay 为空；不再使用 Bellevue 作为 Demo。

## 保留的 Viewer 能力

- 原始 Pascal JSON 宽容解析、解析诊断、二维多画布、楼层切换、旋转、平移、缩放、测量、图层和对象隐藏/恢复。
- 3D 外观、室内、地板、天花，以及顶/前/后/左/右/等轴视角。
- 透视/正交、叠放/爆炸/单层、完整/剖开/半透明/隐藏墙体、建筑与四类管线图层。
- 墙、弧墙、门窗洞口、楼板厚度、天花、楼梯、屋顶数据和家具尺寸占位。无 roof 数据时明确提示，绝不虚构屋顶。

## 管线 Demo

- 强电：红色 `#ef4444`，20 mm；弱电：蓝色 `#3b82f6`，20 mm；信号：白色（灰描边），20 mm；消防喷淋：绿色 `#22c55e`，50 mm。
- 3D 是唯一绘制入口。左键选择/落点，右键旋转，中键平移，滚轮缩放；`Shift` 锁定主轴；双击或 `Enter` 完成，`Esc` 取消最后一点。
- 直管、弯头、三通、墙槽、穿孔保存在独立 Overlay sidecar。2D 只读显示同一份路由，可选择但不可编辑。
- 施工态和 X-Ray 在运行时展示受影响墙、楼板和天花的槽孔；完工态恢复建筑饰面并隐藏暗敷电气线管。原始 Pascal JSON 永远不被修改。

墙槽宽度默认是管径 + 10 mm、深度是管径 + 5 mm；穿孔直径是管径 + 10 mm。它们是 Demo 视觉参数，不是施工规范结论。消防喷淋默认吊顶内明敷，不生成墙槽。

## 运行与校验

```bash
npm install
npm run verify:sample
npm test
npm run build
npm run dev
```

浏览器视觉验收由用户执行；自动化流程不启动浏览器、Playwright 或 CUA。
