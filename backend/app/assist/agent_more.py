"""Everything else Penny's agent can do: edit and delete, bills and pay, transfers and settling
up, accounts, categories, groups, coaching style, and the app itself (open a page, change the
look, hide amounts, sound, or hand a question to Penny AI).

Like app.assist.agent, the model only names the thing and copies values as said; this module
checks each one against the user's data and words every line from it.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import TYPE_CHECKING, Literal

from app.agent_models import (
    AccountNewAction,
    AccountUpdateAction,
    AgentAction,
    AgentStep,
    AppStep,
    BillNewAction,
    BillPaidAction,
    BillUpdateAction,
    CategoryNewAction,
    DeleteAction,
    FriendRef,
    GoalUpdateAction,
    GroupNewAction,
    PayNewAction,
    PayReceivedAction,
    PersonaAction,
    TransactionUpdateAction,
    TransferAction,
)
from app.coach.facts import parse_cad
from app.domain.finance import format_cad
from app.store.sections import next_due_after

if TYPE_CHECKING:
    from app.assist.agent import Context, Intent

DATA_KINDS = (
    "goal_update",
    "transfer",
    "settle",
    "bill_new",
    "bill_paid",
    "bill_update",
    "transaction_update",
    "account_new",
    "account_update",
    "category_new",
    "pay_new",
    "pay_received",
    "group_new",
    "persona",
    "delete",
)
APP_KINDS = ("navigate", "theme", "palette", "surface", "hide_amounts", "sound", "ask")
VIEWS = {
    "today": "Home",
    "spending": "Spending",
    "charts": "Charts",
    "accounts": "Accounts",
    "recurring": "Bills",
    "goals": "Goals",
    "budgets": "Budgets",
    "learn": "Learn",
    "ai": "Penny AI",
    "settings": "Settings",
}
THEMES = ("light", "dark", "system")
PALETTES = ("original", "graphite", "noir", "emerald", "sapphire", "bordeaux", "pearl")
SURFACES = ("classic", "glass", "soft", "clay", "flat", "halo")
DELETE_TARGETS = (
    "transaction",
    "bill",
    "goal",
    "budget",
    "account",
    "category",
    "transfer",
    "pay",
    "group",
)
BILL_FREQUENCIES = ("weekly", "biweekly", "monthly", "yearly")
PAY_FREQUENCIES = ("weekly", "biweekly", "semimonthly", "monthly")
ACCOUNT_TYPES = ("chequing", "savings", "cash", "credit", "investment", "other")
PERSONAS = ("student", "working", "learner")

Built = tuple[AgentStep | None, AppStep | None, str | None]


def _cents(amount: str) -> int | None:
    try:
        cents = parse_cad(amount.strip())
    except ValueError:
        return None
    return cents if cents > 0 else None


def _day(value: date) -> str:
    return f"{value:%a, %b} {value.day}"


_GENERIC = {"fund", "goal", "savings", "saving", "the", "and", "for", "bill", "account", "plan"}


def _words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.casefold()) if len(w) > 2} - _GENERIC


def _pick(items: list, target_id: str | None, name: str, label) -> object | None:  # type: ignore[type-arg]
    """An item by id, else the one sharing the most words with what the user said (if only one
    does)."""
    by_id = next((item for item in items if item.id == target_id), None) if target_id else None
    if by_id is not None:
        return by_id
    said = _words(name)
    scored = sorted(
        ((len(said & _words(label(item))), i) for i, item in enumerate(items)), reverse=True
    )
    if not scored or scored[0][0] == 0 or (len(scored) > 1 and scored[1][0] == scored[0][0]):
        return None
    return items[scored[0][1]]


def _step(index: int, emoji: str, title: str, lines: list[str | None], action: AgentAction):
    return AgentStep(
        id=f"step-{index}",
        emoji=emoji,
        title=title,
        lines=[line for line in lines if line],
        action=action,
    )


def build_app(intent: Intent) -> AppStep | str:
    """A step the app runs on this device, or a question when it can't tell what to do."""
    value = (intent.option or "").strip().casefold()
    if intent.kind == "navigate":
        if value not in VIEWS:
            return "Which page should I open?"
        return AppStep(kind="navigate", value=value, title=f"Open {VIEWS[value]}", emoji="🧭")
    if intent.kind == "theme":
        if value not in THEMES:
            return "Light, dark, or match your device?"
        label = "Match your device" if value == "system" else f"Switch to {value} mode"
        return AppStep(kind="theme", value=value, title=label, emoji="🌗")
    if intent.kind == "palette":
        if value not in PALETTES:
            return f"Which colour style? {', '.join(p.capitalize() for p in PALETTES)}."
        title = f"Colour style: {value.capitalize()}"
        return AppStep(kind="palette", value=value, title=title, emoji="🎨")
    if intent.kind == "surface":
        if value not in SURFACES:
            return f"Which card style? {', '.join(s.capitalize() for s in SURFACES)}."
        title = f"Card style: {value.capitalize()}"
        return AppStep(kind="surface", value=value, title=title, emoji="🪟")
    if intent.kind in ("hide_amounts", "sound"):
        on = value in ("on", "true", "yes", "hide")
        if intent.kind == "hide_amounts":
            title = "Hide amounts" if on else "Show amounts"
            return AppStep(
                kind="hide_amounts", value="on" if on else "off", title=title, emoji="🙈"
            )
        title = "Sound on" if on else "Sound off"
        return AppStep(kind="sound", value="on" if on else "off", title=title, emoji="🔊")
    question = (intent.text or intent.description).strip()
    if not question:
        return "What should I ask Penny AI?"
    shown = question if len(question) <= 70 else f"{question[:67]}…"
    return AppStep(kind="ask", value=question[:300], title=f"Ask Penny AI: “{shown}”", emoji="💬")


