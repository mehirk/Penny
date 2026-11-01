# Penny

**Make money, make sense.** Penny is a mobile-first financial literacy and budgeting MVP for Canadian students and young adults. Every profile, account, transaction, and balance in this repository is fictional.

The app has seven sections:

- **Today (home):** total cash with trend, safe to spend, credit used, monthly savings against goals, a spending overview with a "vs last month" tip, recent transactions, upcoming bills, financial health with the daily Money Score, Penny AI prompts, and a learning streak.
- **Spending:** transactions (search, money in/out, category, a one-day or range date filter, CSV export) with soft Need/Want and Recurring tags, then budgets and trends. A Recurring tab lists every bill with its payment history and an auto-paid or mark-paid choice. A period picker shows any month, preset range, or custom dates.
- **Goals:** savings goals with the monthly amount needed to hit each target date.
- **Invest:** education only. A foundations checklist, TFSA, RRSP and FHSA explained with 2026 limits, and a compounding-and-fees explorer.
- **Learn:** short lessons with quizzes on budgeting, saving, tax, credit and investing, plus XP, levels, a learning streak and challenges.
- **Penny AI:** a money coach grounded in the user's verified numbers.

Every score, total and projection comes from deterministic integer-cent Python. Bank, brokerage and credit-bureau connections remain intentionally out of scope; Settings explains the standards a future bank connection would have to meet.

