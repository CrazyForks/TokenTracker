const assert = require("node:assert/strict");
const { describe, it } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  normalizeGrokBillingResponse,
  normalizeGrokPeriodType,
  inferGrokPeriodTypeFromDates,
  sumProductUsagePercent,
  fetchGrokBilling,
  fetchGrokLimits,
  readGrokAccessToken,
  isGrokInstalled,
  isGrokAccessTokenExpired,
  refreshGrokTokens,
  persistGrokRefreshedAuth,
  resolveGrokAccessToken,
  DEFAULT_TOKEN_ENDPOINT,
  ACCESS_TOKEN_EXPIRY_SKEW_MS,
} = require("../src/lib/grok-limits");

describe("normalizeGrokPeriodType", () => {
  it("maps USAGE_PERIOD_TYPE_* enums for daily/weekly/monthly only", () => {
    assert.equal(normalizeGrokPeriodType("USAGE_PERIOD_TYPE_WEEKLY"), "weekly");
    assert.equal(normalizeGrokPeriodType("USAGE_PERIOD_TYPE_MONTHLY"), "monthly");
    assert.equal(normalizeGrokPeriodType("USAGE_PERIOD_TYPE_DAILY"), "daily");
    assert.equal(normalizeGrokPeriodType("weekly"), "weekly");
    // Hourly is not a recognized end-to-end period — do not emit it.
    assert.equal(normalizeGrokPeriodType("USAGE_PERIOD_TYPE_HOURLY"), null);
    assert.equal(normalizeGrokPeriodType("hourly"), null);
    assert.equal(normalizeGrokPeriodType(""), null);
    assert.equal(normalizeGrokPeriodType(null), null);
  });
});

describe("inferGrokPeriodTypeFromDates", () => {
  it("classifies daily / weekly / monthly windows and leaves gaps null", () => {
    assert.equal(
      inferGrokPeriodTypeFromDates("2026-07-13T00:00:00Z", "2026-07-14T00:00:00Z"),
      "daily",
    );
    assert.equal(
      inferGrokPeriodTypeFromDates("2026-07-13T00:00:00Z", "2026-07-20T00:00:00Z"),
      "weekly",
    );
    assert.equal(
      inferGrokPeriodTypeFromDates("2026-07-01T00:00:00Z", "2026-08-01T00:00:00Z"),
      "monthly",
    );
    // Sub-day and odd mid lengths must not be mislabeled as weekly.
    assert.equal(
      inferGrokPeriodTypeFromDates("2026-07-13T00:00:00Z", "2026-07-13T02:00:00Z"),
      null,
    );
    assert.equal(
      inferGrokPeriodTypeFromDates("2026-07-01T00:00:00Z", "2026-07-13T00:00:00Z"),
      null,
    );
  });
});

describe("sumProductUsagePercent", () => {
  it("sums shared-pool product attribution percentages", () => {
    assert.equal(
      sumProductUsagePercent([
        { product: "GrokBuild", usagePercent: 17 },
        { product: "GrokChat", usagePercent: 1 },
      ]),
      18,
    );
    assert.equal(sumProductUsagePercent([{ product: "GrokBuild", usagePercent: 42 }]), 42);
    assert.equal(sumProductUsagePercent([]), null);
    assert.equal(sumProductUsagePercent(null), null);
  });
});