def build_data(ctx: Context, index: int, intent: Intent) -> tuple[AgentStep | None, str | None]:
    """A checked step for one of DATA_KINDS, or a question."""
    dash = ctx.dashboard
    cents = _cents(intent.amount)
    today = ctx.today
    on = intent.occurred_on if intent.occurred_on and intent.occurred_on <= today else today
    option = (intent.option or "").strip().casefold()
    own = [a for a in dash.accounts if a.account_type != "person"]
    friends = [a for a in dash.accounts if a.account_type == "person"]

    if intent.kind == "goal_update":
        goal = _pick(dash.savings_goals, intent.target_id, intent.description, lambda g: g.name)
        if goal is None:
            return None, "Which goal?"
        status = option if option in ("active", "paused", "completed") else None
        name = (intent.text or "").strip()[:100] or None
        target_date = (
            intent.target_date if intent.target_date and intent.target_date > today else None
        )
        if not any((status, name, cents, target_date)):
            return None, f"What should I change about {goal.name}?"
        lines = [
            f"Name: {goal.name} → {name}" if name else None,
            f"Target: {format_cad(goal.target_cents)} → {format_cad(cents)}" if cents else None,
            f"Target date: {_day(target_date)}, {target_date.year}" if target_date else None,
            {"paused": "Paused: Penny stops counting on it until you resume",
             "active": "Back on: Penny plans for it again",
             "completed": "Marked as reached 🎉"}.get(status or ""),
        ]  # fmt: skip
        title = {"paused": f"Pause {goal.name}", "active": f"Resume {goal.name}"}.get(
            status or "", f"Update {goal.name}"
        )
        action = GoalUpdateAction(
            goal_id=goal.id, name=name, target_cents=cents, target_date=target_date, status=status
        )
        return _step(index, "🐷", title, lines, action), None

    if intent.kind in ("transfer", "settle"):
        if intent.kind == "settle":
            friend = _pick(
                friends,
                intent.target_id,
                " ".join(intent.friend_names) or intent.description,
                lambda f: f.name,
            )
            if friend is None:
                return None, "Who are you settling up with?"
            home = ctx.default_account
            if home is None:
                return None, "Add a chequing account first."
            they_pay = (
                option != "i_paid"
                if option in ("they_paid", "i_paid")
                else friend.balance_cents > 0
            )
            owed = abs(friend.balance_cents)
            amount = cents or owed
            if not amount:
                return None, f"You and {friend.name} are already settled up. How much was it?"
            source, target = (friend.id, home) if they_pay else (home, friend.id)
            title = f"{friend.name} paid you back" if they_pay else f"Pay {friend.name} back"
            left = owed - amount if amount <= owed else 0
            lines = [
                f"{format_cad(amount)} {'into' if they_pay else 'from'} {ctx.account_name(home)}",
                f"Still owed after this: {format_cad(left)}" if owed and left else None,
                "All settled up after this ✅" if owed and not left else None,
            ]
            action = TransferAction(
                from_account_id=source, to_account_id=target, amount_cents=amount, occurred_on=on
            )
            return _step(index, "🤝", title, lines, action), None
        source_id = intent.account_id or ctx.default_account
        target = next((a for a in own if a.id == intent.to_account_id), None)
        if target is None:
            return None, "Which account should the money go to?"
        if not source_id or source_id == target.id:
            return None, "Which account should the money come from?"
        amount = cents
        if amount is None and target.account_type == "credit" and target.balance_cents > 0:
            amount = target.balance_cents  # "pay off my card": what's owed on it
        if amount is None:
            return None, f"How much should I move to {target.name}?"
        title = f"Pay {target.name}" if target.account_type == "credit" else "Move money"
        lines = [
            f"{format_cad(amount)} from {ctx.account_name(source_id)} to {target.name}",
            "Pays it off in full" if target.account_type == "credit"
            and amount == target.balance_cents else None,
        ]  # fmt: skip
        action = TransferAction(
            from_account_id=source_id, to_account_id=target.id, amount_cents=amount, occurred_on=on
        )
        return _step(index, "🔁", title, lines, action), None

    if intent.kind == "bill_new":
        name = intent.description.strip()[:80]
        if not name:
            return None, "What's the bill called?"
        if cents is None:
            return None, f"How much is {name}?"
        account = intent.account_id or ctx.default_account
        if not account:
            return None, "Add a chequing account first."
        frequency = option if option in BILL_FREQUENCIES else "monthly"
        next_due = intent.occurred_on if intent.occurred_on and intent.occurred_on > today else None
        guessed = next_due is None
        next_due = next_due or next_due_after(today, frequency)  # type: ignore[arg-type]
        category = (
            intent.category_id if ctx.category_kind(intent.category_id) == "spending" else None
        )
        action = BillNewAction(
            name=name,
            amount_cents=cents,
            category_id=category,
            account_id=account,
            frequency=frequency,  # type: ignore[arg-type]
            next_due=next_due,
        )
        lines = [
            f"{format_cad(cents)} {frequency} from {ctx.account_name(account)}",
            f"Next due {_day(next_due)}" + (" (change it if that's wrong)" if guessed else ""),
        ]
        return _step(index, "📅", f"Add bill: {name}", lines, action), None

    if intent.kind in ("bill_paid", "bill_update"):
        bill = _pick(dash.bills, intent.target_id, intent.description, lambda b: b.name)
        if bill is None:
            return None, "Which bill?"
        if intent.kind == "bill_paid":
            lines = [f"{format_cad(bill.amount_cents)} from {ctx.account_name(bill.account_id)}"]
            return _step(
                index, "✅", f"Mark {bill.name} paid", lines, BillPaidAction(bill_id=bill.id)
            ), None
        frequency = option if option in BILL_FREQUENCIES else None
        next_due = intent.occurred_on if intent.occurred_on and intent.occurred_on > today else None
        if not any((cents, frequency, next_due)):
            return None, f"What should I change about {bill.name}?"
        lines = [
            f"Amount: {format_cad(bill.amount_cents)} → {format_cad(cents)}" if cents else None,
            f"Repeats {frequency}" if frequency else None,
            f"Next due {_day(next_due)}" if next_due else None,
        ]
        action = BillUpdateAction(
            bill_id=bill.id,
            amount_cents=cents,
            next_due=next_due,
            frequency=frequency,  # type: ignore[arg-type]
        )
        return _step(index, "📅", f"Update {bill.name}", lines, action), None

    if intent.kind == "transaction_update":
        recent = dash.transactions
        tx = _pick(recent, intent.target_id, intent.description, lambda t: t.description)
        if tx is None:
            return None, "Which transaction?"
        category = intent.category_id if ctx.category_kind(intent.category_id) == tx.kind else None
        text = (intent.text or "").strip()[:160] or None
        when = intent.occurred_on if intent.occurred_on and intent.occurred_on <= today else None
        if not any((category, text, cents, when)):
            return None, f"What should I change about {tx.description}?"
        lines = [
            f"Category: {tx.category} → {ctx.category_name(category)}" if category else None,
            f"Amount: {format_cad(tx.amount_cents)} → {format_cad(cents)}" if cents else None,
            f"Name: {tx.description} → {text}" if text else None,
            f"Date: {_day(when)}" if when else None,
        ]
        action = TransactionUpdateAction(
            transaction_id=tx.id,
            description=text,
            amount_cents=cents,
            category_id=category,
            occurred_on=when,
        )
        return _step(index, "✏️", f"Edit {tx.description}", lines, action), None

    if intent.kind == "account_new":
        name = intent.description.strip()[:60]
        kind = option if option in ACCOUNT_TYPES else "chequing"
        if not name:
            return None, "What should I call the account?"
        limit = _cents(intent.amount2)
        if kind == "credit" and limit is None:
            return None, f"What's the credit limit on {name}?"
        action = AccountNewAction(
            name=name,
            account_type=kind,  # type: ignore[arg-type]
            balance_cents=cents or 0,
            credit_limit_cents=limit if kind == "credit" else None,
        )
        owed = "owed" if kind == "credit" else "balance"
        lines = [
            f"{kind.capitalize()} · {format_cad(cents or 0)} {owed}",
            f"Limit {format_cad(limit)}" if kind == "credit" and limit else None,
        ]
        return _step(index, "🏦", f"Add account: {name}", lines, action), None

    if intent.kind == "account_update":
        account = _pick(own, intent.target_id, intent.description, lambda a: a.name)
        if account is None:
            return None, "Which account?"
        name = (intent.text or "").strip()[:60] or None
        balance = cents if cents is not None or intent.amount.strip() in ("0", "$0") else None
        if intent.amount.strip() in ("0", "$0", "0.00"):
            balance = 0
        if name is None and balance is None:
            return None, f"What should I change about {account.name}?"
        lines = [
            f"Name: {account.name} → {name}" if name else None,
            f"Balance: {format_cad(account.balance_cents)} → {format_cad(balance)}"
            if balance is not None
            else None,
        ]
        action = AccountUpdateAction(account_id=account.id, name=name, balance_cents=balance)
        return _step(index, "🏦", f"Update {account.name}", lines, action), None

    if intent.kind == "category_new":
        name = intent.description.strip()[:40]
        if not name:
            return None, "What should the category be called?"
        kind: Literal["income", "spending"] = "income" if option == "income" else "spending"
        parent = intent.category_id if ctx.category_kind(intent.category_id) == kind else None
        action = CategoryNewAction(name=name, category_kind=kind, parent_id=parent)
        lines = [f"Under {ctx.category_name(parent)}" if parent else f"A new {kind} category"]
        return _step(index, "🏷️", f"Add category: {name}", lines, action), None

    if intent.kind == "pay_new":
        name = intent.description.strip()[:80] or "Paycheque"
        if cents is None:
            return None, f"How much is each {name.lower()}?"
        account = intent.account_id or ctx.default_account
        if not account:
            return None, "Add a chequing account first."
        frequency = option if option in PAY_FREQUENCIES else "biweekly"
        payday = intent.occurred_on if intent.occurred_on and intent.occurred_on >= today else None
        guessed = payday is None
        step = {"weekly": 7, "biweekly": 14, "semimonthly": 15, "monthly": 30}[frequency]
        payday = payday or today + timedelta(days=step)
        action = PayNewAction(
            name=name,
            amount_cents=cents,
            account_id=account,
            frequency=frequency,  # type: ignore[arg-type]
            next_payday=payday,
        )
        lines = [
            f"{format_cad(cents)} {frequency} into {ctx.account_name(account)}",
            f"Next payday {_day(payday)}" + (" (change it if that's wrong)" if guessed else ""),
        ]
        return _step(index, "💼", f"Add pay: {name}", lines, action), None

    if intent.kind == "pay_received":
        sources = dash.pay.sources if dash.pay else []
        source = _pick(sources, intent.target_id, intent.description, lambda p: p.name) or (
            sources[0] if len(sources) == 1 else None
        )
        if source is None:
            return None, "Which pay was it?" if sources else "Set up your pay first."
        amount = cents or source.amount_cents
        lines = [
            f"{format_cad(amount)} into {ctx.account_name(source.account_id)} · {_day(on)}",
            "More than usual 🎉" if amount > source.amount_cents else None,
        ]
        action = PayReceivedAction(pay_id=source.id, amount_cents=amount, occurred_on=on)
        return _step(index, "💰", f"I got paid: {source.name}", lines, action), None

    if intent.kind == "group_new":
        name = intent.description.strip()[:60]
        names = [n.strip()[:60] for n in intent.friend_names if n.strip()]
        if not name or not names:
            return None, "Who's in the group, and what should I call it?"
        refs = []
        for friend_name in dict.fromkeys(names):
            match = next((f for f in friends if f.name.casefold() == friend_name.casefold()), None)
            refs.append(
                FriendRef(id=match.id, name=match.name) if match else FriendRef(name=friend_name)
            )
        new = [r.name for r in refs if r.id is None]
        lines = [
            ", ".join(r.name for r in refs),
            f"Adds {', '.join(new)} to your friends" if new else None,
        ]
        action = GroupNewAction(name=name, friends=refs)
        return _step(index, "👥", f"Make a group: {name}", lines, action), None

    if intent.kind == "persona":
        if option not in PERSONAS:
            return None, "Are you a student, working, or learning first?"
        label = {"student": "a student", "working": "working", "learner": "learning first"}[option]
        lines = ["Changes Home, Learn, and Penny AI's coaching"]
        action = PersonaAction(persona=option)  # type: ignore[arg-type]
        return _step(index, "🎓", f"Coach me as {label}", lines, action), None

    # delete
    target = option if option in DELETE_TARGETS else (intent.target_type or "")
    pools = {
        "transaction": (dash.transactions, lambda t: t.description),
        "bill": (dash.bills, lambda b: b.name),
        "goal": (dash.savings_goals, lambda g: g.name),
        "budget": (dash.budgets, lambda b: b.category_name),
        "account": (dash.accounts, lambda a: a.name),
        "category": ([c for c in dash.categories if c.custom], lambda c: c.name),
        "transfer": (dash.transfers, lambda t: t.note or ""),
        "pay": (dash.pay.sources if dash.pay else [], lambda p: p.name),
        "group": (dash.splits.groups if dash.splits else [], lambda g: g.name),
    }
    if target not in pools:
        return None, "What should I delete?"
    items, label_of = pools[target]
    found = _pick(list(items), intent.target_id, intent.description, label_of)
    if (
        found is None
        and target == "transaction"
        and intent.description.casefold()
        in (
            "last",
            "latest",
            "last transaction",
            "",
        )
    ):
        found = items[0] if items else None  # newest first
    if found is None:
        return None, f"Which {target} should I delete?"
    label = label_of(found) or target
    amount = getattr(found, "amount_cents", None)
    shown = f"{label} ({format_cad(amount)})" if isinstance(amount, int) else label
    action = DeleteAction(target=target, target_id=found.id, label=shown[:160])  # type: ignore[arg-type]
    lines = ["You can undo this right after"]
    return _step(index, "🗑️", f"Delete {shown}", lines, action), None


