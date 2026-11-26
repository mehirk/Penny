import type { MissionRun } from "./api";

/**
 * "Share with family": a finished mission as plain text, to talk it over with someone the user
 * trusts. Built only from what the mission already shows (figures the money engine produced and
 * the verifier checked), so nothing is calculated or written by a model here. No runtime imports,
 * so `node --test` can run its tests without a bundler.
 */

export type ShareableMission = Pick<
  MissionRun,
  | "title"
  | "goal"
  | "status"
  | "started_at"
  | "finished_at"
  | "summary"
  | "brief"
  | "costs"
  | "checklist"
  | "verification"
>;

const STAGE: Record<MissionRun["checklist"][number]["stage"], string> = {
  before: "before the move",
  moving: "moving week",
  after: "once there",
};

const date = (iso: string, withYear: boolean) =>
  new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    ...(withYear && { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

/**
 * A second line of defence for what leaves the app: the server already strips these before the
 * AI sees anything, but a share should never carry an email, phone, SIN or card number even if
 * one slipped into a title. Dollar amounts ("$2,656.00") are left alone.
 */
export function scrubPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[removed]")
    .replace(/(?<![$\d.,])(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?![\d,]|\.\d)/g, "[removed]")
    .replace(/(?<![$\d.,])\d(?:[\s-]?\d){8,18}(?![\d,]|\.\d)/g, "[removed]");
}

/** The share text, or null when the mission has nothing finished to share. */
export function missionShareText(run: ShareableMission, ticked: readonly string[] = []): string | null {
  if (run.status !== "done") return null;
  const answer = (run.brief?.answer ?? run.summary ?? "").trim();
  if (!answer) return null;

  const lines: string[] = [`Penny plan: ${run.goal.trim() || run.title.trim()}`];
  const checked = run.verification?.figures_checked ?? 0;
  lines.push(
    [date(run.finished_at ?? run.started_at, true), checked > 0 && `${checked} figures checked`]
      .filter(Boolean)
      .join(" · "),
  );
  lines.push("", "The short answer", answer);

  const numbers = run.brief?.numbers.slice(0, 4) ?? [];
  if (numbers.length) lines.push("", "Key numbers", ...numbers.map((n) => `• ${n.label}: ${n.value}`));

  if (run.costs)
    lines.push(
      "",
      "Every cost",
      `• Upfront: ${run.costs.upfront_total}`,
      `• Every month: ${run.costs.monthly_total} (${run.costs.monthly_now} now)`,
    );

  const todo = run.brief?.picture.filter((item) => item.group === "you_do") ?? [];
  if (todo.length) lines.push("", "What I’d need to do", ...todo.map((item) => `• ${item.title}`));

  if (run.checklist.length) {
    const done = run.checklist.filter((item) => ticked.includes(item.id)).length;
    lines.push("", `My checklist (${done} of ${run.checklist.length} done)`);
    for (const item of run.checklist)
      lines.push(
        `${ticked.includes(item.id) ? "✓" : "○"} ${item.title}, by ${date(item.due_on, false)} (${STAGE[item.stage]})`,
      );
  }

  lines.push(
    "",
    "Worked out with Penny. Every figure comes from tested code, not the AI. For learning, not financial advice.",
  );
  return scrubPersonal(lines.join("\n"));
}
