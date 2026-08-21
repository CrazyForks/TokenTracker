import { copy } from "./copy";

const SPECIAL_PROVIDER_NAMES = {
  anythingllm: "AnythingLLM",
  claudescience: "Claude Science",
  pianthropic: "Pi · Anthropic",
  pigithubcopilot: "Pi · GitHub Copilot",
  picopilot: "Pi · Copilot",
};

const SPECIAL_PROVIDER_COPY_KEYS = {
  deepseek: "provider.display.deepseek_harness",
  dsh: "provider.display.deepseek_harness",
  omp: "provider.display.omp",
  traecn: "provider.display.trae_work_cn",
  traeworkcn: "provider.display.trae_work_cn",
};

function normalizedProviderKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function formatProviderDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const normalized = normalizedProviderKey(raw);
  if (normalized === "primeagent") return "Prime Agent";
  if (normalized.startsWith("primeagent") && normalized.length > "primeagent".length) {
    const provider = raw
      .replace(/^prime[-_ ]?agent[-_ ]?/i, "")
      .split(/[-_ ]+/)
      .filter(Boolean)
      .map((part) => part.toLowerCase() === "github"
        ? "GitHub"
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
    return provider ? `Prime Agent · ${provider}` : "Prime Agent";
  }
  const specialCopyKey = SPECIAL_PROVIDER_COPY_KEYS[normalized];
  if (specialCopyKey) return copy(specialCopyKey);

  const specialName = SPECIAL_PROVIDER_NAMES[normalized];
  if (specialName) return specialName;

  return raw.charAt(0).toUpperCase() + raw.slice(1);
}
