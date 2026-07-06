# PolyRig

**通用 AI harness 包协议与上下文装配系统。**

PolyRig 把任意技术栈的项目初始化为 **agent-ready 的仓库**。它**不**生成业务代码——
没有登录模块、没有网络层、没有 UI 模板。它生成的是 AI 编程所需要的上下文层：
结构化需求、带理由的技术决策、上下文路由、依赖查询策略、验证路线，以及一个持久化的
特性状态机——全部可版本化、可评审、**与具体 agent 无关**。

[English](README.md) | 简体中文

## 要解决的问题：冷启动上下文丢失

已经在用 AI 编程工具的工程师，会反复撞上同一堵墙：

- 每个**新项目**冷启动时，AI 对技术栈、业务领域、约束条件一无所知。
- 每个**新会话**都会丢掉上一个会话里做出的工程决策。
- 领域知识最终活在**聊天记录**里，而不是仓库里。

PolyRig 的解法是把上下文落在磁盘上、放进仓库里，用任何 agent 在任何机器上都能读的
格式保存。

## 核心叙事：一次真实的冷启动演示

v0.1 的验收就是一条端到端叙事：

1. 用 `/polyrig` 初始化一个真实的小项目：**Android + FastAPI + Google 登录**。
   一次对话式的七阶段访谈选定 stack 包和 domain 包，记录约束，定义第一个特性及其
   验证路线，然后生成全部上下文产物。
2. 打开一个**零口头上下文的全新会话**——没有聊天历史，除了"看仓库"之外没有任何指示。
3. AI 只依靠磁盘上的产物（`SPEC.md`、`AGENTS.md`、`feature_list.json`、拷贝进
   `docs/` 的包知识），把第一个特性一路实现到**通过验证**，并在过程中自行推进特性
   状态机（`planned → in_progress → implemented → verified`）。

如果一个零上下文的会话能把一个特性推到 verified，这个仓库就是 agent-ready 的。
这就是全部要点。

## 三层架构

三层绝不能糊成一个"大 prompt 仓库"：

| 层 | 绑定 | 内容 |
|---|---|---|
| 1. 执行层（运行时） | agent 平台适配层 | `skill/polyrig/` —— 初始化项目；`skill/polyrig-pack-author/` —— 创建和维护 pack；`skill/polyrig-pack-install/` —— 从 registry 安装/更新 pack |
| 2. 协议与资产层 | agent 中立 | `packs/{stack,domain}/` + `schemas/`（pack、feature_list、manifest 的 JSON Schema） |
| 3. 生成产物层 | agent 中立，落在目标项目里 | SPEC.md、AGENTS.md、CLAUDE.md、feature_list.json、docs/stacks/、docs/domains/、docs/verify.md、deps.resolved.md、.polyrig/manifest.json、init.plan.md、init.sh |

v1 的执行入口是一组 PolyRig skills：`/polyrig` 初始化目标项目，
`polyrig-pack-author` 创建和维护 packs，`polyrig-pack-install` 从 PolyRig registry
安装共享的 packs。三者都可安装到 Claude Code、Codex、Cursor、Gemini CLI 和 OpenCode。
长期价值绑定在 **包协议 + 生成的仓库上下文** 上，而不是某一个 agent 运行时。

## 包协议概览

包是一个**纯数据目录**——永远不是 skill，不占用任何 skill 触发预算。两种类型共用
一套协议：

- **stack 包** —— 框架约定、项目结构、构建/验证命令、版本坑
  （如 `stack/android`、`stack/backend-fastapi`）。
- **domain 包** —— 业务领域知识（如 `domain/auth-core`、`domain/auth-google`），
  可选提供 per-stack 实现笔记。

关键规则：

- 包的文字部分只放**慢变知识**（决策树、坑点、安全红线）。易变事实（版本号、API
  细节）放在 `deps.yaml` 里，以坐标 + 查询策略的形式存在，装配时在线核实，写入目标
  项目带日期的 `deps.resolved.md`。
