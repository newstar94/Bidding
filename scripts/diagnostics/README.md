# Local diagnostic experiments

These opt-in probes were used to diagnose Prompt 1 failures. They are not
application entry points or substitutes for the full CI commands.

- `contractor_search_probe`, `expert_insert_probe`, `opening_transition_probe`:
  shortened lifecycle prefixes. A pass never means the full lifecycle passed.
- `startup_cpu_probe`, `startup_timeline_probe`: instrumented startup measurements;
  profiler overhead means their results are diagnostic, not final performance gates.
- `startup_flex_probe`, `startup_font_probe`, `startup_font_preload_probe`:
  browser-only experiments, not shipped CSS/font changes. Browser routing in the
  preload probe changes cache behavior; its warm timing is not comparable.
- `font_preload_app.py`: test-only alternative application entry point. Normal
  verification uses `backend.app:app`; final preload integration is in backend code.
- `measure_lifecycle_memory.ps1`: bounded numeric process-memory observation of
  the complete lifecycle unless an explicit loader changes it. Observation expiry
  does not stop or declare success for the suite; inspect its live process first.

For normal verification clear diagnostic `NODE_OPTIONS`, use the default server
entry point and retain the required complete test suites and thresholds. Never
upload crash dumps or session data. Run only one browser suite at a time on the
task's isolated loopback endpoint. Historical logs are under `data/logs/` and the
requirement audit is `docs/prompt1-completion-audit.md`.
