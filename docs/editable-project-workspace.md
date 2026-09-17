# 可编辑项目与工作区持久化

本 Demo 仍将已导入的 Pascal 建筑节点视为只读。当前仅建立可编辑项目的持久化与事务基础；尚未提供 Beam 或任何其他建筑节点的创建、编辑、删除入口。

## 项目身份与版本

项目 JSON 顶层的 `pascalConduitProjectId` 是 Demo 自己的稳定项目身份扩展。旧项目在首次通过 Demo 导出为可写项目时生成一次；后续导入和导出保持不变。它不是文件名，也不是 Pascal Core 字段。

每份 JSON 内容仍计算 SHA-256，作为某一个项目修订版的指纹。内容发生变化会改变 SHA，但不会改变 `pascalConduitProjectId`。浏览器安全上下文可用时使用原生 Web Crypto；局域网 HTTP 开发时则使用等价的本地 SHA-256 回退，结果保持相同。项目导出总是下载 `*-export.json` 新文件，绝不尝试覆盖用户导入的源文件或调用原地写入 API。

导出只添加或更新 Demo 明确拥有的顶层身份扩展；未编辑的顶层字段、节点、未知节点种类、插件 payload 与 metadata 会按语义保留。JSON 的空白和属性顺序不属于保留承诺。

## Overlay 归属与导入

Overlay `source` 保存文件名、修订 SHA，以及可选的 `projectId`。旧 SHA-only Overlay 继续可读；项目首次成为可写项目时，活动 Overlay 会迁移到该稳定身份，同时保留最新修订 SHA 作为版本证据。

导入同一 `projectId` 的新修订版会保留当前 Overlay，并把其修订 SHA 更新为新项目版本。Overlay 的路线、点位和施工记录仍保留原有世界坐标；门洞、家具或其他只读建筑节点的外部位置修改不会自动移动、重挂或重布 Overlay。导入不同身份的项目会初始化独立 Overlay；若项目 JSON 或 Overlay 仍有未导出更改，界面会先要求确认。

## 脏状态与历史

项目 JSON 和 Overlay 分别拥有脏状态；导出其中一个只清除该文档的状态，任一文档未导出时关闭或替换工作区会警告。工作区事务把项目、Overlay 和两个脏状态作为一个原子快照，因此同一条按时间排序的撤销/重做记录可以恢复任一侧或两侧的变更。

项目节点的事务编辑有显式 allowlist。当前 allowlist 为空：导入的所有建筑节点仍不可写；后续仅可把经文档定义的 Demo `beam` 扩展加入该 allowlist。
