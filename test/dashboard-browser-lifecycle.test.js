const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("macOS releases the dashboard WKWebView after a normal close", () => {
  const source = read(
    "TokenTrackerBar/TokenTrackerBar/Services/DashboardWindowController.swift",
  );

  assert.match(source, /private func releaseDashboardResources\(/);
  assert.match(source, /removeScriptMessageHandler\(forName: "nativeOAuth"\)/);
  assert.match(source, /removeScriptMessageHandler\(forName: "nativeBridge"\)/);
  assert.match(source, /NativeBridge\.shared\.webView = nil/);
  assert.match(source, /closingWindow\.contentView = nil/);
  assert.match(source, /self\.webView = nil/);
  assert.match(source, /self\.window = nil/);

  const closeHandler = source.match(
    /func windowWillClose\([\s\S]*?\n    }\n\n    \/\/ MARK: - WKScriptMessageHandler/,
  )?.[0];
  assert.ok(closeHandler, "Dashboard close handler should exist");
  assert.match(closeHandler, /if oauthInFlight/);
  assert.match(closeHandler, /releaseDashboardResources\(closingWindow: closingWindow\)/);
});

test("macOS keeps PKCE state only while native OAuth is in flight", () => {
  const source = read(
    "TokenTrackerBar/TokenTrackerBar/Services/DashboardWindowController.swift",
  );
  const callbackSource = read("dashboard/src/pages/NativeAuthCallbackPage.jsx");

  assert.match(source, /private var oauthInFlight = false/);
  assert.match(source, /private var oauthTimeoutTask: Task<Void, Never>\?/);
  assert.match(source, /beginNativeOAuth\(\)/);
  assert.match(source, /completeNativeOAuth\(\)/);
  assert.match(source, /expireNativeOAuth\(\)/);
  assert.match(source, /messageType == "authCompleted"/);
  assert.match(callbackSource, /postNativeMessage\(\{ type: "authCompleted" \}\)/);
});

test("Windows closes and disposes an idle dashboard WebView2 instead of hiding it", () => {
  const windowSource = read("TokenTrackerWin/DashboardWindow.cs");
  const traySource = read("TokenTrackerWin/TrayApplicationContext.cs");

  assert.match(windowSource, /public event Action<DashboardWindow>\? ReleasedForIdle/);
  assert.match(windowSource, /private void CloseOrHideForOAuth\(\)/);
  assert.match(windowSource, /_webView\.Dispose\(\)/);
  assert.match(windowSource, /ReleasedForIdle\?\.Invoke\(this\)/);
  assert.match(windowSource, /private bool _oauthInFlight/);
  assert.match(windowSource, /BeginNativeOAuth\(\)/);
  assert.match(windowSource, /CompleteNativeOAuth\(\)/);
  assert.match(windowSource, /ExpireNativeOAuth\(\)/);
  assert.match(windowSource, /t\.GetString\(\) == "authCompleted"/);

  const closingHandler = windowSource.match(
    /protected override void OnClosing\([\s\S]*?\n    }\n\n    protected override void OnClosed/,
  )?.[0];
  assert.ok(closingHandler, "Dashboard closing handler should exist");
  assert.match(closingHandler, /if \(!_exiting && _oauthInFlight\)/);
  assert.match(closingHandler, /e\.Cancel = true;\s*Hide\(\);/);
  assert.doesNotMatch(
    closingHandler,
    /if \(!_exiting\)\s*\{\s*e\.Cancel = true;\s*Hide\(\);/,
    "normal closes must not retain WebView2",
  );

  assert.match(traySource, /dashboard\.ReleasedForIdle \+= OnDashboardReleasedForIdle/);
  assert.match(traySource, /ReferenceEquals\(_dashboard, dashboard\)/);
  assert.match(traySource, /_dashboard = null/);
});
