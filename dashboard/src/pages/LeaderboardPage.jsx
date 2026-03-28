import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, Link } from "react-router-dom";
import { BackendStatus } from "../components/BackendStatus.jsx";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { copy } from "../lib/copy";
import { toDisplayNumber } from "../lib/format";
import { cn } from "../lib/cn";
import {
  buildPageItems,
  clampInt,
  getPaginationFlags,
  injectMeIntoFirstPage,
} from "../lib/leaderboard-ui";
import { isMockEnabled } from "../lib/mock-data";
import {
  getLeaderboard,
  getPublicVisibility,
  setPublicVisibility,
} from "../lib/api";
import { HeaderGithubStar } from "../ui/openai/components/HeaderGithubStar.jsx";

const PAGE_LIMIT = 20;

function buttonClass(variant = "default", size = "md", className) {
  const base =
    "inline-flex items-center justify-center rounded font-medium transition-colors duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-oai-gray-950";
  const variants = {
    default:
      "bg-oai-gray-900 text-white hover:bg-oai-gray-800 active:bg-oai-gray-950 dark:bg-white dark:text-oai-gray-900 dark:hover:bg-oai-gray-100 dark:active:bg-oai-gray-200",
    ghost:
      "text-oai-gray-600 hover:text-oai-gray-900 hover:bg-oai-gray-100 active:bg-oai-gray-200 dark:text-oai-gray-400 dark:hover:text-white dark:hover:bg-oai-gray-800 dark:active:bg-oai-gray-700",
  };
  const sizes = {
    sm: "h-9 px-4 text-sm",
    md: "h-11 px-6 text-sm",
    lg: "h-12 px-8 text-base",
  };
  return cn(base, variants[variant], sizes[size], className);
}

function normalizePeriod(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "week") return v;
  if (v === "month") return v;
  if (v === "total") return v;
  return null;
}

