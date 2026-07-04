# PolyRig Pack Author 规格说明

> 状态：已由 grill-me 访谈收敛，等待实施。
> 范围：协议升级 + `polyrig-pack-author` skill + 现有 builtin packs 迁移。

## 目标

实现一个独立的 `polyrig-pack-author` skill，用引导式访谈帮助用户创建或更新 PolyRig pack。它必须能把领域边界、官方来源、可靠性/安全资料、验证路线和证据链整理成协议合规的 pack，并在最后通过本地验证和两个 sub agents 审稿后才报告 ready。

这个功能不是 `/polyrig` 的 mode。职责边界如下：

- `/polyrig`：消费 packs，初始化目标项目。
- `polyrig-pack-author`：生产和维护 packs。
- `validate-pack.mjs`：验证 pack 协议和 Evidence Matrix。

默认写入用户级 pack 根 `~/.polyrig/packs/`。只有用户明确选择时，才写入目标项目 `<target>/.polyrig/packs/` 或 PolyRig builtin `packs/`。

## 非目标

- 本轮不内置 `stack/ios`、`stack/macos` packs；后续用新 skill dogfood 生成。
- 不自动 clone 远程仓库；只支持本地文件/目录、用户粘贴材料、主题访谈和 web search。
- 默认不生成 pack `scripts/`；只有用户明确要求确定性检查时才生成，并且脚本必须测试。
- 不把当前版本号、最新 API 细节、易变事实写进 `knowledge/*.md`。

## 语言规则

- 访谈默认英文，用户可切换中文。
- pack 产物默认英文。
- 只有用户明确要求时，pack 产物才使用中文。
- 最终报告跟随用户当前语言。

## Pack Authoring Workflow

`polyrig-pack-author` 使用六阶段访谈。

1. Pack identity
   - 判断 create 或 update。
   - 确认 pack 类型：`stack` 或 `domain`。
   - 确认 pack id，例如 `stack/ios`、`domain/auth-apple`。
   - 确认写入位置，默认 `~/.polyrig/packs/`。

2. Use cases
   - 这个 pack 要帮助未来 agent 做哪些决策。
   - 哪些任务应该触发这个 pack。
   - 哪些使用场景必须被验证。

3. Boundaries
   - 明确覆盖范围和不覆盖范围。
   - domain pack 需要确认兼容 stacks。
   - 确认 `requires`、`conflicts`、`provides`。

4. Source plan
   - 默认自动 web search，但开始前告知搜索范围。
   - 搜索官方文档、标准文档、安全/隐私/可靠性文档、vendor 文档。
   - 可读取用户给定本地材料或粘贴材料。
   - 不把论坛、营销博客、社交媒体当成权威来源。

5. Knowledge extraction
   - `overview.md`：慢变决策树、原则、推荐默认值。
   - `pitfalls.md`：红线、常见失败模式、必须避免的做法。
   - `deps.yaml`：易变事实的 lookup 策略和官方来源。
   - `verify.md`：可验证的完成标准。
   - `references/sources.md`：Evidence Matrix。

6. Review gate
   - 先落盘草案。
   - 运行增强后的 `validate-pack.mjs`。
   - 调用两个 sub agents：协议/结构审稿、内容/安全审稿。
   - 只有脚本验证通过且两个 sub agents 无 blocking issues，才报告 pack ready。
   - 未通过时保留草案，报告 draft written 和阻塞项。

## Evidence Matrix 协议

Evidence Matrix 成为正式 pack 协议要求。每个 pack 必须包含：

```text
references/sources.md
```

`sources.md` 使用 Markdown 表格，并提供稳定 evidence id：

```md
# Sources

## Evidence Matrix

| id | claim | status | source_type | urls | applies_to | volatility | notes |
|---|---|---|---|---|---|---|---|
| E001 | SwiftUI is the default UI layer for new iOS app surfaces unless UIKit integration is required. | source-backed | official | https://developer.apple.com/xcode/swiftui/ | knowledge/overview.md#ui-layer | low | Slow-changing default; exact APIs belong in deps.yaml. |
```

字段约束：

- `id`: `E001` 格式，递增且唯一。
- `claim`: 被支撑的判断。
- `status`: `source-backed | user-provided | inferred | unverified`。
- `source_type`: 可包含 `official | standard | security | reliability | vendor | user | inference`。
- `urls`: URL 或 `local:<path>` / `local:interview`。
- `applies_to`: 影响哪些 pack 文件或 section。
- `volatility`: `low | medium | high`。
- `notes`: 说明来源如何使用；易变内容是否进入 `deps.yaml`。

