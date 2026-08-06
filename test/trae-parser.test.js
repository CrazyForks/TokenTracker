/**
 * Trae SOLO (ByteDance AI IDE) parser test.
 *
 * Builds synthetic Trae storage.json fixtures under a temp TRAE SOLO home and
 * verifies:
 *   - resolveTraePath env precedence (TOKENTRACKER_TRAE_HOME → platform default)
 *   - resolveTraeStoragePath resolves User/globalStorage/storage.json
 *   - parseTraeIncremental skips missing / unchanged storage.json
 *   - missing iCubeServerData / entitlementInfo advance the cursor without
 *     synthesizing trae-unknown queue entries
 *   - a full entitlement snapshot emits exactly one zero-token hourly queue
 *     entry carrying plan/limits metadata
 *   - cursor mutations are persisted back onto cursors.trae (fresh cursor
 *     included), following the parsePiIncremental pattern
 *   - the supplied traHome override wins over process.env for fallback
 *     storage-path resolution
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  resolveTraePath,
  resolveTraeStoragePath,
  parseTraeIncremental,
} = require("../src/lib/rollout");

const SERVER_KEY = "iCubeServerData://icube.cloudide";

function makeTraeHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "trae-test-"));
}

function writeStorage(traeHome, serverDataValue, { mtimeMs } = {}) {
  const dir = path.join(traeHome, "User", "globalStorage");
  fs.mkdirSync(dir, { recursive: true });
  const storagePath = path.join(dir, "storage.json");
  const payload = {};
  if (serverDataValue !== undefined) payload[SERVER_KEY] = serverDataValue;
  fs.writeFileSync(storagePath, JSON.stringify(payload));
  if (typeof mtimeMs === "number") {
    const t = new Date(mtimeMs);
    fs.utimesSync(storagePath, t, t);
  }
  return storagePath;
}

function readQueue(queuePath) {
  if (!fs.existsSync(queuePath)) return [];
  return fs
    .readFileSync(queuePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
}

function sampleEntitlement(overrides = {}) {
  return {
    identityStr: "Pro",
    identity: 3,
    hasPackage: true,
    isDollarUsageBilling: false,
    proPeriod: "year",
    enableSoloBuilder: true,
    enableSoloCoder: false,
    detail: {
      fastRequestPer: 20,
      inWaitlist: false,
    },
    ...overrides,
  };
}

test("resolveTraePath honors TOKENTRACKER_TRAE_HOME override", () => {
  const override = "/custom/trae-home";
  assert.equal(
    resolveTraePath({ TOKENTRACKER_TRAE_HOME: override }),
    override,
  );
  // Whitespace-only override falls back to platform default.
  assert.notEqual(
    resolveTraePath({ TOKENTRACKER_TRAE_HOME: "   " }),
    "   ",
  );
});

test("resolveTraePath resolves a platform default on darwin", (t) => {
  if (process.platform !== "darwin") {
    t.skip("darwin-only default path");
    return;
  }
  const home = os.homedir();
  assert.equal(
    resolveTraePath({}),
    path.join(home, "Library", "Application Support", "TRAE SOLO"),
  );
});

test("resolveTraeStoragePath returns null when storage.json is missing", () => {
  const traeHome = makeTraeHome();
  assert.equal(
    resolveTraeStoragePath({ TOKENTRACKER_TRAE_HOME: traeHome }),
    null,
  );
});

test("resolveTraeStoragePath resolves existing storage.json", () => {
  const traeHome = makeTraeHome();
  const storagePath = writeStorage(traeHome, sampleEntitlement());
  assert.equal(
    resolveTraeStoragePath({ TOKENTRACKER_TRAE_HOME: traeHome }),
    storagePath,
  );
});

test("parseTraeIncremental returns zero counts when storage.json is missing", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const result = await parseTraeIncremental({
    storagePath: path.join(traeHome, "User", "globalStorage", "storage.json"),
    cursors: {},
    queuePath,
  });
  assert.deepEqual(result, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
});

test("parseTraeIncremental skips unchanged storage.json via mtime cursor", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, sampleEntitlement());
  const cursors = { trae: { lastMtime: Date.now() + 60_000 } };
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.deepEqual(result, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, 0);
});

test("parseTraeIncremental advances cursor and emits nothing when serverData is missing", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, undefined);
  const cursors = {};
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.deepEqual(result, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, 0);
  // Cursor must be persisted back even when cursors.trae did not exist.
  assert.ok(cursors.trae, "cursors.trae should be assigned");
  assert.ok(cursors.trae.lastMtime > 0, "cursor lastMtime should advance");
  assert.ok(cursors.trae.updatedAt, "cursor updatedAt should be set");
});

test("parseTraeIncremental advances cursor without trae-unknown entry when entitlementInfo is missing", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, { noEntitlement: true });
  const cursors = {};
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.deepEqual(result, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  // No synthetic trae-unknown queue line may be emitted.
  assert.equal(readQueue(queuePath).length, 0);
  assert.ok(cursors.trae.lastMtime > 0, "cursor should still advance");
});

test("parseTraeIncremental emits one entitlement snapshot queue entry", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, { entitlementInfo: sampleEntitlement() });
  const cursors = {};
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.deepEqual(result, { recordsProcessed: 1, eventsAggregated: 1, bucketsQueued: 1 });

  const rows = readQueue(queuePath);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source, "trae");
  assert.equal(row.model, "trae-pro");
  assert.equal(row.total_tokens, 0);
  assert.equal(row.billable_total_tokens, 0);
  assert.equal(row.conversation_count, 0);
  assert.match(row.hour_start, /^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
  assert.deepEqual(
    {
      identity: row.trae_entitlement.identity,
      identity_code: row.trae_entitlement.identity_code,
      has_package: row.trae_entitlement.has_package,
      is_dollar_billing: row.trae_entitlement.is_dollar_billing,
      pro_period: row.trae_entitlement.pro_period,
      enable_solo_builder: row.trae_entitlement.enable_solo_builder,
      enable_solo_coder: row.trae_entitlement.enable_solo_coder,
      fast_request_per: row.trae_entitlement.fast_request_per,
      in_waitlist: row.trae_entitlement.in_waitlist,
    },
    {
      identity: "Pro",
      identity_code: 3,
      has_package: true,
      is_dollar_billing: false,
      pro_period: "year",
      enable_solo_builder: true,
      enable_solo_coder: false,
      fast_request_per: 20,
      in_waitlist: false,
    },
  );
  assert.ok(cursors.trae.lastMtime > 0, "cursor should advance");
  assert.ok(cursors.trae.updatedAt, "cursor updatedAt should be set");
});

test("parseTraeIncremental persists cursor back onto an existing cursors.trae", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, { entitlementInfo: sampleEntitlement() });
  const cursors = { trae: { lastMtime: 1 } };
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.equal(result.recordsProcessed, 1);
  assert.equal(cursors.trae.lastMtime, fs.statSync(storagePath).mtimeMs);
});

test("parseTraeIncremental uses the supplied traHome for fallback resolution", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  writeStorage(traeHome, { entitlementInfo: sampleEntitlement() });
  const cursors = {};
  // No storagePath passed; the resolver must honor the traHome override even
  // though process.env.TOKENTRACKER_TRAE_HOME is unset.
  const result = await parseTraeIncremental({ traHome: traeHome, cursors, queuePath });
  assert.equal(result.recordsProcessed, 1);
  assert.equal(readQueue(queuePath).length, 1);
});
