# PolyRig

**通用领域 / 技术栈经验的聚集、封装、与注入协议。**

PolyRig 把来之不易的栈与领域经验沉淀成可复用的 **pack**，再把选中 pack 的知识**注入**
任意技术栈的项目，让 agent 直接照它工作。它**不**生成业务代码——没有登录模块、没有
网络层、没有 UI 模板——也**不**产出项目规格、特性状态机或初始化脚本。它注入的东西
可版本化、可评审、**与具体 agent 无关**：拷进 `.polyrig/vault/` 的 pack 知识、一份带
日期的依赖快照、一份审计 manifest，以及 AGENTS.md / CLAUDE.md 里的**纯路由指针**。
它既能给**新项目冷启动注入**，也能给**已有项目增量注入**——两条路径产出同一套经验产物。

[English](README.md) | 简体中文

## 要解决的问题：冷启动上下文丢失

已经在用 AI 编程工具的工程师，会反复撞上同一堵墙：

- 每个**新项目**冷启动时，AI 对技术栈、业务领域、约束条件一无所知。
- 每个**新会话**都会丢掉上一个会话里做出的工程决策。
- 领域知识最终活在**聊天记录**里，而不是仓库里。

PolyRig 的解法是把经验注入到磁盘上、放进仓库里，用任何 agent 在任何机器上都能读的
格式保存。

## 核心叙事：注入的经验被 agent 正确应用

验收就是一条端到端叙事：

1. 在一个真实的小项目上用 `/polyrig`：**Android + FastAPI + Google 登录**。一次
   对话式的注入流程选定 stack 包和 domain 包，解析它们的依赖，在线核实版本，然后把
   选中 pack 的知识**注入**到 `.polyrig/vault/`，并把路由指针写进 AGENTS.md / CLAUDE.md。
2. 打开一个**零口头上下文的全新会话**——没有聊天历史，除了"看仓库"之外没有任何指示。
3. AI 只依靠磁盘上的经验（`AGENTS.md` 路由指针 → `.polyrig/vault/` 下的 pack 知识、
   `.polyrig/deps.resolved.md`），把任务做对：**不猜安全逻辑、守住 pack 警告过的红线、
   按注入的决策树走**。

如果一个零上下文的会话能正确应用注入的经验——不重新踩 pack 已记录过的坑、不越红线——
这次注入就成立了。这就是全部要点。

## 三层架构

三层绝不能糊成一个"大 prompt 仓库"：

| 层 | 绑定 | 内容 |
|---|---|---|
| 1. 执行层（运行时） | agent 平台适配层 | `skill/polyrig/` —— 初始化项目；`skill/polyrig-pack-author/` —— 创建和维护 pack；`skill/polyrig-pack-install/` —— 从 registry 安装/更新 pack |
| 2. 协议与资产层 | agent 中立 | `packs/{stack,domain}/` + `schemas/`（pack、manifest 的 JSON Schema） |
| 3. 注入产物层 | agent 中立，落在目标项目里 | `.polyrig/vault/stacks/`、`.polyrig/vault/domains/`（拷进的 pack 知识）、`.polyrig/deps.resolved.md`、`.polyrig/manifest.json`，外加 AGENTS.md / CLAUDE.md 里的路由指针托管块 |

v1 的执行入口是一组 PolyRig skills：`/polyrig` 把 pack 经验注入目标项目，
`polyrig-pack-author` 创建和维护 packs，`polyrig-pack-install` 从 PolyRig registry
安装共享的 packs。三者都可安装到 Claude Code、Codex、Cursor、Gemini CLI 和 OpenCode。
长期价值绑定在 **包协议 + 注入到仓库的经验** 上，而不是某一个 agent 运行时。

## 包协议概览

包**默认是数据**，也可以 opt-in 携带 skill（`skills/`，注入时以项目级 symlink 生效）
与示例 script（`scripts/`，作为数据拷贝，从不执行）。两种类型共用一套协议：

- **stack 包** —— 框架约定、项目结构、构建/验证命令、版本坑
  （如 `stack/android`、`stack/backend-fastapi`）。
- **domain 包** —— 业务领域知识（如 `domain/auth-core`、`domain/auth-google`），
  可选提供 per-stack 实现笔记。

关键规则：

- 包的文字部分只放**慢变知识**（决策树、坑点、安全红线）。易变事实（版本号、API
  细节）放在 `deps.yaml` 里，以坐标 + 查询策略的形式存在，注入时在线核实，写入目标
  项目带日期的 `.polyrig/deps.resolved.md`。
- 每个 pack 都携带 `references/sources.md` Evidence Matrix。强规则、红线、推荐默认值
  和依赖 lookup 都必须引用稳定的 `[Evidence: E001]` id，方便后续 agent 审计来源。
- 发现根 —— 内置 `packs/`、用户级 `~/.polyrig/packs/`（兼容旧的
  `~/.claude/polyrig-packs/`）、项目级 `.polyrig/packs/` —— 遵循"越具体越优先"的
  覆盖规则，并配有显式信任模型（项目级包的脚本默认永不执行）。
