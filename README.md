# Penny

**Your wallet. Your coach.** Penny is a money app for Canadian students and young adults that does the bookkeeping for you and teaches you as you go. Snap a receipt or just say *"Pizza $36 with Sam and Priya, split 3 ways"*, and Penny files it, splits it, and updates your budgets after one tap to approve. Then it answers the question a bank balance can't: *how much can I actually spend before my next payday, and why?*

- **Does the work:** an AI agent turns a photo, a voice note, or a sentence into expenses, splits, budgets, goals, bills, and settings, and learns your usual purchases.
- **A team of agents:** give Penny a goal ("I'm moving to Toronto in September, get me ready") and an orchestrator sends six specialist subagents to work on it at once, a verifier checks every figure, and you approve the result in one tap. It all happens inside the Penny AI chat: ask "can I buy an iPhone 18 Pro?" and the agents find the price, check it against your money, and answer like an adviser, with the numbers and your options. Each agent's live progress and full trace are one tap away.
- **Coaches with your numbers:** Penny AI answers "Can I afford it?" from your real month, and every figure it quotes comes from tested code, never the model.
- **Teaches:** lessons, games, and a guide library on budgeting, credit, tax, and TFSAs, in a tone that fits you: playful when you're just learning, plain and grown-up for students and working adults.

Built for the Cognizant BrAInstorm AI Innovation Challenge 2026. It runs on the web and as an iPhone app. Sign-in is invite-only during the beta: the website opens on a landing page (`/welcome`) whose **Sign in** works only for existing accounts. All demo people, accounts, and amounts in this repository are fictional, and Penny never connects to a bank.

## What it does