describe("normalizeGrokBillingResponse", () => {
  it("maps unified format=credits weekly pool", () => {
    const result = normalizeGrokBillingResponse({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-13T09:23:37.846092+00:00",
          end: "2026-07-20T09:23:37.846092+00:00",
        },
        creditUsagePercent: 18.0,
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        productUsage: [
          { product: "GrokBuild", usagePercent: 17.0 },
          { product: "GrokChat", usagePercent: 1.0 },
        ],
        isUnifiedBillingUser: true,
        billingPeriodStart: "2026-07-13T09:23:37.846092+00:00",
        billingPeriodEnd: "2026-07-20T09:23:37.846092+00:00",
      },
    });

    assert.equal(result.period_type, "weekly");
    assert.equal(result.credit_usage_percent, 18);
    // Overall pool percent (not GrokBuild-only attribution) is the quota bar.
    assert.deepEqual(result.primary_window, {
      used_percent: 18,
      reset_at: "2026-07-20T09:23:37.846Z",
    });
    assert.equal(result.secondary_window, null);
    assert.equal(result.billing_period_start, "2026-07-13T09:23:37.846Z");
  });

  it("maps legacy monthly credits and billing period reset", () => {
    const result = normalizeGrokBillingResponse({
      config: {
        monthlyLimit: { val: 150_000 },
        used: { val: 4_625 },
        onDemandCap: { val: 0 },
        onDemandUsed: { val: 0 },
        billingPeriodStart: "2026-06-01T00:00:00+00:00",
        billingPeriodEnd: "2026-07-01T00:00:00+00:00",
      },
    });

    assert.equal(result.period_type, "monthly");
    assert.equal(result.monthly_credits_limit, 150_000);
    assert.equal(result.monthly_credits_used, 4_625);
    assert.deepEqual(result.primary_window, {
      used_percent: (4_625 / 150_000) * 100,
      reset_at: "2026-07-01T00:00:00.000Z",
    });
    assert.equal(result.secondary_window, null);
  });

  it("adds on-demand window when cap is positive", () => {
    const result = normalizeGrokBillingResponse({
      config: {
        monthlyLimit: { val: 100 },
        used: { val: 10 },
        onDemandCap: { val: 50 },
        onDemandUsed: { val: 25 },
        billingPeriodEnd: "2026-07-01T00:00:00Z",
      },
    });

    assert.deepEqual(result.secondary_window, {
      used_percent: 50,
      reset_at: "2026-07-01T00:00:00.000Z",
    });
  });

  it("sums all productUsage entries when creditUsagePercent is missing", () => {
    const result = normalizeGrokBillingResponse({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-13T00:00:00Z",
          end: "2026-07-20T00:00:00Z",
        },
        productUsage: [
          { product: "GrokBuild", usagePercent: 17 },
          { product: "GrokChat", usagePercent: 1 },
        ],
        billingPeriodEnd: "2026-07-20T00:00:00Z",
      },
    });

    assert.equal(result.period_type, "weekly");
    // Shared pool: 17 + 1 = 18, not GrokBuild-only 17.
    assert.equal(result.primary_window.used_percent, 18);
    assert.equal(result.credit_usage_percent, 18);
  });

  it("falls back to a single productUsage entry when only one is present", () => {
    const result = normalizeGrokBillingResponse({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-07-13T00:00:00Z",
          end: "2026-07-20T00:00:00Z",
        },
        productUsage: [{ product: "GrokBuild", usagePercent: 42 }],
        billingPeriodEnd: "2026-07-20T00:00:00Z",
      },
    });

    assert.equal(result.period_type, "weekly");
    assert.equal(result.primary_window.used_percent, 42);
    assert.equal(result.credit_usage_percent, 42);
  });

  it("infers daily / weekly / monthly from period length when type is omitted", () => {
    assert.equal(
      normalizeGrokBillingResponse({
        config: {
          creditUsagePercent: 5,
          billingPeriodStart: "2026-07-13T00:00:00Z",
          billingPeriodEnd: "2026-07-14T00:00:00Z",
        },
      }).period_type,
      "daily",
    );
    assert.equal(
      normalizeGrokBillingResponse({
        config: {
          creditUsagePercent: 5,
          billingPeriodStart: "2026-07-13T00:00:00Z",
          billingPeriodEnd: "2026-07-20T00:00:00Z",
        },
      }).period_type,
      "weekly",
    );
    assert.equal(
      normalizeGrokBillingResponse({
        config: {
          creditUsagePercent: 5,
          billingPeriodStart: "2026-07-01T00:00:00Z",
          billingPeriodEnd: "2026-08-01T00:00:00Z",
        },
      }).period_type,
      "monthly",
    );
  });

  it("does not emit hourly as a recognized period_type", () => {
    const result = normalizeGrokBillingResponse({
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_HOURLY",
          start: "2026-07-13T00:00:00Z",
          end: "2026-07-13T01:00:00Z",
        },
        creditUsagePercent: 10,
      },
    });
    // Type ignored; sub-day length also does not infer weekly/daily.
    assert.equal(result.period_type, null);
    assert.equal(result.primary_window.used_percent, 10);
  });
});

