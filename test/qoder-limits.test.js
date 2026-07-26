"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  QODER_SITES,
  normalizeQoderUsageResponse,
  decryptChromiumCookie,
  qoderRequestHeaders,
  fetchQoderUsage,
  normalizeQoderRpcUsage,
  normalizeQoderActivityResponse,
  fetchQoderActivity,
  fetchQoderLimits,
  readQoderActivityCache,
  writeQoderActivityCache,
  readQoderLimitsCache,
  writeQoderLimitsCache,
  parseQoderQuotaLog,
} = require("../src/lib/qoder-limits");

test("normalizeQoderUsageResponse merges camel-case base and shared quotas", () => {
  const result = normalizeQoderUsageResponse({
    totalQuota: {
      quotaSummary: {
        usedValue: 20,
        limitValue: 100,
        remainingValue: 80,
        usagePercentage: 20,
        unit: "credits",
      },
    },
    sharedQuota: {
      quotaSummary: {
        usedValue: 30,
        limitValue: 200,
        remainingValue: 170,
        unit: "credits",
      },
    },
    nextResetAt: "2026-08-01T00:00:00Z",
  });

  assert.equal(result.configured, true);
  assert.equal(result.primary_window.used_credits, 50);
  assert.equal(result.primary_window.limit_credits, 300);
  assert.equal(result.primary_window.remaining_credits, 250);
  assert.ok(Math.abs(result.primary_window.used_percent - (50 / 3)) < 1e-12);
  assert.equal(result.primary_window.reset_at, "2026-08-01T00:00:00.000Z");
});

test("normalizeQoderUsageResponse accepts snake case and exhausted zero quota", () => {
  const result = normalizeQoderUsageResponse({
    total_quota: {
      quota_summary: {
        used_value: 0,
        limit_value: 0,
        remaining_value: 0,
        unit: "credits",
      },
    },
    next_reset_at: 1_785_542_400_000,
  });
  assert.equal(result.primary_window.used_percent, 100);
  assert.equal(result.primary_window.reset_at, "2026-08-01T00:00:00.000Z");
});

test("normalizeQoderUsageResponse rejects invalid quota values", () => {
  assert.throws(
    () => normalizeQoderUsageResponse({
      totalQuota: {
        quotaSummary: {
          usedValue: -1,
          limitValue: 100,
          remainingValue: 101,
        },
      },
    }),
    /nonnegative/,
  );
  assert.throws(
    () => normalizeQoderUsageResponse({
      totalQuota: {
        quotaSummary: {
          usedValue: 1,
          limitValue: 0,
          remainingValue: 0,
        },
      },
    }),
    /zero total quota/,
  );
});

test("decryptChromiumCookie handles Chromium v10 host-digest payload", () => {
  const password = "test-safe-storage";
  const hostKey = ".qoder.com";
  const plaintext = "session-value";
  const key = crypto.pbkdf2Sync(password, "saltysalt", 1003, 16, "sha1");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  const payload = Buffer.concat([
    crypto.createHash("sha256").update(hostKey).digest(),
    Buffer.from(plaintext),
  ]);
  const encrypted = Buffer.concat([
    Buffer.from("v10"),
    cipher.update(payload),
    cipher.final(),
  ]);

  assert.equal(
    decryptChromiumCookie({
      encryptedHex: encrypted.toString("hex"),
      hostKey,
      password,
    }),
    plaintext,
  );
});

test("fetchQoderUsage sends the CodeXbar-compatible browser request", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          totalQuota: {
            quotaSummary: {
              usedValue: 25,
              limitValue: 100,
              remainingValue: 75,
              usagePercentage: 25,
            },
          },
        };
      },
    };
  };

  const result = await fetchQoderUsage("session=secret", QODER_SITES.international, fetchImpl);
  assert.equal(result.primary_window.used_percent, 25);
  assert.equal(captured.url, "https://qoder.com/api/v2/me/usages/big_model_credits");
  assert.deepEqual(
    captured.options.headers,
    qoderRequestHeaders("session=secret", QODER_SITES.international),
  );
  assert.equal(captured.options.headers["Bx-V"], "2.5.35");
  assert.equal(captured.options.headers["X-Requested-With"], "XMLHttpRequest");
});

