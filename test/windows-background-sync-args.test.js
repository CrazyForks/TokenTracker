const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const repoRoot = path.join(__dirname, "..");

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), "utf8");
}

test("Windows background sync stays native-only while manual sync preserves WSL mode", () => {
  const serverManager = read("TokenTrackerWin/ServerManager.cs");
  const trayContext = read("TokenTrackerWin/TrayApplicationContext.cs");

  assert.match(
    trayContext,
    /new\(\)\s*\{\s*Interval\s*=\s*5\s*\*\s*60\s*\*\s*1000\s*\}/,
    "Windows tray background sync timer should remain a 5-minute timer",
  );
  assert.match(
    trayContext,
    /_syncTimer\.Tick \+= \(_, _\) => TriggerBackgroundSync\(\)/,
    "Windows timer tick should route through TriggerBackgroundSync",
  );
  assert.match(
    trayContext,
    /ServerStatus\.Running[\s\S]*_syncTimer\.Start\(\);[\s\S]*TriggerBackgroundSync\(\);/,
    "Windows server-running path should trigger the same background sync path",
  );
  assert.match(
    serverManager,
    /public void TriggerBackgroundSync\(\)[\s\S]*StartSync\(auto: true\);/,
    "Windows background sync should select the auto path",
  );
  assert.match(
    serverManager,
    /auto\s*\?\s*new\[\]\s*\{\s*"sync",\s*"--auto",\s*"--background"\s*\}\s*:\s*new\[\]\s*\{\s*"sync"\s*\}/,
    "Windows background args should use sync --auto --background while manual sync remains plain sync",
  );
  assert.doesNotMatch(
    serverManager,
    /new\[\]\s*\{\s*"sync",\s*"--auto"\s*\}/,
    "Windows background sync must not retain the bare sync --auto pattern",
  );
  assert.match(
    serverManager,
    /StartTrackerProcess\(\s*runtime\.Value\.NodePath,\s*runtime\.Value\.EntryPath,\s*auto,\s*args\)/,
    "Only the auto/background sync path should request native-only WSL isolation",
  );
  assert.match(
    serverManager,
    /if \(forceNativeOnlyWslMode\)[\s\S]*psi\.Environment\["TOKENTRACKER_WSL_MODE"\]\s*=\s*"native-only";/,
    "The Windows child launcher should override WSL mode for isolated background syncs",
  );
  assert.match(
    serverManager,
    /StartTrackerProcess\(\s*nodePath,\s*entryPath,\s*false,\s*"serve"/,
    "The long-lived server must not receive the background-only WSL override",
  );
  assert.match(
    serverManager,
    /args\.Length\s*>\s*0[\s\S]*TOKENTRACKER_NATIVE_SYNC_OWNER[\s\S]*"windows-host"/,
    "The Windows host must disable the embedded server's duplicate fallback timer",
  );
});
