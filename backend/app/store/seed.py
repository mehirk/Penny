"""Starting data: the fictional demo data set, and a fresh account's empty starting point.

Every person, account, and amount in the demo is invented. The demo's current month is
October 2026 (below); earlier months come from `demo_history`.
"""

from datetime import date, timedelta

from app.auth import DEMO_USER_ID
from app.dashboard_models import Bill, Category, Mission, PaySchedule
from app.domain.categorize import categorize
from app.domain.recurring import series_key
from app.learning.content import LESSONS_BY_ID
from app.learning.engine import Learner, LessonResult, xp_for
from app.models import Account, DemoUser, Transaction
from app.store.demo_history import build_history_budgets, build_history_transactions
from app.store.state import DEMO_MONTH, StoreSnapshot, clamped_today


# fmt: off
def starter_categories() -> list[Category]:
    def spending(id: str, name: str, colour: str, parent: str | None = None) -> Category:
        return Category(id=id, name=name, colour_token=colour, kind="spending", parent_id=parent)

    def income(id: str, name: str) -> Category:
        return Category(id=id, name=name, colour_token="emerald", kind="income")

    return [
        income("cat-income", "Paycheque"),
        income("cat-scholarship", "Scholarship & bursary"),
        income("cat-allowance", "Allowance"),
        income("cat-gift", "Gift"),
        income("cat-benefits", "Benefits & pension"),
        income("cat-refund", "Refund"),
        spending("cat-housing", "Housing", "rose"),
        spending("cat-food", "Food", "amber"),
        spending("cat-groceries", "Groceries", "amber", "cat-food"),
        spending("cat-eating-out", "Eating out", "amber", "cat-food"),
        spending("cat-transport", "Transportation", "sky"),
        spending("cat-phone", "Phone", "violet"),
        spending("cat-school", "School", "indigo"),
        spending("cat-fun", "Entertainment", "pink"),
        spending("cat-health", "Health", "emerald"),
    ]
# fmt: on


def starter_missions() -> list[Mission]:
    def mission(id: str, title: str, description: str, xp_reward: int) -> Mission:
        return Mission(
            id=id, title=title, description=description, xp_reward=xp_reward, completed=False
        )

    return [
        mission(
            "mission-review",
            "Review three recent purchases",
            "Check their categories and make sure each one supports your plan.",
            40,
        ),
        mission(
            "mission-save",
            "Protect your next $15",
            "Move a fictional $15 toward your emergency fund this week.",
            60,
        ),
        mission(
            "mission-budget",
            "Give every spending category a limit",
            "Check that each category you spend in has a monthly budget.",
            50,
        ),
        mission(
            "mission-credit",
            "Learn your credit utilization",
            "Open Credit basics and see how your fictional card balance compares.",
            30,
        ),
        mission(
            "mission-council",
            "Ask before a big purchase",
            "Ask Penny AI about something you are thinking of buying.",
            50,
        ),
    ]


def empty_snapshot(owner: DemoUser) -> StoreSnapshot:
    """A fresh account: no transactions, budgets, goals, or bills, and one $0 chequing account
    so money can be recorded straight away. Categories are the usual starters."""
    return StoreSnapshot(
        profile=owner,
        accounts=[
            Account(id="acct-chequing", name="Chequing", account_type="chequing", balance_cents=0)
        ],
        categories=starter_categories(),
        transactions=[],
        budgets=[],
        goals=[],
        contributions=[],
        missions=starter_missions(),
        bills=[],
        pay_schedules=[],
        learner=Learner(),
    )


# ---------------------------------------------------------------------- the fictional demo

# October 2026 on the chequing account: id, description, category name, cents, kind, day.
# fmt: off
_OCTOBER: tuple[tuple[str, str, str, int, str, int], ...] = (
    ("tx-pay", "Harbour Books pay", "Income", 126_400, "income", 25),
    ("tx-scholarship", "Student scholarship", "Income", 50_000, "income", 2),
    ("tx-rent", "Fictional student housing", "Housing", 82_500, "spending", 1),
    ("tx-groceries", "Atlantic Market", "Food", 18_942, "spending", 22),
    ("tx-transit", "Halifax Transit pass", "Transportation", 7_800, "spending", 3),
    ("tx-dining", "Campus café", "Food", 6_875, "spending", 19),
    ("tx-phone", "Mobile plan", "Phone", 4_500, "spending", 14),
    ("tx-school", "Course materials", "School", 3_299, "spending", 10),
    ("tx-fun", "Movie night", "Entertainment", 2_600, "spending", 17),
    # Everyday purchases, so the Money Score and Penny AI have realistic texture.
    ("tx-coffee-1", "Tim Hortons", "Food", 645, "spending", 5),
    ("tx-takeout-1", "Uber Eats", "Food", 2_890, "spending", 7),
    ("tx-coffee-2", "Starbucks", "Food", 725, "spending", 12),
    ("tx-ride", "Uber ride home", "Transportation", 1_840, "spending", 24),
    ("tx-takeout-2", "Pizza Pizza", "Food", 2_260, "spending", 27),
    ("tx-pharmacy", "Shoppers Drug Mart", "Health", 1_499, "spending", 28),
    ("tx-coffee-3", "Starbucks", "Food", 680, "spending", 29),
)
# fmt: on
# Category budgets are the everyday (variable) part; rent, transit, and phone are recurring
# bills, the fixed part.
_OCTOBER_BUDGETS = {
    "cat-food": 30_000,
    "cat-transport": 3_000,
    "cat-school": 10_000,
    "cat-fun": 8_000,
}


