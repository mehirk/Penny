import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetAll, recall, remember } from "./session-cache.ts";

test("recall returns nothing before anything is remembered", () => {
  forgetAll();
  assert.equal(recall("skill-map"), undefined);
});

test("remember then recall returns the same value", () => {
  forgetAll();
  remember("skill-map", { checked: true, areas: [{ id: "banking", pct: 90 }] });
  assert.deepEqual(recall("skill-map"), { checked: true, areas: [{ id: "banking", pct: 90 }] });
});

test("a newer copy replaces the older one", () => {
  forgetAll();
  remember("skill-map", { checked: false });
  remember("skill-map", { checked: true });
  assert.deepEqual(recall("skill-map"), { checked: true });
});

test("forgetAll wipes everything, as on sign-out", () => {
  remember("skill-map", { checked: true });
  remember("other", 1);
  forgetAll();
  assert.equal(recall("skill-map"), undefined);
  assert.equal(recall("other"), undefined);
});