# ------------------------------------------------------------------ built-in reading

_PAGES = {
    "home": "today",
    "today": "today",
    "spending": "spending",
    "transactions": "spending",
    "charts": "charts",
    "accounts": "accounts",
    "bills": "recurring",
    "subscriptions": "recurring",
    "recurring": "recurring",
    "goals": "goals",
    "budgets": "budgets",
    "budget": "budgets",
    "learn": "learn",
    "lessons": "learn",
    "settings": "settings",
    "coach": "ai",
    "chat": "ai",
    "penny": "ai",
}
_QUESTION = re.compile(
    r"^(can|could|should|how|why|what|when|am|is|are|do|does|will|would|which|where)\b", re.I
)


def is_question(text: str) -> bool:
    clean = text.strip()
    return clean.endswith("?") or bool(_QUESTION.match(clean))


def rule_more(clause: str, ctx: Context, make) -> Intent | None:  # type: ignore[no-untyped-def]
    """Built-in reading of the app and account commands. `make` builds an Intent."""
    lower = clause.casefold().strip()
    dash = ctx.dashboard
    if re.search(r"\b(dark|light)\s*(mode|theme)\b", lower):
        return make(kind="theme", option=re.search(r"\b(dark|light)", lower).group(1))  # type: ignore[union-attr]
    if re.search(r"\bmatch (my )?(device|system|phone)\b", lower):
        return make(kind="theme", option="system")
    palette = next((p for p in PALETTES if re.search(rf"\b{p}\b", lower)), None)
    if palette and re.search(r"\b(colou?rs?|theme|style|palette|look)\b", lower):
        return make(kind="palette", option=palette)
    if re.search(r"\b(hide|blur)\b.*\b(amounts?|balances?|numbers|money)\b", lower):
        return make(kind="hide_amounts", option="on")
    if re.search(r"\b(show|unhide|unblur)\b.*\b(amounts?|balances?|numbers)\b", lower):
        return make(kind="hide_amounts", option="off")
    if re.search(r"\b(mute|sounds? off|turn off (the )?sounds?)\b", lower):
        return make(kind="sound", option="off")
    if re.search(r"\b(unmute|sounds? on|turn on (the )?sounds?)\b", lower):
        return make(kind="sound", option="on")
    persona = re.search(
        r"\b(?:i'?m|i am|coach me as)\s+(?:a |an )?(student|working|learner)", lower
    )
    if persona:
        return make(kind="persona", option=persona.group(1))
    page = re.match(r"(?:open|go to|show me|take me to|show)\s+(?:my\s+|the\s+)?([a-z ]+)", lower)
    if page:
        word = next((w for w in page.group(1).split() if w in _PAGES), None)
        if word:
            return make(kind="navigate", option=_PAGES[word])
    back = re.search(r"\b([a-z]+) paid me back\b", lower) or re.search(
        r"\bpaid ([a-z]+) back\b", lower
    )
    if back:
        they = "paid me back" in lower
        amount = re.search(r"\$?(\d+(?:\.\d{1,2})?)", lower)
        return make(
            kind="settle",
            friend_names=[back.group(1)],
            option="they_paid" if they else "i_paid",
            amount=amount.group(1) if amount else "",
        )
    if re.search(r"\bpay (off )?(my )?(credit )?card\b", lower):
        card = next((a for a in dash.accounts if a.account_type == "credit"), None)
        if card:
            amount = re.search(r"\$?(\d+(?:\.\d{1,2})?)", lower)
            return make(
                kind="transfer", to_account_id=card.id, amount=amount.group(1) if amount else ""
            )
    move = re.search(r"\b(?:move|transfer|put)\b.*\bto (?:my )?([a-z ]+)$", lower)
    if move:
        target = next(
            (
                a
                for a in dash.accounts
                if a.account_type not in ("person",)
                and (
                    set(re.findall(r"[a-z]+", move.group(1)))
                    & (set(re.findall(r"[a-z]+", a.name.casefold())) | {a.account_type})
                )
            ),
            None,
        )
        amount = re.search(r"\$?(\d+(?:\.\d{1,2})?)", lower)
        if target and not any(_words(g.name) & _words(move.group(1)) for g in dash.savings_goals):
            return make(
                kind="transfer", to_account_id=target.id, amount=amount.group(1) if amount else ""
            )
    if re.search(r"\b(paid|mark)\b", lower):
        bill = next((b for b in dash.bills if _words(b.name) & _words(lower)), None)
        if bill and not re.search(r"\b(split|with)\b", lower):
            return make(kind="bill_paid", target_id=bill.id, description=bill.name)
    status = re.match(r"(pause|resume|unpause|restart)\s+(?:my\s+|the\s+)?(.+)", lower)
    if status:
        return make(
            kind="goal_update",
            description=status.group(2),
            option="paused" if status.group(1) == "pause" else "active",
        )
    delete = re.match(r"(?:delete|remove)\s+(?:my\s+|the\s+)?(.+)", lower)
    if delete:
        what = delete.group(1)
        if re.search(r"\b(last|latest)\b.*\b(transaction|purchase|expense)", what) or what in (
            "last one",
            "that",
        ):
            latest = dash.transactions[0].id if dash.transactions else None
            return make(kind="delete", option="transaction", target_id=latest)
        for target, word in (("bill", "bill"), ("goal", "goal"), ("budget", "budget")):
            if word in what:
                name = what.replace(word, "").strip()
                return make(kind="delete", option=target, description=name)
    return None
