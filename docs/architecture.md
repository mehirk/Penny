# Penny Architecture

## System

```text
Next.js App Router client
  |-- mobile-first Tailwind + shadcn/ui dashboard
  |-- loading, empty, error, and mutation states
  |-- Supabase Auth browser client
  |-- GET /api/health
  |
  +---- HTTPS JSON ----> FastAPI
  |                       |-- Pydantic response models
  |                       |-- deterministic Python financial domain
  |                       |-- per-request unit of work (load, run domain code, save changes)
  |                       |-- authenticated, bounded Penny AI coach
  |                       |     |-- deterministic financial tools
  |                       |     |-- verified structured recommendations
  |                       |     +-- optional OpenAI explanation adapter
  |                       +-- owner-bound approval command
  |
  +---- Supabase client -> Auth (sign-in only)

FastAPI ----- PENNY_DATABASE_URL ----> Supabase Postgres
                          |-- versioned migration (supabase/migrations)
                          +-- RLS on, no Data API grants: only the backend reads/writes
```

Penny AI chats (messages and the verified replies shown with them) and proposals are stored in Postgres. Prompts sent to the model provider are not stored.

## Boundaries

- `frontend/` owns presentation, accessibility, Supabase sign-in, and mutation forms. It never calculates financial totals; editable CAD strings are converted to cents with `BigInt` before requests. `components/dashboard-app.tsx` orchestrates views and dialogs; `components/penny/use-dashboard.ts` owns loading, period caching, and applying each change's fresh snapshot.
- `backend/app/domain/` is the authoritative calculation layer. Pure functions accept and return Python integers representing cents, and each has unit tests.
- `backend/app/store/` owns each user's financial state and returns a complete authoritative snapshot after each create, update, or delete. `DashboardStore` is assembled from one module per area (`transactions`, `budgets`, `goals`, `bills`, `accounts`, `splits`, `pay`, `calendar`, `planning`, `learning`, `reports`, and `agent`, which applies an approved snap-or-say plan all or nothing) on top of `state` (data, lookups, validation) and `dashboard`/`insights` (the snapshot). `seed.py` holds the fictional demo and a fresh account's starting point; `registry.py` picks the store for a signed-in user. The store knows nothing about the database: `snapshot()` and the constructor hand its state to `backend/app/db/`, which loads it per request in one query and saves only changed rows, guarded by a version number (409 on a conflicting edit). Without `PENNY_DATABASE_URL` the state is in memory.
- `backend/app/api/` exposes typed routes, one router per area; `backend/app/main.py` only wires the app (per-request save, security headers and request-size limit, CORS, routers). `backend/app/api/deps.py` resolves the signed-in person and applies their request limit; `backend/app/limits.py` also caps Penny AI calls per person. Every financial endpoint validates the bearer identity (Supabase JWT via JWKS, or the development-only demo token) and passes the user id to the store, which rejects non-owners with 403.
- `backend/app/coach/` owns the financial snapshot, check-in signals, deterministic tools, prompt-injection filtering, number grounding, provider fallback, and single-use goal proposals. Provider output cannot mutate state.
- `backend/app/assist/` holds the smaller AI helpers (snap or say it, voice transcription, quick add, search, statement reading, budget suggestions, setup, and short explanations). Each has a built-in fallback, quotes only verified figures, and saves nothing.
- `supabase/migrations/` owns schema evolution. The browser receives only the publishable key; service-role credentials must remain server-side.

## Database model and authorization

Supabase Auth owns credentials; the browser receives only the publishable key. `public.profiles` is keyed by `auth.users.id`, and every other table carries that `user_id` and cascades on delete, so deleting a Supabase user deletes all their Penny data. Tables: `accounts`, `categories`, `transactions`, `budgets`, `savings_goals`, `goal_contributions`, `bills`, `pay_schedules`, `missions`, `learn_*`, `coach_*`, and `reminder_*`. Lessons are content in code, not data.

Every table has RLS enabled with no policies, and `anon`/`authenticated` have no grants, so the public Data API can't read or change anything. FastAPI connects as the database owner over `PENNY_DATABASE_URL` (a server-side secret) and authorizes every request itself from the verified JWT, so all financial writes pass through the deterministic domain code.

All stored money columns use Postgres `bigint` cents with range constraints. Transaction direction is a separate enum-like field, avoiding ambiguous signed storage. Currency is constrained to CAD for the MVP.

## Deterministic flow

1. Validate typed source records and reject booleans, non-integers, or negative monetary magnitudes.
2. Sum income and spending independently with integer arithmetic.
3. Calculate cash flow as income minus spending and budget remaining as limit minus spending; negative results deliberately represent overspending.
4. Return typed cents. Formatting happens only in the UI and never becomes calculation input.

The tested edge cases include no activity, overspending, invalid values, exact savings contributions, and integers beyond JavaScript's safe-number range.

## Demo data

Maya Singh is a clearly fictional 20-year-old Dalhousie University student in Halifax. Her accounts, transactions, budgets, goals, and missions originate in the backend fixture, and are saved to the database the first time the `PENNY_DEMO_OWNER_USER_ID` user signs in. The frontend receives them through the dashboard contract and does not provide fallback balances or totals.

## Health and failure behaviour

