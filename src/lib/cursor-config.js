const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const cp = require("node:child_process");
const https = require("node:https");

const { readJson } = require("./fs");

// ── Path resolution ──

function resolveCursorPaths({ home } = {}) {
  const h = home || os.homedir();
  const appSupport = path.join(h, "Library", "Application Support", "Cursor");
  return {
    appDir: appSupport,
    stateDbPath: path.join(appSupport, "User", "globalStorage", "state.vscdb"),
    cliConfigPath: path.join(h, ".cursor", "cli-config.json"),
  };
}

function isCursorInstalled({ home } = {}) {
  const { appDir } = resolveCursorPaths({ home });
  try {
    return fs.statSync(appDir).isDirectory();
  } catch {
    return false;
  }
}

// ── Auth token extraction ──

/**
 * Extract Cursor session cookie from local SQLite + cli-config.json.
 * Returns { cookie, userId } or null on failure.
 *
 * Cookie format: WorkosCursorSessionToken=user_XXXXX%3A%3A<jwt>
 * - JWT from state.vscdb → ItemTable → cursorAuth/accessToken
 * - userId from cli-config.json → authInfo.authId → "auth0|user_XXXXX"
 */
function extractCursorSessionToken({ home } = {}) {
  const { stateDbPath, cliConfigPath } = resolveCursorPaths({ home });

  // 1. Extract JWT from SQLite
  let jwt;
  try {
    jwt = cp
      .execSync(
        `sqlite3 "${stateDbPath}" "SELECT value FROM ItemTable WHERE key = 'cursorAuth/accessToken';"`,
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
      )
      .trim();
  } catch {
    return null;
  }
  if (!jwt || jwt.length < 10) return null;

  // 2. Extract userId — try cli-config.json first, fall back to JWT decode
  let userId = extractUserIdFromCliConfig(cliConfigPath);
  if (!userId) {
    userId = extractUserIdFromJwt(jwt);
  }
  if (!userId) return null;

  // 3. Build cookie
  const cookie = `WorkosCursorSessionToken=${userId}%3A%3A${jwt}`;
  return { cookie, userId };
}