test("parseQoderQuotaLog reads the latest personal quota snapshot without filling a 0/0 bar", () => {
  const parsed = parseQoderQuotaLog(`
    userType=personal_standard,totalUsagePercentage=42,isQuotaExceeded=false,
    userQuota used=42,total=100,remaining=58,percentage=42,unit=credits,addOnQuota none
    userType=personal_standard,totalUsagePercentage=0,isQuotaExceeded=true,
    userQuota=used=0, total=0, remaining=0, percentage=0, unit=credits, addOnQuota=<none>
  `);
  assert.equal(parsed.plan_label, "personal_standard");
  assert.equal(parsed.quota_exceeded, true);
  assert.equal(parsed.primary_window.used_percent, 0);
  assert.equal(parsed.primary_window.limit_credits, 0);
  assert.equal(parsed.source, "local-log");
});

test("parseQoderQuotaLog preserves a non-exceeded zero quota snapshot", () => {
  const parsed = parseQoderQuotaLog(`
    userType=personal_standard,totalUsagePercentage=0,isQuotaExceeded=false,
    userQuota=used=0, total=0, remaining=0, percentage=0, unit=credits, addOnQuota=<none>
  `);
  assert.equal(parsed.quota_exceeded, false);
  assert.equal(parsed.primary_window.used_percent, 0);
});

test("normalizeQoderRpcUsage keeps Qoder's quota-exceeded 0/0 Credits bucket at 0%", () => {
  const result = normalizeQoderRpcUsage({
    userType: "personal_standard",
    totalUsagePercentage: 0,
    isQuotaExceeded: true,
    userQuota: { used: 0, total: 0, remaining: 0, percentage: 0, unit: "credits" },
    expiresAt: 253_402_214_400_000,
  });

  assert.equal(result.quota_exceeded, true);
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.reset_at, null);
});

test("normalizeQoderActivityResponse exposes Ultimate Free Calls as a separate window", () => {
  const result = normalizeQoderActivityResponse({
    code: 0,
    msg: "ok",
    data: {
      activities: [{
        type: "MODEL_FREE_QUOTA",
        activityId: "ultimate_200_free_invoke",
        modelName: "Ultimate Free Calls",
        limit: 1200,
        used: 789,
        remaining: 411,
        resetAt: 0,
        resetStrategy: "NEVER_EXPIRE",
        eligible: true,
        activityEndAt: 1_785_427_140_000,
      }],
    },
  }, { nowMs: 1_780_000_000_000 });

  assert.deepEqual(result, {
    used_percent: 65.75,
    reset_at: "2026-07-30T15:59:00.000Z",
    used_credits: 789,
    limit_credits: 1200,
    remaining_credits: 411,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  });
});

test("fetchQoderActivity sends a COSY-signed GET without exposing the local token", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          code: 0,
          msg: "ok",
          data: {
            activities: [{
              activityId: "ultimate_200_free_invoke",
              limit: 1200,
              used: 300,
              remaining: 900,
              eligible: true,
              activityEndAt: 1_785_427_140_000,
            }],
          },
        };
      },
    };
  };

  const window = await fetchQoderActivity({
    id: "user-1",
    name: "Test",
    userType: "personal_standard",
    token: "oauth-secret",
    refreshToken: "refresh-secret",
  }, fetchImpl, { nowMs: 1_780_000_000_000 });

  assert.equal(captured.url, "https://openapi.qoder.sh/algo/api/v2/activity");
  assert.equal(captured.options.method, "GET");
  assert.match(captured.options.headers.authorization, /^Bearer COSY\./);
  assert.equal(JSON.stringify(captured.options.headers).includes("oauth-secret"), false);
  assert.equal(window.remaining_credits, 900);
});

