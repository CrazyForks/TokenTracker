const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("UsagePanel accepts statusLabel prop", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../dashboard/src/ui/matrix-a/components/UsagePanel.jsx"),
    "utf8",
  );

  assert.ok(src.includes("statusLabel"), "expected UsagePanel to accept statusLabel prop");
});