describe("fetchGrokLimits", () => {
  it("returns configured false when auth is missing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-missing-"));
    try {
      assert.equal(isGrokInstalled({ home: tmp }), false);
      assert.deepEqual(await fetchGrokLimits({ home: tmp }), { configured: false });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fetches format=credits billing via cli-chat-proxy with stored token", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-fetch-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::test": { key: "test-token" },
        }),
        "utf8",
      );

      assert.equal(readGrokAccessToken({ home: tmp, env: { GROK_HOME: grokHome } }), "test-token");

      const urls = [];
      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        fetchImpl: async (url, options) => {
          urls.push(url);
          assert.equal(options.headers.Authorization, "Bearer test-token");
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                config: {
                  currentPeriod: {
                    type: "USAGE_PERIOD_TYPE_WEEKLY",
                    start: "2026-07-13T09:23:37.846092+00:00",
                    end: "2026-07-20T09:23:37.846092+00:00",
                  },
                  creditUsagePercent: 25,
                  onDemandCap: { val: 0 },
                  billingPeriodEnd: "2026-07-20T09:23:37.846092+00:00",
                },
              };
            },
          };
        },
      });

      assert.equal(urls[0], "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
      assert.equal(result.configured, true);
      assert.equal(result.error, null);
      assert.equal(result.period_type, "weekly");
      assert.equal(result.primary_window.used_percent, 25);
      assert.equal(result.primary_window.reset_at, "2026-07-20T09:23:37.846Z");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("falls back to legacy /v1/billing when format=credits fails", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-fallback-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::test": { key: "test-token" },
        }),
        "utf8",
      );

      const urls = [];
      let canceledBodies = 0;
      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        fetchImpl: async (url) => {
          urls.push(url);
          if (String(url).includes("format=credits")) {
            return {
              ok: false,
              status: 500,
              body: {
                async cancel() {
                  canceledBodies += 1;
                },
              },
              async json() { return {}; },
            };
          }
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                config: {
                  monthlyLimit: { val: 1000 },
                  used: { val: 250 },
                  onDemandCap: { val: 0 },
                  billingPeriodStart: "2026-07-01T00:00:00Z",
                  billingPeriodEnd: "2026-08-01T00:00:00Z",
                },
              };
            },
          };
        },
      });

      assert.deepEqual(urls, [
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        "https://cli-chat-proxy.grok.com/v1/billing",
      ]);
      assert.equal(result.configured, true);
      assert.equal(result.period_type, "monthly");
      assert.equal(result.primary_window.used_percent, 25);
      assert.equal(canceledBodies, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("cancels an auth-error response body before surfacing reauthentication", async () => {
    let canceledBodies = 0;

    await assert.rejects(
      fetchGrokBilling("test-token", {
        timeoutMs: 100,
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          body: {
            async cancel() {
              canceledBodies += 1;
            },
          },
        }),
      }),
      /grok login/i,
    );
    assert.equal(canceledBodies, 1);
  });

  it("falls back to legacy /v1/billing after a format=credits network error", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-network-fallback-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::test": { key: "test-token" },
        }),
        "utf8",
      );

      const urls = [];
      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        fetchImpl: async (url) => {
          urls.push(url);
          if (String(url).includes("format=credits")) {
            throw new TypeError("fetch failed");
          }
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                config: {
                  monthlyLimit: { val: 1000 },
                  used: { val: 250 },
                  onDemandCap: { val: 0 },
                  billingPeriodStart: "2026-07-01T00:00:00Z",
                  billingPeriodEnd: "2026-08-01T00:00:00Z",
                },
              };
            },
          };
        },
      });

      assert.deepEqual(urls, [
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
        "https://cli-chat-proxy.grok.com/v1/billing",
      ]);
      assert.equal(result.configured, true);
      assert.equal(result.error, null);
      assert.equal(result.period_type, "monthly");
      assert.equal(result.primary_window.used_percent, 25);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("does not start a late fallback after the shared request deadline", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-timeout-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::test": { key: "test-token" },
        }),
        "utf8",
      );

      const urls = [];
      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        timeoutMs: 30,
        fetchImpl: async (url, options) => {
          urls.push(url);
          await new Promise((_, reject) => {
            options.signal.addEventListener("abort", () => reject(options.signal.reason), {
              once: true,
            });
          });
        },
      });

      assert.deepEqual(urls, [
        "https://cli-chat-proxy.grok.com/v1/billing?format=credits",
      ]);
      assert.equal(result.configured, true);
      assert.match(result.error, /timed out/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("refreshes an expired access token before billing", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-refresh-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      const authPath = path.join(grokHome, "auth.json");
      const scope = "https://auth.x.ai::client-abc";
      fs.writeFileSync(
        authPath,
        JSON.stringify({
          [scope]: {
            key: "stale-access",
            refresh_token: "rt-abc",
            expires_at: "2020-01-01T00:00:00.000Z",
            oidc_client_id: "client-abc",
            oidc_issuer: "https://auth.x.ai",
          },
        }),
        "utf8",
      );

      const urls = [];
      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
        fetchImpl: async (url, options) => {
          urls.push(String(url));
          if (String(url).includes("/oauth2/token")) {
            assert.equal(options.method, "POST");
            assert.match(options.headers["Content-Type"], /application\/x-www-form-urlencoded/);
            const body = new URLSearchParams(options.body);
            assert.equal(body.get("grant_type"), "refresh_token");
            assert.equal(body.get("refresh_token"), "rt-abc");
            assert.equal(body.get("client_id"), "client-abc");
            return {
              ok: true,
              status: 200,
              async json() {
                return {
                  access_token: "fresh-access",
                  refresh_token: "rt-new",
                  expires_in: 3600,
                };
              },
            };
          }
          assert.equal(options.headers.Authorization, "Bearer fresh-access");
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                config: {
                  currentPeriod: {
                    type: "USAGE_PERIOD_TYPE_WEEKLY",
                    start: "2026-07-22T00:00:00Z",
                    end: "2026-07-29T00:00:00Z",
                  },
                  creditUsagePercent: 41,
                },
              };
            },
          };
        },
      });

      assert.equal(urls[0], DEFAULT_TOKEN_ENDPOINT);
      assert.equal(urls[1], "https://cli-chat-proxy.grok.com/v1/billing?format=credits");
      assert.equal(result.configured, true);
      assert.equal(result.error, null);
      assert.equal(result.primary_window.used_percent, 41);

      const persisted = JSON.parse(fs.readFileSync(authPath, "utf8"));
      assert.equal(persisted[scope].key, "fresh-access");
      assert.equal(persisted[scope].refresh_token, "rt-new");
      assert.ok(persisted[scope].expires_at);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("retries billing once after 401 by forcing OIDC refresh", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-401-refresh-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::client-abc": {
            key: "still-present-but-revoked",
            refresh_token: "rt-abc",
            // Far future so preflight does not refresh first.
            expires_at: "2099-01-01T00:00:00.000Z",
            oidc_client_id: "client-abc",
            oidc_issuer: "https://auth.x.ai",
          },
        }),
        "utf8",
      );

      let billingHits = 0;
      let refreshHits = 0;
      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        fetchImpl: async (url, options) => {
          if (String(url).includes("/oauth2/token")) {
            refreshHits += 1;
            return {
              ok: true,
              status: 200,
              async json() {
                return { access_token: "after-refresh", expires_in: 3600 };
              },
            };
          }
          billingHits += 1;
          if (billingHits === 1) {
            assert.equal(options.headers.Authorization, "Bearer still-present-but-revoked");
            return {
              ok: false,
              status: 401,
              body: { async cancel() {} },
            };
          }
          assert.equal(options.headers.Authorization, "Bearer after-refresh");
          return {
            ok: true,
            status: 200,
            async json() {
              return {
                config: {
                  creditUsagePercent: 12,
                  billingPeriodStart: "2026-07-22T00:00:00Z",
                  billingPeriodEnd: "2026-07-29T00:00:00Z",
                },
              };
            },
          };
        },
      });

      assert.equal(refreshHits, 1);
      assert.equal(billingHits, 2);
      assert.equal(result.error, null);
      assert.equal(result.primary_window.used_percent, 12);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("surfaces reauth error when refresh_token is rejected", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-limits-reauth-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::client-abc": {
            key: "stale-access",
            refresh_token: "rt-dead",
            expires_at: "2020-01-01T00:00:00.000Z",
            oidc_client_id: "client-abc",
          },
        }),
        "utf8",
      );

      const result = await fetchGrokLimits({
        home: tmp,
        env: { GROK_HOME: grokHome },
        nowMs: Date.parse("2026-07-28T12:00:00.000Z"),
        fetchImpl: async (url) => {
          assert.match(String(url), /oauth2\/token/);
          return {
            ok: false,
            status: 400,
            async json() {
              return { error: "invalid_grant" };
            },
          };
        },
      });

      assert.equal(result.configured, true);
      assert.match(result.error, /Grok session expired/i);
      assert.doesNotMatch(result.error, /Not logged in/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("isGrokAccessTokenExpired", () => {
  it("applies skew and ignores missing/invalid expiry", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    assert.equal(isGrokAccessTokenExpired(null, now), false);
    assert.equal(isGrokAccessTokenExpired("not-a-date", now), false);
    assert.equal(isGrokAccessTokenExpired("2026-07-28T12:02:00.000Z", now), false);
    assert.equal(isGrokAccessTokenExpired("2026-07-28T12:00:30.000Z", now), true);
    assert.equal(isGrokAccessTokenExpired("2026-07-28T11:00:00.000Z", now), true);
    assert.equal(ACCESS_TOKEN_EXPIRY_SKEW_MS, 60_000);
  });
});

