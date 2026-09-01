"use strict";

// Codex token_count events do not carry a model id. Attribute them to the
// latest turn selection, upgraded to the effective model when an app-server
// model/rerouted notification is present in the persisted event stream.

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
