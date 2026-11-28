// Run with `npm test` (Node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LISTEN_OFF, type ListenAction, type ListenQueue, listenReducer } from "./listen-queue.ts";

const run = (actions: ListenAction[], from: ListenQueue = LISTEN_OFF) => actions.reduce(listenReducer, from);
const started = run([{ type: "start", length: 3 }]);

describe("listenReducer", () => {
  it("starts on the first item", () => {
    assert.deepEqual(started, { status: "playing", index: 0, length: 3, take: 1 });
  });
  it("refuses an empty or invalid summary", () => {
    assert.equal(run([{ type: "start", length: 0 }]), LISTEN_OFF);
    assert.equal(run([{ type: "start", length: 1.5 }]), LISTEN_OFF);
  });
  it("ignores presses while off", () => {
    for (const type of ["toggle", "play", "pause", "next", "previous", "ended"] as const)
      assert.equal(listenReducer(LISTEN_OFF, { type }), LISTEN_OFF);
  });
  it("one press pauses, the next resumes the same item from its start", () => {
    const paused = listenReducer(started, { type: "toggle" });
    assert.equal(paused.status, "paused");
    assert.equal(paused.take, started.take, "pausing doesn't restart speech");
    const resumed = listenReducer(paused, { type: "toggle" });
    assert.deepEqual(resumed, { ...started, take: started.take + 1 });
  });
  it("two presses skip, and finishing an item moves on", () => {
    assert.equal(listenReducer(started, { type: "next" }).index, 1);
    assert.equal(listenReducer(started, { type: "ended" }).index, 1);
  });
  it("an item ending while paused doesn't move on", () => {
    const paused = listenReducer(started, { type: "pause" });
    assert.equal(listenReducer(paused, { type: "ended" }), paused);
  });
  it("finishes after the last item, then plays again from the top", () => {
    const done = run([{ type: "next" }, { type: "next" }, { type: "ended" }], started);
    assert.equal(done.status, "done");
    assert.equal(done.index, 2);
    assert.equal(listenReducer(done, { type: "next" }).status, "done");
    const again = listenReducer(done, { type: "toggle" });
    assert.equal(again.status, "playing");
    assert.equal(again.index, 0);
  });
  it("three presses go back one, and restart the first item instead of doing nothing", () => {
    const second = listenReducer(started, { type: "next" });
    assert.equal(listenReducer(second, { type: "previous" }).index, 0);
    const restarted = listenReducer(started, { type: "previous" });
    assert.equal(restarted.index, 0);
    assert.equal(restarted.take, started.take + 1);
  });
  it("going back from a paused item plays it", () => {
    const paused = run([{ type: "next" }, { type: "pause" }], started);
    const back = listenReducer(paused, { type: "previous" });
    assert.equal(back.status, "playing");
    assert.equal(back.index, 0);
  });
  it("play while playing and pause while paused change nothing", () => {
    assert.equal(listenReducer(started, { type: "play" }), started);
    const paused = listenReducer(started, { type: "pause" });
    assert.equal(listenReducer(paused, { type: "pause" }), paused);
  });
  it("stop turns it off from any state", () => {
    const stopped = listenReducer(listenReducer(started, { type: "next" }), { type: "stop" });
    assert.equal(stopped.status, "off");
    assert.equal(stopped.length, 0);
  });
  it("a single-item summary finishes after one item", () => {
    const one = run([{ type: "start", length: 1 }, { type: "ended" }]);
    assert.deepEqual([one.status, one.index], ["done", 0]);
  });
});