- 选中的包知识会被**物理拷贝**进目标项目的 `.polyrig/vault/`，随仓库一起走、一起进 git。

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

## Pack group（组）：打包有关联的 packs

有些 pack 只有放在一起才有意义 —— 一个共享基座（如 `domain/auth-core`）加上在它
之上的各家 provider（`domain/auth-google`、`domain/auth-github`）。逐个单独分享会
丢掉关联关系，还会强加发布顺序（provider 无法先于它依赖的 core 发布）。**group**
同时解决这两点。

group 是一个**版本化、引用式的清单** —— `group/<name>` 命名空间下的
`groups/<name>/group.yaml` —— 用**精确锁定的版本**列出成员 pack。成员 pack 在磁盘上
仍然原子、独立（像 `auth-core` 这样的成员仍可单装、也可被别处依赖）；组只是一份指向
它们的策划清单：

```yaml
# groups/auth/group.yaml
id: group/auth
version: 0.1.0
last_reviewed: 2026-07-06
summary: OAuth/OIDC sign-in suite — shared auth-core plus Google and GitHub providers
members:
  - id: domain/auth-core
    version: 0.1.0
  - id: domain/auth-google
    version: 0.1.0
  - id: domain/auth-github
    version: 0.1.0
requires: []            # 对组外 pack 的精确锁定引用（如果有）
```

组对其**成员依赖闭合**（每个成员的 `requires` 都能解析到同组的另一个成员，或组级
`requires` 里声明的组外 pack），且 `requires` 图必须无环 —— `validate-group.mjs` 会
强制这些规则外加版本匹配、无重复。`/polyrig` 访谈会把兼容的组作为"套餐"选项呈现，
选中即按依赖顺序纳入全部成员。

**打包上传。** 组在磁盘上保持引用式，所以发布它需要一个把 `group.yaml` 和各成员收拢
在一起的归档。`polyrig` CLI 不复制文件就能做到 —— 它把分散的成员**流式**打成一个
`.tar.gz`（打包前先校验组）：

```sh
polyrig pack-group groups/auth
# -> tmp/auth-0.1.0.tar.gz   （仅用于传输；上传后可删）
```

然后把这个归档上传到 [polyrig.dev](https://polyrig.dev)。服务器会重新解包、
**对整组做联合校验**（组内 `requires` 在这一批里解析，因此没有发布顺序问题），
并原子地发布全部成员。`polyrig-pack-author` skill 会引导你创建 `group.yaml` 并打包，
所以你很少需要手敲这条命令。

**安装组**是镜像操作：组有自己的 canonical URL（`/groups/<name>/versions/<version>`）。
粘贴组 URL 会按依赖顺序整组安装；粘贴成员 pack URL 则软引导安装整组，同时也允许只单装
该 pack（会拉入该 pack 的 `requires` 闭包，但不带组内兄弟）。

## v0.2 新增

v0.1 验证了核心循环——一个零上下文会话正确应用了从 pack 注入的经验。v0.2 把它变成
可安装、可分享的东西：

- **一条命令安装。** 已发布到 npm；`npx polyrig install` 暂存运行时并链接 skill——
  无需 clone、无需构建步骤。（见「安装」小节。）
- **pack 编写。** `polyrig-pack-author` skill 按 schema 创建和维护 pack，强制
  Evidence Matrix,并有两遍 reviewer 审核门槛。（见「编写 pack」小节。）
- **Registry 闭环。** `polyrig-pack-install` 加上 [polyrig.dev](https://polyrig.dev)
  闭合分享循环：在浏览器发布、从 canonical URL 安装、显式更新。（见「Registry」小节。）
- **两个新内置 pack。** `stack/nextjs`（App Router 前端约定）和
  `domain/auth-github`（GitHub 登录）——内置包增至七个。
- **Pack group（组）。** 把有关联的 pack 打包成版本化的 `group/<name>`，作为一个
  整体的安装/发布单位；auth 三件套现在就是 `group/auth`。
  （见 [Pack group](#pack-group组打包有关联的-packs)。）

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

三个 auth pack 同时打包为内置的 **`group/auth`** 套餐（`groups/auth/group.yaml`）
—— 可以一步装好整套登录能力，也可以只单装其中某个成员。见
[Pack group](#pack-group组打包有关联的-packs)。

黄金路径（Android + FastAPI + Google Sign-In）仍是端到端验收演示：它证明注入到 vault
的经验能被一个守住红线的零上下文 agent 正确消费。次级验收门槛：
`scripts/validate-pack.mjs` 在所有内置包上通过；注入的 `.polyrig/manifest.json` 能通过
`schemas/` 校验（由 `scripts/validate-artifacts.mjs` 检查）。

## 非目标

- 生成业务代码骨架。
- 与 create-next-app / Nx / projen 这类脚手架竞争。
- 真实 TUI —— 交互形式是对话式访谈。
- 发布 CLI —— 上传 pack 和提交审核都在 [polyrig.dev](https://polyrig.dev) 的浏览器里
  完成；本地命令只有安装/更新。

## 许可证

[MIT](LICENSE) © 2026 kaisleung