The dashboard loads all financial values from FastAPI. Transaction, category-assignment, monthly-budget, and savings-goal mutations return a freshly calculated dashboard snapshot. With `PENNY_DATABASE_URL` set, everything a user has (accounts, transactions, budgets, goals, bills, pay schedule, Learn progress, Penny AI chats and proposals) is saved in Supabase Postgres; see [Where data is stored](#where-data-is-stored). Without it, FastAPI keeps data in memory and it resets on restart.

## Requirements

- Node.js 20.9 or newer and npm
- Python 3.12 or newer and [uv](https://docs.astral.sh/uv/)
- Supabase CLI and Docker Desktop for the local database/Auth stack

## Local setup

### 1. Supabase

Penny uses a hosted Supabase project for sign-in and storage. Apply the schema once (and again whenever `supabase/migrations` changes):

```bash
supabase link --project-ref <project-ref>   # asks for the database password
supabase db push
```

Or paste `supabase/migrations/202610290001_initial_schema.sql` into the project's SQL Editor. Then:

- Put the project URL and publishable key in `frontend/.env.local` (`cp frontend/.env.example frontend/.env.local`).
- Under **Connect → Session pooler**, copy the connection string (with the database password) into `PENNY_DATABASE_URL` in `backend/.env`. It's a secret: keep it server-side.
- Create fictional users under **Authentication → Users**. Each gets their own empty Penny on first sign-in; put one user's UUID in `PENNY_DEMO_OWNER_USER_ID` to give them the fictional Maya data set.

A local Supabase stack (`supabase start`, which needs Docker) also works: use its URLs and `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

### 2. FastAPI

```bash
cd backend
cp .env.example .env
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

Check `http://localhost:8000/health` and interactive API documentation at `http://localhost:8000/docs`.

How the daily Money Score works: fixed recurring charges are excluded. Each day earns up to 60 points for month-to-date flexible spending against the pro-rated flexible budget, and up to 40 for that day's flexible spending against the daily allowance. Zones follow WHOOP's bands: green 67–100, yellow 34–66, red 0–33. See `backend/app/domain/money_days.py`.

Other routes: `GET /api/v1/categorize?description=…` (rule-based category and need/want suggestion), `POST /api/v1/lessons/{id}/complete` (idempotent XP), `POST /api/v1/calculations/growth` (illustrative compounding with fees), `/api/v1/bills` (create, update, delete, and `/{id}/mark-paid`), `PUT /api/v1/pay-schedule`, `/api/v1/categories` and `/api/v1/accounts` (customization), and `POST /api/v1/transactions/import` (CSV history).

Dashboard and CRUD routes are under `/api/v1/dashboard`, `/api/v1/transactions`, `/api/v1/budgets`, and `/api/v1/savings-goals`. Add `?month=YYYY-MM-01` to view or return a past month. History is `GET /api/v1/history?start=…&end=…`; other additions are `POST /api/v1/budgets/copy`, `POST /api/v1/savings-goals/{id}/contributions`, `POST /api/v1/missions/{id}/complete`, and the stateless `POST /api/v1/calculations/credit-utilization`.

Penny AI is a money coach that knows the user's numbers. Its routes are `GET /api/v1/coach/brief` (a deterministic monthly check-in with no model call), `POST /api/v1/coach/chat` (a multi-turn conversation of up to 12 messages), and `POST /api/v1/coach/proposals/{id}/approve`. `GET /api/v1/me` echoes the verified identity for checking sign-in.

How an answer is produced:

1. The backend builds a verified snapshot of the user's month: budgets, spending by category against a 3-month average, bills, goals, accounts, credit use, and recent transactions. Every amount in it is formatted by deterministic integer-cent code and recorded as a verified figure.
2. The model reads the snapshot and conversation and can call deterministic tools: affordability, savings plans, upfront-versus-monthly comparisons, goal projections, spending-cut what-ifs, card-payment what-ifs, and transaction lookups. Tools receive amounts as the text the user typed and do all the arithmetic.
3. Every dollar amount and percentage in the reply must match a verified figure or an amount the user typed. If one doesn't, the model gets one chance to revise; otherwise Penny returns a built-in answer from the same data.
4. Suggested budget or goal changes are returned as single-use, version-checked proposals. Nothing changes until the user taps Approve.

To enable model-generated answers, create an OpenAI project API key and put it only in `backend/.env`:

```dotenv
PENNY_OPENAI_API_KEY=your_secret_key_here
PENNY_OPENAI_MODEL=gpt-6.1-sol
PENNY_COACH_TIMEOUT_SECONDS=45
```

Restart FastAPI after changing the environment file. AI answers are labelled with the model and response time. Without a key, or if the model fails, times out, or quotes an unverifiable number, the reply is labelled `Built-in answer` and is assembled from the deterministic check-in signals. Never put this key in `frontend/.env.local` or commit it to source control.

### Authentication

Every financial route (dashboard, transactions, budgets, savings goals, Penny AI, and approval) requires `Authorization: Bearer <token>`. Missing or invalid tokens return 401; an authenticated user who does not own the data receives 403. Only the stateless `POST /api/v1/calculations/summary` and `/health` are public.

- **Supabase (default):** the browser signs in with the publishable key and sends the session access token. FastAPI verifies it against `PENNY_SUPABASE_URL/auth/v1/.well-known/jwks.json` (ES256 or RS256, cached for ten minutes), and checks the issuer, `aud=authenticated`, `role=authenticated`, expiry, and subject. `PENNY_SUPABASE_JWT_SECRET` is only for legacy HS256 projects.
- **Whose data:** the Supabase user whose UUID is in `PENNY_DEMO_OWNER_USER_ID` gets the fictional Maya data set. Every other signed-in user gets their own account, empty apart from a $0 chequing account and starter categories.
- **Offline demo (development only):** set `PENNY_DEMO_AUTH_TOKEN` in the backend plus `NEXT_PUBLIC_DEMO_MODE=true` and the same `NEXT_PUBLIC_DEMO_AUTH_TOKEN` in the frontend. The backend refuses to start if a demo token is configured outside `PENNY_ENVIRONMENT=development`, and the frontend never invents a token.

The backend reads `.env` and then `.env.local`. Its secrets (`PENNY_DATABASE_URL`, `PENNY_OPENAI_API_KEY`) stay server-side; no Supabase service-role key is used anywhere.

### 3. Next.js

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000`. The frontend health endpoint is `http://localhost:3000/api/health`; `/login` signs in with Supabase email and password, then returns to the dashboard. Without a session (or explicit demo mode), the dashboard shows a sign-in prompt instead of financial data.

### 4. iPhone app (optional)

`frontend/ios` is a native iOS app (Capacitor) that bundles the same UI as static files. It still calls FastAPI and Supabase over the network, so the Mac running FastAPI and the iPhone must be on the same network. You need full Xcode from the Mac App Store; the Command Line Tools alone can't build for a phone. A free Apple ID is enough.

**On this Mac (iOS Simulator).** The Simulator shares the Mac's network, so the usual FastAPI on `localhost:8000` works unchanged:

```bash
cd frontend
npm run ios:build:sim
npm run ios:open
```

In Xcode, pick an iPhone simulator as the run destination and press **Run** (no Apple ID needed). In Xcode 27 the simulator window is the **DeviceHub** app. Rerun `npm run ios:build:sim` and **Run** after frontend changes. A Simulator build can't reach FastAPI from a real iPhone; use the steps below for that.

**On an iPhone:**

1. Start FastAPI so other devices can reach it, and allow incoming connections if macOS asks:

   ```bash
   cd backend
   uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

2. Build the app with the Mac's network address (a phone can't reach `localhost`; the build refuses it):

   ```bash
   cd frontend
   NEXT_PUBLIC_API_BASE_URL=http://$(ipconfig getifaddr en0):8000 npm run ios:build
   npm run ios:open
   ```

3. In Xcode: **Settings → Accounts**, add your Apple ID. Select the **App** target → **Signing & Capabilities**, choose your **Personal Team**, and if the bundle identifier is taken, change `com.mehirkumar.penny` to something unique (also update `appId` in `capacitor.config.ts`).
4. Connect the iPhone by cable, tap **Trust**, pick it as the run destination, and press **Run**. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode** when asked (it restarts), then trust your Apple ID under **Settings → General → VPN & Device Management**.
5. Open Penny and tap **Allow** for local network access.

Rerun `npm run ios:build` after any frontend change or when the Mac's address changes. With a free Apple ID the install expires after 7 days; press **Run** again to renew it. If the Wi-Fi blocks devices from reaching each other (common on campus networks), connect the Mac to the iPhone's Personal Hotspot and rebuild with the new address.

## Where data is stored

`supabase/migrations/202610290001_initial_schema.sql` defines one table per kind of data, each keyed by the Supabase Auth user and deleted with them:

| Area | Tables |
| --- | --- |
| Profile | `profiles` (name, fictional flag, and a version number that stops two devices overwriting each other) |
| Money | `accounts`, `categories`, `transactions`, `budgets`, `savings_goals`, `goal_contributions`, `bills`, `pay_schedules`, `missions` |
| Learn | `learn_profiles`, `learn_results`, `learn_activity`, `learn_attempts` |
| Penny AI | `coach_conversations`, `coach_messages`, `coach_proposals` |
| Reminders (unused since email reminders were removed, D-100) | `reminder_settings`, `reminder_sent_keys`, `reminder_emails` |

Money is `bigint` cents. Only FastAPI touches these tables, over `PENNY_DATABASE_URL`: row level security is on with no policies, and the `anon` and `authenticated` roles have no grants, so the public Data API can't read or change them. All writes still go through the deterministic backend.

Each request loads the user's data in one query, runs the same integer-cent domain code as before (`backend/app/dashboard_store.py`), and saves only the rows that changed, in one transaction (`backend/app/db/`). If another tab or device saved first, an edit gets `409` ("refresh and try again") instead of overwriting. Penny AI chats are saved to the account and follow the user across devices; chats saved only on a device before this are uploaded once.

## Hosting

**API.** `backend/Dockerfile` runs on any container host (Render, Railway, Fly.io, Cloud Run). Point the host at the `backend` folder, expose the port it gives in `$PORT`, use `/health` as the health check, and set:

| Variable | Value |
| --- | --- |
| `PENNY_ENVIRONMENT` | `production` |
| `PENNY_DATABASE_URL` | Supabase **Session pooler** connection string (IPv4; the direct connection is IPv6-only) |
| `PENNY_SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `PENNY_FRONTEND_ORIGIN` | the hosted website's URL; more in `PENNY_EXTRA_ORIGINS`, comma-separated |
| `PENNY_DEMO_OWNER_USER_ID` | optional: the user who gets the Maya data |
| `PENNY_OPENAI_API_KEY` | optional: model answers |

Never set `PENNY_DEMO_AUTH_TOKEN` in production (the API refuses to start). Choose a region near the Supabase project: each request makes one or two database round trips.

**Website.** Host `frontend` on Vercel (or any Next.js host) with `NEXT_PUBLIC_API_BASE_URL` set to the API's `https://` URL, then add the site's URL to the API's allowed origins and to Supabase **Authentication → URL Configuration**.

**iPhone app.** Rebuild with the hosted API: `NEXT_PUBLIC_API_BASE_URL=https://<api> npm run ios:build`. The phone then works on any network.

## Verification

Automated verification is intentionally deferred during the active redesign phase. The Python modules in `backend/app/domain/finance.py` and `backend/app/coach/calculations.py` remain the authoritative financial calculation layer. Amounts are integer cents, and the frontend converts editable decimal strings to cents without floating-point money arithmetic. Run lint, type checking, builds, and end-to-end checks during the final verification phase before release.

## Repository map

```text
frontend/             Next.js, Tailwind CSS, shadcn/ui components, Supabase Auth client
frontend/ios/         Native iOS shell (Capacitor) around the static export of the frontend
backend/              FastAPI, Pydantic models, deterministic financial domain (app/domain), Penny AI (app/coach), Postgres persistence (app/db), Dockerfile
supabase/migrations/  Postgres schema, Auth trigger, grants, indexes, and RLS policies
docs/architecture.md  System boundaries and data flow
```
