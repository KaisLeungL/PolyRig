# PolyRig Pack Registry 规格说明

> 状态：已由 grill-me 访谈收敛，等待确认后实施。
> 范围：PolyRig 官方平台上的用户上传、审核、分享、下载、安装和更新 pack。
> 非范围：任意第三方 URL 安装、私有团队 pack、评分评论社区、自动后台更新。

## 目标

建立一个 PolyRig pack 分享平台，让用户可以在网站上传 pack，经平台自动校验和人工审核后发布。其他用户复制平台上的 pack 版本页链接，并通过独立的 `polyrig-pack-install` skill 下载、校验、安装到本地 PolyRig pack 根。

这个能力必须保持 PolyRig 现有分层：

- `polyrig`：消费已安装 pack，生成项目上下文。
- `polyrig-pack-author`：创建和维护 pack。
- `polyrig-pack-install`：从 PolyRig 平台下载、校验、安装、更新 pack。
- Pack artifact：仍然是 agent-neutral 的纯数据目录，不变成 skill。

## 核心决策

1. 只允许从 PolyRig 平台下载 pack artifact；下载 skill 不接受 GitHub raw、网盘、任意 zip URL 或第三方 registry URL。
2. 平台允许用户上传 pack，但只有通过平台自动校验和人工审核后的版本才可公开分享和下载。
3. 第一版只支持 GitHub 登录，不接入 Google 登录。
4. GitHub 只作为登录身份；平台使用独立且锁定的 `publisher_slug` 作为发布身份。
5. Published pack 版本不可变；任何内容修改必须发布新版本。
6. 第一版不区分 stable / prerelease；可下载版本只有 `published`。
7. Pack 内部 id 协议保持不变：`stack/<name>` 或 `domain/<name>`。Registry 层负责全局唯一、publisher 元数据和名字争议。
8. 分享链接使用普通 HTTPS canonical pack version URL，不使用自定义协议。
9. 平台可接受用户在网页选择本地 pack 目录；前端打包只用于传输，服务器必须重新校验和规范化打包。
10. 一次上传只允许一个 pack root，根目录下必须直接有 `pack.yaml`、`knowledge/`、`references/`、`verify.md`。
11. 平台发布产物统一为 `.tar.gz` artifact；下载 skill 只接受平台 metadata 指向的标准 artifact。
12. 第一版强制 SHA-256 校验，不强制签名验证；metadata 预留签名字段。
13. Pack artifact 可以包含 `scripts/`，但第一版安装后默认禁用，不执行远程或本地 pack 脚本。
14. 下载默认安装到 `~/.polyrig/packs/`；项目级安装 `<project>/.polyrig/packs/` 必须显式选择。
15. 第一版同一个 pack id 本地只安装一个版本；同 id 不同版本或 checksum 默认阻止覆盖，只有显式 `--replace` 才替换。
16. Published pack 可匿名下载；上传、编辑、提交审核、审核、下架、用户角色管理需要登录和权限。
17. 依赖图在发布时冻结；安装时只按 metadata 中的精确 `resolved_requires` 安装。
18. 本地更新只由用户显式触发，不做自动后台更新。
19. 每次发布新版本必须填写 `release_notes`，并在更新计划中展示。
20. 下架区分 `deprecated` 和 `removed`：deprecated 可警告下载，removed 禁止新下载但保留审计记录。

## 架构

第一版采用独立平台应用，但沿用 PolyRig 协议和 validator。

```text
apps/web
  Next.js App Router + React + TypeScript
  页面、上传表单、审核台、pack 展示页

services/api
  FastAPI
  GitHub OAuth、session、pack 上传、验证、审核、metadata、下载控制

artifact storage
  MVP 可用服务器本地文件目录
  代码接口按对象存储抽象，后续迁移 S3/R2/OSS

skill/polyrig-pack-install
  下载、校验、安装、更新 pack 的 agent 入口

scripts/install-pack.mjs
  deterministic helper：metadata resolve、下载、sha256、安全解包、本地 validate、安装、写元数据
```

