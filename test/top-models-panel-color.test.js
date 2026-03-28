const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("TopModelsPanel renders percent values", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../dashboard/src/ui/matrix-a/components/TopModelsPanel.jsx"),
    "utf8",
  );

  assert.ok(src.includes("{percent"), "expected TopModelsPanel to render percent");
  assert.ok(src.includes("{percentSymbol}"), "expected TopModelsPanel to render percent symbol");
});