核心 pack 文件用 inline marker 引用 evidence：

```md
Never commit signing keys or provisioning artifacts. [Evidence: E004, E007]
```

`deps.yaml` 每个 dependency entry 必须包含：

```yaml
evidence: [E010, E011]
```

## Validator 要求

增强 `scripts/lib/validate.mjs` 和 `scripts/validate-pack.mjs`，把 Evidence Matrix 纳入正式验证。

必须校验：

- `references/sources.md` 存在。
- 包含 `## Evidence Matrix` 标题。
- 表格包含列：`id, claim, status, source_type, urls, applies_to, volatility, notes`。
- evidence id 唯一，符合 `E\d{3}`。
- `status` 和 `volatility` 值合法。
- 所有 `[Evidence: ...]` 引用都能找到对应 id。
- `deps.yaml` 中 `evidence: [...]` 引用都存在。
- `deps.yaml` 每个 dependency entry 缺 `evidence` 视为错误。
- 强规则启发式：包含 `RED LINE`, `must`, `never`, `required`, `do not`, `禁止`, `必须`, `绝不` 等词的行/段必须有 evidence marker。
- 强规则不能引用 `unverified` evidence。
- 强规则如果只引用 `inferred` evidence，视为错误；至少需要 `source-backed` 或 `user-provided`。

验证器不做完整语义证明，只做可确定的结构、引用和强规则启发式校验。

## Builtin Pack 迁移

现有 builtin packs 必须最小迁移，不重写知识正文：

- `packs/stack/android`
- `packs/stack/backend-fastapi`
- `packs/domain/auth-core`
- `packs/domain/auth-google`

迁移规则：

- 保留现有 `overview.md`、`pitfalls.md`、`verify.md` 结构。
- 给红线、强约束、推荐默认值补 `[Evidence: E...]`。
- 新增 `references/sources.md`。
- `deps.yaml` 每个 dependency 补 `evidence: [...]`。
- 只在发现明显违反新协议的句子时小修。

## `/polyrig` 变更

`/polyrig` 复制 pack knowledge 时也复制 evidence：

- stack pack: `references/sources.md` -> `<target>/docs/stacks/<short-id>/sources.md`
- domain pack: `references/sources.md` -> `<target>/docs/domains/<short-id>/sources.md`

`AGENTS.md` routing 需要说明：

- 正常实现优先读 `overview.md`、`pitfalls.md`、`verify.md`。
- 遇到强规则争议、依赖更新、安全/可靠性审计、来源追溯时读 `sources.md`。

`.polyrig/manifest.json` checksum 计算包含 copied sources。

## `polyrig-pack-author` Skill 结构

```text
skill/polyrig-pack-author/
  SKILL.md
  agents/openai.yaml
  references/
    pack-authoring-contract.md
    review-prompts.md
  assets/
    pack-template/
      pack.yaml
      knowledge/
        overview.md
        pitfalls.md
      references/
        sources.md
      deps.yaml
      verify.md
```

`review-prompts.md` 固定两个 sub agent 审稿 prompt：

- Protocol / structure reviewer
- Content / safety reviewer

## 安装器变更

`scripts/link-skill.mjs` 同时安装：

- `polyrig`
- `polyrig-pack-author`

已支持平台继续沿用现有策略：

- Claude Code / Codex：原生 skill link。
- Cursor / Gemini CLI / OpenCode：managed pointer/context。

Smoke test 必须覆盖两个 skills。

## 验收标准

1. 协议层
   - Evidence Matrix 被正式验证。
   - 现有 4 个 builtin packs 全部通过增强验证。

2. skill 层
   - `polyrig-pack-author` 文件结构完整。
   - skill 明确六阶段访谈、web search、create/update、draft/ready gate、双 sub agent review。

3. 安装层
   - `link-skill.mjs` 同时安装两个 skills。
   - smoke test 覆盖两个 skills。

4. 生成层
   - 使用模板或 fixture 生成一个最小 user-level pack，增强验证通过。

5. 审稿层
   - 固定两个 review prompt。
   - 实施完成后用 sub agent 对 skill 或生成 pack 做审稿；如果环境没有 subagent 工具，最终报告必须说明未执行。
