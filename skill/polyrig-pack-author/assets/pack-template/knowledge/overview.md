# Overview

## Purpose

This pack helps future agents make stable decisions about the example capability.
Replace this section with the durable decision context that would otherwise be
lost outside the chat. [Evidence: E001]

## Decision Rules

- Prefer the simplest implementation path that satisfies the verified use cases.
  [Evidence: E001]
- Route version-shaped or fast-changing facts through `deps.yaml` lookup entries
  instead of writing them as timeless prose. [Evidence: E002]
- Do not treat unsourced examples as authority for product, security, privacy, or
  reliability decisions. [Evidence: E003]

## Recommended Defaults

- Default scope: the smallest workflow that exercises the pack's core decision
  tree. [Evidence: E001]
- Default verification: combine automated checks for deterministic behavior with
  manual review for policy, privacy, or UX judgment. [Evidence: E004]
