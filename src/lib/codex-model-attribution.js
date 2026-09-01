"use strict";

// Codex token_count events do not carry a model id. Every usage event is
// therefore attributed to the model named by the most recent turn_context,
// which Codex emits at the start of each turn and which tracks mid-session
// model switches exactly. That per-turn path is what actually runs today.
//
// The model/rerouted upgrade below is forward-looking: it promotes usage to
// the effective model when the app server reports a server-side reroute.
//
// Deliberately NOT used for attribution: event_msg/thread_settings_applied.
// It carries thread_settings.model, but it fires when the user picks a model
// in the UI - seconds to minutes before the switch takes effect - so usage
// still streaming from the in-flight turn belongs to the previous model.
// turn_context is the only signal that marks where a turn actually begins.

function cleanString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeEventName(value) {
  return cleanString(value)?.toLowerCase().replaceAll("_", "/") || "";
}

function eventEnvelope(obj) {
  const candidates = [
    { name: obj?.method, data: obj?.params },
    { name: obj?.type, data: obj?.payload },
    { name: obj?.payload?.method, data: obj?.payload?.params },
    { name: obj?.payload?.type, data: obj?.payload },
    { name: obj?.payload?.msg?.method, data: obj?.payload?.msg?.params },
    { name: obj?.payload?.msg?.type, data: obj?.payload?.msg },
    { name: obj?.msg?.method, data: obj?.msg?.params },
    { name: obj?.msg?.type, data: obj?.msg },
  ];
  return candidates.find(({ name }) => normalizeEventName(name) === "model/rerouted") || null;
}

// Forward-looking: no model/rerouted event has been observed in any real
// rollout (verified against 5832 local files, codex-cli 0.151.0), so the
// envelope shapes and the fromModel/toModel field names below are inferred
// from the app-server protocol rather than confirmed against logged data.
// Re-verify against a real sample before relying on rerouted attribution.
function extractModelReroute(obj) {
  const envelope = eventEnvelope(obj);
  if (!envelope) return null;
  const data = envelope.data && typeof envelope.data === "object" ? envelope.data : {};
  const fromModel = cleanString(data.fromModel ?? data.from_model);
  const toModel = cleanString(data.toModel ?? data.to_model);
  if (!toModel) return null;
  return {
    fromModel,
    toModel,
    reason: cleanString(data.reason),
    threadId: cleanString(data.threadId ?? data.thread_id),
    turnId: cleanString(data.turnId ?? data.turn_id),
  };
}

function createCodexModelAttributionState(value = {}) {
  const selectedModel = cleanString(value.selectedModel ?? value.selected_model ?? value.model);
  const effectiveModel = cleanString(value.effectiveModel ?? value.effective_model) || selectedModel;
  return {
    selectedModel,
    effectiveModel,
    turnId: cleanString(value.turnId ?? value.turn_id),
    rerouted: Boolean(value.rerouted),
    rerouteReason: cleanString(value.rerouteReason ?? value.reroute_reason),
  };
}

function applyCodexModelEvent(state, obj) {
  if (!state || typeof state !== "object") return null;
  if (obj?.type === "turn_context" && obj.payload && typeof obj.payload === "object") {
    const selectedModel = cleanString(obj.payload.model);
    if (selectedModel) {
      state.selectedModel = selectedModel;
    }
    state.effectiveModel = state.selectedModel || state.effectiveModel;
    state.turnId = cleanString(obj.payload.turn_id ?? obj.payload.turnId) || state.turnId;
    state.rerouted = false;
    state.rerouteReason = null;
    return { type: "turn_context", selectedModel };
  }

  const reroute = extractModelReroute(obj);
  if (!reroute) return null;
  state.selectedModel = reroute.fromModel || state.selectedModel || state.effectiveModel;
  state.effectiveModel = reroute.toModel;
  state.turnId = reroute.turnId || state.turnId;
  state.rerouted = true;
  state.rerouteReason = reroute.reason;
  return { type: "model_rerouted", ...reroute };
}

function currentCodexModel(state) {
  return cleanString(state?.effectiveModel) || cleanString(state?.selectedModel);
}

function snapshotCodexModelAttributionState(state) {
  return createCodexModelAttributionState(state);
}

module.exports = {
  applyCodexModelEvent,
  createCodexModelAttributionState,
  currentCodexModel,
  extractModelReroute,
  snapshotCodexModelAttributionState,
};
