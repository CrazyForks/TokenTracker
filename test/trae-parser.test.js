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
 *     entry (token-count-only per the queue contract — plan/limits metadata
 *     is served from Trae Local State, never persisted into queue.jsonl)
 *   - readTraeEntitlementFromStorage reads the normalized entitlement
 *     snapshot straight from storage.json for the status render path
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
  readTraeEntitlementFromStorage,
  parseTraeIncremental,
  toUtcHalfHourStart,
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

test("parseTraeIncremental treats a top-level null storage.json as no valid data", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = path.join(traeHome, "User", "globalStorage", "storage.json");
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, "null");
  const cursors = {};
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.deepEqual(result, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, 0);
  assert.ok(cursors.trae.lastMtime > 0, "cursor should still advance");
  assert.ok(cursors.trae.updatedAt, "cursor updatedAt should be set");
});

test("parseTraeIncremental treats serverData JSON null (\"null\") as no valid snapshot", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, "null");
  const cursors = {};
  const result = await parseTraeIncremental({ storagePath, cursors, queuePath });
  assert.deepEqual(result, { recordsProcessed: 0, eventsAggregated: 0, bucketsQueued: 0 });
  assert.equal(readQueue(queuePath).length, 0);
  assert.ok(cursors.trae.lastMtime > 0, "cursor should still advance");
  assert.ok(cursors.trae.updatedAt, "cursor updatedAt should be set");
});

test("toUtcHalfHourStart buckets to :00 and :30 UTC starts", () => {
  assert.equal(
    toUtcHalfHourStart("2026-08-07T01:15:00.000Z"),
    "2026-08-07T01:00:00.000Z",
  );
  assert.equal(
    toUtcHalfHourStart("2026-08-07T01:45:00.000Z"),
    "2026-08-07T01:30:00.000Z",
  );
});

test("parseTraeIncremental invokes onProgress on the successful path", async () => {
  const traeHome = makeTraeHome();
  const queuePath = path.join(traeHome, "queue.ndjson");
  const storagePath = writeStorage(traeHome, { entitlementInfo: sampleEntitlement() });
  const cursors = {};
  const progressCalls = [];
  const result = await parseTraeIncremental({
    storagePath,
    cursors,
    queuePath,
    onProgress: (p) => progressCalls.push(p),
  });
  assert.equal(result.recordsProcessed, 1);
  assert.equal(progressCalls.length, 1);
  assert.equal(progressCalls[0].index, 1);
  assert.equal(progressCalls[0].total, 1);
  assert.equal(progressCalls[0].bucketsQueued, 1);
});

test("parseTraeIncremental emits one token-count-only queue entry", async () => {
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
  assert.match(row.hour_start, /^\d{4}-\d{2}-\d{2}T\d{2}:(00|30):00\.000Z$/);
  // Queue rows are token-count-only (CLAUDE.md privacy rule): plan/limits
  // metadata must NOT be persisted into queue.jsonl.
  assert.equal("trae_entitlement" in row, false);
  assert.ok(cursors.trae.lastMtime > 0, "cursor should advance");
  assert.ok(cursors.trae.updatedAt, "cursor updatedAt should be set");
});

test("readTraeEntitlementFromStorage returns a normalized snapshot from Local State", () => {
  const traeHome = makeTraeHome();
  const storagePath = writeStorage(traeHome, { entitlementInfo: sampleEntitlement() });
  const ent = readTraeEntitlementFromStorage(storagePath);
  assert.deepEqual(ent, {
    identity: "Pro",
    identity_code: 3,
    has_package: true,
    is_dollar_billing: false,
    pro_period: "year",
    enable_solo_builder: true,
    enable_solo_coder: false,
    fast_request_per: 20,
    in_waitlist: false,
    captured_at: ent.captured_at,
  });
  assert.match(ent.captured_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test("readTraeEntitlementFromStorage returns null for missing storage.json", () => {
  const traeHome = makeTraeHome();
  assert.equal(
    readTraeEntitlementFromStorage(path.join(traeHome, "User", "globalStorage", "storage.json")),
    null,
  );
});

test("readTraeEntitlementFromStorage returns null for top-level null storage.json", () => {
  const traeHome = makeTraeHome();
  const storagePath = path.join(traeHome, "User", "globalStorage", "storage.json");
  fs.mkdirSync(path.dirname(storagePath), { recursive: true });
  fs.writeFileSync(storagePath, "null");
  assert.equal(readTraeEntitlementFromStorage(storagePath), null);
});

test("readTraeEntitlementFromStorage returns null when serverData has no entitlementInfo", () => {
  const traeHome = makeTraeHome();
  const storagePath = writeStorage(traeHome, { noEntitlement: true });
  assert.equal(readTraeEntitlementFromStorage(storagePath), null);
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
