# PolyRig Pack Author Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 `polyrig-pack-author`，并把 Evidence Matrix 升级为 PolyRig pack 的正式协议要求。

**Architecture:** 保持 `/polyrig` 负责消费 pack，新增 `polyrig-pack-author` 负责创建/更新 pack。Evidence Matrix 进入 pack validator，现有 builtin packs 做最小 evidence 迁移，`/polyrig` 复制 sources 但不把 sources 作为日常必读上下文。

**Tech Stack:** 零依赖 Node.js `.mjs` 脚本、PolyRig YAML 子集解析器、Markdown pack 文件、Codex/Claude-style skills。

---

## 前置上下文

阅读这些文件后再实施：

- `docs/plans/2026-07-04-polyrig-pack-author-spec.md`
- `docs/authoring-packs.md`
- `docs/pack-protocol.md`
- `schemas/pack.schema.json`
- `scripts/lib/validate.mjs`
- `scripts/validate-pack.mjs`
- `scripts/link-skill.mjs`
- `skill/polyrig/SKILL.md`
- `skill/polyrig/templates/AGENTS.md`
- `feature_list.json`

实施必须遵守：

- 默认中文沟通，文档优先中文。
- TDD：行为变更先写失败测试，再实现。
- 不重写现有 pack 正文，只做最小 evidence 迁移。
- user-level pack 生成不改 `feature_list.json`；本仓库协议/skill 变更需要更新 `feature_list.json`。

## Task 1: Evidence Matrix 失败测试

**Files:**

- Create: `scripts/test-validate-pack-evidence.mjs`
- Read: `scripts/validate-pack.mjs`
- Read: `scripts/lib/validate.mjs`

**Step 1: 写失败测试脚本**

创建零依赖 smoke test，在临时目录构造多个 pack fixture：

1. 缺 `references/sources.md` 应失败。
2. `sources.md` 缺 `## Evidence Matrix` 应失败。
3. Evidence id 重复应失败。
4. `overview.md` 有 `must` 但无 `[Evidence: E001]` 应失败。
5. 强规则引用 `unverified` evidence 应失败。
6. `deps.yaml` dependency 缺 `evidence` 应失败。
7. 一个完整 pack 应通过。

测试使用 `execFileSync(process.execPath, ['scripts/validate-pack.mjs', packDir])` 调用真实 validator。

**Step 2: 运行测试确认失败**

Run:

```bash
node scripts/test-validate-pack-evidence.mjs
```

Expected: FAIL，原因是当前 validator 还不要求 Evidence Matrix。

**Step 3: 提交红灯测试**

不要提交，只进入 Task 2 实现；最终按任务批次提交。

## Task 2: 增强 validator

**Files:**

- Modify: `scripts/lib/validate.mjs`
- Modify: `scripts/validate-pack.mjs` only if CLI output needs adjustment
- Test: `scripts/test-validate-pack-evidence.mjs`

**Step 1: 实现 sources.md 解析**

在 `validatePackDir` 中新增结构检查：

- `references/sources.md` 必须存在且非空。
- 必须包含 `## Evidence Matrix`。
- 解析 Markdown 表格 header，要求列：
  `id, claim, status, source_type, urls, applies_to, volatility, notes`

保持解析简单：只处理 pipe table，不做复杂 Markdown AST。

**Step 2: 实现 evidence id/status 校验**

检查：

- id 符合 `E\d{3}`。
- id 唯一。
- status 属于 `source-backed | user-provided | inferred | unverified`。
- volatility 属于 `low | medium | high`。

**Step 3: 实现 evidence 引用校验**

扫描这些文件：

- `knowledge/**/*.md`
- `verify.md`

提取 `[Evidence: E001]` 和 `[Evidence: E001, E002]`。

检查：

- 引用 id 必须存在。
- 强规则行/段必须带 evidence marker。
- 强规则引用 `unverified` 报错。
- 强规则如果只引用 `inferred` 报错。

强规则词初版：

```js
[
  'RED LINE',
  'must',
  'never',
  'required',
  'do not',
  '禁止',
  '必须',
  '绝不'
]
```

**Step 4: 实现 deps.yaml evidence 校验**

扩展当前 deps 校验：

- 每个 dependency entry 必须有 `evidence` 数组。
- 每个 evidence id 必须存在。

**Step 5: 运行红灯测试转绿**

Run:

```bash
node scripts/test-validate-pack-evidence.mjs
```

Expected: PASS。

## Task 3: 迁移 builtin packs 到 Evidence Matrix

**Files:**

- Modify: `packs/stack/android/**`
- Modify: `packs/stack/backend-fastapi/**`
- Modify: `packs/domain/auth-core/**`
- Modify: `packs/domain/auth-google/**`

