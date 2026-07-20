import assert from "node:assert/strict";
import test from "node:test";
import { dueNodeIds, scheduleReview } from "../src/scheduler";

const now = new Date("2026-07-20T12:00:00Z");

test("scheduler gives successful recall a future interval", () => {
  const first = scheduleReview("function:a", "good", undefined, now);
  assert.equal(first.intervalDays, 1);
  assert.equal(first.repetitions, 1);
  const second = scheduleReview("function:a", "good", first, now);
  assert.equal(second.intervalDays, 3);
  assert.equal(second.repetitions, 2);
});

test("again resets repetition and is due immediately", () => {
  const state = scheduleReview("function:a", "again", undefined, now);
  assert.equal(state.repetitions, 0);
  assert.deepEqual(dueNodeIds([state], now), ["function:a"]);
});

