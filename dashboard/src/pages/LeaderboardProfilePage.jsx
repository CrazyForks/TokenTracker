import React, { useEffect, useMemo, useState } from "react";
import { useLocation, Link } from "react-router-dom";
import { BackendStatus } from "../components/BackendStatus.jsx";
import { isAccessTokenReady, resolveAuthAccessToken } from "../lib/auth-token";
import { copy } from "../lib/copy";
import { toDisplayNumber } from "../lib/format";
import { cn } from "../lib/cn";
import { isMockEnabled } from "../lib/mock-data";
import { getLeaderboardProfile } from "../lib/api";
import { HeaderGithubStar } from "../ui/openai/components/HeaderGithubStar.jsx";

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

function normalizeProfileError(err) {
  if (!err) return copy("shared.error.prefix", { error: copy("leaderboard.error.unknown") });
  const msg = err?.message || String(err);
  const safe = String(msg || "").trim() || copy("leaderboard.error.unknown");
  return copy("shared.error.prefix", { error: safe });
}

function normalizeName(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function normalizePeriod(value) {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "week") return v;
  if (v === "month") return v;
  if (v === "total") return v;
  return null;
}

export function LeaderboardProfilePage({
  baseUrl,
  auth,
  signedIn,
  sessionSoftExpired,
  signOut,
  signInUrl = "/sign-in",
  userId,
}) {
  const location = useLocation();
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
  const period = useMemo(() => {
    const params = new URLSearchParams(location?.search || "");
    return normalizePeriod(params.get("period")) || "week";
  }, [location?.search]);
  const periodSearch = location?.search || "";

  let headerStatus = null;
  if (authTokenAllowed && authTokenReady) {
    headerStatus = <BackendStatus baseUrl={baseUrl} accessToken={effectiveAuthToken} />;
  }

  const [profileState, setProfileState] = useState(() => ({
    loading: false,
    error: null,
    data: null,
  }));

  useEffect(() => {
    if (!baseUrl) return;
    if (!userId) return;
    if (!mockEnabled && (!authTokenAllowed || !authTokenReady)) return;
    let active = true;
    setProfileState((prev) => ({ ...prev, loading: true, error: null }));
    (async () => {
      const token = await resolveAuthAccessToken(effectiveAuthToken);
      const data = await getLeaderboardProfile({
        baseUrl,
        accessToken: token,
        userId,
        period,
      });
      if (!active) return;
      setProfileState({ loading: false, error: null, data });
    })().catch((err) => {
      if (!active) return;
      setProfileState({ loading: false, error: normalizeProfileError(err), data: null });
    });
    return () => {
      active = false;
    };
  }, [authTokenAllowed, authTokenReady, baseUrl, effectiveAuthToken, mockEnabled, period, userId]);

  const data = profileState.data;
  const from = data?.from || null;
  const to = data?.to || null;
  const generatedAt = data?.generated_at || null;
  const entry = data?.entry || null;

  const displayName = normalizeName(entry?.display_name) || copy("leaderboard.anon_label");
  const weekLabel = copy("leaderboard.period.week");
  const monthLabel = copy("leaderboard.period.month");
  const totalLabel = copy("leaderboard.period.total");
  const periodLabel = period === "month" ? monthLabel : period === "total" ? totalLabel : weekLabel;

  let body = null;
  if (!userId) {
    body = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-400">{copy("leaderboard.empty")}</p>
      </div>
    );
  } else if (profileState.loading) {
    body = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-400">{copy("leaderboard.loading")}</p>
      </div>
    );
  } else if (profileState.error) {
    body = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-red-400">{profileState.error}</p>
      </div>
    );
  } else if (entry) {
    body = (
      <div className="w-full overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-oai-gray-900/50 border-b border-oai-gray-800">
            <tr>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.rank")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.total")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.gpt")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.claude")}</th>
              <th className="px-6 py-4 font-medium text-oai-gray-400">{copy("leaderboard.column.other")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-oai-gray-800/50">
            <tr className="transition-colors hover:bg-oai-gray-900/60">
              <td className="px-6 py-4 font-medium text-oai-gray-400">
                {entry?.rank ?? copy("shared.placeholder.short")}
              </td>
              <td className="px-6 py-4 text-oai-gray-300">{toDisplayNumber(entry?.total_tokens)}</td>
              <td className="px-6 py-4 text-oai-gray-400">{toDisplayNumber(entry?.gpt_tokens)}</td>
              <td className="px-6 py-4 text-oai-gray-400">{toDisplayNumber(entry?.claude_tokens)}</td>
              <td className="px-6 py-4 text-oai-gray-400">{toDisplayNumber(entry?.other_tokens)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  } else {
    body = (
      <div className="px-6 py-12 text-center">
        <p className="text-sm text-oai-gray-400">{copy("leaderboard.empty")}</p>
      </div>
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
              to={`/leaderboard${periodSearch}`}
              className="text-sm font-medium text-oai-gray-400 hover:text-white transition-colors mr-2 hidden sm:block"
            >
              {copy("leaderboard.profile.nav.back")}
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
          <div className="flex flex-col gap-6 mb-10">
            <div>
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-white mb-3">
                {displayName}
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
          </div>

          <div className="rounded-xl border border-oai-gray-800 bg-[#0a0a0a]/50 backdrop-blur-md shadow-2xl shadow-black/50 overflow-hidden">
            <div className="px-6 py-4 border-b border-oai-gray-800 bg-oai-gray-900/20">
              <h2 className="text-base font-medium text-white">{copy("leaderboard.profile.card.title")}</h2>
              <p className="text-xs text-oai-gray-500 mt-1">{copy("leaderboard.profile.card.subtitle", { period: periodLabel })}</p>
            </div>

            {body}
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
              to={`/leaderboard${periodSearch}`}
              className="font-medium text-oai-brand-500 hover:text-oai-brand-400 transition-colors"
            >
              {copy("leaderboard.profile.nav.back")} &rarr;
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
