# Sources

## Evidence Matrix

| id | claim | status | source_type | urls | applies_to | volatility | notes |
|---|---|---|---|---|---|---|---|
| E001 | The pack captures durable domain or stack decisions that future agents should not have to reconstruct from chat history. | user-provided | user | local:interview | knowledge/overview.md#purpose; knowledge/overview.md#decision-rules | low | Replace with the user's stated pack purpose and scope. |
| E002 | Volatile versions, package coordinates, and fast-changing API details belong in deps.yaml lookup strategies instead of stable prose. | source-backed | official | TODO:official-doc-url | knowledge/overview.md#decision-rules; knowledge/pitfalls.md#common-failure-modes; deps.yaml | medium | Replace TODO with official dependency or platform docs. |
| E003 | Secrets and sensitive artifacts should not be committed or treated as regular pack knowledge. | source-backed | security | TODO:security-doc-url | knowledge/overview.md#decision-rules; knowledge/pitfalls.md#red-lines | low | Replace TODO with the relevant security guidance. |
| E004 | Completion should be tied to concrete automated or manual verification checks. | user-provided | user | local:interview | knowledge/overview.md#recommended-defaults; knowledge/pitfalls.md#red-lines; verify.md | low | Replace with project/team verification expectations. |
| E005 | Inferred or unverified claims should not become hard rules without stronger evidence. | inferred | inference | local:interview | knowledge/pitfalls.md#common-failure-modes | medium | Use only for non-strong guidance until backed by a source. |
| E006 | The example dependency needs current lookup before implementation. | source-backed | official | TODO:official-dependency-doc-url | deps.yaml | high | Replace with the official dependency or platform source. |