部署入口使用同域名路径分流，减少 CORS 和跨站 Cookie 复杂度：

```text
https://polyrig.example.com/              -> Next.js 页面
https://polyrig.example.com/api/...       -> FastAPI API
https://polyrig.example.com/artifacts/... -> artifact 下载入口
```

MVP 可以由 FastAPI `FileResponse` 直出 artifact。上线版走 FastAPI 状态检查和下载记录后，用 Nginx `X-Accel-Redirect` 或等价机制从非公开目录发送文件。

## 发布状态机

Pack version 状态：

```text
draft
  -> submitted
  -> validation_failed
  -> pending_review
  -> rejected
  -> published
  -> deprecated
  -> removed
```

规则：

- `draft`：作者可编辑、可删除。
- `submitted` / `pending_review`：作者可撤回。
- `validation_failed`：作者修复后可重新提交。
- `rejected`：保留审核意见，作者可基于它创建新草稿。
- `published`：可搜索、可分享、可下载、可作为默认更新目标；内容冻结。
- `deprecated`：页面可访问，可警告下载，不作为默认更新目标。
- `removed`：禁止新下载，不作为更新目标，artifact 不物理删除但不公开分发。

## 上传和审核流程

```text
1. 用户 GitHub 登录。
2. 用户确认或创建 publisher_slug。
3. 用户在网页选择一个本地 pack root 目录。
4. 前端读取目录文件树并打包上传。
5. FastAPI 保存短期 original_upload（可选，7-30 天，仅 admin 可见）。
6. FastAPI 解包到隔离临时目录。
7. FastAPI 检查路径穿越、绝对路径、symlink 外跳、危险文件。
8. FastAPI 找到唯一 pack root，并要求根目录直接包含 pack 必需文件。
9. FastAPI 使用固定版本 PolyRig validator 跑 `validate-pack`。
10. 校验失败则进入 `validation_failed`。
11. 校验通过后，服务器重新规范化打包成标准 `.tar.gz` artifact。
12. 服务器计算 sha256，冻结 artifact metadata。
13. 进入 `pending_review`。
14. reviewer / admin 做发布资格审核。
15. 审核通过后进入 `published`，生成 canonical pack version URL。
```

人工审核只做发布资格审核，不代表平台为内容质量背书。审核范围：

- pack 协议结构正确。
- Evidence Matrix 存在且 validator 通过。
- strong rules / red lines 有证据支撑。
- 无明显恶意 prompt、越权指令、要求泄露 secrets、误导性 system 指令。
- `scripts/` 默认禁用，且页面和 metadata 显示 `has_scripts`。
- 版权和来源声明达到最低可接受标准。
- pack id / summary / publisher 没有冒充官方或误导。

页面不使用 `Verified` 作为内容背书，使用 `Platform checks passed` 这类克制措辞。

## 下载和安装流程

用户复制普通 HTTPS 页面链接：

```text
https://polyrig.example.com/packs/domain/stripe-billing/versions/0.1.0
```

`polyrig-pack-install` 解析后只调用稳定 metadata API，不解析 HTML：

```text
GET /api/packs/domain/stripe-billing/versions/0.1.0/install-metadata
```

返回示例：

```json
{
  "status": "published",
  "id": "domain/stripe-billing",
  "version": "0.1.0",
  "canonical_url": "https://polyrig.example.com/packs/domain/stripe-billing/versions/0.1.0",
  "artifact_url": "https://polyrig.example.com/artifacts/domain/stripe-billing/0.1.0/sha256.tar.gz",
  "sha256": "sha256:...",
  "signature": null,
  "signature_algorithm": null,
  "publisher_slug": "kaisleung",
  "has_scripts": false,
  "release_notes": "Initial published version.",
  "resolved_requires": []
}
```

安装步骤：

