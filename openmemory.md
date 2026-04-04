# OpenMemory Guide

## Overview

- Project: `tokentracker`
- Purpose: local-first token and usage tracker for agent tools, with a Node backend, a Vite dashboard, and a macOS menu bar app.
- Primary local data sources:
  - CLI/session logs under user home directories for usage rollups
  - Local tracker queue/cursor state under `.tokentracker`
  - Best-effort live usage-limit APIs or local probes for provider quota windows

## Architecture

- Backend runtime:
  - `src/cli.js` wires CLI commands.
  - `src/lib/local-api.js` serves local `/functions/*` endpoints used by the dashboard and macOS app.
  - `src/lib/usage-limits.js` aggregates live quota windows for Claude, Codex, Cursor, Gemini, Kiro, and Antigravity.
- Dashboard:
  - `dashboard/src/lib/api.ts` calls local `/functions/*` endpoints.
  - `dashboard/src/hooks/use-usage-limits.ts` fetches usage-limit data.
  - `dashboard/src/ui/matrix-a/components/UsageLimitsPanel.jsx` renders provider quota bars.
  - Provider logos for the web dashboard are served from `dashboard/public/brand-logos`, and each provider row must pass an explicit `icon` prop to `ToolGroup`.
  - The web `cursor.svg` is a dark glyph, so dark mode needs an explicit invert treatment when it is rendered on dark backgrounds.
- macOS app:
  - `TokenTrackerBar/TokenTrackerBar/Services/APIClient.swift` fetches the same `/functions/*` endpoints.
  - `TokenTrackerBar/TokenTrackerBar/Models/UsageLimits.swift` decodes the shared usage-limit response.
  - `TokenTrackerBar/TokenTrackerBar/Views/UsageLimitsView.swift` renders the quota bars in SwiftUI.
  - macOS usage-limit icons should use the same provider SVGs that ship in `dashboard/public/brand-logos`.
  - For SwiftUI display, `Codex`, `Gemini`, and `Antigravity` are more reliable when those SVGs are imported into `Assets.xcassets` and rendered as compiled vector assets instead of being parsed at runtime with `NSImage(data:)`.
  - `Cursor` still needs a runtime SVG path because its icon color must be rewritten for dark/light mode. Runtime-loaded `Cursor` SVGs must normalize `width` and `height` to explicit pixel values before rendering.

## User Defined Namespaces

- [Leave blank - user populates]

## Components

### Usage Limits Aggregator

- Location: `src/lib/usage-limits.js`
- Purpose: central best-effort fetcher for live provider quota windows.
- Behavior:
  - Uses a 2-minute in-memory cache.
  - Reads Claude/Codex auth tokens from `src/lib/subscriptions.js`.
  - Reuses Cursor local auth extraction from `src/lib/cursor-config.js`.
  - Probes Gemini via Gemini CLI OAuth credentials + Google private quota APIs.
  - Probes Kiro via `kiro-cli chat --no-interactive /usage`.
  - Probes Antigravity via local language-server process discovery + localhost RPC.
- Output shape:
  - Stable top-level object with `fetched_at`, `claude`, `codex`, `cursor`, `gemini`, `kiro`, `antigravity`.
  - Each provider returns `configured`, optional `error`, and zero to three `*_window` objects.

### Cursor Local Auth + Usage

- Location: `src/lib/cursor-config.js`
- Purpose: extract Cursor session cookie from local SQLite/config and call Cursor web APIs.
- Inputs:
  - Cursor app support DB: `~/Library/Application Support/Cursor/User/globalStorage/state.vscdb`
  - Cursor CLI config: `~/.cursor/cli-config.json`
- Exports:
  - Session extraction
  - Usage CSV fetch/parsing for rollups
  - Usage summary fetch for live limit bars

### Gemini OAuth Quota Probe

- Location: `src/lib/usage-limits.js`
- Purpose: read Gemini CLI OAuth state from `~/.gemini`, discover tier/project, and query live quota buckets.
- Inputs:
  - `~/.gemini/settings.json`
  - `~/.gemini/oauth_creds.json`
  - installed `gemini` CLI for OAuth client extraction when token refresh is needed
- Output:
  - Primary/secondary/tertiary windows mapped to Pro / Flash / Flash Lite families

### Local API Surface

- Location: `src/lib/local-api.js`, `dashboard/vite.config.js`
- Purpose: expose dashboard/macOS-compatible function endpoints in local mode.
- Relevant endpoint:
  - `/functions/tokentracker-usage-limits`

## Patterns

### Live Limit Provider Pattern

- Detect local auth or running source first.
- If the source is unavailable, return `{ configured: false }`.
- If the source exists but fetch/probe fails, return `{ configured: true, error }`.
- Normalize provider-specific responses into window objects that contain:
  - `used_percent`
  - `reset_at` when known

### Usage Limit Window Conventions

- Claude keeps Anthropic-native fields (`five_hour`, `seven_day`, `seven_day_opus`).
- Codex keeps OpenAI-native fields (`primary_window`, `secondary_window`).
- Cursor, Gemini, Kiro, and Antigravity use `primary_window`/`secondary_window`/`tertiary_window`.
- Frontends treat missing windows as optional and only render configured providers.
