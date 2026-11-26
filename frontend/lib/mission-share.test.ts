// Run with `npm test` (Node's built-in test runner; Node strips the types itself).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { missionShareText, scrubPersonal, type ShareableMission } from "./mission-share.ts";

const move: ShareableMission = {
  title: "Moving to Toronto",
  goal: "I'm moving from Halifax to Toronto. What will it cost?",
  status: "done",
  started_at: "2026-11-26T14:02:00Z",
  finished_at: "2026-11-26T14:05:32Z",
  summary: "Not yet. Fallback summary.",
  brief: {
    answer: "Not yet. You’d need $2,656.00 upfront against $756.47 safe to spend.",
    numbers: [
      { label: "Upfront", value: "$2,656.00" },
      { label: "Safe to spend", value: "$756.47" },
    ],
    options: [{ title: "Save for 4 months", detail: "Move in March", recommended: true }],
    picture: [
      { group: "you_do", title: "Book a sublet", detail: "Before December" },
      { group: "penny_did", title: "Set a reminder", detail: "" },
      { group: "skip", title: "Movers", detail: "" },
    ],
  },
  costs: {
    title: "the move",
    upfront: [],
    monthly: [],
    upfront_total: "$2,656.00",
    monthly_total: "$1,702.00",
    monthly_now: "$1,250.00",
    monthly_change: "$452.00",
    change_up: true,
    surplus_after: null,
    months_to_save: 4,
  },
  checklist: [
    { id: "c1", title: "Give notice", detail: "", due_on: "2026-11-30", stage: "before" },
    { id: "c2", title: "Get an OHIP card", detail: "", due_on: "2027-01-08", stage: "after" },
  ],
  verification: { status: "passed", figures_checked: 44, actions_checked: 3, notes: [], steps: [] },
};

describe("missionShareText", () => {
  it("shares the checked answer, numbers, costs, to-dos and checklist", () => {
    const text = missionShareText(move, ["c1"]);
    assert.ok(text);
    const lines = text.split("\n");
    assert.equal(lines[0], "Penny plan: I'm moving from Halifax to Toronto. What will it cost?");
    assert.equal(lines[1], "Nov 26, 2026 · 44 figures checked");
    assert.ok(text.includes("Not yet. You’d need $2,656.00 upfront against $756.47 safe to spend."));
    assert.ok(text.includes("• Upfront: $2,656.00\n• Safe to spend: $756.47"));
    assert.ok(text.includes("• Every month: $1,702.00 ($1,250.00 now)"));
    assert.ok(text.includes("What I’d need to do\n• Book a sublet"));
    assert.ok(!text.includes("Set a reminder"), "only what the user does is shared");
    assert.ok(!text.includes("Movers"));
    assert.ok(text.includes("My checklist (1 of 2 done)"));
    assert.ok(text.includes("✓ Give notice, by Nov 30 (before the move)"));
    assert.ok(text.includes("○ Get an OHIP card, by Jan 8 (once there)"));
    assert.ok(text.endsWith("For learning, not financial advice."));
  });

  it("falls back to the summary and leaves out empty sections", () => {
    const text = missionShareText({
      ...move,
      goal: "  ",
      brief: null,
      costs: null,
      checklist: [],
      verification: null,
      finished_at: null,
    });
    assert.ok(text);
    assert.equal(text.split("\n")[0], "Penny plan: Moving to Toronto");
    assert.equal(text.split("\n")[1], "Nov 26, 2026");
    assert.ok(text.includes("Not yet. Fallback summary."));
    for (const heading of ["Key numbers", "Every cost", "What I’d need to do", "My checklist"])
      assert.ok(!text.includes(heading), heading);
  });

  it("shares nothing for a mission that is running, failed or has no answer", () => {
    assert.equal(missionShareText({ ...move, status: "running" }), null);
    assert.equal(missionShareText({ ...move, status: "failed" }), null);
    assert.equal(missionShareText({ ...move, brief: null, summary: "   " }), null);
  });

  it("never carries personal details, even in the question", () => {
    const text = missionShareText({ ...move, goal: "Email sam@example.com or call 902-555-0199 about it" });
    assert.ok(text);
    assert.ok(text.startsWith("Penny plan: Email [removed] or call [removed] about it"));
  });
});

describe("scrubPersonal", () => {
  it("removes emails, phone numbers, SINs and card numbers", () => {
    assert.equal(scrubPersonal("me: sam.lee+penny@mail.example.ca"), "me: [removed]");
    assert.equal(scrubPersonal("call (902) 555-0199"), "call [removed]");
    assert.equal(scrubPersonal("SIN 123 456 789"), "SIN [removed]");
    assert.equal(scrubPersonal("card 4520 1234 5678 9012."), "card [removed].");
  });

  it("leaves money, dates and small counts alone", () => {
    const safe = "$2,656.00 by Nov 30, 2026 · 44 figures · $1,234,567.89 · 2656.00";
    assert.equal(scrubPersonal(safe), safe);
  });
});
