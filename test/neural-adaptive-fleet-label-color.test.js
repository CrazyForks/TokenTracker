const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

test("NeuralAdaptiveFleet renders label with appropriate styling", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../dashboard/src/ui/matrix-a/components/NeuralAdaptiveFleet.jsx"),
    "utf8",
  );

  assert.ok(src.includes("{label}"), "expected NeuralAdaptiveFleet to render label");
  assert.ok(
    src.includes("font-semibold"),
    "expected label to use semibold font weight",
  );
});
