# Pitfalls

## Red Lines

- Do not commit credentials, private keys, tokens, raw secrets, or generated
  sensitive artifacts. [Evidence: E003]
- Do not mark work complete until the pack-specific verification route has been
  run or explicitly documented as unavailable. [Evidence: E004]

## Common Failure Modes

- Mixing volatile dependency details into `knowledge/*.md` makes the pack stale;
  keep those details in `deps.yaml` lookup strategies. [Evidence: E002]
- Treating inferred or unverified claims as hard rules can mislead future agents;
  promote those claims only after source review. [Evidence: E005]
