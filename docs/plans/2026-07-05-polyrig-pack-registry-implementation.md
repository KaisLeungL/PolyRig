# PolyRig Pack Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 PolyRig 官方 pack registry 第一版，让用户可以 GitHub 登录、上传 pack、经校验和审核发布，并通过 `polyrig-pack-install` 下载、校验、安装和更新 pack。

**Architecture:** 平台拆成 `apps/web` Next.js 页面层、`services/api` FastAPI 核心业务 API、artifact storage 文件/对象存储层，以及独立的 `polyrig-pack-install` skill + deterministic `scripts/install-pack.mjs`。FastAPI 是认证、权限、审核、artifact metadata 和下载状态检查的唯一真相源；Next.js 只负责 UI；下载脚本只信任平台 metadata + 本地校验。

**Tech Stack:** Next.js App Router, React, TypeScript, Tailwind CSS, FastAPI, SQLAlchemy, Alembic, PostgreSQL-oriented schema with SQLite MVP option, zero-dependency Node.js installer helper where practical, existing PolyRig `validate-pack.mjs`.

---

## 前置上下文

实施前阅读：

- `docs/plans/2026-07-05-polyrig-pack-registry-spec.md`
- `SPEC.md`
- `docs/architecture.md`
- `docs/pack-protocol.md`
- `docs/authoring-packs.md`
- `scripts/validate-pack.mjs`
- `scripts/lib/validate.mjs`
- `scripts/build-pack-index.mjs`
- `scripts/link-skill.mjs`
- `skill/polyrig/SKILL.md`
- `skill/polyrig-pack-author/SKILL.md`
- `feature_list.json`

实施原则：

- 先实现平台限定 registry，不支持任意第三方 URL。
- 第一版只做 GitHub 登录，不接 Google。
- 核心状态机和安全检查先测试，再实现。
- Artifact 发布后不可变。
- 下载端和发布端都必须跑 `validate-pack`。
- 不执行 pack 内 `scripts/`。
- 每个 task 完成后更新 `feature_list.json`，但不要把未验证功能标为 verified。

## Task 1: 登记功能状态

**Files:**

- Modify: `feature_list.json`
- Read: `docs/plans/2026-07-05-polyrig-pack-registry-spec.md`

**Step 1: 增加 F017**

在 `feature_list.json` 添加新 feature：

```json
{
  "id": "F017",
  "title": "PolyRig Pack Registry platform",
  "status": "planned",
  "priority": "p0",
  "depends_on": ["F012", "F014", "F016"],
  "pack_refs": ["stack/backend-fastapi"],
  "acceptance_criteria": [
    "GitHub 登录、publisher_slug、user/reviewer/admin 权限模型可用",
    "用户可以上传单个 pack root，服务器规范化为 .tar.gz artifact，并用固定版本 validate-pack 验证",
    "校验通过后进入人工审核，审核通过后 published 版本不可变并可匿名下载 metadata/artifact",
    "polyrig-pack-install 可以从平台 canonical URL 下载、sha256 校验、安全解包、本地 validate、安装到 ~/.polyrig/packs，并写 .polyrig-install.json",
    "本地 update 只显式触发，并展示 release_notes 与 resolved_requires 变化"
  ],
  "verification": {
    "manual": [
      "完整走通上传 -> 校验 -> 审核 -> 发布 -> 匿名 metadata -> 下载 skill 安装 -> update no-op",
      "人工确认 removed 版本不能新下载，deprecated 版本下载有警告"
    ],
    "automated": [
      "cd services/api && uv run pytest",
      "cd apps/web && pnpm test",
      "node scripts/test-install-pack.mjs"
    ]
  },
  "files_expected": [
    "apps/web/",
    "services/api/",
    "skill/polyrig-pack-install/",
    "scripts/install-pack.mjs",
    "scripts/test-install-pack.mjs"
  ],
  "notes": "Spec and implementation plan are in docs/plans/2026-07-05-polyrig-pack-registry-*.md."
}
```

**Step 2: 验证 JSON**

Run:

```bash
node -e "JSON.parse(require('fs').readFileSync('feature_list.json','utf8'))"
```

Expected: exits 0.

## Task 2: API 项目骨架

**Files:**

- Create: `services/api/pyproject.toml`
- Create: `services/api/app/main.py`
- Create: `services/api/app/settings.py`
- Create: `services/api/app/db.py`
- Create: `services/api/tests/test_health.py`

**Step 1: 写 health 测试**

Create `services/api/tests/test_health.py`:

