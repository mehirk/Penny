"""Penny's subagents: who they are, the tools each may use, and how each works without a model.

Every agent sees only its own tools (least privilege). Read tools are shared; draft tools are
given only to the agents whose job is to propose changes; nobody can save anything.

The playbooks are the built-in way each agent works: the same tools, in a fixed order, with
decisions made by deterministic code. Figures in their findings come from tool results.
"""

import calendar
import re
from dataclasses import dataclass
from datetime import date, timedelta

from app.agents.models import AgentId, Finding, MissionKind
from app.agents.runtime import Act, Playbook, Report
from app.agents.tools import TOOLS, Tool, forecast_for
from app.agents.workspace import Workspace
from app.coach.facts import parse_cad
from app.domain import benefits as benefit_rules
from app.domain.cash_forecast import round_up
from app.domain.categorize import NEED_CATEGORIES
from app.domain.finance import format_cad

# Penny keeps at least this much in chequing after bills before suggesting money leaves it.
CUSHION_CENTS = 50_000
REMIND_DAYS_AHEAD = 7
# Full month names only, so "I may move" isn't read as May.
MONTHS = {name.casefold(): index for index, name in enumerate(calendar.month_name) if name}


@dataclass(frozen=True)
class Subagent:
    id: AgentId
    name: str
    emoji: str
    role: str
    tools: tuple[str, ...]
    playbook: Playbook
    # False for agents whose work is a lookup the playbook does as well as a model would.
    thinks: bool = True
    # True for agents whose work is checking numbers: they run on the cheaper agent model.
    light: bool = False

    def tool_list(self) -> list[Tool]:
        return [TOOLS[name] for name in self.tools]


# ------------------------------------------------------------------ playbooks


