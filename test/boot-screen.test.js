const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

function read(rel) {
  return fs.readFileSync(path.join(__dirname, "..", rel), "utf8");
}

function parseCsv(raw) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = raw[i + 1];
        if (next === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }

    if (ch === ",") {
      row.push(field);
      field = "";
      continue;
    }

    if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    if (ch === "\r") continue;

    field += ch;
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

test("boot screen uses ascii art from copy registry", () => {
  const csv = read("dashboard/src/content/copy.csv");
  const rows = parseCsv(csv);
  const map = new Map();
  for (const row of rows) {
    if (!row.length) continue;
    map.set(row[0], row[5] || "");
  }

  const art = map.get("boot.ascii_art");
  assert.ok(art && art.length > 0, "expected boot.ascii_art to be non-empty");
});