**Step 1: 为每个 pack 新增 sources.md**

每个 pack 创建：

```text
references/sources.md
```

包含 Evidence Matrix 表格。

要求：

- 不追求大量来源，追求覆盖现有强规则、红线、推荐默认值。
- source_type 用 `official`, `security`, `vendor`, `standard`, `user`, `inference` 等。
- 对现有知识中无法稳定溯源但合理的经验判断，标为 `inferred`，不要用于强规则。

**Step 2: 给 Markdown 强规则补 marker**

最小编辑：

- 不重写正文。
- 对 `RED LINE`、`must`、`never`、`required`、`do not` 等强规则行补 `[Evidence: E...]`。
- 如果一句强规则暂时只能 inferred，要改成非强规则表述，或补 source-backed/user-provided evidence。

**Step 3: 给 deps.yaml 补 evidence**

每个 dependency entry 增加：

```yaml
evidence: [E001]
```

引用 sources 中对应官方来源。

**Step 4: 验证四个 builtin packs**

Run:

```bash
node scripts/validate-pack.mjs packs/stack/android
node scripts/validate-pack.mjs packs/stack/backend-fastapi
node scripts/validate-pack.mjs packs/domain/auth-core
node scripts/validate-pack.mjs packs/domain/auth-google
```

Expected: all PASS。

## Task 4: 更新 `/polyrig` 复制 sources

**Files:**

- Modify: `skill/polyrig/SKILL.md`
- Modify: `skill/polyrig/templates/AGENTS.md`
- Modify: `docs/pack-protocol.md`
- Modify: `docs/architecture.md`
- Test: add or update a script if an existing smoke test can cover copy contract

**Step 1: 更新 SKILL.md P7 copy 规则**

在 copy pack knowledge 步骤中加入：

- 复制 `references/sources.md`。
- stack -> `docs/stacks/<short-id>/sources.md`
- domain -> `docs/domains/<short-id>/sources.md`
- checksum 包含 sources。

**Step 2: 更新 AGENTS 模板 routing**

说明：

- 日常实现先读 `overview.md`、`pitfalls.md`、`verify.md`。
- 遇到强规则争议、依赖更新、安全/可靠性审计、来源追溯时读 `sources.md`。

**Step 3: 更新协议文档**

同步 `docs/pack-protocol.md` 和 `docs/architecture.md`。

**Step 4: 验证文本合同**

Run:

```bash
rg -n "sources.md|Evidence Matrix" skill/polyrig docs
```

Expected: `/polyrig` 和 docs 都包含 sources copy/routing 说明。

## Task 5: 新增 polyrig-pack-author skill

**Files:**

- Create: `skill/polyrig-pack-author/SKILL.md`
- Create: `skill/polyrig-pack-author/agents/openai.yaml`
- Create: `skill/polyrig-pack-author/references/pack-authoring-contract.md`
- Create: `skill/polyrig-pack-author/references/review-prompts.md`
- Create: `skill/polyrig-pack-author/assets/pack-template/pack.yaml`
- Create: `skill/polyrig-pack-author/assets/pack-template/knowledge/overview.md`
- Create: `skill/polyrig-pack-author/assets/pack-template/knowledge/pitfalls.md`
- Create: `skill/polyrig-pack-author/assets/pack-template/references/sources.md`
- Create: `skill/polyrig-pack-author/assets/pack-template/deps.yaml`
- Create: `skill/polyrig-pack-author/assets/pack-template/verify.md`

**Step 1: 写 SKILL.md frontmatter**

Name:

```yaml
name: polyrig-pack-author
```

Description 必须覆盖触发场景：

- create/update PolyRig pack
- generate stack/domain pack
- add Evidence Matrix
- author user/project/builtin pack
- search official docs and validate pack

**Step 2: 写六阶段 workflow**

SKILL.md 保持 lean，详细规则放 reference：

- Pack identity
- Use cases
- Boundaries
- Source plan
- Knowledge extraction
- Review gate

**Step 3: 写 pack-authoring-contract.md**

包含完整合同：

- 默认写入 `~/.polyrig/packs/`
- create/update 策略
- web search 边界
- Evidence Matrix 要求
- draft/ready gate
- scripts 默认不生成
- user/project/builtin 写入规则

**Step 4: 写 review-prompts.md**

包含两个固定 sub agent prompt：

- Protocol / structure reviewer
- Content / safety reviewer

Prompt 必须要求输出：

```text
blocking issues
non-blocking issues
recommended fixes
approval status
```

**Step 5: 写 assets/pack-template**

