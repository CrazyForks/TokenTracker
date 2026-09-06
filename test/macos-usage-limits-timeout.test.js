const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const apiClientPath = path.join(
  __dirname,
  "..",
  "TokenTrackerBar",
  "TokenTrackerBar",
  "Services",
  "APIClient.swift",
);
const dashboardViewModelPath = path.join(
  __dirname,
  "..",
  "TokenTrackerBar",
  "TokenTrackerBar",
  "ViewModels",
  "DashboardViewModel.swift",
);

function readAPIClient() {
  return fs.readFileSync(apiClientPath, "utf8");
}

test("macOS usage-limits request outlives the server provider timeout budget", () => {
  const source = readAPIClient();

  assert.match(
    source,
    /private static let usageLimitsRequestTimeout: TimeInterval = 25/,
    "The limits request needs headroom above the server's 15-second per-provider timeout.",
  );
  assert.match(
    source,
    /func fetchUsageLimits\(\)[\s\S]*fetch\([\s\S]*"\/functions\/tokentracker-usage-limits"[\s\S]*requestTimeout: Self\.usageLimitsRequestTimeout[\s\S]*\)/,
    "Only the usage-limits endpoint should opt into the longer request timeout.",
  );
  assert.match(
    source,
    /if let requestTimeout \{[\s\S]*request\.timeoutInterval = requestTimeout[\s\S]*session\.data\(for: request\)/,
    "The endpoint-specific timeout must be applied to its URLRequest.",
  );
});

test("macOS usage-limits hydrates the last good record before refreshing", () => {
  const source = fs.readFileSync(dashboardViewModelPath, "utf8");

  assert.match(
    source,
    /@Published var usageLimits: UsageLimitsResponse\? = UsageLimitsCache\.load\(\)/,
    "A restarted app should render its last good limits record instead of a skeleton.",
  );
  assert.match(
    source,
    /let newLimits = try await APIClient\.shared\.fetchUsageLimits\(\)[\s\S]*UsageLimitsCache\.save\(newLimits\)/,
    "A successful background refresh should persist the replacement record.",
  );
});

test("macOS local API session bypasses URLCache after a system clock rollback", () => {
  const source = readAPIClient();

  assert.match(
    source,
    /let config = URLSessionConfiguration\.default[\s\S]*config\.requestCachePolicy = \.reloadIgnoringLocalCacheData[\s\S]*config\.urlCache = nil[\s\S]*self\.session = URLSession\(configuration: config\)/,
    "Dynamic localhost responses must not be replayed from a future-dated URLCache entry.",
  );
});