describe("refreshGrokTokens", () => {
  it("posts form-encoded refresh to the xAI token endpoint", async () => {
    let observedUrl = null;
    let observedBody = null;
    const result = await refreshGrokTokens({
      refreshToken: "rt-abc",
      clientId: "client-abc",
      fetchImpl: async (url, opts) => {
        observedUrl = url;
        observedBody = new URLSearchParams(opts.body);
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "new-access", refresh_token: "new-rt", expires_in: 120 };
          },
        };
      },
    });
    assert.equal(observedUrl, DEFAULT_TOKEN_ENDPOINT);
    assert.equal(observedBody.get("grant_type"), "refresh_token");
    assert.equal(observedBody.get("client_id"), "client-abc");
    assert.equal(result.access_token, "new-access");
    assert.equal(result.refresh_token, "new-rt");
    assert.ok(result.expires_at);
  });

  it("throws GROK_REAUTH_REQUIRED on invalid_grant", async () => {
    await assert.rejects(
      refreshGrokTokens({
        refreshToken: "rt-abc",
        clientId: "client-abc",
        fetchImpl: async () => ({
          ok: false,
          status: 400,
          async json() {
            return { error: "invalid_grant" };
          },
        }),
      }),
      (err) => err && err.code === "GROK_REAUTH_REQUIRED",
    );
  });
});

