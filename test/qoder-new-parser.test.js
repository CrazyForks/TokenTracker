"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  parseQoderNewIncremental,
  resolveQoderProjectsDir,
  resolveQoderCnProjectsDir,
  listQoderNewSessionFiles,
} = require("../src/lib/rollout");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-new-"));
}

function tempQueue() {
  const dir = tempDir();
  return {
    dir,
    queuePath: path.join(dir, "queue.jsonl"),
  };
}

function queueRows(queuePath) {
  if (!fs.existsSync(queuePath)) return [];
  return fs.readFileSync(queuePath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonl(filePath, records) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
}

test("parseQoderNewIncremental aggregates and second sync is no-op", async (t) => {
  const tmp = tempDir();
  const { dir, queuePath } = tempQueue();
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sessionFile = path.join(tmp, "proj", "sess1.jsonl");
  const baseRecord = (credits, ts, msgId) => ({
    type: "assistant",
    timestamp: ts,
    uuid: msgId,
    sessionId: "sess-1",
    cwd: "/tmp/proj",
    message: {
      id: msgId,
      role: "assistant",
      model: "qmodel_38max",
      content: [{ type: "tool_use", name: "Read" }],
      usage: { credits, billable: true, input_tokens: 0, output_tokens: 0 },
    },
  });
  writeJsonl(sessionFile, [
    baseRecord(1.5, "2026-08-30T11:00:00.000Z", "m1"),
    baseRecord(2.0, "2026-08-30T11:15:00.000Z", "m2"),
  ]);
  const cursors = {};
  const first = await parseQoderNewIncremental({
    sessionFiles: [sessionFile],
    cursors,
    queuePath,
    sourceKey: "qoder",
    cursorKey: "qoderNew",
  });
  assert.equal(first.messagesProcessed, 2);
  assert.equal(first.eventsAggregated, 2);
  assert.ok(first.bucketsQueued >= 1);
  const before = fs.readFileSync(queuePath, "utf8");
  const second = await parseQoderNewIncremental({
    sessionFiles: [sessionFile],
    cursors,
    queuePath,
    sourceKey: "qoder",
    cursorKey: "qoderNew",
  });
  assert.equal(second.eventsAggregated, 0);
  assert.equal(second.bucketsQueued, 0);
  assert.equal(fs.readFileSync(queuePath, "utf8"), before);
});

test("parseQoderNewIncremental keeps distinct keys for no-id records in same file", async (t) => {
  const tmp = tempDir();
  const { dir, queuePath } = tempQueue();
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sessionFile = path.join(tmp, "sess.jsonl");
  // No message.id nor uuid, same sessionId — fallback must use line index
  const rec = (ts) => ({
    type: "assistant",
    timestamp: ts,
    sessionId: "sess-x",
    cwd: "/tmp/proj",
    message: {
      role: "assistant",
      model: "qmodel_38max",
      content: [{ type: "tool_use", name: "Bash" }],
      usage: { credits: 1.0, billable: true },
    },
  });
  writeJsonl(sessionFile, [
    rec("2026-08-30T11:00:00.000Z"),
    rec("2026-08-30T11:05:00.000Z"),
    rec("2026-08-30T11:10:00.000Z"),
  ]);
  const cursors = {};
  const res = await parseQoderNewIncremental({
    sessionFiles: [sessionFile],
    cursors,
    queuePath,
    sourceKey: "qoder",
    cursorKey: "qoderNew",
  });
  // All three should be counted distinct, not collapsed to 1
  assert.equal(res.messagesProcessed, 3);
  assert.equal(res.eventsAggregated, 3);
  const keys = Object.keys(cursors.qoderNew.messages);
  assert.equal(keys.length, 3);
  // Keys must be distinct
  assert.equal(new Set(keys).size, 3);
});

test("parseQoderNewIncremental corrects credits change", async (t) => {
  const tmp = tempDir();
  const { dir, queuePath } = tempQueue();
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sessionFile = path.join(tmp, "sess.jsonl");
  const mk = (credits) => ({
    type: "assistant",
    timestamp: "2026-08-30T11:00:00.000Z",
    uuid: "u1",
    sessionId: "sess-1",
    cwd: "/tmp/proj",
    message: {
      id: "m1",
      role: "assistant",
      model: "qmodel_38max",
      content: [{ type: "tool_use", name: "Read" }],
      usage: { credits, billable: true },
    },
  });
  writeJsonl(sessionFile, [mk(1.0)]);
  const cursors = {};
  await parseQoderNewIncremental({ sessionFiles: [sessionFile], cursors, queuePath, sourceKey: "qoder", cursorKey: "qoderNew" });
  const firstRows = queueRows(queuePath).filter((r) => r.source === "qoder");
  const firstTokens = firstRows[0].total_tokens;
  // Correct credits to 2.0
  writeJsonl(sessionFile, [mk(2.0)]);
  const second = await parseQoderNewIncremental({ sessionFiles: [sessionFile], cursors, queuePath, sourceKey: "qoder", cursorKey: "qoderNew" });
  assert.ok(second.eventsAggregated >= 1);
  assert.ok(second.bucketsQueued >= 1);
  const latest = queueRows(queuePath).filter((r) => r.source === "qoder").at(-1);
  assert.ok(latest.total_tokens > firstTokens, "tokens should increase with credits");
  assert.equal(latest.usage_precision, "qoder_credits_estimate");
});

test("resolveQoderProjectsDir windows case-insensitive guard", () => {
  const intl = resolveQoderProjectsDir({ home: "C:\\Users\\x", env: { QODER_PROJECTS_DIR: "C:\\Users\\x\\.qoder\\projects" }, platform: "win32", deps: { existsSync: () => true, discoverWslHome: () => null } });
  const cn = resolveQoderCnProjectsDir({ home: "C:\\Users\\x", env: { QODER_CN_PROJECTS_DIR: "c:\\users\\x\\.qoder\\projects" }, platform: "win32", deps: { existsSync: () => true, discoverWslHome: () => null } });
  // Direct guard logic from sync.js uses path.normalize + win32 lower-case
  const winKey = (p) => path.win32.normalize(p).toLowerCase();
  assert.equal(winKey(intl), winKey(cn));
  // Raw strings differ in case
  assert.notEqual(intl, cn);
});

test("parseQoderNewIncremental uses isolated cursor namespace", async (t) => {
  const tmp = tempDir();
  const { dir, queuePath } = tempQueue();
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sessionFile = path.join(tmp, "sess.jsonl");
  writeJsonl(sessionFile, [{
    type: "assistant",
    timestamp: "2026-08-30T11:00:00.000Z",
    uuid: "u1",
    sessionId: "sess-1",
    cwd: "/tmp/proj",
    message: { id: "m1", role: "assistant", model: "qmodel_38max", content: [{ type: "tool_use", name: "Read" }], usage: { credits: 1.0, billable: true } },
  }]);
  const cursors = { qoder: { messages: { legacyKey: { totals: { input_tokens: 1 }, bucketStart: "2026-08-30T11:00:00.000Z", model: "qoder-agent" } }, updatedAt: new Date().toISOString() } };
  await parseQoderNewIncremental({ sessionFiles: [sessionFile], cursors, queuePath, sourceKey: "qoder", cursorKey: "qoderNew" });
  // Legacy cursor untouched, new cursor populated
  assert.ok(cursors.qoder.messages.legacyKey);
  assert.ok(cursors.qoderNew);
  assert.equal(Object.keys(cursors.qoderNew.messages).length, 1);
  assert.equal(cursors.qoderNew.messages["jsonl:sess-1|m1"]?.model, "qmodel_38max");
});

test("parseQoderNewIncremental handles zero credit with only cache-creation tokens (precise, not estimated)", async (t) => {
  const tmp = tempDir();
  const { dir, queuePath } = tempQueue();
  t.after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const sessionFile = path.join(tmp, "sess.jsonl");
  writeJsonl(sessionFile, [{
    type: "assistant",
    timestamp: "2026-08-30T11:00:00.000Z",
    uuid: "u1",
    sessionId: "sess-cache",
    cwd: "/tmp/proj",
    message: {
      id: "m-cache",
      role: "assistant",
      model: "qmodel_38max",
      content: [{ type: "tool_use", name: "Read" }],
      usage: { credits: 0, billable: true, input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 123, output_tokens: 0 },
    },
  }]);
  const cursors = {};
  const res = await parseQoderNewIncremental({ sessionFiles: [sessionFile], cursors, queuePath, sourceKey: "qoder", cursorKey: "qoderNew" });
  assert.equal(res.messagesProcessed, 1);
  assert.equal(res.eventsAggregated, 1);
  const row = queueRows(queuePath).find((r) => r.source === "qoder");
  assert.equal(row.cache_creation_input_tokens, 123);
  assert.equal(row.total_tokens, 123);
  assert.equal(row.input_tokens, 0);
  // Precise cache-creation should not be marked as credits estimate
  assert.equal(row.usage_precision, undefined);
  assert.equal(row.conversation_count, 1);
});