- 每个 pack 都携带 `references/sources.md` Evidence Matrix。强规则、红线、推荐默认值
  和依赖 lookup 都必须引用稳定的 `[Evidence: E001]` id，方便后续 agent 审计来源。
- 发现根 —— 内置 `packs/`、用户级 `~/.polyrig/packs/`（兼容旧的
  `~/.claude/polyrig-packs/`）、项目级 `.polyrig/packs/` —— 遵循"越具体越优先"的
  覆盖规则，并配有显式信任模型（项目级包的脚本默认永不执行）。
- 选中的包知识会被**物理拷贝**进目标项目，随仓库一起走、一起进 git。

## 编写 pack：`polyrig-pack-author`

`/polyrig` 只**消费** pack。`polyrig-pack-author` 是它的姐妹 skill，负责**创建和
维护** pack —— 教会 PolyRig 一个新技术栈或业务领域的工作流，而不是照着 schema
手写 `pack.yaml` 和 Markdown。

用 `/polyrig-pack-author` 触发，或者直接用自然语言提出需求。示例：

- `/polyrig-pack-author 帮我创建一个 Next.js 的 stack pack` —— 新建 stack 包，
  默认写入 `~/.polyrig/packs/stack/nextjs/`。
- `/polyrig-pack-author 创建一个 Stripe 计费的 domain pack，兼容 backend-fastapi`
  —— 新建 domain 包，`stacks: [backend-fastapi]`，并生成
  `knowledge/per-stack/backend-fastapi.md`。
- `/polyrig-pack-author 更新 packs/stack/android —— 刷新 last_reviewed，补充一条
  关于 predictive back 的坑` —— 就地更新已有的 pack。

它跑六个阶段（pack 身份 → 使用场景 → 边界 → 信息源计划 → 知识提取 → 评审关卡）：
慢变决策写进 `knowledge/*.md`，易变事实（版本号、API 面）写进 `deps.yaml` 作为查询
策略，每条强规则或依赖 lookup 都必须在 `references/sources.md` 里引用稳定的
`[Evidence: E001]` 风格 id。在把 pack 报告为 `ready` 之前，它会在独立上下文里跑
`scripts/validate-pack.mjs`，再跑两个固定的 reviewer（protocol/structure、
content/safety）——绝不在编写上下文里自我审查。

## 安装

一条命令，不需要 clone：

```sh
npx polyrig install
```

`npx` 会下载已发布的 npm 包（其中打包了 skill 运行时所需的 packs、scripts、
schemas），然后运行安装脚本。安装脚本会先把**运行时暂存**到 `~/.polyrig/runtime`
——这是一个不受 npx 缓存清理影响的稳定目录——再把 `/polyrig`、
`/polyrig-pack-author` 和 `/polyrig-pack-install` 三个 skill 以 symlink 安装到你本机的
agent 平台，并把 `POLYRIG_ROOT` 指向该运行时。随时重跑同一条命令即可升级。

如果你打算靠 `git pull` 跟踪更新，或者想要 symlink 跟随同一份 checkout，优先用本地
clone —— 在 git checkout 下安装脚本会跳过暂存、直接把 skill symlink 到仓库，改动即时
生效：

```sh
git clone https://github.com/KaisLeungL/PolyRig.git && cd PolyRig
node scripts/link-skill.mjs
```

两种方式底层都是：零依赖 Node 脚本、没有 workspace 工具链、没有构建步骤。默认会把
三个 skill 安装到所有已支持的本机 agent 平台：Claude Code 和 Codex 使用原生 skill
链接（加 `--copy` 则是拷贝）；Cursor、Gemini CLI 和 OpenCode 写入受管理的
pointer/context 文件。只安装单个平台，在以上任一条命令后加
`--platform claude-code|codex|cursor|gemini-cli|opencode`。

## Registry：分享 packs