function normalizeLeaderboardError(err) {
  if (!err) return copy("shared.error.prefix", { error: copy("leaderboard.error.unknown") });
  const msg = err?.message || String(err);
  const safe = String(msg || "").trim() || copy("leaderboard.error.unknown");
  return copy("shared.error.prefix", { error: safe });
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isAnonymousName(value) {
  const normalized = normalizeName(value);
  if (!normalized) return true;
  return normalized.toLowerCase() === "anonymous";
}

function buildPublicViewPath(userId, search = "") {
  if (typeof userId !== "string") return null;
  const normalized = userId.trim().toLowerCase();
  if (!normalized) return null;

  const params = new URLSearchParams(typeof search === "string" ? search : "");
  const period = normalizePeriod(params.get("period"));
  const suffix = period ? `?period=${period}` : "";

  return `/share/pv1-${normalized}${suffix}`;
}

export function LeaderboardPage({
  baseUrl,
  auth,
  signedIn,
  sessionSoftExpired,
  signOut,
  signInUrl = "/sign-in",
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const mockEnabled = isMockEnabled();
  const authTokenAllowed = signedIn && !sessionSoftExpired;
  const authAccessToken = useMemo(() => {
    if (!authTokenAllowed) return null;
    if (typeof auth === "function") return auth;
    if (typeof auth === "string") return auth;
    if (auth && typeof auth === "object") return auth;
    return null;
  }, [auth, authTokenAllowed]);
  const effectiveAuthToken = authTokenAllowed ? authAccessToken : null;
  const authTokenReady = authTokenAllowed && isAccessTokenReady(effectiveAuthToken);

  let headerStatus = null;
  if (authTokenAllowed && authTokenReady) {
    headerStatus = <BackendStatus baseUrl={baseUrl} accessToken={effectiveAuthToken} />;
  }

  const placeholder = copy("shared.placeholder.short");
  const [listPage, setListPage] = useState(1);
  const [listReloadToken, setListReloadToken] = useState(0);
  const [listState, setListState] = useState(() => ({
    loading: false,
    error: null,
    data: null,
  }));

  const [profileState, setProfileState] = useState(() => ({
    loading: false,
    saving: false,
    error: null,
    leaderboardPublic: null,
  }));

  const period = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizePeriod(params.get("period")) || "week";
  }, [location?.search]);

  const periodSearch = location?.search || "";

  const handlePeriodChange = (nextPeriod) => {
    const normalized = normalizePeriod(nextPeriod);
    if (!normalized) return;
    if (normalized === period) return;
    const params = new URLSearchParams(location?.search || "");
    params.set("period", normalized);
    setListPage(1);
    navigate(`${location?.pathname || "/leaderboard"}?${params.toString()}`, { replace: true });
  };

  useEffect(() => {
    setListPage(1);
  }, [period]);

  useEffect(() => {
    if (mockEnabled) return;
    if (!authTokenAllowed) return;
    if (authTokenReady) return;
    setListState({ loading: false, error: null, data: null });
    setProfileState({
      loading: false,
      saving: false,
      error: null,
      leaderboardPublic: null,
    });
  }, [authTokenAllowed, authTokenReady, mockEnabled]);

  const listOffset = useMemo(() => {
    const safePage = clampInt(listPage, { min: 1, max: 1_000_000, fallback: 1 });
    return (safePage - 1) * PAGE_LIMIT;
  }, [listPage]);

  useEffect(() => {
    if (!baseUrl) return;
    if (mockEnabled) return;
    if (!authTokenAllowed || !authTokenReady) return;
    let active = true;
    setProfileState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      const token = await resolveAuthAccessToken(effectiveAuthToken);
      const data = await getPublicVisibility({ baseUrl, accessToken: token });
      if (!active) return;
      setProfileState((prev) => ({
        ...prev,
        loading: false,
        error: null,
        leaderboardPublic: Boolean(data?.enabled),
      }));
    })().catch((err) => {
      if (!active) return;
      setProfileState((prev) => ({
        ...prev,
        loading: false,
        error: normalizeLeaderboardError(err),
        leaderboardPublic: null,
      }));
    });
    return () => {
      active = false;
    };
  }, [authTokenAllowed, authTokenReady, baseUrl, effectiveAuthToken, mockEnabled]);

  useEffect(() => {
    if (!baseUrl) return;
    if (!mockEnabled && authTokenAllowed && !authTokenReady) return;
    let active = true;
    setListState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      const token = authTokenAllowed
        ? await resolveAuthAccessToken(effectiveAuthToken)
        : null;
      const data = await getLeaderboard({
        baseUrl,
        accessToken: token,
        period,
        limit: PAGE_LIMIT,
        offset: listOffset,
      });
      if (!active) return;
      setListState({ loading: false, error: null, data });
    })().catch((err) => {
      if (!active) return;
      setListState({ loading: false, error: normalizeLeaderboardError(err), data: null });
    });
    return () => {
      active = false;
    };
  }, [
    baseUrl,
    effectiveAuthToken,
    authTokenAllowed,
    authTokenReady,
    listOffset,
    listReloadToken,
    mockEnabled,
    period,
  ]);

  const listData = listState.data;

  const totalPages = listData?.total_pages ?? null;
  const currentPage = listData?.page ?? listPage;
  const pageItems = useMemo(() => {
    return buildPageItems(currentPage, totalPages);
  }, [currentPage, totalPages]);

  const from = listData?.from || null;
  const to = listData?.to || null;
  const generatedAt = listData?.generated_at || null;
  const me = listData?.me || null;
  const meLabel = copy("leaderboard.me_label");
  const anonLabel = copy("leaderboard.anon_label");
  const publicProfileLabel = copy("leaderboard.public_profile.label");
  const publicProfileStatusEnabledLabel = copy("leaderboard.public_profile.status.enabled");
  const publicProfileStatusDisabledLabel = copy("leaderboard.public_profile.status.disabled");
  const weekLabel = copy("leaderboard.period.week");
  const monthLabel = copy("leaderboard.period.month");
  const totalLabel = copy("leaderboard.period.total");
  const periodLabel = period === "month" ? monthLabel : period === "total" ? totalLabel : weekLabel;

  const displayEntries = useMemo(() => {
    const rows = Array.isArray(listData?.entries) ? listData.entries : [];
    if (currentPage !== 1) return rows;
    return injectMeIntoFirstPage({
      entries: rows,
      me,
      meLabel,
      limit: PAGE_LIMIT,
    });
  }, [currentPage, listData?.entries, me, meLabel]);

  const publicProfileEnabled = Boolean(profileState.leaderboardPublic);
  const publicProfileBusy = profileState.loading || profileState.saving;
  const publicProfileStatusLabel = publicProfileEnabled
    ? publicProfileStatusEnabledLabel
    : publicProfileStatusDisabledLabel;

  const handleTogglePublicProfile = async () => {
    if (!baseUrl) return;
    if (mockEnabled) return;
    if (!authTokenAllowed || !authTokenReady) return;
    if (publicProfileBusy) return;
    setProfileState((prev) => ({ ...prev, saving: true, error: null }));
    try {
      const token = await resolveAuthAccessToken(effectiveAuthToken);
      const nextValue = !publicProfileEnabled;
      const data = await setPublicVisibility({
        baseUrl,
        accessToken: token,
        enabled: nextValue,
      });
      setProfileState((prev) => ({
        ...prev,
        saving: false,
        error: null,
        leaderboardPublic: Boolean(data?.enabled),
      }));
      setListReloadToken((value) => value + 1);
    } catch (err) {
      setProfileState((prev) => ({
        ...prev,
        saving: false,
        error: normalizeLeaderboardError(err),
      }));
    }
  };

  const { canPrev, canNext } = getPaginationFlags({ page: currentPage, totalPages });

  const hasEntries = Array.isArray(displayEntries) && displayEntries.length !== 0;
  let listBody = null;
  if (listState.loading) {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-400">{copy("leaderboard.loading")}</p>
      </div>
    );
  } else if (listState.error) {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-red-400">{listState.error}</p>
      </div>
    );
  } else if (hasEntries) {
    listBody = (
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <colgroup>
            <col className="w-[80px]" />
            <col />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
            <col className="w-[120px]" />
          </colgroup>
          <thead className="bg-oai-gray-900/50 border-b border-oai-gray-800">
            <tr>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.rank")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.user")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.total")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.gpt")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.claude")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.other")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-oai-gray-800/50">
            {displayEntries.map((entry) => {
              const isMe = Boolean(entry?.is_me);
              const profileUserId = typeof entry?.user_id === "string" ? entry.user_id : null;
              const rawName = normalizeName(entry?.display_name);
              const entryName = isAnonymousName(rawName) ? anonLabel : rawName;
              const name = isMe ? meLabel : entryName;
              // Only clickable when: not me, has user_id, AND is_public=true (backend verified)
              const userLinkEnabled = Boolean(profileUserId) && !isMe && Boolean(entry?.is_public);
              const publicViewPath = userLinkEnabled
                ? buildPublicViewPath(profileUserId, periodSearch)
                : null;
              const rowClickable = Boolean(publicViewPath);

              if (isMe) {
                return (
                  <tr
                    key={`row-${entry?.rank}-${name}`}
                    className="bg-oai-brand-900/10 border-y border-oai-brand-500/30 transition-colors"
                  >
                    <td className="px-6 py-4 font-semibold text-oai-brand-400">
                      {entry?.rank ?? placeholder}
                    </td>
                    <td className="px-6 py-4 font-semibold text-oai-white truncate max-w-[240px]">
                      {name}
                    </td>
                    <td className="px-6 py-4 font-medium text-oai-white">
                      {toDisplayNumber(entry?.total_tokens)}
                    </td>
                    <td className="px-6 py-4 text-oai-gray-300">
                      {toDisplayNumber(entry?.gpt_tokens)}
                    </td>
                    <td className="px-6 py-4 text-oai-gray-300">
                      {toDisplayNumber(entry?.claude_tokens)}
                    </td>
                    <td className="px-6 py-4 text-oai-gray-300">
                      {toDisplayNumber(entry?.other_tokens)}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={`row-${entry?.rank}-${name}`}
                  className={cn(
                    "transition-colors",
                    rowClickable ? "cursor-pointer hover:bg-oai-gray-900/60" : ""
                  )}
                  onClick={
                    rowClickable
                      ? () => {
                          if (typeof window !== "undefined") {
                            window.location.assign(publicViewPath);
                            return;
                          }
                          navigate(publicViewPath);
                        }
                      : undefined
                  }
                  onKeyDown={
                    rowClickable
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            if (typeof window !== "undefined") {
                              window.location.assign(publicViewPath);
                              return;
                            }
                            navigate(publicViewPath);
                          }
                        }
                      : undefined
                  }
                  role={rowClickable ? "link" : undefined}
                  tabIndex={rowClickable ? 0 : undefined}
                  aria-label={rowClickable ? `Open public dashboard for ${name}` : undefined}
                >
                  <td className="px-6 py-4 font-medium text-oai-gray-400">
                    {entry?.rank ?? placeholder}
                  </td>
                  <td className="px-6 py-4 font-medium text-oai-gray-200 truncate max-w-[240px]">
                    {name}
                  </td>
                  <td className="px-6 py-4 text-oai-gray-300">
                    {toDisplayNumber(entry?.total_tokens)}
                  </td>
                  <td className="px-6 py-4 text-oai-gray-400">
                    {toDisplayNumber(entry?.gpt_tokens)}
                  </td>
                  <td className="px-6 py-4 text-oai-gray-400">
                    {toDisplayNumber(entry?.claude_tokens)}
                  </td>
                  <td className="px-6 py-4 text-oai-gray-400">
                    {toDisplayNumber(entry?.other_tokens)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  } else {
    listBody = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-400">{copy("leaderboard.empty")}</p>
      </div>
    );
  }

  let pageButtons = null;
  if (typeof totalPages === "number") {
    pageButtons = pageItems.map((p, idx) => {
      if (p == null) {
        return (
          <span
            key={`ellipsis-${idx}`}
            className="px-2 text-oai-gray-500"
          >
            {copy("leaderboard.pagination.ellipsis")}
          </span>
        );
      }
      return (
        <button
          key={`page-${p}`}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium transition-colors",
            p === currentPage
              ? "bg-oai-gray-800 text-white"
              : "text-oai-gray-400 hover:bg-oai-gray-800 hover:text-white"
          )}
          onClick={() => setListPage(p)}
          disabled={listState.loading}
        >
          {String(p)}
        </button>
      );
    });
  } else {
    pageButtons = (
      <span className="text-sm text-oai-gray-400">
        {copy("leaderboard.pagination.page_unknown", { page: String(currentPage) })}
      </span>
    );
  }

  return (
    <div className="min-h-screen bg-oai-gray-950 text-oai-white font-oai antialiased dark">
      <header className="sticky top-0 z-50 bg-oai-gray-950/80 backdrop-blur-md border-b border-oai-gray-900">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-5">
            <Link
              to="/"
              className="flex items-center gap-3 no-underline outline-none rounded focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:ring-offset-oai-gray-950 transition-opacity hover:opacity-80"
            >
              <img src="/app-icon.png" alt="" width={24} height={24} className="rounded-md" />
              <span className="text-sm font-semibold tracking-wide text-white uppercase hidden sm:inline-block">
                Token Tracker
              </span>
            </Link>
            {headerStatus && <div className="hidden md:block">{headerStatus}</div>}
          </div>
          <div className="flex items-center gap-3 sm:gap-4">
            <Link 
              to="/" 
              className="text-sm font-medium text-oai-gray-400 hover:text-white transition-colors mr-2 hidden sm:block"
            >
              {copy("leaderboard.nav.back")}
            </Link>
            <div className="hidden sm:block">
              <HeaderGithubStar />
            </div>
            {signedIn ? (
              <button
                onClick={signOut}
                className={cn(buttonClass("ghost", "sm"), "text-oai-gray-400 hover:text-white")}
              >
                {copy("dashboard.sign_out")}
              </button>
            ) : (
              <a
                href={signInUrl}
                className={cn(
                  buttonClass("default", "sm"),
                  "no-underline px-5 rounded-full shadow-sm ring-1 ring-white/10 group"
                )}
              >
                {copy("shared.button.sign_in")}
                <span className="ml-2 inline-block transition-transform duration-200 group-hover:translate-x-0.5">
                  &rarr;
                </span>
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="py-12 sm:py-16">
        <div className="mx-auto max-w-5xl px-4 sm:px-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
            <div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-3">
                {copy("leaderboard.title")}
              </h1>
              <p className="text-oai-gray-400 text-sm sm:text-base">
                {period === "total"
                  ? copy("leaderboard.range.total")
                  : from && to
                    ? copy("leaderboard.range", { period: periodLabel, from, to })
                    : copy("leaderboard.range_loading", { period: periodLabel })}
                {generatedAt && (
                  <span className="ml-2 pl-2 border-l border-oai-gray-800 inline-block text-oai-gray-500 text-xs">
                    {copy("leaderboard.generated_at", { ts: generatedAt })}
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="inline-flex p-1 bg-[#0a0a0a] border border-oai-gray-800 rounded-lg shadow-inner">
                {["week", "month", "total"].map((p) => (
                  <button
                    key={p}
                    onClick={() => handlePeriodChange(p)}
                    disabled={listState.loading}
                    className={cn(
                      "px-4 py-1.5 text-sm font-medium rounded-md transition-colors",
                      period === p
                        ? "bg-oai-gray-800 text-white shadow"
                        : "text-oai-gray-400 hover:text-oai-gray-200 hover:bg-oai-gray-900/50"
                    )}
                  >
                    {p === "week" ? weekLabel : p === "month" ? monthLabel : totalLabel}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-oai-gray-800 bg-[#0a0a0a]/50 backdrop-blur-md shadow-2xl shadow-black/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-oai-gray-800 bg-oai-gray-900/20 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-medium text-white">{copy("leaderboard.table.title")}</h2>
                <p className="text-xs text-oai-gray-500 mt-1">{copy("leaderboard.table.subtitle")}</p>
              </div>

              {authTokenAllowed && authTokenReady && (
                <div className="flex items-center gap-3">
                  {profileState.error && (
                    <span className="text-xs text-red-400 mr-2">
                      {profileState.error}
                    </span>
                  )}
                  <span className="text-sm font-medium text-oai-gray-400">
                    {publicProfileLabel}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={publicProfileEnabled}
                    onClick={handleTogglePublicProfile}
                    disabled={publicProfileBusy}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-oai-brand-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-oai-gray-950 disabled:opacity-50 disabled:cursor-not-allowed",
                      publicProfileEnabled ? "bg-oai-brand-500" : "bg-oai-gray-700"
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        publicProfileEnabled ? "translate-x-6" : "translate-x-1"
                      )}
                    />
                  </button>
                  <span className="text-xs text-oai-gray-500 min-w-[60px]">
                    {publicProfileStatusLabel}
                  </span>
                </div>
              )}
            </div>

            {listBody}

            <div className="px-6 py-4 border-t border-oai-gray-800 bg-oai-gray-900/20 flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <button
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium text-oai-gray-400 rounded-md border border-oai-gray-800 transition-colors",
                    canPrev && !listState.loading
                      ? "hover:bg-oai-gray-800 hover:text-white"
                      : "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => setListPage((p) => Math.max(1, p - 1))}
                  disabled={!canPrev || listState.loading}
                >
                  {copy("leaderboard.pagination.prev")}
                </button>
                <button
                  className={cn(
                    "px-3 py-1.5 text-sm font-medium text-oai-gray-400 rounded-md border border-oai-gray-800 transition-colors",
                    canNext && !listState.loading
                      ? "hover:bg-oai-gray-800 hover:text-white"
                      : "opacity-50 cursor-not-allowed"
                  )}
                  onClick={() => setListPage((p) => p + 1)}
                  disabled={!canNext || listState.loading}
                >
                  {copy("leaderboard.pagination.next")}
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1">{pageButtons}</div>
            </div>
          </div>
        </div>
      </main>
      
      <footer className="border-t border-oai-gray-900 bg-oai-gray-950 py-12">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 px-4 sm:px-6 text-sm text-oai-gray-400 sm:flex-row">
          <p>{copy("landing.v2.footer.line")}</p>
          <div className="flex items-center gap-6">
            <a
              href="https://github.com/mm7894215/tokentracker"
              className="font-medium text-oai-gray-400 hover:text-white transition-colors"
              target="_blank"
              rel="noopener noreferrer"
            >
              {copy("landing.v2.nav.github")}
            </a>
            <Link
              to="/"
              className="font-medium text-oai-brand-500 hover:text-oai-brand-400 transition-colors"
            >
              {copy("leaderboard.nav.back")} &rarr;
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
