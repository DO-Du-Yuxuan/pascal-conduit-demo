# 平面布置图评分系统｜文档索引

## 飞书项目资源

| 资源 | 名称 | 链接 / ID |
|---|---|---|
| 产品首页云文档 | 平面布置图评分系统｜产品原则与决策记录 | https://pav7o65swgz.feishu.cn/docx/K8SwdjlgioUVDNxrAPocU1a4nec |
| 多维表格 | 平面布置图评分系统｜规则与案例库 | https://pav7o65swgz.feishu.cn/base/ZoGebNb9ka5QM1soXe5cW1KynOg |
| 规则总表 | 一行一条规则 | `tbluMgZMVgbuB6g4` |
| 案例测试表 | 一行一个测试或真实案例 | `tblNyPQogqXwexu2` |

## 信息权威来源

| 信息类型 | 权威来源 |
|---|---|
| 产品目标、原则和决策 | 飞书云文档《平面布置图评分系统｜产品原则与决策记录》 |
| 规则名称、产品状态、V0.1 取舍 | 飞书多维表格“规则总表” |
| 算法、参数、代码和测试 | Git 仓库 |
| 实际是否可用 | 自动化测试和真实项目验收 |

权威边界用于解决信息冲突，不代表其他位置不能保存引用或快照。引用内容与权威来源不一致时，应回到权威来源确认，不得用同步程序静默覆盖产品决策。

## 人工维护字段

以下字段不得由 Git 或自动同步程序覆盖：

- 规则名称
- 规则目的
- 产品状态
- V0.1 是否启用
- 通过标准
- 问题标准
- 设计师说明
- 产品决策
- 是否接受某个限制

## 可由 Codex 从 Git 同步的字段

在按规则 ID 精确定位记录、确认目标表结构且不触碰人工字段的前提下，可同步：

- 实现状态
- 执行方式
- Bellevue 结果
- 数据依赖
- 代码文件
- 测试文件
- 当前限制
- 当前 commit

同步细节见 [feishu-rule-sync.md](./feishu-rule-sync.md)。

## 初始化信息

- 初始化时间：2026-07-23 18:25:01 CST（Asia/Shanghai）
- 初始化分支：`agent/rule-docs-feishu`
- 初始化 commit：`483f44597634620a2a8127b0822a5543b0d0ebba`
- 技术交接文档：[g1-g3-stage-handoff.md](./g1-g3-stage-handoff.md)
- 机器规则清单：[rule-implementation-status.json](./rule-implementation-status.json)
- Git 仓库：https://github.com/DO-Du-Yuxuan/pascal-layout-auditor
- Demo：https://do-du-yuxuan.github.io/pascal-layout-auditor/
