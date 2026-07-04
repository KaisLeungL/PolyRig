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

三层绝不能糊成一个"大 prompt 仓库"（详见 [docs/architecture.md](docs/architecture.md)）：

| 层 | 绑定 | 内容 |
|---|---|---|
| 1. 执行层（运行时） | agent 平台适配层 | `skill/polyrig/` —— 初始化项目；`skill/polyrig-pack-author/` —— 创建和维护 pack |
| 2. 协议与资产层 | agent 中立 | `packs/{stack,domain}/` + `schemas/`（pack、feature_list、manifest 的 JSON Schema） |
| 3. 生成产物层 | agent 中立，落在目标项目里 | SPEC.md、AGENTS.md、CLAUDE.md、feature_list.json、docs/stacks/、docs/domains/、docs/verify.md、deps.resolved.md、.polyrig/manifest.json、init.plan.md、init.sh |

v1 的执行入口是一组 PolyRig skills：`/polyrig` 初始化目标项目，
`polyrig-pack-author` 创建和维护 packs。两者都可安装到 Claude Code、Codex、Cursor、
Gemini CLI 和 OpenCode。长期价值绑定在 **包协议 + 生成的仓库上下文** 上，而不是某一个
agent 运行时。

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

完整协议与完整示例：[docs/pack-protocol.md](docs/pack-protocol.md)。

## 安装

```sh
node scripts/link-skill.mjs
```

纯 git 仓库、零依赖 Node 脚本、没有 workspace 工具链、没有构建步骤。默认会把
`skill/polyrig/` 和 `skill/polyrig-pack-author/` 安装到所有已支持的本机 agent 平台：
Claude Code 和 Codex 使用原生 skill 链接；Cursor、Gemini CLI 和 OpenCode 写入受管理的
pointer/context 文件。只安装单个平台可用
`--platform claude-code|codex|cursor|gemini-cli|opencode`。

## v0.1 范围 —— 黄金路径

深度优先于广度：四个内置包，一个端到端演示。

- `stack/android`
- `stack/backend-fastapi`
- `domain/auth-core` —— 共享的 OAuth/OIDC 架构、token/会话处理、
  CSRF/nonce/state、安全存储原则
- `domain/auth-google` —— 依赖 auth-core；提供 android + backend-fastapi 的
  per-stack 笔记

次级验收门槛：`scripts/validate-pack.mjs` 在所有内置包上通过；生成的产物能通过
`schemas/` 校验。

## 路线图

| 版本 | 范围 |
|---|---|
| v0.2 | `stack/web-nextjs`、auth-google 的 web 笔记 |
| v0.3 | `stack/ios`、`domain/auth-apple` |
| v0.4 | `domain/auth-wechat`（中国生态特有事项） |
| 之后 | `polyrig-update` 升级命令、远程包 |

## 非目标

- 生成业务代码骨架。
- 与 create-next-app / Nx / projen 这类脚手架竞争。
- 真实 TUI —— 交互形式是对话式访谈。
- 远程包分发与包升级工具（推迟；manifest 已经记录了升级命令所需的一切）。

## 许可证

[MIT](LICENSE) © 2026 kaisleung