function extractUserIdFromCliConfig(configPath) {
  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const authId = config?.authInfo?.authId || "";
    const match = authId.match(/\|(user_[A-Za-z0-9_]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function extractUserIdFromJwt(jwt) {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const sub = payload.sub || "";
    const match = sub.match(/(user_[A-Za-z0-9_]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

// ── API client ──

const CURSOR_CSV_URL = "https://cursor.com/api/dashboard/export-usage-events-csv?strategy=tokens";
const CURSOR_SUMMARY_URL = "https://cursor.com/api/usage-summary";

/**
 * Fetch full usage CSV from Cursor API.
 * Returns raw CSV string or throws on error.
 */
function fetchCursorUsageCsv({ cookie, timeoutMs = 30000 }) {
  return new Promise((resolve, reject) => {
    const url = new URL(CURSOR_CSV_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          Accept: "*/*",
          Cookie: cookie,
          Referer: "https://www.cursor.com/settings",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          res.resume();
          return reject(new Error("Cursor session expired — re-login in Cursor to refresh"));
        }
        if (res.statusCode === 308 || res.statusCode === 301 || res.statusCode === 302) {
          // Follow redirect once
          const location = res.headers.location;
          res.resume();
          if (!location) return reject(new Error(`Cursor API redirect without Location header`));
          return fetchUrlRaw({ urlStr: location, cookie, timeoutMs }).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Cursor API returned ${res.statusCode}`));
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Cursor API request timed out"));
    });
    req.end();
  });
}

/**
 * Fetch Cursor usage summary JSON.
 * Returns parsed JSON body or throws on error.
 */
function fetchCursorUsageSummary({ cookie, timeoutMs = 30000, fetchImpl = fetch }) {
  return fetchImpl(CURSOR_SUMMARY_URL, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Cookie: cookie,
      Referer: "https://www.cursor.com/settings",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  }).then(async (res) => {
    if (res.status === 401 || res.status === 403) {
      throw new Error("session_expired");
    }
    if (!res.ok) {
      throw new Error(`Cursor API returned ${res.status}`);
    }
    return res.json();
  });
}

function fetchUrlRaw({ urlStr, cookie, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: "GET",
        headers: {
          Accept: "*/*",
          Cookie: cookie,
          Referer: "https://www.cursor.com/settings",
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: timeoutMs,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Cursor API returned ${res.statusCode} from ${urlStr}`));
        }
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => resolve(data));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Cursor API request timed out"));
    });
    req.end();
  });
}

// ── CSV parsing ──

/**
 * Parse Cursor usage CSV into structured records.
 *
 * New format columns:
 *   Date, Kind, Model, Max Mode, Input (w/ Cache Write), Input (w/o Cache Write),
 *   Cache Read, Output Tokens, Total Tokens, Cost
 *
 * Old format columns:
 *   Date, Model, Input (w/ Cache Write), Input (w/o Cache Write),
 *   Cache Read, Output Tokens, Total Tokens, Cost, Cost to you
 */
function parseCursorCsv(csvText) {
  const lines = csvText.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0];
  const isNewFormat = header.includes("Kind");

  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (!fields || fields.length < 8) continue;

    let record;
    if (isNewFormat) {
      // Date,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost
      const inputWithCache = toNum(fields[4]);
      const inputWithoutCache = toNum(fields[5]);
      record = {
        date: stripQuotes(fields[0]),
        kind: stripQuotes(fields[1]),
        model: stripQuotes(fields[2]),
        maxMode: stripQuotes(fields[3]),
        inputTokens: inputWithoutCache,
        cacheWriteTokens: Math.max(0, inputWithCache - inputWithoutCache),
        cacheReadTokens: toNum(fields[6]),
        outputTokens: toNum(fields[7]),
        totalTokens: toNum(fields[8]),
        cost: toFloat(fields[9]),
      };
    } else {
      // Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost,Cost to you
      const inputWithCache = toNum(fields[2]);
      const inputWithoutCache = toNum(fields[3]);
      record = {
        date: stripQuotes(fields[0]),
        kind: "unknown",
        model: stripQuotes(fields[1]),
        maxMode: "No",
        inputTokens: inputWithoutCache,
        cacheWriteTokens: Math.max(0, inputWithCache - inputWithoutCache),
        cacheReadTokens: toNum(fields[4]),
        outputTokens: toNum(fields[5]),
        totalTokens: toNum(fields[6]),
        cost: toFloat(fields[7]),
      };
    }

    // Skip records with no tokens
    if (record.totalTokens <= 0 && record.inputTokens <= 0 && record.outputTokens <= 0) continue;

    records.push(record);
  }

  return records;
}

/**
 * Normalize a Cursor CSV record to TokenTracker's standard token format.
 */
function normalizeCursorUsage(record) {
  const inputTokens = Math.max(0, Math.floor(record.inputTokens || 0));
  const cacheWrite = Math.max(0, Math.floor(record.cacheWriteTokens || 0));
  const cacheRead = Math.max(0, Math.floor(record.cacheReadTokens || 0));
  const outputTokens = Math.max(0, Math.floor(record.outputTokens || 0));
  const totalTokens = inputTokens + outputTokens + cacheWrite + cacheRead;
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    output_tokens: outputTokens,
    reasoning_output_tokens: 0,
    total_tokens: totalTokens,
  };
}

// ── CSV helpers ──

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      current += ch;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function stripQuotes(s) {
  if (!s) return "";
  const trimmed = s.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function toNum(s) {
  const n = Number(stripQuotes(s));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

function toFloat(s) {
  const cleaned = stripQuotes(s).replace(/[$,]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  resolveCursorPaths,
  isCursorInstalled,
  extractCursorSessionToken,
  fetchCursorUsageCsv,
  fetchCursorUsageSummary,
  parseCursorCsv,
  normalizeCursorUsage,
};
