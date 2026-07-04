<!-- polyrig: Template for the target project's deps.resolved.md. Fill it during interview phase 7 (generate) by executing each selected pack's deps.yaml lookup strategies online. One group section per stack or dependency group; one subsection per dependency coordinate. Every entry is a DATED SNAPSHOT taken at generation time — never an eternal fact. Remove all `polyrig:` comments from the final artifact. -->

# Dependency resolution — resolved-at: {{RESOLVED_AT_DATE}}

> Entries below are dated snapshots of online verification, never eternal
> facts. Re-check any entry before implementation if its resolved-at date is
> stale or its re-check condition is met, and update this file with the new
> date, source, and confidence.

## {{DEPENDENCY_GROUP_NAME}}

<!-- polyrig: one group per stack or logical dependency group (e.g. per stack pack); repeat the group heading and the dependency subsection below as needed. -->

### {{DEPENDENCY_COORDINATE}}

- **Purpose:** {{DEPENDENCY_PURPOSE}}
- **Resolved version:** {{RESOLVED_VERSION}}
- **Source:** {{OFFICIAL_DOC_URL}}
  <!-- polyrig: the official URL actually consulted during online verification, from the pack's deps.yaml official_sources. -->
- **Confidence:** {{CONFIDENCE_LEVEL}}
  <!-- polyrig: one of high | medium | low, with a short justification, e.g. "high (official docs, checked {{RESOLVED_AT_DATE}})". -->
- **Action:** re-check before implementation — {{RECHECK_CONDITION}}
  <!-- polyrig: state when/how to re-verify, e.g. "re-run the deps.yaml lookup query if this entry is older than 90 days or the build fails resolving the artifact". -->