模板包含合法占位符和 Evidence Matrix 表头。

**Step 6: 验证 skill 结构**

Run:

```bash
test -f skill/polyrig-pack-author/SKILL.md
test -f skill/polyrig-pack-author/agents/openai.yaml
test -f skill/polyrig-pack-author/references/pack-authoring-contract.md
test -f skill/polyrig-pack-author/references/review-prompts.md
test -f skill/polyrig-pack-author/assets/pack-template/references/sources.md
```

Expected: exit 0。

## Task 6: 更新安装器支持多个 skills

**Files:**

- Modify: `scripts/link-skill.mjs`
- Modify: `scripts/test-link-skill.mjs`
- Modify: `scripts/doctor.mjs`

**Step 1: 先改测试**

更新 `scripts/test-link-skill.mjs`：

- 期望 native skill 平台同时安装：
  - `.claude/skills/polyrig`
  - `.claude/skills/polyrig-pack-author`
  - `.codex/skills/polyrig`
  - `.codex/skills/polyrig-pack-author`
- Cursor/Gemini/OpenCode pointer/context 同时提到两个 skills。

Run:

```bash
node scripts/test-link-skill.mjs
```

Expected: FAIL。

**Step 2: 改 link-skill.mjs**

将单一 `src = skill/polyrig` 改为 skills 列表：

```js
[
  { name: 'polyrig', path: join(REPO_ROOT, 'skill', 'polyrig') },
  { name: 'polyrig-pack-author', path: join(REPO_ROOT, 'skill', 'polyrig-pack-author') },
]
```

保持 `--platform`、`--copy`、`--force`、`--home` 行为。

**Step 3: 更新 doctor**

检查两个 canonical skill 目录存在，并报告 native install 状态。

**Step 4: 跑安装测试**

Run:

```bash
node scripts/test-link-skill.mjs
```

Expected: PASS。

## Task 7: 文档和状态更新

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `SPEC.md`
- Modify: `docs/authoring-packs.md`
- Modify: `feature_list.json`

**Step 1: README / SPEC 更新**

说明：

- `polyrig-pack-author` 存在。
- Evidence Matrix 是正式协议。
- install 会安装两个 skills。

**Step 2: authoring-packs 更新**

把手写指南升级为 Evidence Matrix 版本。

**Step 3: feature_list 增加新 feature**

新增一个 feature，例如：

```json
{
  "id": "F012",
  "title": "Pack authoring skill and Evidence Matrix protocol",
  "status": "implemented",
  ...
}
```

验收项覆盖本计划五层。

**Step 4: JSON 验证**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8'))"
```

Expected: exit 0。

## Task 8: 最终验证和 sub agent 审稿

**Files:**

- No direct production file changes unless review finds issues.

**Step 1: 跑全部本地验证**

Run:

```bash
node scripts/test-validate-pack-evidence.mjs
node scripts/test-link-skill.mjs
node scripts/test-build-pack-index.mjs
node scripts/doctor.mjs
git diff --check
```

Expected:

- tests PASS。
- doctor PASS；真实 home skill 安装 warning 可接受，但必须说明。
- diff check clean。

**Step 2: 调用 Protocol / structure reviewer sub agent**

Prompt 使用：

```text
Use the protocol/structure review prompt in skill/polyrig-pack-author/references/review-prompts.md to review this implementation. Focus on pack protocol, Evidence Matrix validator behavior, builtin pack migration, /polyrig copy contract, and installation support. Return blocking issues, non-blocking issues, recommended fixes, and approval status.
```

**Step 3: 调用 Content / safety reviewer sub agent**

Prompt 使用：

```text
Use the content/safety review prompt in skill/polyrig-pack-author/references/review-prompts.md to review the migrated builtin packs and the new pack-authoring skill. Focus on whether volatile facts leaked into prose, whether strong rules have adequate evidence, whether safety/privacy/reliability red lines are preserved, and whether the skill could mislead future agents. Return blocking issues, non-blocking issues, recommended fixes, and approval status.
```

**Step 4: 修复 blocking issues**

如果任一 sub agent 报 blocking issues：

- 修复。
- 重新跑相关验证。
- 重新请求对应 reviewer 复审。

**Step 5: 完成**

只有本地验证通过且两个 reviewers 无 blocking issues，才能报告完成。

## 推荐提交拆分

1. `test: add Evidence Matrix validation fixtures`
2. `feat: enforce Evidence Matrix in pack validation`
3. `chore: migrate builtin packs to Evidence Matrix`
4. `feat: add polyrig pack author skill`
5. `feat: install multiple PolyRig skills`
6. `docs: document pack authoring Evidence Matrix`