```text
1. 解析 canonical URL。
2. 请求 metadata API。
3. 确认 status 可安装：published 或用户明确接受 deprecated。
4. 解析 `resolved_requires`，查询本地已安装 pack。
5. 展示安装计划，包含主 pack、依赖、版本、sha256、has_scripts、deprecated 警告。
6. 用户确认。
7. 下载 `.tar.gz` artifact。
8. 计算本地 sha256，必须匹配 metadata。
9. 安全解包到临时目录。
10. 防路径穿越、绝对路径、symlink 外跳。
11. 本地再跑 `validate-pack`。
12. 检查同 id 本地安装冲突。
13. 安装到 `~/.polyrig/packs/<type>/<name>/`，或显式 project-level 目录。
14. 写 `.polyrig-install.json`。
```

本地 `.polyrig-install.json` 示例：

```json
{
  "source": "remote",
  "registry_url": "https://polyrig.example.com",
  "canonical_url": "https://polyrig.example.com/packs/domain/stripe-billing/versions/0.1.0",
  "artifact_id": "art_...",
  "pack_id": "domain/stripe-billing",
  "version": "0.1.0",
  "sha256": "sha256:...",
  "publisher_slug": "kaisleung",
  "installed_at": "2026-07-05T00:00:00Z"
}
```

## 更新流程

本地 pack 不自动后台更新。用户显式触发：

```text
polyrig-pack-install update domain/stripe-billing
polyrig-pack-install update --all
```

更新流程：

```text
1. 读取本地 `.polyrig-install.json`。
2. 请求 registry 查询该 pack id 最高 published 版本。
3. 如果本地已是最高版本，报告 no-op。
4. 展示当前版本、目标版本、release_notes、sha256、publisher、has_scripts、resolved_requires 变化。
5. 检查本地冲突和依赖变化。
6. 用户确认。
7. 按依赖顺序下载、校验、替换。
8. 更新 `.polyrig-install.json`。
```

## 确认点

下载 skill 必须在这些情况停下来请求确认：

- 首次安装任何 pack。
- 安装依赖 pack。
- replace 已有同 id pack。
- update pack。
- 安装 deprecated pack。
- artifact contains scripts。
- 安装到 project-level `.polyrig/packs`。
- conflicts 命中本地已安装 pack。

不需要确认：

- 解析 URL。
- 读取 metadata。
- 检查本地是否已安装。
- 同 checksum 已安装时 no-op。

## 数据模型

建议表：

```text
users
  id
  github_user_id
  github_login
  display_name
  role: user | reviewer | admin
  created_at
  updated_at

publishers
  id
  user_id
  publisher_slug
  locked_at

packs
  id
  pack_id
  type
  name
  publisher_id
  summary
  provides
  compatible_stacks
  current_published_version_id
  created_at
  updated_at

pack_versions
  id
  pack_id
  version
  status
  release_notes
  artifact_path
  sha256
  signature
  signature_algorithm
  has_scripts
  validator_name
  validator_version
  validator_output
  validated_at
  resolved_requires
  conflicts
  last_reviewed
  published_at
  deprecated_at
  removed_at
  removal_reason

reviews
  id
  pack_version_id
  reviewer_user_id
  decision: approved | rejected
  notes
  created_at

downloads
  id
  pack_version_id
  user_id nullable
  ip_hash
  user_agent_hash
  created_at
```

Pack id 在 registry 内全局唯一。官方 / builtin id 保留，高价值通用 id 需要审核，用户不能发布容易冒充官方的 id。

## API 合同草案

公开 API：

```text
GET /api/packs
GET /api/packs/{type}/{name}
GET /api/packs/{type}/{name}/versions/{version}
GET /api/packs/{type}/{name}/versions/{version}/install-metadata
GET /api/packs/{type}/{name}/updates?current_version=...
GET /api/artifacts/{artifact_id}/download
```

登录 API：

```text
GET /api/auth/github/login
GET /api/auth/github/callback
POST /api/auth/logout
GET /api/users/me
```

作者 API：