def _plain(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def _day(when: date | None) -> str:
    return f"{when:%B} {when.day}" if when else ""


def count(n: int, word: str, plural: str | None = None) -> str:
    return f"{n} {word if n == 1 else plural or word + 's'}"


async def analyst(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    await act.think("Reading this month's spending")
    spend = await act.use("spending_by_category")
    subs = await act.use("subscriptions_and_bills")
    findings: list[Finding] = []
    for row in spend["categories"]:
        name = row["category"]
        if row.get("over_budget"):
            findings.append(
                Finding(
                    tone="alert",
                    title=f"{name} is over budget",
                    detail=f"{row['spent_this_month']} spent against a {row['budget']} budget.",
                )
            )
        elif row.get("above_usual") and "three_month_average" in row:
            findings.append(
                Finding(
                    tone="watch",
                    title=f"{name} is above your usual",
                    detail=f"{row['spent_this_month']} vs a {row['three_month_average']} "
                    "3-month average.",
                )
            )
    top = max(ws.dashboard.category_spending, key=lambda c: c.spent_cents, default=None)
    if top:
        findings.append(
            Finding(
                tone="info",
                title=f"Biggest category: {top.category_name}",
                detail=f"{format_cad(top.spent_cents)} of {spend['total_spent']} this month.",
            )
        )
    subscriptions = [item for item in subs["items"] if item["kind"] == "subscription"]
    if subscriptions:
        await act.think("Checking subscriptions for ones you might not use")
        unused = [item["name"] for item in subscriptions if not item["ever_paid_in_penny"]]
        findings.append(
            Finding(
                tone="watch" if unused else "info",
                title=f"Subscriptions cost {subs['subscriptions_per_year']} a year",
                detail=(
                    f"No payment recorded yet for {', '.join(unused)}: still using it?"
                    if unused
                    else f"{count(len(subscriptions), 'subscription')} at "
                    f"{subs['subscriptions_per_month']} a month."
                ),
            )
        )
    alerts = [f for f in findings if f.tone in ("alert", "watch")]
    summary = (
        f"{count(len(alerts), 'thing')} to look at this month, starting with "
        + "; ".join(f.title.lower() for f in alerts[:2])
        + "."
        if alerts
        else "Spending looks on track this month."
    )
    return Report(summary=summary, findings=findings[:5])


async def cashflow(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    d, f = ws.dashboard, ws.facts
    await act.think("Walking chequing day by day through the next 30 days")
    overview = await act.use("money_overview")
    ahead = await act.use("cash_forecast", days=30)
    forecast = forecast_for(ws, 30)
    findings: list[Finding] = []
    chequing = next((a for a in d.accounts if a.account_type == "chequing"), None)
    savings = next((a for a in d.accounts if a.account_type == "savings"), None)
    if forecast.shortfall_cents and chequing:
        move = round_up(forecast.shortfall_cents)
        findings.append(
            Finding(
                tone="alert",
                title=f"Chequing runs short on {_day(forecast.first_short_on)}",
                detail=f"It would fall {ahead['shortfall']} below zero before money comes in.",
            )
        )
        if savings and savings.balance_cents >= move:
            f.money("Transfer to cover the shortfall", move, "cash_forecast")
            await act.think("Covering the gap from savings")
            await act.use(
                "draft_transfer",
                from_account_id=savings.id,
                to_account_id=chequing.id,
                amount=_plain(move),
            )
    else:
        findings.append(
            Finding(
                tone="good",
                title="Bills are covered for the next 30 days",
                detail=f"Chequing's lowest point is {ahead['lowest_point']}"
                + (f", on {_day(forecast.lowest_on)}." if forecast.lowest_on else "."),
            )
        )
    room = ws.coach.account_total("chequing") - ws.coach.unpaid_bills_cents - CUSHION_CENTS
    card = d.credit
    # A purchase question isn't the time to suggest paying the card off.
    if card and card.balance_cents > 0 and chequing and kind != "purchase":
        await act.think("Checking whether the card can be paid off")
        await act.use("credit_card_payment", payment=_plain(card.balance_cents))
        if card.balance_cents <= room and not forecast.shortfall_cents:
            findings.append(
                Finding(
                    tone="watch",
                    title=f"You can pay off {card.account_name}",
                    detail=f"{overview['credit_card']['owed']} owed; chequing keeps "
                    f"{format_cad(CUSHION_CENTS)} or more after bills.",
                )
            )
            f.money("Cushion kept in chequing", CUSHION_CENTS, "policy")
            await act.use(
                "draft_transfer",
                from_account_id=chequing.id,
                to_account_id=card.account_id,
                amount=_plain(card.balance_cents),
            )
        else:
            findings.append(
                Finding(
                    tone="info",
                    title=f"{overview['credit_card']['owed']} on {card.account_name}",
                    detail="Paying it in full would leave chequing too thin right now.",
                )
            )
    for item in d.recurring.items:
        if 0 <= item.days_until_due <= REMIND_DAYS_AHEAD and not item.auto_record:
            remind_on = max(ws.today, item.next_due - timedelta(days=1))
            await act.use(
                "set_reminder",
                title=f"{item.name} is due {item.next_due:%b} {item.next_due.day}",
                detail=f"{format_cad(item.amount_cents)} comes out of your account.",
                due_on=remind_on.isoformat(),
            )
    summary = findings[0].title + ". " + (findings[1].title + "." if len(findings) > 1 else "")
    return Report(summary=summary.strip(), findings=findings)


_GOAL_WORDS = re.compile(r"\b(?:move|moving|co-?op|trip|travel|laptop|car|school|tuition)\b", re.I)
_AMOUNT = re.compile(r"\$\s?\d[\d,]*(?:\.\d{2})?")


def _goal_from_text(ws: Workspace) -> tuple[str, int | None, date | None]:
    """A goal's name, amount, and date from the user's own words (built-in reading)."""
    text = ws.goal
    amount = _AMOUNT.search(text)
    cents = parse_cad(amount.group(0).replace("$", "")) if amount else None
    when: date | None = None
    for word in re.findall(r"[A-Za-z]+", text):
        month = MONTHS.get(word.casefold())
        if month:
            year = ws.today.year + (1 if month <= ws.today.month else 0)
            when = date(year, month, 1)
            break
    place = re.search(r"\bto\s+([A-Z][a-z]+)", text)
    topic = _GOAL_WORDS.search(text)
    if topic and topic.group(0).casefold().startswith("mov"):
        name = f"Move to {place.group(1)}" if place else "Moving fund"
    elif topic:
        name = f"{topic.group(0).capitalize()} fund"
    else:
        name = text.strip().rstrip(".")[:40] or "New goal"
    return name, cents, when


def _months_until(today: date, when: date) -> int:
    return max(1, (when.year - today.year) * 12 + when.month - today.month)


def _round_rent(cents: int) -> int:
    """To the nearest $50, for answer choices."""
    return (cents + 2_500) // 5_000 * 5_000


async def _expected_rent(act: Act, ws: Workspace, name: str) -> str | None:
    """For a move, asks the user what rent they expect there; None keeps today's rent."""
    if not name.startswith(("Move to", "Moving")):
        return None
    rent = next((b for b in ws.dashboard.bills if b.category_id == "cat-housing"), None)
    where = f" in {name.removeprefix('Move to ')}" if name.startswith("Move to") else ""
    if rent:
        options = [_round_rent(rent.amount_cents * n // 4) for n in (5, 6, 8)]
        choices = ["Same as now", *(f"{format_cad(c)} a month" for c in options)]
        assumption = "Same as your rent now"
    else:
        choices = [f"{format_cad(c)} a month" for c in (150_000, 200_000, 250_000)]
        assumption = "No amount yet: the goal waits for one"
    answer = await act.use(
        "ask_user",
        question=f"What rent do you expect{where}?",
        why="First and last month's rent is the biggest moving cost.",
        choices=choices,
        assumption=assumption,
    )
    found = _AMOUNT.search(str(answer.get("answer") or ""))
    return _plain(parse_cad(found.group(0).replace("$", ""))) if found else None


_ITEM = re.compile(
    r"(?:afford|buy|get|price of|cost of|price for)\s+(?:an?\s+|the\s+|a new\s+|new\s+)?"
    r"(.+?)(?:\?|$|\s+(?:for|in canada|now|right now|this month)\b)",
    re.I,
)
_PRICE = re.compile(r"\$?\s?\d[\d,]*(?:\.\d{2})?")


_HOW_MUCH = re.compile(
    r"how much (?:is|are|does|do)\s+(?:an?\s+|the\s+)?(.+?)(?:,|\?|$| cost)", re.I
)
_LEAD = re.compile(r"^(.+?)\s*(?:\bprice\b|\bcost\b|,|\b(?:can|could|should) i\b)", re.I)


def item_from_text(text: str) -> str:
    """What the user wants to buy, from their words ("Can I afford a $499 PS5?" → "PS5",
    "iPhone 18 Pro price, can I buy it?" → "iPhone 18 Pro")."""
    item = ""
    for pattern in (_ITEM, _HOW_MUCH, _LEAD):
        found = pattern.search(text)
        candidate = _AMOUNT.sub("", found.group(1) if found else "").strip(" ?.!,")
        candidate = re.sub(r"^(?:an?|the|new)\s+", "", candidate, flags=re.I)
        if candidate and candidate.casefold() not in ("it", "one", "this", "that", "them"):
            item = candidate
            break
    item = re.sub(r"\s+", " ", item)[:40]
    return item[:1].upper() + item[1:] if item else "purchase"


def _price_in(text: str) -> str | None:
    found = _AMOUNT.search(text) or _PRICE.search(text)
    try:
        cents = parse_cad(found.group(0).replace("$", "").strip()) if found else 0
    except ValueError:
        return None
    return _plain(cents) if cents > 0 else None


def _months_ahead(today: date, months: int) -> date:
    month = today.month - 1 + months
    return date(today.year + month // 12, month % 12 + 1, 1)


async def _purchase(act: Act, ws: Workspace) -> Report:
    """Can the user buy it: the price (theirs, or asked), what it does to their money, and how
    long saving for it would take."""
    item = item_from_text(ws.goal)
    found = _AMOUNT.search(ws.goal)
    price = _price_in(found.group(0)) if found else None
    if price is None:
        await act.think(f"I need the price of the {item}")
        answer = await act.use(
            "ask_user",
            question=f"What does the {item} cost?",
            why="The price decides whether it fits this month.",
            choices=[],
            assumption="No price, so I'll show what you can spend instead",
        )
        price = _price_in(str(answer.get("answer") or ""))
    if price is None:
        overview = await act.use("money_overview")
        safe = overview["safe_to_spend"]
        return Report(
            summary=f"Tell me the price and I'll check it. Safe to spend right now is {safe}.",
            findings=[
                Finding(
                    tone="info",
                    title=f"Safe to spend: {safe}",
                    detail="What you can spend before payday without touching bills.",
                )
            ],
        )
    taxed = await act.use("price_with_tax", item=item, price=price, province=None)
    total, tax_words = price, ""
    if "error" not in taxed:
        total = _price_in(taxed["total_with_tax"]) or price
        tax_words = f" with {taxed['sales_tax']}"
    await act.think(f"Checking whether the {item} fits after bills")
    fit = await act.use("check_affordability", item=item, price=total)
    if "error" in fit:
        return Report(summary="Couldn't check that price.")
    at = f"At {fit['price']}{tax_words}"
    verdict = {
        "fits_now": Finding(
            tone="good",
            title=f"The {item} fits now",
            detail=f"{at}, chequing keeps {fit['chequing_after_bills_and_purchase']} after bills "
            "and the purchase.",
        ),
        "stretch": Finding(
            tone="watch",
            title=f"The {item} would be a stretch",
            detail=(
                f"{at}, chequing covers it ({fit['chequing_after_bills_and_purchase']} left "
                f"after bills), but this month's budget would be at "
                f"{fit['budget_left_after_purchase']}."
                if not fit["chequing_after_bills_and_purchase"].startswith("-")
                else f"{at}, chequing can't cover it after bills; it would take savings, "
                f"leaving {fit['all_cash_after_bills_and_purchase']} in all."
            ),
        ),
        "not_yet": Finding(
            tone="alert",
            title=f"The {item} doesn't fit yet",
            detail=f"{at} it's more than all your cash after bills "
            f"({fit['chequing_after_bills']} in chequing after bills).",
        ),
    }[fit["verdict"]]
    choice = ws.follow_up.casefold()
    name = item[:1].upper() + item[1:40]

    async def save_for(months: int) -> Finding | None:
        plan = await act.use("plan_savings", item=item, price=total, months=months, goal_id=None)
        if "error" in plan:
            return None
        return Finding(
            tone="info",
            title=f"Save {plan['monthly_saving']} a month for {months} months",
            detail=f"Reaches {fit['price']}{tax_words} and leaves "
            f"{plan['typical_surplus_left_after_saving']} of your typical monthly surplus.",
        )

    # The user picked one of the options: do that, rather than weighing it all again.
    if "save" in choice or "wait" in choice:
        months = 6 if ("6" in choice or "six" in choice) else 3
        plan = await save_for(months)
        await act.use(
            "draft_goal",
            name=name,
            target=total,
            target_date=_months_ahead(ws.today, months).isoformat(),
        )
        findings = [f for f in (plan, verdict) if f]
        lead = f"Here's your {months}-month plan for the {item}"
        return Report(
            summary=f"{lead}: {plan.title.lower() if plan else 'a goal'}.", findings=findings
        )
    if "buy" in choice:
        if fit["verdict"] == "not_yet":
            return Report(summary=f"{verdict.title}. {verdict.detail}", findings=[verdict])
        status = await act.use("goals_status")
        due = [
            g
            for g in ws.dashboard.savings_goals
            if g.status == "active"
            and g.monthly_needed_cents
            and g.contributed_this_month_cents == 0
            and "error" not in status
        ]
        protected = []
        for goal in due[:2]:
            drafted = await act.use(
                "draft_goal_contribution",
                goal_id=goal.id,
                amount=_plain(goal.monthly_needed_cents or 0),
            )
            if "error" not in drafted:
                protected.append(goal.name)
        ready = Finding(
            tone="good",
            title=f"You're set to buy the {item}",
            detail=f"{at}, chequing keeps {fit['chequing_after_bills_and_purchase']} after bills. "
            + (
                f"First, this month's share for {', '.join(protected)} is ready to approve."
                if protected
                else "Record it in Penny when you buy and your budgets update."
            ),
        )
        return Report(summary=f"{ready.title}. {ready.detail}", findings=[ready])

    findings = [verdict]
    if fit["verdict"] != "fits_now":
        for months in (3, 6):
            plan = await save_for(months)
            if plan:
                findings.append(plan)
        await act.use(
            "draft_goal",
            name=name,
            target=total,
            target_date=_months_ahead(ws.today, 3).isoformat(),
        )
    return Report(summary=f"{verdict.title}. {verdict.detail}", findings=findings)


async def planner(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    if kind == "purchase":
        return await _purchase(act, ws)
    d, f = ws.dashboard, ws.facts
    findings: list[Finding] = []
    await act.think("Looking at your goals and what you can set aside")
    status = await act.use("goals_status")
    room = ws.coach.account_total("chequing") - ws.coach.unpaid_bills_cents - CUSHION_CENTS

    if kind == "life_event":
        name, cents, when = _goal_from_text(ws)
        if cents is None:
            await act.think("No amount given: starting from first and last month's rent")
            rent = await _expected_rent(act, ws, name)
            estimate = await act.use("move_cost_estimate", monthly_rent=rent)
            if "error" not in estimate:
                cents = parse_cad(estimate["first_and_last_month"].replace("$", ""))
                if "rent_change_per_month" in estimate:
                    findings.append(
                        Finding(
                            tone="watch" if estimate["rent_goes"] == "up" else "good",
                            title=f"Rent goes {estimate['rent_goes']} "
                            f"{estimate['rent_change_per_month']} a month",
                            detail=f"{estimate['new_rent']} there vs {estimate['current_rent']} "
                            "now: plan your monthly budget around it.",
                        )
                    )
        if cents:
            await act.use(
                "draft_goal",
                name=name,
                target=_plain(cents),
                target_date=when.isoformat() if when else None,
            )
            if when:
                monthly = -(-cents // _months_until(ws.today, when))
                shown = f.money(f"Monthly saving for {name}", monthly, "plan")
                surplus = status["typical_monthly_surplus"]
                findings.append(
                    Finding(
                        tone="good" if monthly <= ws.coach.typical_surplus_cents else "watch",
                        title=f"{name}: {shown} a month",
                        detail=f"Gets you to {format_cad(cents)} by {when:%B %Y}; "
                        f"your typical surplus is {surplus}.",
                    )
                )
                payday = d.pay.upcoming[0].on if d.pay and d.pay.upcoming else None
                if payday:
                    await act.use(
                        "set_reminder",
                        title=f"Move {shown} to {name}",
                        detail="Right after payday, before it gets spent.",
                        due_on=payday.isoformat(),
                    )
        else:
            findings.append(
                Finding(tone="info", title="How much will it cost?", detail="Tell me the amount.")
            )
    else:
        goals = [g for g in d.savings_goals if g.status == "active" and g.monthly_needed_cents]
        goals.sort(key=lambda g: g.target_date or date.max)
        for goal in goals:
            needed = goal.monthly_needed_cents or 0
            await act.use("project_goal", goal_id=goal.id, monthly_contribution=_plain(needed))
            if needed <= room:
                findings.append(
                    Finding(
                        tone="good",
                        title=f"Put {format_cad(needed)} toward {goal.name}",
                        detail="That's this month's share to stay on track, and chequing keeps "
                        f"{format_cad(CUSHION_CENTS)} or more after bills.",
                    )
                )
                f.money("Cushion kept in chequing", CUSHION_CENTS, "policy")
                await act.use("draft_goal_contribution", goal_id=goal.id, amount=_plain(needed))
                break
        else:
            if goals:
                findings.append(
                    Finding(
                        tone="watch",
                        title="No room for goal savings this month",
                        detail="Chequing after bills is below the cushion Penny keeps.",
                    )
                )
        hot = [b for b in d.budgets if b.remaining_cents < 0]
        if hot:
            budget = min(hot, key=lambda b: b.remaining_cents)
            cut = round_up(-budget.remaining_cents)
            await act.think(f"What trimming {budget.category_name} would free up")
            result = await act.use(
                "simulate_spending_cut",
                category=budget.category_name,
                monthly_cut=_plain(cut),
                goal_id=None,
            )
            if "error" not in result:
                findings.append(
                    Finding(
                        tone="watch",
                        title=f"Trim {budget.category_name} by {result['monthly_cut']} a month",
                        detail=f"Frees {result['yearly_savings']} a year.",
                    )
                )
    summary = "; ".join(f.title for f in findings[:2]) or "Your goals are on track."
    return Report(summary=summary, findings=findings)


async def benefits(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    await act.think("Screening you for Canadian benefits and credits")
    screen = await act.use("benefits_screen")
    findings: list[Finding] = []
    for match in screen["matches"]:
        detail = match["why"] + (f" Up to {match['up_to']}." if match["up_to"] else "")
        findings.append(
            Finding(
                tone="good" if match["status"] == "likely" else "info",
                title=match["name"],
                detail=f"{detail} {match['how']}",
            )
        )
    deadline = date.fromisoformat(screen["tax_filing_deadline"])
    await act.use(
        "set_reminder",
        title="Start your tax return",
        detail=f"Filing by {deadline:%B} {deadline.day} is what unlocks most benefits.",
        due_on=(deadline - timedelta(days=30)).isoformat(),
    )
    await act.use("recommend_guide", guide_id="benefits", why="Benefits Penny screened you for.")
    if any(m["id"] == "student_grant" for m in screen["matches"]):
        await act.use("recommend_guide", guide_id="student-loans", why="Grants first, then loans.")
    likely = sum(1 for m in screen["matches"] if m["status"] == "likely")
    summary = (
        f"{count(likely, 'benefit')} look likely and {len(screen['matches']) - likely} more are "
        "worth checking. Filing a tax return unlocks most of them."
    )
    return Report(summary=summary, findings=findings[:5])


async def people(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    await act.think("Checking who owes you")
    owed = await act.use("who_owes_me")
    findings: list[Finding] = []
    for person in owed["people"]:
        if person["direction"] == "owes you":
            findings.append(
                Finding(
                    tone="watch",
                    title=f"{person['name']} owes you {person['amount']}",
                    detail="A friendly reminder is set for tomorrow.",
                )
            )
            await act.use(
                "set_reminder",
                title=f"Ask {person['name']} for {person['amount']}",
                detail="From your shared costs in Penny.",
                due_on=(ws.today + timedelta(days=1)).isoformat(),
            )
        else:
            findings.append(
                Finding(
                    tone="info",
                    title=f"You owe {person['name']} {person['amount']}",
                    detail="Settle up from Accounts when you're ready.",
                )
            )
    summary = (
        f"{count(len(findings), 'open balance')} with friends."
        if findings
        else "Nobody owes you money, and you don't owe anyone."
    )
    if not findings:
        findings.append(Finding(tone="good", title="All settled up", detail=summary))
    return Report(summary=summary, findings=findings)


async def tutor(act: Act, ws: Workspace, kind: MissionKind) -> Report:
    d = ws.dashboard
    await act.think("Matching lessons to what the other agents will look at")
    await act.use("learning_progress")
    queries: list[tuple[str, str]] = []
    if kind == "life_event":
        queries.append(("rent", "You're planning a move: renting costs and leases."))
    if kind == "free_money":
        queries.append(("tax", "Filing is what unlocks benefits."))
    if any(b.remaining_cents < 0 for b in d.budgets):
        queries.append(("budgeting", "A category went over budget this month."))
    if d.credit and d.credit.balance_cents:
        queries.append(("credit", "You carry a card balance."))
    queries.append(("saving", "Goals move faster with a plan."))
    assigned: list[str] = []
    for query, why in queries:
        if len(assigned) == 2:
            break
        found = await act.use("find_lessons", query=query)
        lesson = next((x for x in found.get("lessons", []) if not x["locked"]), None)
        if lesson and lesson["title"] not in assigned:
            await act.use("assign_lesson", lesson_id=lesson["id"], why=why)
            assigned.append(lesson["title"])
    if not assigned:
        await act.use("recommend_guide", guide_id="budgeting", why="A good place to start.")
    summary = (
        f"Added {count(len(assigned), 'lesson')} to your plan: {', '.join(assigned)}."
        if assigned
        else "Recommended the budgeting guide to start."
    )
    return Report(
        summary=summary,
        findings=[
            Finding(tone="info", title=title, detail="Added to your learning plan.")
            for title in assigned
        ],
    )


# ------------------------------------------------------------------ follow-ups (second wave)


def close_gap(shortfall: str) -> Playbook:
    """Analyst, after the Cash-flow guard found chequing running short: where could it come
    from next month?"""

    async def run(act: Act, ws: Workspace, kind: MissionKind) -> Report:
        await act.think(f"Looking for spending that could close the {shortfall} gap")
        await act.use("spending_by_category")
        wants = [
            c
            for c in ws.dashboard.category_spending
            if c.category_id and c.category_id not in NEED_CATEGORIES and c.spent_cents > 0
        ]
        if not wants:
            return Report(summary="No flexible spending to trim this month.")
        top = max(wants, key=lambda c: c.spent_cents)
        gap = parse_cad(shortfall.replace("$", ""))
        cut = min(round_up(gap), top.spent_cents)
        result = await act.use(
            "simulate_spending_cut",
            category=top.category_name,
            monthly_cut=_plain(cut),
            goal_id=None,
        )
        if "error" in result:
            return Report(summary="Couldn't test a cut this time.")
        finding = Finding(
            tone="watch",
            title=f"Trim {top.category_name} by {result['monthly_cut']}",
            detail=f"It's your biggest flexible category ({result['spent_this_month']} this "
            f"month); the cut frees {result['yearly_savings']} a year.",
        )
        return Report(summary=finding.title + " to stop it happening again.", findings=[finding])

    return run


def benefit_to_goal(benefit: str, up_to: str, goal: str, target: str) -> Playbook:
    """Planner, after the Benefits finder found money the user may get: point it at a goal."""

    async def run(act: Act, ws: Workspace, kind: MissionKind) -> Report:
        await act.think(f"Planning where the {benefit} could go")
        await act.use("goals_status")
        deadline = benefit_rules.tax_deadline(ws.today)
        covers = parse_cad(up_to.replace("$", "")) >= parse_cad(target.replace("$", ""))
        await act.use(
            "set_reminder",
            title=f"If the {benefit} arrives, put it toward {goal}",
            detail=f"Up to {up_to} if you qualify; it usually comes after you file.",
            due_on=(deadline + timedelta(days=30)).isoformat(),
        )
        finding = Finding(
            tone="good",
            title=f"The {benefit} could fund {goal}"
            if covers
            else f"The {benefit} could boost {goal}",
            detail=f"Up to {up_to} if you qualify, against a {target} target. A reminder is "
            "set for when it would arrive.",
        )
        return Report(summary=finding.title + ".", findings=[finding])

    return run


# ------------------------------------------------------------------ the team

READ_COMMON = ("money_overview",)

TEAM: dict[AgentId, Subagent] = {
    agent.id: agent
    for agent in (
        Subagent(
            "analyst",
            "Analyst",
            "🔎",
            "Finds patterns, overspending, and subscriptions in your spending.",
            (*READ_COMMON, "spending_by_category", "subscriptions_and_bills"),
            analyst,
            light=True,
        ),
        Subagent(
            "cashflow",
            "Cash-flow guard",
            "🛡️",
            "Walks your balance through upcoming bills and paydays, and covers gaps.",
            (
                *READ_COMMON,
                "cash_forecast",
                "subscriptions_and_bills",
                "credit_card_payment",
                "draft_transfer",
                "set_reminder",
            ),
            cashflow,
            light=True,
        ),
        Subagent(
            "planner",
            "Planner",
            "🧭",
            "Turns goals into budgets, savings, and a schedule.",
            (
                *READ_COMMON,
                "goals_status",
                "project_goal",
                "simulate_spending_cut",
                "check_affordability",
                "price_with_tax",
                "plan_savings",
                "spending_by_category",
                "move_cost_estimate",
                "draft_goal",
                "draft_goal_contribution",
                "draft_budget",
                "set_reminder",
                "ask_user",
                "web_research",
            ),
            planner,
        ),
        Subagent(
            "benefits",
            "Benefits finder",
            "🎁",
            "Screens you for Canadian benefits, credits, and student aid.",
            ("benefits_screen", "set_reminder", "recommend_guide", "web_research"),
            benefits,
            light=True,
        ),
        Subagent(
            "people",
            "People",
            "🤝",
            "Keeps track of who owes whom, and reminds you.",
            ("who_owes_me", "set_reminder"),
            people,
            thinks=False,
        ),
        Subagent(
            "tutor",
            "Tutor",
            "🎓",
            "Picks lessons for the gaps the mission turns up.",
            ("learning_progress", "find_lessons", "assign_lesson", "recommend_guide"),
            tutor,
            thinks=False,
        ),
    )
}


RULES = """You are one of Penny's subagents, working on a mission for a Canadian student or young
adult. Penny is an educational money app with fictional data; it never connects to a bank.
Rules:
- Do the work yourself. Start by calling your tools. When something is unknown, make a
  sensible assumption and say what you assumed (a month already past this year means next
  year's). If you have ask_user and the answer would really change your plan (their expected
  rent somewhere new, their co-op pay), ask ONE short question with 2 to 4 choices instead.
- Get every figure from your tools. Never calculate, estimate, or invent an amount. When you
  need a number, call the tool that works it out. If you have web_research, use it for current
  outside facts Penny can't know (a city's typical rent, a program's deadline), then pass the
  figure it found to a tool; say that it's from the web.
- Act, don't just advise: draft the changes that clearly help (the user approves them), and set
  reminders, lessons, and guides (those happen automatically).
- Commit: finish the job on your stated assumptions. Never call your plan partial or leave
  things "to confirm" in your report; the user can change any draft before approving it.
- Draft amounts must be figures a tool returned, the web found, or the user wrote.
- Don't suggest anything Penny's memory says the user turned down.
- Recurring bills are planned outside budgets; a category's spending can include them.
- No individual investment, tax, legal, or credit advice: say what's worth checking, and why.
- Be sharp and plain. Every figure a tool or web search gives you is checked: state it. Never
  call figures unverified or estimates, and never tell the user to confirm a price or tax.
  The user's city and province are given: use them, never assume another.
- Call tools that don't depend on each other together, in the same turn: every extra turn
  re-sends the whole conversation.
- At most 7 tool calls, then your report: a summary of one or two short sentences and up to 4
  findings (tone: good, watch, alert, or info). Titles under 8 words, details under 25 words.
"""

# What some agents do differently with a model (a playbook does the same in code).
PLAYS: dict[str, str] = {
    "planner": "For a move, do all of these before your report: 1) web_research the typical rent "
    "there; 2) ask_user what rent they expect, offering the researched figure as a choice; "
    "3) move_cost_estimate with that monthly_rent; 4) draft_goal named 'Move to <City>' with "
    "its first_and_last_month as the target and the move month as the date; 5) set_reminder "
    "for right after the next payday to start saving toward it. As a follow-up with money "
    "found by a teammate, set a reminder to put it toward the goal it fits.",
    "planner_purchase": (
        "For a purchase: 1) web_research the item's current price at a major Canadian "
        "retailer (Apple Canada, Best Buy; the exact model and storage the user named); 2) "
        "price_with_tax with that price (the user's province is on file: never assume another"
        " one); 3) check_affordability with the total with tax; 4) plan_savings over 3 and 6 "
        "months with that total; 5) if it doesn't fit now, draft_goal for it with the total "
        "as the target. If the user picked an option, do that instead: saving → plan_savings "
        "for those months and draft_goal; buying → check_affordability and "
        "draft_goal_contribution for any goal still owed this month; a cheaper model → "
        "web_research one and run steps 2 to 4 on it. Findings: the price and where it's "
        "from, the total with tax, the verdict with what's left, and the plan. Never call "
        "figures unverified or ask the user to confirm the price or tax. Name a goal after the "
        "exact model they asked about (iPhone 18 Pro Max, not iPhone 18 Pro)."
    ),
    "benefits": "After benefits_screen, use web_research once to check the most valuable match's "
    "current amount or deadline, and cite it.",
}


def instructions_for(agent: Subagent, kind: MissionKind | None = None) -> str:
    play = PLAYS.get(f"{agent.id}_{kind}") or PLAYS.get(agent.id)
    return f"{RULES}\nYou are the {agent.name}: {agent.role}" + (f"\n{play}" if play else "")
