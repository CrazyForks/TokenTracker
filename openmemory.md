## Overview
- TokenTracker is a local-first token usage tracker for AI agent CLIs, with a Node.js CLI entrypoint, a web dashboard, and a native macOS menu bar companion app.
- The repository mixes runtime code under `src/`, a Vite-based dashboard under `dashboard/`, and a standalone Xcode project under `TokenTrackerBar/`.

## Architecture
- CLI: `bin/tracker.js` dispatches into the CommonJS application in `src/`.
- Dashboard: static frontend assets live in `dashboard/` and are built separately from the CLI package.
- macOS app: `TokenTrackerBar/` is a SwiftUI `MenuBarExtra` application that talks to the local TokenTracker server and packages its own asset catalog.

## User Defined Namespaces
- [Leave blank - user populates]

## Components
- Marketing landing header primary CTA uses `copy("landing.v2.cta.primary")`, links via `getDashboardEntryPath()` (`/` on loopback, `/dashboard` on public host). `App.jsx` sets `gate` to dashboard when `normalizedPath === "/dashboard"`.
- `TokenTrackerBar/TokenTrackerBar/TokenTrackerBarApp.swift`: native macOS menu bar entrypoint that renders the dashboard window and uses `MenuBarIcon` for the status item.
- `TokenTrackerBar/TokenTrackerBar/Services/StatusBarController.swift`: owns the `NSStatusItem`, popover/menu wiring, and now renders the optional menu bar stats as a single composite `NSImage` so the Clawd icon and two text columns stay pixel-aligned.
- `TokenTrackerBar/TokenTrackerBar/Services/MenuBarAnimator.swift`: owns the raw animated Clawd icon frames and exposes the current frame for `StatusBarController` to compose into the stats image without losing sync/blink animation.
- `TokenTrackerBar/TokenTrackerBar/AppIcon.icon`: Icon Composer document copied into the Xcode project tree and compiled by Xcode when the target app icon name is set to `AppIcon`.
- `TokenTrackerBar/generate_icon_composer_assets.swift`: script-driven generator for the layered SVG source assets that feed the Icon Composer workflow.
- `TokenTrackerBar/generate_menubar_icon.swift`: menu bar icon generator that now writes directly into `Assets.xcassets/MenuBarIcon.imageset` by default instead of creating a separate `icon_output/` scratch directory.
- `TokenTrackerBar/icon_composer/`: layered SVG source assets intended for import into Apple Icon Composer before saving a `.icon` document.
- `TokenTrackerBar/build/TokenTrackerBar.dmg`: the only packaged artifact intentionally kept in-repo after cleanup; staging exports, archives, and export-option files are treated as disposable build byproducts.
- `dashboard/src/pages/DashboardPage.jsx` is the web dashboard entry that derives the current `from/to` window from the selected period and feeds period-scoped summary data into the dashboard panels.

## Patterns
- The macOS app icon is generated from Swift drawing code instead of hand-authored bitmap exports.
- For fallback PNG-based app icon delivery, exported artwork should stay full-square and avoid baking in the rounded-rectangle mask; macOS applies the icon shape and edge treatment later.
- The white bolt glyph should stay inside the standard safe area, while a full-bleed square background lets the system crop the icon to the current macOS template.
- `Icon Composer` documents use Apple's private `.icon` package format, so this repo keeps `TokenTrackerBar/TokenTrackerBar/AppIcon.icon` as the only authoritative app icon asset and prepares layered SVG source assets under `TokenTrackerBar/icon_composer/` for future edits.
- The bolt geometry used by the app icon should preserve the original SVG orientation from `BoltShape.swift`; do not mirror the Y axis again when generating `icon_composer/02-bolt.svg` or `AppIcon.icon/Assets/02-bolt.svg`.
- `App Icon Source` in Xcode General is an input for the primary icon asset name, not a file picker; the correct value is `AppIcon`, not an absolute path.
- Xcode only compiles the Icon Composer document when `AppIcon.icon` is added to the project as `folder.iconcomposer.icon`, included in the target resources, and `ASSETCATALOG_COMPILER_APPICON_NAME` remains `AppIcon`.
- If `project.pbxproj` loses the `AppIcon.icon` file reference or its resources-phase entry, Xcode silently falls back to the asset catalog icon. Keep `AppIcon.icon` in the project tree and remove any leftover `Assets.xcassets/AppIcon.appiconset` directory so packaging cannot regress to the old icon.
- Legacy PNG app icon assets, preview renders, duplicate `.icon` packages, and historical archives were removed after the Icon Composer migration; the repo now keeps only `TokenTrackerBar/build/TokenTrackerBar.dmg` as the packaged artifact.
- `ExportOptions.plist`, staging folders under `build/`, `.xcarchive` outputs, and `.DS_Store` files are not part of the maintained resource set and can be deleted when they reappear.
- In the web dashboard, the `Conversations` stat in `dashboard/src/ui/matrix-a/components/StatsPanel.jsx` must read from the current period summary (`summary.conversation_count`) instead of the fixed rolling 30-day aggregate, so it changes when the user switches the time filter.
- In `TokenTrackerBar/TokenTrackerBar/Views/UsageTrendChart.swift`, the trend area's top edge should always share the exact same `interpolationMethod` as the trend line. Keep the interpolation in one shared property and fall back to `.linear` when there are too few points to smooth safely.
- `TokenTrackerBar` should treat dashboard periods in the local macOS time zone, not UTC. `DateHelpers` now computes `day/week/month/total` ranges from `TimeZone.current`, and `APIClient` passes both `tz` and `tz_offset_minutes` to all usage endpoints so backend aggregation matches the menu bar app's local calendar.
- In `TokenTrackerBar/TokenTrackerBar/Views/UsageTrendChart.swift`, the `day` period is a special case: convert the backend's half-hour buckets into hourly points, sort them ascending, trim future hours, and use `.monotone` when there are enough hourly points so the intraday line stays smooth without the loop artifacts seen with `.catmullRom`.
- `UsageTrendChart` should not reuse the generic day/week/month axis stride for the `day` period. Build explicit local-hour tick values from the first visible hourly bucket through the last one so intraday charts show intermediate hour labels like `10`, `11`, and `12` instead of only sparse endpoints.
- TokenTrackerBar packaging should overwrite the current `TokenTrackerBar/build/TokenTrackerBar.xcarchive` and `TokenTrackerBar/build/TokenTrackerBar.dmg` in place; timestamped backup archives, staging directories, and stray `.DS_Store` files are disposable and should be cleaned up after packaging.
- `UsageTrendChart` must parse hourly timestamps from both the edge/backend shape (`...Z` / `...000Z`) and the local app stub shape (timezone-less local strings). The local `src/lib/local-api.js` hourly endpoint now aggregates queue rows into local-hour buckets using the requested `tz` / `tz_offset_minutes`, so local development matches the menu bar app's expected day-view payload.
- Menu bar stats in `StatusBarController` should not use `attributedTitle` tab stops for multi-line alignment. Render the 22×22 Clawd icon plus the token/cost value+label columns into one non-template `NSImage`, and let `MenuBarAnimator` keep publishing the underlying animated icon frame so stats mode can stay aligned while the icon animates.
