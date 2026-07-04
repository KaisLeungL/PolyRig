# Verification

- [A] Add or run the smallest automated check that proves the core deterministic
  behavior governed by this pack. [Evidence: E004]
- [M] Review the implementation against every red line in `knowledge/pitfalls.md`
  and document any exception. [Evidence: E003, E004]
- [M] Re-run every `deps.yaml` lookup before relying on dependency or platform
  details in implementation. [Evidence: E002, E006]
