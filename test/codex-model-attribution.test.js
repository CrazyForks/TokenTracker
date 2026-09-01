"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  applyCodexModelEvent,
  createCodexModelAttributionState,
  currentCodexModel,
  extractModelReroute,
} = require("../src/lib/codex-model-attribution");

test("Codex model attribution promotes an official model/rerouted notification to the effective model", () => {
  const state = createCodexModelAttributionState();
  applyCodexModelEvent(state, {
    type: "turn_context",
    payload: { turn_id: "turn-1", model: "gpt-5.6-sol" },
  });
  const notification = {
    method: "model/rerouted",
    params: {
      threadId: "thread-1",
      turnId: "turn-1",
      fromModel: "gpt-5.6-sol",
      toModel: "gpt-5.6-terra",
      reason: "capacity",
    },
  };
  assert.deepEqual(extractModelReroute(notification), {
    threadId: "thread-1",
    turnId: "turn-1",
    fromModel: "gpt-5.6-sol",
    toModel: "gpt-5.6-terra",
    reason: "capacity",
  });
  applyCodexModelEvent(state, notification);
  assert.equal(state.selectedModel, "gpt-5.6-sol");
  assert.equal(currentCodexModel(state), "gpt-5.6-terra");
  assert.equal(state.rerouted, true);
  applyCodexModelEvent(state, { type: "turn_context", payload: { turn_id: "turn-2" } });
  assert.equal(currentCodexModel(state), "gpt-5.6-sol");
  assert.equal(state.rerouted, false);
});

test("Codex model attribution accepts persisted snake-case event envelopes", () => {
  const state = createCodexModelAttributionState({ model: "gpt-5.6-sol" });
  applyCodexModelEvent(state, {
    type: "event_msg",
    payload: {
      type: "model_rerouted",
      from_model: "gpt-5.6-sol",
      to_model: "gpt-5.6-luna",
      reason: "user_limit",
    },
  });
  assert.equal(currentCodexModel(state), "gpt-5.6-luna");
  assert.equal(state.rerouteReason, "user_limit");
});
