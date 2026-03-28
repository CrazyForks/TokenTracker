import { formatDateLocal } from "./date-range";
import {
  getMockUsageDaily,
  getMockUsageHourly,
  getMockUsageHeatmap,
  getMockUsageMonthly,
  getMockUsageModelBreakdown,
  getMockUsageSummary,
  getMockProjectUsageSummary,
  getMockLeaderboard,
  isMockEnabled,
} from "./mock-data";

type AnyRecord = Record<string, any>;

const PATHS = {
  usageSummary: "vibeusage-usage-summary",
  usageDaily: "vibeusage-usage-daily",
  usageHourly: "vibeusage-usage-hourly",
  usageMonthly: "vibeusage-usage-monthly",
  usageHeatmap: "vibeusage-usage-heatmap",
  usageModelBreakdown: "vibeusage-usage-model-breakdown",
  projectUsageSummary: "vibeusage-project-usage-summary",
  userStatus: "vibeusage-user-status",
  localSync: "vibeusage-local-sync",
};

async function fetchLocalJson(slug: string, params?: AnyRecord, options?: AnyRecord) {
  const url = new URL(`/functions/${slug}`, window.location.origin);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value != null && value !== "") url.searchParams.set(key, String(value));
    }
  }
  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    cache: "no-store",
    ...options,
  });
  if (!response.ok) {
    const err: any = new Error(`Request failed with HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

function buildTimeZoneParams({ timeZone, tzOffsetMinutes }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const tz = typeof timeZone === "string" ? timeZone.trim() : "";
  if (tz) params.tz = tz;
  if (Number.isFinite(tzOffsetMinutes)) {
    params.tz_offset_minutes = String(Math.trunc(tzOffsetMinutes));
  }
  return params;
}

function buildFilterParams({ source, model }: AnyRecord = {}) {
  const params: AnyRecord = {};
  const normalizedSource = typeof source === "string" ? source.trim().toLowerCase() : "";
  if (normalizedSource) params.source = normalizedSource;
  const normalizedModel = typeof model === "string" ? model.trim() : "";
  if (normalizedModel) params.model = normalizedModel;
  return params;
}

export async function probeBackend({ signal }: AnyRecord = {}) {
  const today = formatDateLocal(new Date());
  await fetchLocalJson(PATHS.usageSummary, { from: today, to: today }, { signal });
  return { status: 200 };
}

export async function getUsageSummary({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  rolling = false,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageSummary({ from, to, seed: accessToken, rolling });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const rollingParams = rolling ? { rolling: "1" } : {};
  return fetchLocalJson(PATHS.usageSummary, { from, to, ...filterParams, ...tzParams, ...rollingParams });
}

export async function getProjectUsageSummary({
  from,
  to,
  source,
  limit,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockProjectUsageSummary({ seed: accessToken, limit });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  const params: AnyRecord = { ...filterParams, ...tzParams };
  if (from) params.from = from;
  if (to) params.to = to;
  if (limit != null) params.limit = String(limit);
  return fetchLocalJson(PATHS.projectUsageSummary, params);
}

export async function getLeaderboard({
  accessToken,
  period,
  metric,
  limit,
  offset,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockLeaderboard({ seed: accessToken, period, metric, limit, offset });
  }
  return { entries: [], period: period || "week", from: null, to: null, generated_at: new Date().toISOString() };
}

export async function getPublicVisibility(_opts: AnyRecord = {}) {
  return { enabled: false, updated_at: null, share_token: null };
}

export async function setPublicVisibility({ enabled }: AnyRecord = {}) {
  return { enabled: Boolean(enabled), updated_at: new Date().toISOString(), share_token: null };
}

export async function getLeaderboardProfile({
  accessToken,
  userId,
  period,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    const mock = getMockLeaderboard({ seed: accessToken, period, metric: "all", limit: 250, offset: 0 });
    const entries = Array.isArray(mock?.entries) ? mock.entries : [];
    const match = entries.find((entry: any) => entry?.user_id === userId) || null;
    return {
      period: mock?.period ?? "week",
      from: mock?.from ?? null,
      to: mock?.to ?? null,
      generated_at: mock?.generated_at ?? new Date().toISOString(),
      entry: match,
    };
  }
  return { period: period || "week", from: null, to: null, generated_at: new Date().toISOString(), entry: null };
}

export async function getUserStatus(_opts: AnyRecord = {}) {
  if (isMockEnabled()) {
    const now = new Date().toISOString();
    return {
      user_id: "local-user",
      created_at: now,
      pro: { active: false, sources: [], expires_at: null, partial: false, as_of: now },
      subscriptions: { partial: false, as_of: now, items: [] },
      install: {
        partial: false,
        as_of: now,
        has_active_device_token: false,
        has_active_device: false,
        active_device_tokens: 0,
        active_devices: 0,
        latest_token_activity_at: null,
        latest_device_seen_at: null,
      },
    };
  }
  return fetchLocalJson(PATHS.userStatus);
}

export async function triggerLocalSync({ signal }: AnyRecord = {}) {
  const response = await fetch(`/functions/${PATHS.localSync}`, {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal,
  });
  const payload = await response.json().catch(() => ({
    ok: false,
    error: `Local sync request failed with HTTP ${response.status}`,
  }));
  if (!response.ok || payload?.ok === false) {
    const message = payload?.error || payload?.message || `Local sync request failed with HTTP ${response.status}`;
    const error: any = new Error(message);
    error.status = response.status;
    throw error;
  }
  return payload;
}

export async function getUsageModelBreakdown({
  from,
  to,
  source,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageModelBreakdown({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source });
  return fetchLocalJson(PATHS.usageModelBreakdown, { from, to, ...filterParams, ...tzParams });
}

export async function getUsageDaily({
  from,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageDaily({ from, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageDaily, { from, to, ...filterParams, ...tzParams });
}

export async function getUsageHourly({
  day,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageHourly({ day, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  const params = day ? { day, ...filterParams, ...tzParams } : { ...filterParams, ...tzParams };
  return fetchLocalJson(PATHS.usageHourly, params);
}

export async function getUsageMonthly({
  months,
  to,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageMonthly({ months, to, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageMonthly, {
    ...(months ? { months: String(months) } : {}),
    ...(to ? { to } : {}),
    ...filterParams,
    ...tzParams,
  });
}

export async function getUsageHeatmap({
  weeks,
  to,
  weekStartsOn,
  source,
  model,
  timeZone,
  tzOffsetMinutes,
  accessToken,
}: AnyRecord = {}) {
  if (isMockEnabled()) {
    return getMockUsageHeatmap({ weeks, to, weekStartsOn, seed: accessToken });
  }
  const tzParams = buildTimeZoneParams({ timeZone, tzOffsetMinutes });
  const filterParams = buildFilterParams({ source, model });
  return fetchLocalJson(PATHS.usageHeatmap, {
    weeks: String(weeks),
    to,
    week_starts_on: weekStartsOn,
    ...filterParams,
    ...tzParams,
  });
}

export async function requestInstallLinkCode(_opts: AnyRecord = {}) {
  return { link_code: null, expires_at: null };
}

export async function getPublicViewProfile(_opts: AnyRecord = {}) {
  return null;
}
