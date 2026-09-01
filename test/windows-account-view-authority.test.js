"use strict";

// Windows counterpart of test/macos-account-view-authority.test.js.
//
// The tray/pet poller hits the same `?account=1` contract as the macOS popover
// and had the same defect: it read `X-TokenTracker-Account-View`, stored it in a
// flag nobody consumed, and published the payload regardless — so a transient
// cloud failure dropped the tray from cross-device totals to this machine.
//
// There is no C# test project, so the invariants are asserted against the source.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");
const usagePoller = fs.readFileSync(
  path.join(repoRoot, "TokenTrackerWin/UsagePoller.cs"),
  "utf8",
);

test("the write-only AccountViewActive flag is gone", () => {
  assert.doesNotMatch(
    usagePoller,
    /AccountViewActive/,
    "Tracking the account view in a field nobody reads is what made the bug invisible.",
  );
});

test("both account-view headers are read, transient matched by prefix", () => {
  assert.match(
    usagePoller,
    /private static AccountSource ReadAccountSource\(HttpResponseMessage resp\)/,
  );
  assert.match(usagePoller, /"X-TokenTracker-Account-View"/);
  assert.match(usagePoller, /"X-TokenTracker-Account-Fallback"/);
  assert.match(
    usagePoller,
    /reason\.StartsWith\("transient", StringComparison\.Ordinal\)\n\s*\? AccountSource\.LocalTransient\n\s*: AccountSource\.LocalAuthoritative/,
    "New transient reasons must not require a client change; a missing reason stays authoritative.",
  );
});

test("a transient fallback skips the publish instead of overwriting account figures", () => {
  assert.match(
    usagePoller,
    /var summarySource = ReadAccountSource\(resp\);\n\s*if \(summarySource == AccountSource\.LocalTransient && _showingAccountData\) return null;/,
    "Returning null leaves TrayApplicationContext._lastStats — the account snapshot — untouched.",
  );
});

test("rich pet stats cannot mix authorities into one published snapshot", () => {
  assert.match(
    usagePoller,
    /private async Task<\(int Streak, int ActiveDays\)\?> FetchHeatmapAsync\(/,
    "FetchHeatmapAsync must be able to signal a would-be downgrade.",
  );
  assert.match(
    usagePoller,
    /private async Task<IReadOnlyList<TopModelStat>\?> FetchTopModelsAsync\(/,
    "FetchTopModelsAsync must be able to signal a would-be downgrade.",
  );
  for (const guard of [
    /FetchHeatmapAsync[\s\S]*?if \(ReadAccountSource\(resp\) == AccountSource\.LocalTransient && _showingAccountData\) return null;/,
    /FetchTopModelsAsync[\s\S]*?if \(ReadAccountSource\(resp\) == AccountSource\.LocalTransient && _showingAccountData\) return null;/,
  ]) {
    assert.match(usagePoller, guard, "each rich sub-fetch must apply the same rule");
  }
  assert.match(
    usagePoller,
    /if \(heatmap is null \|\| topModels is null\) return null;/,
    "UsageStats is published atomically, so one degraded dataset skips the whole poll.",
  );
});

test("account authority is recorded only on a real publish", () => {
  assert.match(
    usagePoller,
    /_showingAccountData = summarySource == AccountSource\.Account;\n\s*return new UsageStats\(/,
    "The flag must track what is actually on screen, not what the last response said.",
  );
});
