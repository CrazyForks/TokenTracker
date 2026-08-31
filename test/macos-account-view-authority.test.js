"use strict";

// Guard rails for the native popover's account-view authority.
//
// There is no Swift test target in this repo (see TokenTrackerBar/project.yml),
// so the invariants that keep a transient cloud failure from silently shrinking
// the popover to this-machine data are asserted against the source itself.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("account fallback reasons are classified, and transient ones are recognised by prefix", () => {
  const source = read("TokenTrackerBar/TokenTrackerBar/Models/AccountViewSource.swift");

  assert.match(source, /case account\b/);
  assert.match(source, /case localAuthoritative\(reason: String\)/);
  assert.match(source, /case localTransient\(reason: String\)/);
  assert.match(
    source,
    /if reason\.hasPrefix\("transient"\) \{ return \.localTransient\(reason: reason\) \}/,
    "Transient reasons must be matched by prefix so the server can add new ones.",
  );
  assert.match(
    source,
    /return \.localAuthoritative\(reason: reason\.isEmpty \? "unspecified" : reason\)/,
    "A server too old to send the fallback header must keep the pre-fix behaviour.",
  );
});

test("a transient fallback never replaces an account snapshot that is already shown", () => {
  const source = read("TokenTrackerBar/TokenTrackerBar/Models/AccountViewSource.swift");

  assert.match(
    source,
    /mutating func shouldAdopt\([\s\S]*guard source\.isTransientFallback else \{[\s\S]*return true\n {8}\}/,
    "Authoritative sources (account, signed out, cloud sync off) always publish.",
  );
  assert.match(
    source,
    /degradedDatasets\.insert\(dataset\)\n {8}if hasExistingValue, sourceByDataset\[dataset\]\?\.isAccount == true \{[\s\S]*return false/,
    "A transient fallback must keep the existing account snapshot.",
  );
  assert.match(
    source,
    /sourceByDataset\[dataset\] = source\n {8}return true\n {4}\}/,
    "With no account snapshot to keep, local data is still better than an empty panel.",
  );
});

test("every account-capable popover fetch keeps its response authority", () => {
  const apiClient = read("TokenTrackerBar/TokenTrackerBar/Services/APIClient.swift");

  for (const fn of [
    "fetchDaily",
    "fetchHeatmap",
    "fetchModelBreakdown",
    "fetchMonthly",
    "fetchHourly",
  ]) {
    assert.match(
      apiClient,
      new RegExp(`func ${fn}\\([^)]*\\) async throws -> AccountFetchResult<`),
      `${fn} must return the account-view authority, not a bare payload.`,
    );
  }
  assert.match(
    apiClient,
    /X-TokenTracker-Account-Fallback/,
    "The fallback reason header must be read by the client.",
  );
  assert.doesNotMatch(
    apiClient,
    /withAccountQueryItems\(\[[\s\S]{0,200}?\]\)\)\n\t\}\n\n\tfunc fetch(Daily|Heatmap|Monthly|Hourly|ModelBreakdown)[^\n]*-> (Daily|Heatmap|Monthly|Hourly|Model)/,
    "No account endpoint may fall back to the header-dropping generic fetch.",
  );
});

test("the view model gates every dataset behind the account-view authority", () => {
  const viewModel = read("TokenTrackerBar/TokenTrackerBar/ViewModels/DashboardViewModel.swift");

  for (const dataset of [
    "todaySummary",
    "periodSummary",
    "rollingSummary",
    "totalSummary",
    "daily",
    "hourly",
    "monthly",
    "heatmap",
    "modelBreakdown",
  ]) {
    assert.match(
      viewModel,
      new RegExp(`for: \\.${dataset},`),
      `${dataset} must go through shouldPublish before overwriting what is on screen.`,
    );
  }

  assert.match(
    viewModel,
    /private static let accountRecoveryDelays: \[TimeInterval\] = \[1, 3, 10\]/,
    "A transient cloud failure should retry on a short backoff, not wait for the next tick.",
  );
  assert.match(
    viewModel,
    /if accountViewState\.isDegraded \{\n {12}scheduleAccountRecoveryRetry\(\)\n {8}\} else \{\n {12}cancelAccountRecovery\(\)/,
    "Recovery retries must stop as soon as the account view comes back.",
  );
  assert.match(
    viewModel,
    /guard accountRecoveryAttempt < Self\.accountRecoveryDelays\.count else \{ return \}/,
    "Retries must be bounded.",
  );
});

test("the local server tags why it served this-machine data", () => {
  const localApi = read("src/lib/local-api.js");

  assert.match(localApi, /const ACCOUNT_FALLBACK_CLOUD_SYNC_OFF = "cloud-sync-off";/);
  assert.match(localApi, /const ACCOUNT_FALLBACK_SIGNED_OUT = "signed-out";/);
  assert.match(
    localApi,
    /res\.setHeader\("X-TokenTracker-Account-View", "0"\);\n\s*res\.setHeader\("X-TokenTracker-Account-Fallback", result\);/,
    "Every local fallback response must carry its reason.",
  );
  assert.match(
    localApi,
    /function classifyAccountFallback\(err\)[\s\S]*return "transient-timeout"[\s\S]*return "transient-auth"[\s\S]*return "transient-network"/,
    "Timeout, auth and network failures must be distinguishable in logs.",
  );
});
