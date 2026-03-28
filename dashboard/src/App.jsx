import React, { Suspense, useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import { ThemeProvider } from "./ui/foundation/ThemeProvider.jsx";
import { isMockEnabled } from "./lib/mock-data";
import { fetchLatestTrackerVersion } from "./lib/npm-version";
import { isScreenshotModeEnabled } from "./lib/screenshot-mode";
import { LandingPage } from "./pages/LandingPage.jsx";

const DashboardPage = React.lazy(() =>
  import("./pages/DashboardPage.jsx").then((mod) => ({
    default: mod.DashboardPage,
  })),
);

const LeaderboardPage = React.lazy(() =>
  import("./pages/LeaderboardPage.jsx").then((mod) => ({
    default: mod.LeaderboardPage,
  })),
);

const LeaderboardProfilePage = React.lazy(() =>
  import("./pages/LeaderboardProfilePage.jsx").then((mod) => ({
    default: mod.LeaderboardProfilePage,
  })),
);

export default function App() {
  const location = useLocation();
  const mockEnabled = isMockEnabled();
  const screenshotMode = useMemo(() => {
    if (typeof window === "undefined") return false;
    return isScreenshotModeEnabled(window.location.search);
  }, []);
  const [latestVersion, setLatestVersion] = useState(null);

  useEffect(() => {
    let active = true;
    fetchLatestTrackerVersion({ allowStale: true }).then((version) => {
      if (!active) return;
      setLatestVersion(version);
    });
    return () => {
      active = false;
    };
  }, []);

  const pathname = location?.pathname || "/";
  const pageUrl = new URL(window.location.href);
  const sharePathname = pageUrl.pathname.replace(/\/+$/, "") || "/";
  const shareMatch = sharePathname.match(/^\/share\/([^/?#]+)$/i);
  const tokenFromPath = shareMatch?.[1] || null;
  const tokenFromQuery = pageUrl.searchParams.get("token") || null;
  const publicToken = tokenFromPath || tokenFromQuery;
  const publicMode =
    sharePathname === "/share" ||
    sharePathname === "/share.html" ||
    sharePathname.startsWith("/share/");

  const isLocalMode = typeof window !== "undefined" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

  const gate = isLocalMode || mockEnabled || screenshotMode ? "dashboard" : "landing";

  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  const leaderboardProfileMatch = normalizedPath.match(/^\/leaderboard\/u\/([^/]+)$/i);
  const leaderboardProfileUserId = leaderboardProfileMatch ? leaderboardProfileMatch[1] : null;
  const PageComponent = leaderboardProfileUserId
    ? LeaderboardProfilePage
    : normalizedPath === "/leaderboard"
      ? LeaderboardPage
      : DashboardPage;

  const loadingShell = <div className="min-h-screen bg-[#050505]" />;

  let content = null;
  if (gate === "landing") {
    content = <LandingPage signInUrl="/" signUpUrl="/" />;
  } else {
    content = (
      <Suspense fallback={loadingShell}>
        <PageComponent
          baseUrl=""
          auth={null}
          signedIn={false}
          sessionSoftExpired={false}
          signOut={() => Promise.resolve()}
          publicMode={publicMode}
          publicToken={publicToken}
          userId={leaderboardProfileUserId}
          signInUrl="/"
          signUpUrl="/"
        />
      </Suspense>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        {content}
      </ThemeProvider>
    </ErrorBoundary>
  );
}
