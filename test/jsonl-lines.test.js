"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");

const { physicalJsonlLines, physicalJsonlRecords } = require("../src/lib/jsonl-lines");

async function collectLines(chunks) {
  const lines = [];
  for await (const line of physicalJsonlLines(chunks)) {
    lines.push(line);
  }
  return lines;
}

test("physicalJsonlLines splits LF records", async () => {
  const lines = await collectLines(["first\nsecond\nthird\n"]);

  assert.deepEqual(lines, ["first", "second", "third"]);
});

test("physicalJsonlLines strips CR from CRLF records, including split CRLF chunks", async () => {
  const lines = await collectLines(["first\r", "\nsecond\r", "\nthird\r\n"]);

  assert.deepEqual(lines, ["first", "second", "third"]);
});

test("physicalJsonlLines preserves legal U+2028 and U+2029 characters", async () => {
  const first = '{"text":"before\u2028after"}';
  const second = '{"text":"before\u2029after"}';
  const lines = await collectLines([`${first}\n${second}\n`]);

  assert.deepEqual(lines, [first, second]);
});

test("physicalJsonlLines preserves bare carriage returns", async () => {
  const lines = await collectLines(["first\rsecond\nfinal\r"]);

  assert.deepEqual(lines, ["first\rsecond", "final\r"]);
});

test("physicalJsonlRecords reports exact CRLF and unterminated byte spans", async () => {
  const records = [];
  for await (const record of physicalJsonlRecords(["first\r\nlast"])) {
    records.push(record);
  }

  assert.deepEqual(records, [
    { line: "first", physicalBytes: 7, terminated: true },
    { line: "last", physicalBytes: 4, terminated: false },
  ]);
});

test("physicalJsonlLines closes its input when the consumer stops early", async () => {
  let returned = false;
  const input = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { value: "first\nsecond\n", done: false };
        },
        async return() {
          returned = true;
          return { done: true };
        },
      };
    },
  };

  for await (const _line of physicalJsonlLines(input)) break;

  assert.equal(returned, true);
});

test("physicalJsonlLines reassembles records split across chunks", async () => {
  const lines = await collectLines(['{"id":', "1}", '\n{"id"', ":2}\n"]);

  assert.deepEqual(lines, ['{"id":1}', '{"id":2}']);
});

test("physicalJsonlLines yields a final unterminated record", async () => {
  const lines = await collectLines(["complete\nunter", "minated"]);

  assert.deepEqual(lines, ["complete", "unterminated"]);
});

test("physicalJsonlLines preserves empty physical records", async () => {
  const lines = await collectLines(["\n", "\nvalue\n\n"]);

  assert.deepEqual(lines, ["", "", "value", ""]);
});

test("physicalJsonlLines handles a large record split across many chunks", async () => {
  const record = `{"payload":"${"x".repeat(2 * 1024 * 1024)}"}`;
  const chunks = [];
  for (let offset = 0; offset < record.length; offset += 127) {
    chunks.push(record.slice(offset, offset + 127));
  }
  chunks.push("\n");

  const lines = await collectLines(chunks);

  assert.equal(chunks.length > 10_000, true);
  assert.deepEqual(lines, [record]);
});
