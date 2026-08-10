# Changelog

All notable changes to Sensor Delta Card are documented here.

## 0.6.2 — 2026-08-10

### Fixed
- Historical comparisons now use the last known value at or before the target time instead of a potentially future, nearer reading.
- Compact-card deltas, detail summaries and the delta chart now share the same historical lookup semantics.
- Comparisons with insufficient retained history now show no delta instead of reusing the oldest available reading.

## 0.6.1 — 2026-08-09

### Added
- The detail popup now shows the entity's last update below the current value using Home Assistant's native localized timestamp display.

## 0.6 — 2026-08-09

### Documentation
- Added screenshots of dashboard cards, the visual editor, value history and delta history.

## 0.5.9 — 2026-08-09

### Release candidate
- Visual editor with searchable native Home Assistant entity picker.
- Native selector for comparison period.
- Editable optional card title from the visual editor.
- Compact current value and delta card.
- Single persistent detail modal.
- Native Home Assistant 24-hour value history.
- Values / Delta graph toggle.
- Delta history calculated against 24 h, 48 h, 72 h or 7 days.
- Summary deltas for 24 h, 48 h, 72 h and 7 days.
- Lazy history loading.
- Frontend-only synthetic delta entity; no helpers or backend entities.
- English and Spanish localization.
- Race-condition and duplicate-registration hardening.
- Improved historical lookup and delta transition calculation.

## Earlier development versions

Versions 0.1.0 through 0.5.8 were iterative development builds leading to the first publishable package.
