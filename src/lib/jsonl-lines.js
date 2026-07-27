"use strict";

/**
 * Yield physical JSONL records. Unlike node:readline, this intentionally treats
 * only LF as a record separator so valid U+2028/U+2029 characters inside JSON
 * strings remain part of the record. Reading raw bytes keeps byte budgets exact
 * and lets malformed UTF-8 fail closed.
 */
class PhysicalJsonlLimitError extends Error {
  constructor(maxPhysicalBytes) {
    super(`physical JSONL byte limit exceeded: ${maxPhysicalBytes}`);
    this.name = "PhysicalJsonlLimitError";
    this.code = "PHYSICAL_JSONL_LIMIT_EXCEEDED";
  }
}

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });

function decodePhysicalLine(buffer, { stripCr = false } = {}) {
  const content = stripCr && buffer.length > 0 && buffer[buffer.length - 1] === 0x0d
    ? buffer.subarray(0, buffer.length - 1)
    : buffer;
  return fatalUtf8Decoder.decode(content);
}

async function* physicalJsonlRecords(input, { maxPhysicalBytes = Infinity } = {}) {
  const byteLimit = Number.isFinite(maxPhysicalBytes)
    ? Math.max(0, Number(maxPhysicalBytes))
    : Infinity;
  const fragments = [];
  let fragmentsBytes = 0;
  let physicalBytesRead = 0;

  for await (const value of input) {
    if (!Buffer.isBuffer(value) && !(value instanceof Uint8Array)) {
      throw new TypeError("physicalJsonlLines input must emit bytes");
    }
    const chunk = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);

    let start = 0;
    let newline = chunk.indexOf(0x0a);
    while (newline !== -1) {
      const fragment = chunk.subarray(start, newline);
      const physicalBytes = fragmentsBytes + fragment.length + 1;
      if (physicalBytesRead + physicalBytes > byteLimit) {
        throw new PhysicalJsonlLimitError(byteLimit);
      }
      const lineBuffer = fragments.length === 0
        ? fragment
        : Buffer.concat([...fragments, fragment], fragmentsBytes + fragment.length);
      fragments.length = 0;
      fragmentsBytes = 0;
      physicalBytesRead += physicalBytes;
      yield {
        line: decodePhysicalLine(lineBuffer, { stripCr: true }),
        physicalBytes,
        terminated: true,
      };
      start = newline + 1;
      newline = chunk.indexOf(0x0a, start);
    }

    if (start < chunk.length) {
      const fragment = chunk.subarray(start);
      if (physicalBytesRead + fragmentsBytes + fragment.length > byteLimit) {
        throw new PhysicalJsonlLimitError(byteLimit);
      }
      fragments.push(Buffer.from(fragment));
      fragmentsBytes += fragment.length;
    }
  }

  if (fragmentsBytes > 0) {
    const lineBuffer = fragments.length === 1
      ? fragments[0]
      : Buffer.concat(fragments, fragmentsBytes);
    yield {
      line: decodePhysicalLine(lineBuffer),
      physicalBytes: fragmentsBytes,
      terminated: false,
    };
  }
}

async function* physicalJsonlLines(input) {
  for await (const record of physicalJsonlRecords(input)) {
    yield record.line;
  }
}

module.exports = {
  PhysicalJsonlLimitError,
  physicalJsonlLines,
  physicalJsonlRecords,
};