```python
from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

**Step 2: 运行确认失败**

Run:

```bash
cd services/api && uv run pytest tests/test_health.py
```

Expected: FAIL because app does not exist.

**Step 3: 实现最小 FastAPI app**

Create `app/main.py` with `/api/health`.

**Step 4: 跑测试**

Run:

```bash
cd services/api && uv run pytest
```

Expected: PASS.

## Task 3: 数据模型和迁移

**Files:**

- Create: `services/api/app/models.py`
- Create: `services/api/app/repositories/`
- Create: `services/api/tests/test_pack_version_state.py`

**Step 1: 写状态机测试**

覆盖：

- `draft -> submitted -> pending_review -> published`
- `published` 不能编辑 artifact 字段
- `published -> deprecated`
- `published -> removed` 仅 admin allowed
- `removed` 不能下载

**Step 2: 实现模型**

最小模型：

- `User`
- `Publisher`
- `Pack`
- `PackVersion`
- `Review`
- `Download`

状态字段使用字符串枚举，先不引入复杂状态机库。

**Step 3: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_pack_version_state.py
```

Expected: PASS.

## Task 4: GitHub 登录和 session

**Files:**

- Create: `services/api/app/auth/github.py`
- Create: `services/api/app/auth/session.py`
- Create: `services/api/app/routers/auth.py`
- Create: `services/api/tests/test_auth_session.py`

**Step 1: 写 session 测试**

测试不直接打 GitHub 网络：

- GitHub provider 返回 `github_user_id` 和 `github_login` 后创建 user。
- 重复登录同一个 `github_user_id` 返回同一个 user。
- `/api/users/me` 未登录返回 401，登录后返回用户和 role。

**Step 2: 实现 provider 抽象**

将 GitHub OAuth callback 的外部 HTTP 请求隔离到 provider class，测试使用 fake provider。

**Step 3: 实现 session cookie**

Cookie 必须 httpOnly、secure 可配置、sameSite。

**Step 4: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_auth_session.py
```

Expected: PASS.

## Task 5: Publisher slug

**Files:**

- Create: `services/api/app/routers/publishers.py`
- Create: `services/api/tests/test_publishers.py`

**Step 1: 写测试**

覆盖：

- 首次 GitHub 登录后可以创建 `publisher_slug`。
- slug 全局唯一。
- slug 默认可以基于 `github_login` 建议，但必须用户确认。
- 锁定后第一版不支持用户自助修改。

**Step 2: 实现 API**

Endpoints:

```text
GET /api/publisher/me
POST /api/publisher/me
```

**Step 3: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_publishers.py
```

Expected: PASS.

## Task 6: 上传包安全解包和规范化

**Files:**

- Create: `services/api/app/artifacts/safe_extract.py`
- Create: `services/api/app/artifacts/normalize.py`
- Create: `services/api/tests/test_artifact_normalize.py`

**Step 1: 写安全测试**

构造 archive fixtures，覆盖：

- 正常单 pack root 通过。
- 多个 pack root 失败。
- 缺 `pack.yaml` 失败。
- `../evil` 路径穿越失败。
- 绝对路径失败。
- symlink 指向外部失败。

**Step 2: 实现 safe extract**

只解到临时目录，检查每个 entry 的 normalized path。

**Step 3: 实现 normalize**

输出标准 `.tar.gz`，解包后根目录直接是：

```text
pack.yaml
knowledge/
references/
verify.md
```

**Step 4: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_artifact_normalize.py
```

Expected: PASS.

## Task 7: 服务端 validate-pack 集成

**Files:**

- Create: `services/api/app/validation/polyrig_validator.py`
- Create: `services/api/tests/test_pack_validation.py`

**Step 1: 写测试**

覆盖：

- 合法 fixture 通过，记录 validator name/version/output/validated_at。
- 非法 fixture 失败，状态进入 `validation_failed`。
- 不能信任用户上传的 validation result 字段。

**Step 2: 实现 validator runner**

调用仓库内：

```bash
node scripts/validate-pack.mjs <temp-pack-dir>
```

捕获 stdout/stderr/exit code。

**Step 3: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_pack_validation.py
```

Expected: PASS.

## Task 8: 上传和提交审核 API

**Files:**

- Create: `services/api/app/routers/uploads.py`
- Create: `services/api/app/services/pack_submission.py`
- Create: `services/api/tests/test_pack_upload_flow.py`

**Step 1: 写端到端 API 测试**

使用 test client + fake logged-in user：

```text
POST /api/uploads/pack-directory
-> creates draft or validation_failed
POST /api/my/pack-versions/{id}/submit
-> pending_review only when validation passed
```