test("fetchQoderLimits merges local Plan Credits with the activity window", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-merge-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  let activeRpcRequests = 0;
  const rpcRequest = async (method) => {
    activeRpcRequests += 1;
    assert.equal(activeRpcRequests, 1, "Qoder local RPC requests must be serialized");
    await new Promise((resolve) => setImmediate(resolve));
    activeRpcRequests -= 1;
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 0,
        isQuotaExceeded: false,
        userQuota: { used: 0, total: 0, remaining: 0, percentage: 0, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return {
      id: "user-1",
      name: "Test",
      userType: "personal_standard",
      token: "oauth-secret",
      refreshToken: "refresh-secret",
    };
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        data: {
          activities: [{
            activityId: "ultimate_200_free_invoke",
            limit: 1200,
            used: 789,
            remaining: 411,
            eligible: true,
            activityEndAt: 2_000_000_000_000,
          }],
        },
      };
    },
  });

  const result = await fetchQoderLimits({ home, rpcRequest, fetchImpl });
  assert.equal(result.primary_window.used_percent, 0);
  assert.equal(result.primary_window.reset_at, null);
  assert.equal(result.secondary_window.remaining_credits, 411);
  assert.equal(result.source, "local-ipc+provider-api");
});

test("fetchQoderLimits keeps an unexpired activity when the provider briefly returns none", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-empty-activity-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nowMs = Date.parse("2030-07-29T16:00:00.000Z");
  const activityWindow = {
    used_percent: 65.75,
    reset_at: "2030-07-30T15:59:00.000Z",
    used_credits: 789,
    limit_credits: 1200,
    remaining_credits: 411,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  };
  writeQoderActivityCache(activityWindow, {
    home,
    nowMs: nowMs - 60_000,
  });

  const rpcRequest = async (method) => {
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 0,
        isQuotaExceeded: false,
        userQuota: { used: 0, total: 0, remaining: 0, percentage: 0, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return {
      id: "user-1",
      name: "Test",
      userType: "personal_standard",
      token: "oauth-secret",
    };
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return { code: 0, data: { activities: [] } };
    },
  });

  const result = await fetchQoderLimits({
    home,
    nowMs,
    rpcRequest,
    fetchImpl,
  });

  assert.equal(result.secondary_window.remaining_credits, 411);
  assert.equal(result.source, "local-ipc+cached-activity");
  assert.deepEqual(readQoderActivityCache({ home, nowMs }), activityWindow);
});

test("fetchQoderLimits preserves the last unexpired activity window while Qoder is closed", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-activity-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const activityWindow = {
    used_percent: 65.75,
    reset_at: "2030-07-30T15:59:00.000Z",
    used_credits: 789,
    limit_credits: 1200,
    remaining_credits: 411,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  };
  writeQoderActivityCache(activityWindow, {
    home,
    nowMs: Date.parse("2030-07-29T15:59:00.000Z"),
  });
  assert.deepEqual(
    readQoderActivityCache({
      home,
      nowMs: Date.parse("2030-07-29T16:00:00.000Z"),
    }),
    activityWindow,
  );

  const result = await fetchQoderLimits({
    home,
    platform: "linux",
    nowMs: Date.parse("2030-07-29T16:00:00.000Z"),
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => {
      throw new Error("Browser session unavailable.");
    },
  });

  assert.equal(result.primary_window, null);
  assert.equal(result.secondary_window.remaining_credits, 411);
  assert.equal(result.source, "cached-activity");
});