- `GET http://localhost:3000/api/health` verifies the Next.js runtime.
- `GET http://localhost:8000/health` verifies FastAPI and its typed response contract.
- If FastAPI is unavailable, the dashboard shows a retryable error instead of inventing fallback financial values.
- The login page disables sign-in and explains configuration when Supabase public environment variables are absent.
- If the model key is absent, a model call fails or times out, or a reply quotes a figure that is not in the verified set after one revision, Penny AI returns a built-in answer assembled from the same deterministic signals.

## Penny AI request and approval flow

```text
Authenticated chat request (up to 12 messages, last one a user question)
  -> reject prompt-control instructions in the question
  -> load the caller's current month and the three prior months
  -> build the verified snapshot; register every amount and ratio in a FactBook
  -> model loop (at most 5 tool rounds): the model may call deterministic tools
       check_affordability, plan_savings, compare_payment_options, project_goal,
       simulate_spending_cut, credit_card_payment, list_transactions,
       propose_goal_contribution, propose_budget_limit
     each tool parses user-typed amounts, computes in integer cents, and registers results
  -> grounding check: every $ amount and % in the reply must match a verified figure
       or an amount the user typed; one revision is allowed, then built-in fallback
  -> return reply, cited figures, tools used, provenance, and any inert proposal

Explicit approval
  -> re-authenticate caller
  -> verify proposal owner, version, single-use state, and that the goal balance or
     budget limit has not changed since the proposal
  -> apply the predetermined integer-cent change and return a fresh dashboard
```

The model never calculates. It may quote figures that deterministic code produced, and it can only change data by preparing a proposal that the user must approve. A reply is bounded by `PENNY_COACH_TIMEOUT_SECONDS` (default 45) across all tool rounds.

## Snap or say it flow

```text
POST /agent/plan (typed or transcribed text, optional photo, recent chat as context)
  -> the model, or built-in rules without a key, reads intents only: kinds, names,
     and amounts copied as text; it never totals or splits
  -> deterministic code parses amounts to cents, matches accounts, categories, and goals,
     builds typed actions, and asks a question for anything missing; nothing is saved
POST /agent/apply (the user's tap on Do it, up to 20 actions)
  -> every action runs through the same store operations as the manual forms;
     any failure restores the pre-apply state, so a plan applies all or nothing
POST /agent/undo (within 15 minutes, only if nothing changed since)
  -> restores the pre-apply state
```

App steps (open a page, switch theme, hide amounts) run on the device. Chat messages in Penny AI go through the same planner first, so a question reaches the coach and a request comes back as a plan card. A big goal ("I'm moving to Toronto, get me ready") becomes a `mission` step, which starts a mission for the agents below.

## Agents (inside Penny AI)

Missions run inside the Penny AI chat: the planner turns a request that needs the agents into a `mission` step, the chat starts it and shows it live, and the mission ends with a `brief` (the direct answer, the numbers behind it, and options the user can pick as their next message).

`backend/app/agents/` runs missions with an orchestrator, six built-in subagents, specialists the orchestrator creates per mission, and a verifier.

```text
POST /agents/runs {kind, goal}            (or /agents/autopilot once a day when the app opens)
  -> load a read-only workspace now, while the request holds the user's data; run in the background
  -> memory: earlier missions' approved steps checked against today; turned-down ones noted
  -> think it through (life events and custom missions, with a model): what the user needs to
     keep in mind (5-10 considerations, including what they didn't ask about), the built-in
     agents to send, up to 3 specialists to create (name, emoji, role, task, and tools from a
     safe list that never includes a transfer), and up to 2 questions asked before anyone goes
     (each with an assumption if unanswered). Without a model: rules (a move gets the whole team)
  -> subagents in parallel (asyncio), each with only its own tools:
       Analyst, Cash-flow guard, Planner, Benefits finder, People, Tutor, and any specialists
       model loop: call tools -> read results -> repeat (≤5 rounds) -> report
       without a model: the agent's built-in playbook calls the same tools
       an agent may ask the user one question (the mission waits up to 90 s, then assumes)
       the Planner, Benefits finder, and specialists may search the web (≤6 a mission, sources
       kept); cost_plan totals any situation (plan_move adds a move's dated checklist) in cents
  -> review: Penny reads the reports and sends follow-ups (a second wave) built on findings
  -> verifier: every $ and % in every report must be a FactBook figure (sent back once, then
     replaced with built-in findings); drafts are rebuilt by the same step builder as the app's
     plans, duplicates merged, and held back if together they'd leave chequing under a $500
     cushion after bills
  -> brief: the answer, its numbers, options, and the full picture (what you do, what Penny did,
     what's not worth it); the costed plan and checklist are shown with it
  -> summary; the run is saved to agent_runs (30 per person) as the audit trail
GET /agents/runs/{id}                     (polled by the app while it runs)
POST /agents/runs/{id}/answer              (the user's answer to a waiting question)
POST /agent/apply, then /agents/runs/{id}/approved   (the user's one tap, then the audit note)
POST /agents/runs/{id}/declined            ("Not now": remembered for 30 days)
POST /transactions -> a purchase that tips a budget over starts a Watch mission (app/agents/watch.py)
```

Read tools run deterministic code and register every figure; draft tools refuse any amount a tool didn't produce or the user didn't say; auto tools (reminders, lessons, guides) move no money and run without approval. Only the Cash-flow guard and the Planner can draft. Starting a new mission marks older unapproved drafts as superseded, since they were worked out from old numbers. A mission makes at most 30 model calls.
