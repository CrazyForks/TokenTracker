"use strict";

/**
 * Yield physical JSONL records. Unlike node:readline, this intentionally treats
 * only LF as a record separator so valid U+2028/U+2029 characters inside JSON
 * strings remain part of the record.
 *
 * The input must emit decoded strings (for example, a read stream created with
 * encoding: "utf8") so the stream owns UTF-8 chunk-boundary handling.
 */
async function* physicalJsonlRecords(input) {
  let fragments = [];

  for await (const chunk of input) {
    if (typeof chunk !== "string") {
      throw new TypeError("physicalJsonlLines input must emit strings");
    }

    let start = 0;
    let newline = chunk.indexOf("\n");
    while (newline !== -1) {
      const fragment = chunk.slice(start, newline);
      let line;
      if (fragments.length === 0) {
        line = fragment;
      } else {
        fragments.push(fragment);
        line = fragments.join("");
        fragments = [];
      }
      const physicalBytes = Buffer.byteLength(line, "utf8") + 1;
      if (line.endsWith("\r")) line = line.slice(0, -1);
      yield { line, physicalBytes, terminated: true };
      start = newline + 1;
      newline = chunk.indexOf("\n", start);
    }

    if (start < chunk.length) {
      fragments.push(chunk.slice(start));
    }
  }

  if (fragments.length > 0) {
    const line = fragments.join("");
    yield {
      line,
      physicalBytes: Buffer.byteLength(line, "utf8"),
      terminated: false,
    };
  }
}

async function* physicalJsonlLines(input) {
  for await (const record of physicalJsonlRecords(input)) {
    yield record.line;
  }
}

module.exports = { physicalJsonlLines, physicalJsonlRecords };