| Area | What the user gets |
| --- | --- |
| **Learn** | Short lessons and quizzes on budgeting, saving, tax, credit, and investing readiness, plus a **pocket-money practice game** with pretend money. XP, streaks, and badges. |
| **Personas** | Student, Working, or Just learning, picked before setup. Penny AI and Home fit the coaching to it; Just learning can start with lessons and practice before entering any money. |
| **Home** | **Safe to spend**: chequing and cash after every unpaid bill and budget, with a per-day amount until payday. Accounts, upcoming bills, recent activity, and a payday prompt. |
| **Payday** | **I got paid** records a paycheque; a check-in then shows what's due before the next payday and suggests a saving. A bonus or gift gets a windfall plan: card balance first, then savings, the rest is yours. |
| **Spending and budgets** | Transactions with search and filters, recurring bills with history, monthly budgets with suggested limits and a rebalance when one goes over, and charts over time. |
| **Cards and bills** | Credit card due dates that roll forward when paid, "have you paid it?" for bills, and **Add to calendar** for bills, card payments, and paydays. |
| **Splits** | Shared costs with friends and groups, without counting money owed to you as cash. |
| **Goals** | Savings goals with the monthly amount needed to hit each date. |
| **Receipts** | Snap a receipt or bill: Penny AI reads each line and the app groups them into one purchase per category (groceries, fuel), checked against the printed total. A pre-read sample receipt shows it without an AI call. |
| **Agents** | Inside Penny AI: an orchestrator plans each mission (a check-up, finding free money, a card payoff, whether you can afford something, or a life event in the user's words), six subagents (Analyst, Cash-flow guard, Planner, Benefits finder, People, Tutor) work on it in parallel with their own tools, and a verifier checks every figure and draft. Drafts wait for one approval with Undo; reminders, lessons, and guides happen on their own. **Autopilot** runs a daily check when the app opens. |
| **Penny AI** | A coach that knows the user's numbers: "Can I afford a $300 concert trip?" It suggests budget or goal changes that apply only after the user approves. |
| **Snap or say it** | Tap Penny's button and say "Pizza $36 with Sam and Priya, split 3 ways" or snap a receipt. Penny drafts every step (expenses, splits, budgets, goals, bills, settings) as one plan; nothing is saved until the user taps **Do it**, and **Undo** reverses the whole plan. **Your usuals** offers the user's most frequent purchases as one-tap shortcuts. |

## How AI is kept honest

Every total, limit, projection, and suggestion comes from deterministic, tested Python that works in integer cents. The model never calculates.

1. Penny builds a snapshot of the user's month, and every amount in it is recorded as a verified figure.
2. The model can call deterministic tools (affordability, savings plans, goal projections, spending-cut what-ifs) that do all the arithmetic.
3. Every dollar amount and percentage in the reply must match a verified figure or a number the user typed. If not, the model gets one revision, then Penny answers from the numbers instead.
4. Changes to budgets or goals come back as single-use proposals. Nothing changes until the user taps **Approve**.

If the model is unavailable, slow, or over a person's daily limit, Penny still answers from the same deterministic data.

## Security

- **Sign-in:** Supabase Auth. The API verifies each token's signature (JWKS, pinned algorithms), issuer, audience, role, and expiry.
- **Data isolation:** every table has row-level security with no public access; only the API reads and writes, and every row belongs to one user and is deleted with them.
- **Abuse limits:** 120 requests a minute, 200 AI calls a day, and 3 running missions per person; oversized requests are refused.
- **AI guardrails:** card numbers, SINs, emails, and phone numbers are removed from what you type before it's stored or sent to the model. Prompt-injection attempts are refused, web pages that try to give instructions are discarded, only http(s) source links are shown, and answers that pick stocks, funds, or crypto are replaced. Money changes always wait for your approval.
- **Headers:** no framing, no caching of financial data, a strict content security policy, HSTS in production.
- **Secrets** stay server-side. **Delete account** in Settings removes the account and everything in it.

## Architecture

```text
Next.js (web + iPhone via Capacitor) ──HTTPS──▶ FastAPI ──▶ Supabase Postgres
        │                                        │
        └──── Supabase Auth (sign-in) ◀───────────┘ verifies tokens
                                                 └──▶ OpenAI (optional, explanations only)
```

```text
frontend/
  app/                  pages: the app, the landing page (welcome), and sign-in
  components/penny/     one file per screen or feature (home, spending, settings, Penny AI, …)
  components/ui/        shared building blocks (buttons, dialogs, inputs)
  lib/                  API client, money formatting (cents, never floats), sign-in, native iPhone helpers
  ios/                  the iPhone app shell (Capacitor)
backend/app/
  api/                  HTTP routes, one router per area
  domain/               the financial rules: pure, deterministic, integer-cent, unit tested
  store/                each person's data and every operation on it, one module per area
  coach/                Penny AI: verified snapshot, tools, number checking, proposals
  agents/               Penny's agents: orchestrator, subagents, tools, verifier, memory, mission history
  assist/               smaller AI helpers (snap or say it, quick add, search, statement reading), each with a fallback
  learning/             lessons and game rules
  db/                   Postgres persistence: load once per request, save only what changed
  limits.py             per-person request and AI limits
backend/tests/          about 450 tests: financial rules, security, and every feature's edge cases
supabase/migrations/    the database schema
```

More detail: [docs/architecture.md](docs/architecture.md). Every product and design decision, with its reason, is in [DECISIONS.md](DECISIONS.md).

## Run it

You need Node.js 20.9+, Python 3.12+, and [uv](https://docs.astral.sh/uv/).

```bash
# API: http://localhost:8000
cd backend && cp .env.example .env && uv sync
uv run uvicorn app.main:app --reload --port 8000

# Web app: http://localhost:3000
cd frontend && cp .env.example .env.local && npm install
npm run dev
```

Without a database URL, the API keeps data in memory. To look around without Supabase, use the offline demo with the fictional data set ([docs/setup.md › Authentication](docs/setup.md#authentication)). Supabase, Penny AI, the iPhone app, and hosting are covered step by step in [docs/setup.md](docs/setup.md).

## Checks

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run --with pytest pytest
cd frontend && npm run typecheck && npm run lint && npm run format:check && npm run build
```