Packs 通过 PolyRig registry —— **[polyrig.dev](https://polyrig.dev)** —— 分享。
它闭合了三个 skill 打开的循环：`polyrig-pack-author` **创建** pack，registry
**发布** pack，`polyrig-pack-install` **安装** pack 供 `/polyrig` 消费。registry
是一个独立应用（FastAPI + Next.js），只负责提供 metadata 和 artifact —— 本地的
安装/更新客户端随 PolyRig 一起分发，并且绝不信任任何它无法重新验证的东西。

**发布**（在浏览器里完成，没有 CLI）：GitHub 登录 → 确认锁定的 `publisher_slug`
→ 在 `/dashboard/upload` 上传 pack root（`pack.yaml`、`knowledge/`、
`references/`、`verify.md`）→ 服务器用**固定版本** validator 重新校验并重新打包成
canonical、sha256 冻结的 `.tar.gz` → 提交草稿进入审核 → reviewer 审核发布资格通过
→ 得到一个不可变的 canonical 版本 URL 用于分享：

```text
https://polyrig.dev/packs/<type>/<name>/versions/<version>
```

**安装**（粘贴该 URL，让 skill 驱动）：

```sh
export POLYRIG_REGISTRY_URL=https://polyrig.dev
node "$POLYRIG_ROOT/scripts/install-pack.mjs" install \
  https://polyrig.dev/packs/domain/stripe-billing/versions/0.1.0 --yes
```

安装器会校验 sha256、安全解包、在本地重跑 `validate-pack`、安装到
`~/.polyrig/packs/<type>/<name>/`，并按发布时冻结的依赖一并安装。`update
<type>/<name>` 或 `update --all` 显式升级 —— 没有后台自动更新。已发布版本不可变；
`deprecated` 下载时警告，`removed` 禁止新下载。

## v0.2 新增

v0.1 验证了核心循环——一个零上下文会话把功能做到 verified。v0.2 把它变成可安装、
可分享的东西：

- **一条命令安装。** 已发布到 npm；`npx polyrig install` 暂存运行时并链接 skill——
  无需 clone、无需构建步骤。（见「安装」小节。）
- **pack 编写。** `polyrig-pack-author` skill 按 schema 创建和维护 pack，强制
  Evidence Matrix,并有两遍 reviewer 审核门槛。（见「编写 pack」小节。）
- **Registry 闭环。** `polyrig-pack-install` 加上 [polyrig.dev](https://polyrig.dev)
  闭合分享循环：在浏览器发布、从 canonical URL 安装、显式更新。（见「Registry」小节。）
- **两个新内置 pack。** `stack/nextjs`（App Router 前端约定）和
  `domain/auth-github`（GitHub 登录）——内置包增至七个。

## 内置 packs

深度优先于广度：聚焦的一组内置包，一个端到端演示。

- `stack/android`
- `stack/ios`
- `stack/backend-fastapi`
- `stack/nextjs` —— App Router 前端：server/client 边界、数据获取/缓存、
  session 消费、通过 server action / route handler 做 mutation *(v0.2 新增)*
- `domain/auth-core` —— 共享的 OAuth/OIDC 架构、token/会话处理、
  CSRF/nonce/state、安全存储原则
- `domain/auth-google` —— 依赖 auth-core；提供 android + backend-fastapi 的
  per-stack 笔记
- `domain/auth-github` —— 依赖 auth-core；GitHub OAuth authorization-code 流；
  提供 backend-fastapi + nextjs 的 per-stack 笔记 *(v0.2 新增)*

v0.1 的黄金路径（Android + FastAPI + Google Sign-In）仍是端到端验收演示。次级验收
门槛：`scripts/validate-pack.mjs` 在所有内置包上通过；生成的产物能通过 `schemas/`
校验（由 `scripts/validate-artifacts.mjs` 检查）。

## 非目标

- 生成业务代码骨架。
- 与 create-next-app / Nx / projen 这类脚手架竞争。
- 真实 TUI —— 交互形式是对话式访谈。
- 发布 CLI —— 上传 pack 和提交审核都在 [polyrig.dev](https://polyrig.dev) 的浏览器里
  完成；本地命令只有安装/更新。

## 许可证

[MIT](LICENSE) © 2026 kaisleung
