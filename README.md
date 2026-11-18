# Penny

**Your wallet. Your coach.** Penny is a financial literacy app for Canadian students and young adults. It finds what you don't know about money, teaches it through lessons, story games and guides written from official Canadian sources, then helps you use it on real decisions with a team of AI agents.

Built for the **Cognizant BrAInstorm AI Innovation Challenge 2026** (theme: Education). It runs on the web and as an iPhone app. Landing page: [penny-khaki-two.vercel.app/welcome](https://penny-khaki-two.vercel.app/welcome) (sign-in is invite-only during the beta).

> All people, accounts and amounts in this repository and the demo are fictional. Penny never connects to a bank, and it is educational, not financial advice.

## The problem

Nobody teaches you money before college. Then, all at once, you are expected to handle rent, tuition, a first paycheque, a credit card, taxes and a TFSA. Budgeting apps show you what you spent; they don't teach you why, and AI chatbots give confident advice with numbers you can't check.

Penny does both halves: it **teaches** you, then **helps you apply it** to your own money, and every number it shows comes from tested code, not from the model.

## Highlights

- **Learn by playing.** A 12-question **Money IQ** check builds your **skill map** across six areas; **Penny's plan** then picks your next lesson, guide and game for your weakest areas. Story games (Semester survival, First paycheque, Pocket money challenge, Needs or wants) use pretend money. The **Money Guide** has 23 guides written from Canada.ca, the CRA and the FCAC, each linking its sources.
- **A team of agents.** Ask _"I'm moving to Toronto in September. Get me ready."_ Penny thinks the situation through (including what you didn't ask), asks what only you know, then sends six built-in agents (Planner, Cash-flow guard, Benefits finder, Analyst, People, Tutor) plus up to three specialists it creates for the job. They research in parallel, a verifier checks every figure, and you get the full picture with every cost and a dated checklist. Nothing changes until you approve.
- **Snap or say it.** Snap a receipt or say _"Pizza $36 with Sam and Priya, split 3 ways"_: Penny drafts the expenses, split and budget updates as one plan, saved only when you tap **Do it**, and **Undo** reverses all of it.
- **Safe to spend.** One number: what you can actually spend before payday, after every bill and budget.

## What it does

| Area                        | What the user gets                                                                                                                                                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**                   | Money IQ, a skill map, Penny's plan, lessons from Easy to Hard, story games with pretend money, the Money Guide, XP, streaks and badges.                                                                                                |
| **Personas**                | Student, Working, or Just learning. Penny AI and Home adapt their coaching; Just learning can start with lessons and games before entering any money.                                                                                   |
| **Penny AI**                | A coach that knows your numbers ("Can I afford a $300 concert trip?"), and the place where agent missions run, with each agent's live progress and full trace one tap away.                                                             |
| **Agents**                  | An orchestrator plans each mission (a check-up, finding free money, a card payoff, an affordability check, or a life event in your words). Drafts wait for one approval with Undo. **Autopilot** runs a daily check when the app opens. |
| **Home**                    | **Safe to spend**, accounts, upcoming bills, recent activity and a payday prompt.                                                                                                                                                       |
| **Payday**                  | **I got paid** records a paycheque, shows what's due before the next one and suggests a saving. A windfall gets a plan: card balance first, then savings.                                                                               |
| **Spending and budgets**    | Search and filters, recurring bills, monthly budgets with suggested limits and a rebalance when one goes over, and charts over time.                                                                                                    |
| **Cards and bills**         | Card due dates that roll forward when paid, "have you paid it?" for bills, and **Add to calendar** for bills, card payments and paydays.                                                                                                |
| **Splits and goals**        | Shared costs with friends (money owed to you is never counted as cash), and savings goals with the monthly amount needed to hit each date.                                                                                              |
| **Receipts and statements** | Penny AI reads each receipt line and groups it by category, checked against the printed total. Statements import from PDF, Excel or CSV.                                                                                                |

## How AI is kept honest

Every total, limit, projection and suggestion comes from deterministic, tested Python that works in integer cents. The model never calculates.

1. Penny builds a snapshot of the user's month, and every amount in it is recorded as a verified figure.
2. The model calls deterministic tools (affordability, savings plans, goal projections, spending what-ifs) that do all the arithmetic.
3. Every dollar amount and percentage in a reply must match a verified figure or a number the user typed. If not, the model gets one revision, then Penny answers from the numbers instead.
4. Changes to budgets or goals come back as single-use proposals. Nothing changes until the user approves.

If the model is unavailable, slow, or over a person's daily limit, Penny still answers from the same deterministic data.

## Security and privacy

- **Sign-in:** Supabase Auth. The API verifies each token's signature (JWKS, pinned algorithms), issuer, audience, role and expiry.
- **Data isolation:** every table has row-level security with no public access; only the API reads and writes, and every row belongs to one user and is deleted with them.
- **Abuse limits:** 120 requests a minute, 300 AI calls a day and 3 running missions per person; oversized requests are refused.
- **AI guardrails:** card numbers, SINs, emails and phone numbers are removed before anything is stored or sent to the model. Prompt-injection attempts are refused, web pages that try to give instructions are discarded, and answers that pick stocks, funds or crypto are replaced.
- **Headers:** no framing, no caching of financial data, a strict content security policy, HSTS in production.
- **Secrets** stay server-side. **Delete account** in Settings removes the account and everything in it.

## Architecture

```text
Next.js (web + iPhone via Capacitor) ──HTTPS──▶ FastAPI ──▶ Supabase Postgres
        │                                        │
        └──── Supabase Auth (sign-in) ◀───────────┘ verifies tokens
                                                 └──▶ OpenAI (reads, plans and explains; never calculates)
```

```text
frontend/
  app/                  pages: the app, the landing page (welcome), and sign-in
  components/penny/     one file per screen or feature (home, learn, Penny AI, agents, …)
  components/ui/        shared building blocks (buttons, dialogs, inputs)
  lib/                  API client, money formatting (cents, never floats), sign-in, native iPhone helpers
  ios/                  the iPhone app shell (Capacitor)
backend/app/
  api/                  HTTP routes, one router per area
  domain/               the financial rules: pure, deterministic, integer-cent, unit tested
  store/                each person's data and every operation on it
  coach/                Penny AI: verified snapshot, tools, number checking, proposals
  agents/               orchestrator, subagents, tools, verifier, memory, mission history
  assist/               smaller AI helpers (snap or say it, quick add, search, statements), each with a fallback
  learning/             lessons, Money IQ and game rules
  db/                   Postgres persistence: load once per request, save only what changed
  limits.py             per-person request and AI limits
backend/tests/          456 tests: financial rules, security, and every feature's edge cases
supabase/migrations/    the database schema
```

More detail: [docs/architecture.md](docs/architecture.md).

**Stack:** Next.js 16, React 19, TypeScript (strict), Tailwind CSS, Capacitor; FastAPI on Python 3.12, fully typed; Supabase (Postgres and Auth); OpenAI.

## Run it

You need Node.js 20.9+, Python 3.12+ and [uv](https://docs.astral.sh/uv/).

```bash
# API: http://localhost:8000
cd backend && cp .env.example .env && uv sync
uv run uvicorn app.main:app --reload --port 8000

# Web app: http://localhost:3000
cd frontend && cp .env.example .env.local && npm install
npm run dev
```

Without a database URL, the API keeps data in memory. To try it without Supabase, use the **offline demo** with the fictional data set ([docs/setup.md › Authentication](docs/setup.md#authentication)). Supabase, Penny AI, the iPhone app and hosting are covered step by step in [docs/setup.md](docs/setup.md).

## Checks

```bash
cd backend && uv run ruff check . && uv run ruff format --check . && uv run --with pytest pytest
cd frontend && npm run typecheck && npm run lint && npm run format:check && npm run build
```