```text
POST /api/uploads/pack-directory
GET /api/my/packs
GET /api/my/pack-versions/{id}
POST /api/my/pack-versions/{id}/submit
POST /api/my/pack-versions/{id}/withdraw
DELETE /api/my/pack-versions/{id}       # draft only
POST /api/my/published-versions/{id}/request-deprecation
```

审核 API：

```text
GET /api/review/queue
GET /api/review/pack-versions/{id}
POST /api/review/pack-versions/{id}/approve
POST /api/review/pack-versions/{id}/reject
```

Admin API：

```text
GET /api/admin/users
POST /api/admin/users/{id}/role
POST /api/admin/pack-versions/{id}/remove
POST /api/admin/pack-ids/{id}/reserve
```

## 前端页面

第一版页面：

- 首页 / pack 搜索页。
- Pack 详情页。
- Pack version 详情页。
- GitHub 登录入口。
- 用户工作台：我的 packs、上传 pack、草稿、提交审核、验证失败详情。
- 审核台：pending review 队列、验证输出、审核通过/拒绝。
- Admin 用户角色管理和 removed 操作。

Pack 详情页必须展示：

- pack id
- version
- publisher_slug + GitHub 身份
- summary
- type
- provides
- compatible stacks
- requires / conflicts
- release_notes
- last_reviewed
- Platform checks 摘要
- has_scripts 警告
- sha256
- canonical install URL / copy button
- install 命令示例
- deprecated / removed 状态提示

搜索筛选：

- 关键词：id / summary / provides
- type：stack / domain
- compatible stack
- publisher_slug

排序：

- 默认最近发布
- 可选最多下载、最近更新

## 安全边界

- 不接受任意远程 URL 安装。
- 不执行上传 artifact 内的任何脚本。
- 发布端和下载端都要运行 `validate-pack`。
- 发布端 validator 使用平台固定版本，不能信任用户本地验证结果。
- 下载端必须再次本地验证，不能只信任平台 metadata。
- 上传解包必须隔离临时目录，禁止路径穿越、绝对路径、symlink 外跳。
- Session cookie 使用 httpOnly、secure、sameSite。
- GitHub token 不暴露给 Next.js 前端。
- FastAPI 是权限真相源；Next.js 只消费登录态。
- Published artifact 不物理删除，避免破坏审计链。
- Removed artifact 禁止新下载，但保留审计记录。

## 验收标准

1. 用户可以用 GitHub 登录并确认 `publisher_slug`。
2. 用户可以在网页选择一个本地 pack root 目录上传。
3. 服务器能规范化 artifact，运行固定版本 validator，并记录输出。
4. 校验失败的 pack 不能进入审核。
5. reviewer/admin 可以审核通过或拒绝。
6. 审核通过后生成可复制 HTTPS canonical pack version URL。
7. 匿名用户可以读取 published pack metadata 和下载 artifact。
8. `polyrig-pack-install` 可以从 canonical URL 安装 pack 到 `~/.polyrig/packs/`。
9. 安装过程强制 sha256、本地 validate、安全解包、冲突检查。
10. 同 id 不同版本默认不覆盖，显式 replace 才替换。
11. `requires` 依赖按发布时冻结的 `resolved_requires` 展示计划并安装。
12. 本地更新只在用户显式触发时发生，并展示 release_notes 和依赖变化。
13. deprecated 可警告下载；removed 禁止新下载。
14. pack 页面显示平台检查摘要，但不把平台审核表达成内容质量背书。

## 实施前确认 Prompt

如果要进入实施，建议用下面的 prompt 开新任务：

```text
请开始实施 PolyRig Pack Registry 第一版。先阅读：
- docs/plans/2026-07-05-polyrig-pack-registry-spec.md
- docs/plans/2026-07-05-polyrig-pack-registry-implementation.md
- SPEC.md
- docs/pack-protocol.md
- scripts/validate-pack.mjs
- scripts/lib/validate.mjs

请按实施计划 task-by-task 执行，先写测试，再实现。每完成一个任务就运行对应验证，并更新 feature_list.json。不要实现计划之外的功能；不要接入 Google 登录；不要支持任意第三方 URL 下载。
```