**Step 2: 实现上传 API**

上传文件可以是前端打包后的 archive。服务器仍重新解包、验证、规范化、计算 sha256。

**Step 3: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_pack_upload_flow.py
```

Expected: PASS.

## Task 9: 审核 API

**Files:**

- Create: `services/api/app/routers/review.py`
- Create: `services/api/app/permissions.py`
- Create: `services/api/tests/test_review_flow.py`

**Step 1: 写权限测试**

覆盖：

- user 不能 approve/reject。
- reviewer 可以 approve/reject。
- admin 拥有 reviewer 权限。
- approve 后状态为 `published` 且 artifact 不可变。
- reject 保存 notes。

**Step 2: 实现 permissions**

使用 `role: user | reviewer | admin`。

**Step 3: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_review_flow.py
```

Expected: PASS.

## Task 10: 公开 metadata 和下载 API

**Files:**

- Create: `services/api/app/routers/public_packs.py`
- Create: `services/api/tests/test_public_install_metadata.py`

**Step 1: 写测试**

覆盖：

- published 匿名可读 install metadata。
- deprecated 匿名可读但返回 warning。
- removed 不返回 artifact URL。
- metadata 包含 sha256、resolved_requires、has_scripts、release_notes、signature null。

**Step 2: 实现 API**

Endpoints:

```text
GET /api/packs
GET /api/packs/{type}/{name}/versions/{version}/install-metadata
GET /api/artifacts/{artifact_id}/download
```

**Step 3: 跑测试**

Run:

```bash
cd services/api && uv run pytest tests/test_public_install_metadata.py
```

Expected: PASS.

## Task 11: 下载脚本红灯测试

**Files:**

- Create: `scripts/test-install-pack.mjs`
- Create: `scripts/fixtures/registry-pack/`

**Step 1: 写 installer 测试**

使用本地 fake HTTP server 或 mock metadata file，覆盖：

- 安装 published pack。
- sha256 不匹配失败。
- 同 checksum 已安装 no-op。
- 同 id 不同版本默认失败。
- `--replace` 成功替换。
- 写 `.polyrig-install.json`。
- `requires` 依赖按顺序安装。

**Step 2: 运行确认失败**

Run:

```bash
node scripts/test-install-pack.mjs
```

Expected: FAIL because install script does not exist.

## Task 12: 实现 `scripts/install-pack.mjs`

**Files:**

- Create: `scripts/install-pack.mjs`
- Modify: `scripts/test-install-pack.mjs`

**Step 1: 实现 metadata resolve**

只接受平台 canonical HTTPS URL。第一版 registry base 可配置：

```text
POLYRIG_REGISTRY_URL=https://polyrig.example.com
```

拒绝非平台注册域名，拒绝任意 artifact URL 输入。

**Step 2: 实现下载和 sha256**

必须匹配 metadata `sha256`。

**Step 3: 实现 safe extract**

复用或移植服务端路径穿越检查逻辑。

**Step 4: 实现本地 validate-pack**

调用：

```bash
node scripts/validate-pack.mjs <temp-pack-dir>
```

**Step 5: 实现安装和冲突处理**

默认安装到：

```text
~/.polyrig/packs/<type>/<name>/
```

支持显式 project-level 目录，但需要 skill 层确认。

**Step 6: 跑测试**

Run:

```bash
node scripts/test-install-pack.mjs
```

Expected: PASS.

## Task 13: update 命令

**Files:**

- Modify: `scripts/install-pack.mjs`
- Modify: `scripts/test-install-pack.mjs`

**Step 1: 写 update 测试**

覆盖：

- 本地已是最高 published 版本 -> no-op。
- 有新版本 -> 输出计划。
- 用户确认后替换。
- 新版本 resolved_requires 变化会展示并安装。
- removed 不作为 update 目标。
- deprecated 不作为默认 update 目标。

**Step 2: 实现 update**

Commands:

```bash
node scripts/install-pack.mjs update domain/stripe-billing
node scripts/install-pack.mjs update --all
```

**Step 3: 跑测试**

Run:

```bash
node scripts/test-install-pack.mjs
```

Expected: PASS.

## Task 14: `polyrig-pack-install` skill

**Files:**

- Create: `skill/polyrig-pack-install/SKILL.md`
- Create: `skill/polyrig-pack-install/agents/openai.yaml`
- Modify: `scripts/link-skill.mjs`
- Modify: `scripts/test-link-skill.mjs`
- Modify: `scripts/doctor.mjs`

