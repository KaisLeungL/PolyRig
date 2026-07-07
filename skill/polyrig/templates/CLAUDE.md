<!-- polyrig: This is the PolyRig MANAGED BLOCK to inject into the target project's CLAUDE.md. It carries the SAME block content as AGENTS.md (CLAUDE.md is a synonym entry point for Claude Code). Merge it between the BEGIN/END markers exactly as for AGENTS.md: replace the marked span if present, append if the file exists without markers, create the file if absent. PURE ROUTING ONLY — never inline red lines or strong-rule prose; that knowledge lives in .polyrig/vault/. Emit one "MUST read" row per selected stack pack and per selected domain pack. Remove all `polyrig:` comments from the final artifact. -->
<!-- BEGIN POLYRIG MANAGED BLOCK -->
## PolyRig experience (injected)

This project has PolyRig-injected domain/stack experience. The knowledge lives on
disk under `.polyrig/vault/` — read it before working in the areas it covers.
This block is routing only; the actual rules and red lines live in the vault files.

| Before working on… | You MUST read |
|---|---|
| {{STACK_SHORT_NAME}} (build, conventions, pitfalls, verification) | `.polyrig/vault/stacks/{{STACK_SHORT_NAME}}/knowledge/*.md`, `.../verify.md` (and `.../references/sources.md` for provenance / dependency / audit disputes) |
| {{DOMAIN_SHORT_NAME}} (domain rules, red lines, pitfalls, verification) | `.polyrig/vault/domains/{{DOMAIN_SHORT_NAME}}/knowledge/*.md`, `.../verify.md` (and `.../references/sources.md` for provenance / dependency / audit disputes) |
| Dependency versions / whether a version is current | `.polyrig/deps.resolved.md` — dated snapshots; re-verify online before adding or upgrading a dependency if the entry is stale or its re-check condition is met |
| Which packs/versions were injected, checksums | `.polyrig/manifest.json` |

Obey the red lines and strong rules stated in the routed vault files. Do not
guess security-critical behavior — the vault knowledge is authoritative for the
areas it covers.
<!-- END POLYRIG MANAGED BLOCK -->