def _bill(id: str, name: str, cents: int, category_id: str, due: date, auto_record: bool) -> Bill:
    return Bill(
        id=id,
        name=name,
        amount_cents=cents,
        category_id=category_id,
        account_id="acct-chequing",
        frequency="monthly",
        next_due=due,
        auto_record=auto_record,
    )


def _demo_bills() -> list[Bill]:
    return [
        _bill("bill-rent", "Student housing", 82_500, "cat-housing", date(2026, 11, 1), True),
        _bill(
            "bill-transit", "Halifax Transit pass", 7_800, "cat-transport", date(2026, 11, 3), True
        ),
        _bill("bill-phone", "Mobile plan", 4_500, "cat-phone", date(2026, 11, 14), True),
        _bill(
            "bill-streaming", "Streaming subscription", 1_299, "cat-fun", date(2026, 11, 18), False
        ),
    ]


def _demo_transactions(categories: list[Category], bills: list[Bill]) -> list[Transaction]:
    ids_by_name = {category.name: category.id for category in categories} | {"Income": "cat-income"}
    names = {category.id: category.name for category in categories}
    october = [
        Transaction(
            id=id,
            description=description,
            category=category,
            account_id="acct-chequing",
            category_id=ids_by_name.get(category),
            amount_cents=cents,
            kind=kind,  # type: ignore[arg-type]
            occurred_on=DEMO_MONTH.replace(day=day),
        )
        for id, description, category, cents, kind, day in _OCTOBER
    ]
    result = []
    for item in [*october, *build_history_transactions()]:
        # The data only knows top-level names; refine them into income types and subcategories.
        if item.kind == "income" or item.category_id == "cat-food":
            refined = categorize(item.description, item.kind).category_id
            if refined:
                item = item.model_copy(update={"category_id": refined, "category": names[refined]})
        # Link past payments to the bills, so each bill has a payment history.
        bill = next(
            (
                bill
                for bill in bills
                if item.kind == "spending"
                and (
                    series_key(item.description) == series_key(bill.name)
                    or (
                        item.category_id == bill.category_id
                        and item.amount_cents == bill.amount_cents
                    )
                )
            ),
            None,
        )
        result.append(item.model_copy(update={"bill_id": bill.id}) if bill else item)
    return result


def _demo_learner() -> Learner:
    """Fictional learning history so the demo opens with a streak in progress. The learner
    still chooses a country and topics the first time they open Learn."""
    learner = Learner()
    today = clamped_today(DEMO_MONTH)
    for days_ago, lesson_id, stars in ((2, "budgeting-easy", 3), (1, "saving-easy", 2)):
        passed_on = today - timedelta(days=days_ago)
        learner.results[lesson_id] = LessonResult(
            stars=stars,
            xp_earned=xp_for(LESSONS_BY_ID[lesson_id].tier, stars),
            first_passed=passed_on,
        )
        learner.activity_days.add(passed_on)
    return learner


def demo_snapshot() -> StoreSnapshot:
    """Sam, a fictional student at Dalhousie University in Halifax."""
    categories = starter_categories()
    bills = _demo_bills()
    return StoreSnapshot(
        profile=DemoUser(
            id=DEMO_USER_ID,
            display_name="Sam",
            age=20,
            school="Dalhousie University",
            city="Halifax",
            province="NS",
            currency="CAD",
            is_fictional=True,
            persona="student",
        ),
        accounts=[
            Account(
                id="acct-chequing",
                name="Everyday Chequing",
                account_type="chequing",
                balance_cents=184_250,
            ),
            Account(
                id="acct-savings",
                name="High Interest Savings",
                account_type="savings",
                balance_cents=125_000,
            ),
            Account(
                id="acct-credit",
                name="Student Credit Card",
                account_type="credit",
                balance_cents=24_380,
                credit_limit_cents=150_000,
            ),
        ],
        categories=categories,
        transactions=_demo_transactions(categories, bills),
        budgets=[
            {
                "id": f"budget-{index}",
                "category_id": category_id,
                "month_start": DEMO_MONTH,
                "limit_cents": limit,
            }
            for index, (category_id, limit) in enumerate(_OCTOBER_BUDGETS.items(), start=1)
        ]
        + build_history_budgets(),
        goals=[
            {
                "id": "goal-emergency",
                "name": "Winter emergency fund",
                "target_cents": 250_000,
                "current_cents": 125_000,
                "target_date": date(2027, 2, 28),
                "status": "active",
                "account_id": "acct-savings",
            },
            {
                "id": "goal-laptop",
                "name": "Laptop fund",
                "target_cents": 120_000,
                "current_cents": 30_000,
                "target_date": date(2027, 1, 31),
                "status": "active",
                "account_id": "acct-chequing",
            },
        ],
        contributions=[],
        # The demo opens with one challenge already done.
        missions=[
            m.model_copy(update={"completed": True}) if m.id == "mission-save" else m
            for m in starter_missions()
        ],
        bills=bills,
        pay_schedules=[
            PaySchedule(
                id="pay-main",
                name="Harbour Books pay",
                amount_cents=126_400,
                account_id="acct-chequing",
                frequency="monthly",
                next_payday=date(2026, 11, 25),
            ),
            PaySchedule(
                id="pay-tutoring",
                name="Campus tutoring",
                amount_cents=7_500,
                account_id="acct-chequing",
                frequency="weekly",
                next_payday=date(2026, 11, 6),
            ),
        ],
        learner=_demo_learner(),
    )