**Step 1: 写 skill**

Skill 只负责交互合同：

- 解析用户意图：install / update / update --all。
- 调用 `scripts/install-pack.mjs`。
- 展示安装计划。
- 在必要确认点停下来。
- 禁止任意 URL 和脚本执行。

**Step 2: 更新安装器**

`link-skill.mjs` 安装三个 skills：

- `polyrig`
- `polyrig-pack-author`
- `polyrig-pack-install`

**Step 3: 跑安装测试**

Run:

```bash
node scripts/test-link-skill.mjs
node scripts/doctor.mjs
```

Expected: PASS.

## Task 15: Next.js 前端骨架

**Files:**

- Create: `apps/web/package.json`
- Create: `apps/web/app/layout.tsx`
- Create: `apps/web/app/page.tsx`
- Create: `apps/web/lib/api.ts`
- Create: `apps/web/app/packs/page.tsx`
- Create: `apps/web/app/packs/[type]/[name]/versions/[version]/page.tsx`

**Step 1: 建立最小 app**

页面：

- 首页 / 搜索入口。
- Pack list。
- Pack version detail。

**Step 2: API client**

只调用 FastAPI `/api`，不保存 GitHub token。

**Step 3: 验证 build**

Run:

```bash
cd apps/web && pnpm build
```

Expected: PASS.

## Task 16: 上传和审核 UI

**Files:**

- Create: `apps/web/app/dashboard/page.tsx`
- Create: `apps/web/app/dashboard/upload/page.tsx`
- Create: `apps/web/app/review/page.tsx`
- Create: `apps/web/components/PackDirectoryUploader.tsx`
- Create: `apps/web/components/PlatformChecks.tsx`

**Step 1: 实现目录选择上传**

使用浏览器目录选择能力。前端打包仅用于传输，页面文案明确服务器会重新校验。

**Step 2: 实现审核台**

显示：

- validation output
- Platform checks 摘要
- has_scripts 警告
- approve / reject

**Step 3: 验证 build**

Run:

```bash
cd apps/web && pnpm build
```

Expected: PASS.

## Task 17: 反向代理和本地运行文档

**Files:**

- Create: `docs/registry-local-dev.md`
- Create: `deploy/nginx/polyrig-registry.conf.example`
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: 写本地开发说明**

包括：

- 启动 FastAPI。
- 启动 Next.js。
- 配置 GitHub OAuth app。
- 设置 artifact storage 目录。
- 设置第一个 admin。

**Step 2: 写部署路径分流示例**

说明：

```text
/ -> Next.js
/api -> FastAPI
/artifacts -> FastAPI check + X-Accel-Redirect
```

**Step 3: 文档验证**

Run:

```bash
rg -n "polyrig-pack-install|Pack Registry|GitHub OAuth|X-Accel" README.md README.zh-CN.md docs deploy
```

Expected: key terms found.

## Task 18: 端到端验收

**Files:**

- Create: `docs/examples/pack-registry-demo.md`

**Step 1: 准备测试 pack**

使用现有合法 pack fixture 或创建最小 pack。

**Step 2: 跑完整流程**

手动流程：

```text
GitHub 登录
创建 publisher_slug
上传 pack root
服务器 validate passed
reviewer approve
匿名打开 pack version URL
node scripts/install-pack.mjs <canonical-url>
确认安装成功
node scripts/install-pack.mjs update <pack-id>
确认 no-op 或更新计划正确
```

**Step 3: 自动验证**

Run:

```bash
cd services/api && uv run pytest
cd apps/web && pnpm build
node scripts/test-install-pack.mjs
node scripts/test-link-skill.mjs
node scripts/doctor.mjs
git diff --check
```

Expected: all PASS.

**Step 4: 更新 feature_list**

如果全部通过，将 F017 状态更新为 `implemented`。只有完整手动验收也记录在 notes 后，才能标为 `verified`。

## 实施启动 Prompt

确认要实施时，用这个 prompt：

```text
请开始实施 PolyRig Pack Registry 第一版。严格按 docs/plans/2026-07-05-polyrig-pack-registry-implementation.md task-by-task 执行。

要求：
- 先写测试再实现。
- 第一版只做 GitHub 登录。
- 只允许从 PolyRig 平台 canonical HTTPS URL 安装，不支持任意第三方 URL。
- 发布端和下载端都必须 validate-pack。
- 不执行 pack scripts。
- 每完成一个 task 运行对应验证，并更新 feature_list.json。
- 未完成端到端手动验收前，不要把 F017 标为 verified。
```
