export function getBackendBaseUrl() {
  // 本地開発モード uses empty string (relative path)
  if (typeof window !== "undefined" &&
      (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "";
  }
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return (
    env?.VITE_TOKENTRACKER_BACKEND_BASE_URL ||
    env?.VITE_BACKEND_BASE_URL ||
    ""
  );
}

export function getBackendAnonKey() {
  const env = typeof import.meta !== "undefined" ? import.meta.env : undefined;
  return env?.VITE_TOKENTRACKER_BACKEND_ANON_KEY || env?.VITE_BACKEND_ANON_KEY || "";
}