test("Qoder activity cache stays usable until the activity expires", (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-activity-expiry-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const activityWindow = {
    used_percent: 50,
    reset_at: "2030-08-01T00:00:00.000Z",
    used_credits: 600,
    limit_credits: 1200,
    remaining_credits: 600,
    unit: "calls",
    activity_id: "ultimate_200_free_invoke",
  };
  writeQoderActivityCache(activityWindow, {
    home,
    nowMs: Date.parse("2030-07-20T00:00:00.000Z"),
  });

  assert.deepEqual(
    readQoderActivityCache({
      home,
      nowMs: Date.parse("2030-07-30T00:00:00.000Z"),
    }),
    activityWindow,
  );
  assert.equal(
    readQoderActivityCache({
      home,
      nowMs: Date.parse("2030-08-01T00:00:00.000Z"),
    }),
    null,
  );
});

test("fetchQoderLimits persists a provider-level last-good cache for app restarts", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-limits-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const liveNowMs = Date.parse("2030-07-29T00:00:00.000Z");
  const rpcRequest = async (method) => {
    if (method === "credit/usage") {
      return {
        userType: "personal_standard",
        totalUsagePercentage: 25,
        isQuotaExceeded: false,
        userQuota: { used: 25, total: 100, remaining: 75, percentage: 25, unit: "credits" },
        expiresAt: 253_402_214_400_000,
      };
    }
    return {
      id: "user-1",
      name: "Test",
      userType: "personal_standard",
      token: "oauth-secret",
    };
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async json() {
      return {
        code: 0,
        data: {
          activities: [{
            activityId: "ultimate_200_free_invoke",
            limit: 1200,
            used: 900,
            remaining: 300,
            eligible: true,
            activityEndAt: Date.parse("2030-08-01T00:00:00.000Z"),
          }],
        },
      };
    },
  });

  const live = await fetchQoderLimits({ home, rpcRequest, fetchImpl, nowMs: liveNowMs });
  assert.equal(live.primary_window.remaining_credits, 75);
  assert.equal(live.secondary_window.remaining_credits, 300);
  assert.equal(readQoderLimitsCache({ home, nowMs: liveNowMs }).primary_window.remaining_credits, 75);

  const cached = await fetchQoderLimits({
    home,
    platform: "linux",
    nowMs: liveNowMs + 60_000,
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    fetchImpl: async () => {
      throw new Error("Browser session unavailable.");
    },
  });

  assert.equal(cached.primary_window.remaining_credits, 75);
  assert.equal(cached.secondary_window.remaining_credits, 300);
  assert.equal(cached.cached, true);
  assert.equal(cached.stale, true);
  assert.equal(cached.source, "disk-cache");
});

test("fetchQoderLimits returns last-good before slow macOS browser-session probing", async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokentracker-qoder-cache-first-"));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const nowMs = Date.parse("2030-07-29T00:00:00.000Z");
  writeQoderLimitsCache({
    configured: true,
    error: null,
    plan_label: "personal_standard",
    primary_window: {
      used_percent: 25,
      reset_at: null,
      used_credits: 25,
      limit_credits: 100,
      remaining_credits: 75,
      unit: "credits",
    },
    secondary_window: {
      used_percent: 75,
      reset_at: "2030-08-01T00:00:00.000Z",
      used_credits: 900,
      limit_credits: 1200,
      remaining_credits: 300,
      unit: "calls",
    },
  }, { home, nowMs });

  const cookiePath = path.join(
    home,
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "Default",
    "Cookies",
  );
  fs.mkdirSync(path.dirname(cookiePath), { recursive: true });
  fs.writeFileSync(cookiePath, "");
  let keychainReads = 0;
  let cookieReads = 0;

  const cached = await fetchQoderLimits({
    home,
    platform: "darwin",
    nowMs: nowMs + 60_000,
    rpcRequest: async () => {
      throw new Error("Qoder local service is not running.");
    },
    securityRunner: async () => {
      keychainReads += 1;
      return "safe-storage-password";
    },
    sqliteReader: async () => {
      cookieReads += 1;
      return [];
    },
  });

  assert.equal(cached.source, "disk-cache");
  assert.equal(cached.secondary_window.remaining_credits, 300);
  assert.equal(keychainReads, 0);
  assert.equal(cookieReads, 0);
});
