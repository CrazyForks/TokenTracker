import React from "react";
import { Card } from "../../openai/components";
import { FadeIn } from "../../foundation/FadeIn.jsx";

function formatReset(isoOrUnix) {
  if (!isoOrUnix) return null;
  const ts = typeof isoOrUnix === "number" ? isoOrUnix * 1000 : Date.parse(isoOrUnix);
  if (!Number.isFinite(ts)) return null;
  const diff = ts - Date.now();
  if (diff <= 0) return "now";
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function barColor(pct) {
  if (pct >= 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function LimitBar({ label, pct, reset }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-oai-gray-500 dark:text-oai-gray-400 w-12 shrink-0">{label}</span>
      <div className="flex-1 bg-oai-gray-100 dark:bg-oai-gray-700/50 rounded-full h-1.5 overflow-hidden">
        <div
          className={`${barColor(v)} rounded-full h-full transition-[width] duration-500 ease-out`}
          style={{ width: `${v}%`, minWidth: v > 0 ? "3px" : 0 }}
        />
      </div>
      <span className="text-[11px] tabular-nums text-oai-gray-500 dark:text-oai-gray-400 w-[30px] text-right shrink-0">
        {v}%
      </span>
      {reset ? (
        <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500 w-6 text-right shrink-0">
          {reset}
        </span>
      ) : null}
    </div>
  );
}

function ToolGroup({ name, icon, error, children }) {
  // Cursor uses currentColor, so it adapts to theme naturally
  // Gemini and Antigravity have fixed colors but need consistent sizing
  const getIconClassName = (iconPath) => {
    if (iconPath === "/brand-logos/cursor.svg") {
      return "w-[14px] h-[14px] dark:invert";
    }
    // Gemini and Antigravity need explicit sizing since their SVGs use fixed colors
    return "w-[14px] h-[14px]";
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        {icon ? <img src={icon} alt="" className={getIconClassName(icon)} /> : null}
        <span className="text-sm font-medium text-oai-black dark:text-oai-white">{name}</span>
        {error ? (
          <span className="text-[10px] text-oai-gray-400 dark:text-oai-gray-500 truncate">
            {error === "token_expired" || error === "session_expired" ? "session expired" : error}
          </span>
        ) : null}
      </div>
      {!error ? children : null}
    </div>
  );
}

export function UsageLimitsPanel({ claude, codex, cursor, gemini, kiro, antigravity }) {
  const cc = claude?.configured;
  const cx = codex?.configured;
  const cr = cursor?.configured;
  const gm = gemini?.configured;
  const kr = kiro?.configured;
  const ag = antigravity?.configured;
  if (!cc && !cx && !cr && !gm && !kr && !ag) return null;

  return (
    <FadeIn delay={0.15}>
      <Card>
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">Usage Limits</h3>
          {cc ? (
            <ToolGroup name="Claude" icon="/brand-logos/claude-code.svg" error={claude.error}>
              {claude.five_hour ? (
                <LimitBar label="5h" pct={claude.five_hour.utilization} reset={formatReset(claude.five_hour.resets_at)} />
              ) : null}
              {claude.seven_day ? (
                <LimitBar label="7d" pct={claude.seven_day.utilization} reset={formatReset(claude.seven_day.resets_at)} />
              ) : null}
              {claude.seven_day_opus ? (
                <LimitBar label="Opus" pct={claude.seven_day_opus.utilization} reset={formatReset(claude.seven_day_opus.resets_at)} />
              ) : null}
            </ToolGroup>
          ) : null}
          {cx ? (
            <ToolGroup name="Codex" icon="/brand-logos/codex.svg" error={codex.error}>
              {codex.primary_window ? (
                <LimitBar label="5h" pct={codex.primary_window.used_percent} reset={formatReset(codex.primary_window.reset_at)} />
              ) : null}
              {codex.secondary_window ? (
                <LimitBar label="7d" pct={codex.secondary_window.used_percent} reset={formatReset(codex.secondary_window.reset_at)} />
              ) : null}
            </ToolGroup>
          ) : null}
          {cr ? (
            <ToolGroup name="Cursor" icon="/brand-logos/cursor.svg" error={cursor.error}>
              {cursor.primary_window ? (
                <LimitBar label="Plan" pct={cursor.primary_window.used_percent} reset={formatReset(cursor.primary_window.reset_at)} />
              ) : null}
              {cursor.secondary_window ? (
                <LimitBar label="Auto" pct={cursor.secondary_window.used_percent} reset={formatReset(cursor.secondary_window.reset_at)} />
              ) : null}
              {cursor.tertiary_window ? (
                <LimitBar label="API" pct={cursor.tertiary_window.used_percent} reset={formatReset(cursor.tertiary_window.reset_at)} />
              ) : null}
            </ToolGroup>
          ) : null}
          {gm ? (
            <ToolGroup name="Gemini" icon="/brand-logos/gemini.svg" error={gemini.error}>
              {gemini.primary_window ? (
                <LimitBar label="Pro" pct={gemini.primary_window.used_percent} reset={formatReset(gemini.primary_window.reset_at)} />
              ) : null}
              {gemini.secondary_window ? (
                <LimitBar label="Flash" pct={gemini.secondary_window.used_percent} reset={formatReset(gemini.secondary_window.reset_at)} />
              ) : null}
              {gemini.tertiary_window ? (
                <LimitBar label="Lite" pct={gemini.tertiary_window.used_percent} reset={formatReset(gemini.tertiary_window.reset_at)} />
              ) : null}
            </ToolGroup>
          ) : null}
          {kr ? (
            <ToolGroup name="Kiro" error={kiro.error}>
              {kiro.primary_window ? (
                <LimitBar label="Month" pct={kiro.primary_window.used_percent} reset={formatReset(kiro.primary_window.reset_at)} />
              ) : null}
              {kiro.secondary_window ? (
                <LimitBar label="Bonus" pct={kiro.secondary_window.used_percent} reset={formatReset(kiro.secondary_window.reset_at)} />
              ) : null}
            </ToolGroup>
          ) : null}
          {ag ? (
            <ToolGroup name="Antigravity" icon="/brand-logos/antigravity.svg" error={antigravity.error}>
              {antigravity.primary_window ? (
                <LimitBar label="Claude" pct={antigravity.primary_window.used_percent} reset={formatReset(antigravity.primary_window.reset_at)} />
              ) : null}
              {antigravity.secondary_window ? (
                <LimitBar label="G Pro" pct={antigravity.secondary_window.used_percent} reset={formatReset(antigravity.secondary_window.reset_at)} />
              ) : null}
              {antigravity.tertiary_window ? (
                <LimitBar label="Flash" pct={antigravity.tertiary_window.used_percent} reset={formatReset(antigravity.tertiary_window.reset_at)} />
              ) : null}
            </ToolGroup>
          ) : null}
        </div>
      </Card>
    </FadeIn>
  );
}
