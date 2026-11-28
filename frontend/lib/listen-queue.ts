/**
 * Listen mode's player state, kept pure so every AirPods press is tested without a browser.
 * `take` counts how many times an item has been (re)started: the engine speaks whenever it
 * changes, so "go back" on the first item restarts it instead of doing nothing.
 */

export type ListenStatus = "off" | "playing" | "paused" | "done";

export type ListenQueue = {
  status: ListenStatus;
  /** Which item is on (or was last on). */
  index: number;
  /** How many items the summary has. */
  length: number;
  take: number;
};

export type ListenAction =
  | { type: "start"; length: number }
  /** One press: pause if playing, otherwise play (from the top once it has finished). */
  | { type: "toggle" }
  | { type: "play" }
  | { type: "pause" }
  /** Two presses, or the item finished speaking. */
  | { type: "next" }
  | { type: "ended" }
  /** Three presses. */
  | { type: "previous" }
  | { type: "stop" };

export const LISTEN_OFF: ListenQueue = { status: "off", index: 0, length: 0, take: 0 };

const play = (queue: ListenQueue, index: number): ListenQueue => ({
  ...queue,
  status: "playing",
  index,
  take: queue.take + 1,
});

export function listenReducer(queue: ListenQueue, action: ListenAction): ListenQueue {
  if (action.type === "start") {
    if (!Number.isSafeInteger(action.length) || action.length < 1) return LISTEN_OFF;
    return play({ ...queue, length: action.length }, 0);
  }
  if (queue.status === "off") return queue;
  switch (action.type) {
    case "stop":
      return { ...LISTEN_OFF, take: queue.take };
    case "pause":
      return queue.status === "playing" ? { ...queue, status: "paused" } : queue;
    case "play":
      if (queue.status === "playing") return queue;
      // Resumes at the start of the item it stopped in: speech engines can't reliably resume mid-sentence.
      return play(queue, queue.status === "done" ? 0 : queue.index);
    case "toggle":
      return listenReducer(queue, { type: queue.status === "playing" ? "pause" : "play" });
    case "next":
    case "ended": {
      // A finished item that wasn't playing (paused just as it ended) stays put.
      if (action.type === "ended" && queue.status !== "playing") return queue;
      if (queue.index + 1 >= queue.length) return { ...queue, status: "done", index: queue.length - 1 };
      return play(queue, queue.index + 1);
    }
    case "previous":
      return play(queue, Math.max(0, queue.index - 1));
  }
}
