import { useCallback, useEffect, useState } from "react";
import { getUsageLimits } from "../lib/api";

interface UsageLimitsData {
  fetched_at: string;
  claude: { configured: boolean; error?: string | null; five_hour?: { utilization: number; resets_at?: string }; seven_day?: { utilization: number; resets_at?: string }; seven_day_opus?: { utilization: number; resets_at?: string } | null; extra_usage?: { is_enabled: boolean; monthly_limit?: number | null; used_credits?: number | null; currency?: string | null } | null };
  codex: { configured: boolean; error?: string | null; primary_window?: { used_percent: number; reset_at?: number; limit_window_seconds?: number } | null; secondary_window?: { used_percent: number; reset_at?: number; limit_window_seconds?: number } | null };
  cursor: { configured: boolean; error?: string | null; membership_type?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  gemini: { configured: boolean; error?: string | null; account_email?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
  kiro: { configured: boolean; error?: string | null; plan_name?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null };
  antigravity: { configured: boolean; error?: string | null; account_email?: string | null; account_plan?: string | null; primary_window?: { used_percent: number; reset_at?: string | null } | null; secondary_window?: { used_percent: number; reset_at?: string | null } | null; tertiary_window?: { used_percent: number; reset_at?: string | null } | null };
}

export function useUsageLimits() {
  const [data, setData] = useState<UsageLimitsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await getUsageLimits();
      setData(res && typeof res === "object" ? res as UsageLimitsData : null);
      setError(null);
    } catch (err) {
      setError((err as Error)?.message || String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { data, error, refresh };
}