describe("persistGrokRefreshedAuth", () => {
  it("atomically updates the scoped auth entry", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-auth-persist-"));
    try {
      const authPath = path.join(tmp, "auth.json");
      const scope = "https://auth.x.ai::client-abc";
      const authFile = {
        [scope]: {
          key: "old",
          refresh_token: "rt-old",
          email: "user@example.com",
        },
      };
      fs.writeFileSync(authPath, JSON.stringify(authFile), "utf8");
      const persisted = await persistGrokRefreshedAuth(
        authPath,
        authFile,
        scope,
        authFile[scope],
        {
          access_token: "new",
          refresh_token: "rt-new",
          expires_at: "2026-07-28T18:00:00.000Z",
        },
      );
      assert.equal(persisted.entry.key, "new");
      const disk = JSON.parse(fs.readFileSync(authPath, "utf8"));
      assert.equal(disk[scope].key, "new");
      assert.equal(disk[scope].refresh_token, "rt-new");
      assert.equal(disk[scope].email, "user@example.com");
      assert.equal(disk[scope].expires_at, "2026-07-28T18:00:00.000Z");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("resolveGrokAccessToken", () => {
  it("does not refresh a still-valid access token", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tt-grok-resolve-fresh-"));
    try {
      const grokHome = path.join(tmp, ".grok");
      fs.mkdirSync(grokHome, { recursive: true });
      fs.writeFileSync(
        path.join(grokHome, "auth.json"),
        JSON.stringify({
          "https://auth.x.ai::client-abc": {
            key: "fresh",
            refresh_token: "rt-abc",
            expires_at: "2099-01-01T00:00:00.000Z",
            oidc_client_id: "client-abc",
          },
        }),
        "utf8",
      );
      let fetchCalls = 0;
      const resolved = await resolveGrokAccessToken({
        home: tmp,
        env: { GROK_HOME: grokHome },
        fetchImpl: async () => {
          fetchCalls += 1;
          throw new Error("should not fetch");
        },
      });
      assert.equal(resolved.accessToken, "fresh");
      assert.equal(resolved.refreshed, false);
      assert.equal(fetchCalls, 0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
