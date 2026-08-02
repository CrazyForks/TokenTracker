const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { test } = require("node:test");

const {
  repairCodebuddyLogJsonlOverlap,
  CODEBUDDY_LOG_JSONL_REPAIR_KEY,
} = require("../src/commands/sync");

test("repairCodebuddyLogJsonlOverlap rebuilds old log+JSONL double counts atomically", async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "tt-codebuddy-repair-"));
  try {
    const codebuddyHome = path.join(tmp, ".codebuddy");
    const projectDir = path.join(codebuddyHome, "projects", "encoded-cwd");
    await fs.mkdir(projectDir, { recursive: true });
    const jsonlPath = path.join(projectDir, "session.jsonl");
    const logPath = path.join(tmp, "extension.log");
    const hourStart = "2026-04-05T14:00:00.000Z";
    const jsonlLine = JSON.stringify({
      type: "function_call",
      sessionId: "session",
      providerData: {
        messageId: "round-trip-1",
        model: "hy3",
        rawUsage: {
          prompt_tokens: 100,
          completion_tokens: 10,
          prompt_tokens_details: { cached_tokens: 0 },
        },
      },
      timestamp: Date.parse(hourStart),
    });
    await fs.writeFile(jsonlPath, `${jsonlLine}\n`);
    await fs.writeFile(logPath, "legacy log source\n");

    const queuePath = path.join(tmp, "queue.jsonl");
    const queueRows = [
      { source: "other", model: "x", hour_start: hourStart, total_tokens: 7 },
      {
        source: "codebuddy",
        model: "hy3",
        hour_start: hourStart,
        input_tokens: 200,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 20,
        reasoning_output_tokens: 0,
        total_tokens: 220,
        conversation_count: 2,
      },
    ];
    await fs.writeFile(queuePath, queueRows.map((row) => JSON.stringify(row)).join("\n") + "\n");
    const queueStatePath = path.join(tmp, "queue.state.json");
    await fs.writeFile(queueStatePath, JSON.stringify({ offset: 123 }));

    const cursors = {
      version: 1,
      hourly: {
        buckets: {
          "codebuddy|hy3|2026-04-05T14:00:00.000Z": {
            source: "codebuddy",
            model: "hy3",
            hour_start: hourStart,
            totals: {
              input_tokens: 200,
              cached_input_tokens: 0,
              cache_creation_input_tokens: 0,
              output_tokens: 20,
              reasoning_output_tokens: 0,
              total_tokens: 220,
              conversation_count: 2,
            },
          },
        },
        groupQueued: {},
      },
      codebuddy: {
        fileOffsets: {
          [jsonlPath]: { size: 1 },
          [logPath]: { size: 1 },
        },
      },
    };

    const changed = await repairCodebuddyLogJsonlOverlap({
      cursors,
      queuePath,
      queueStatePath,
      codebuddyFiles: [jsonlPath, logPath],
      env: { CODEBUDDY_HOME: codebuddyHome, HOME: tmp },
    });
    assert.equal(changed, true);
    assert.equal(cursors.migrations[CODEBUDDY_LOG_JSONL_REPAIR_KEY].status, "applied");
    assert.equal(cursors.hourly.buckets["codebuddy|hy3|2026-04-05T14:00:00.000Z"].totals.total_tokens, 110);
    assert.equal(cursors.codebuddy.fileOffsets[logPath], undefined);

    const lines = (await fs.readFile(queuePath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(lines.filter((row) => row.source === "other").length, 1);
    const codebuddyRows = lines.filter((row) => row.source === "codebuddy");
    assert.equal(codebuddyRows.length, 1);
    assert.equal(codebuddyRows[0].total_tokens, 110);
    assert.equal(JSON.parse(await fs.readFile(queueStatePath, "utf8")).offset, 0);

    const changedAgain = await repairCodebuddyLogJsonlOverlap({
      cursors,
      queuePath,
      queueStatePath,
      codebuddyFiles: [jsonlPath, logPath],
      env: { CODEBUDDY_HOME: codebuddyHome, HOME: tmp },
    });
    assert.equal(changedAgain, false);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
