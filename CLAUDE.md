# Upstox Agents prototype: context for agents

An internal prototype, built by an Upstox PM (Jayesh), of **a personal team of AI
agents inside the Upstox app**. Its purpose is to show leadership what "agents that
do investing work for you" looks like. It is not a production Upstox product.

**Read [docs/HANDOVER.md](docs/HANDOVER.md) before starting work.** It covers the
current state, what's verified and what isn't, how to work alongside the other
laptop, and what's next. [docs/STRATEGY.md](docs/STRATEGY.md) has the product
thinking behind it, and [docs/PRODUCT.md](docs/PRODUCT.md) the step-by-step plan.

## The one rule

**No agent ever places an order.** Every action an agent wants becomes a request
card with its numbers and reasons. Only the user's slide turns it into an order.
There is deliberately **no code path to a live order endpoint**: orders are
practice fills or go to Upstox's sandbox. Don't add one.

## Run, test, build

```bash
npm install
npm run dev            # app http://localhost:5173, API :8787 (local mode: one person, files in data/)
npm test               # 69 tests: approval engine, AI layer (scripted model), screens, hosted pieces
npm run typecheck
npm run build          # run before every push
npm run vercel-build   # the Vercel output in .vercel/output
```

`.env` is optional locally (see `.env.example`). `AGENTS_HOSTED=1` plus the hosted
variables makes a local run behave like Vercel. That writes to the **real**
Supabase table, so sign in with a test email.

## Where things are

| Area | Files |
|---|---|
| Routes (one person per request) | `server/app.ts`; local server `server/index.ts`; Vercel function `server/vercel.ts` |
| A person's desk (Upstox client, prices, broker, engine, chat, agents) | `server/desk.ts` |
| Approval engine (propose, approve, batch, price band, expiry, mandates, audit) | `server/engine.ts`, `server/mandate.ts` |
| Sign-in (email domain + access code + PIN, signed cookie) | `server/auth.ts` |
| Each person's Upstox tokens (AES-256-GCM) | `server/secrets.ts` |
| Storage: files locally, Supabase hosted, lock per person | `server/store/` (`types.ts`, `file.ts`, `supabase.ts`); SQL in `supabase/agents.sql` |
| Upstox REST client, token checks, daily login (OAuth) | `server/upstox.ts`; candles, news, fundamentals `server/data.ts` |
| Prices (live, or demo drift around real closes) | `server/market.ts`; holdings, charges, fills `server/broker.ts` |
| Claude: client, tools, loop, prompts, chat, agent runs, brief | `server/ai/` |
| Screens the assistant builds (A2UI v0.9): catalog, checks, renderer | catalog `shared/a2ui.ts`; `show_ui` checks and presses `server/ai/ui.ts`; renderer (lazy chunk) `web/src/a2ui/` (`components.tsx`, `runtime.tsx`, `host.ts`); in the chat `web/src/screens/Ask.tsx` |
| Settings from the environment | `server/config.ts` |
| App screens | `web/src/screens/` (Home, Ask, Approvals, Agents, Activity, Settings, SignIn); kit `web/src/components/ui.tsx`; polling `web/src/api.ts` |
| Vercel build (Build Output API, function in bom1) | `scripts/build-vercel.ts`, `vercel.json` |
| Deploying, settings, admin SQL | `DEPLOY.md` |
| Upstox API reference (copied from custom-screener) | `docs/upstox-api-notes.md` |

## Rules

- **`main` auto-deploys to Vercel** (the live app colleagues use). Work on a branch,
  run `npm test` and `npm run build`, and merge only working code.
- **Never commit secrets.** Env values live in Vercel and in a file the owner keeps;
  the database key lives in Supabase Vault (`agents_server_key`). `data/*` and
  `.env*` are git-ignored on purpose.
- **Numbers come from code, never from the model.** Tools compute every figure;
  the model explains it.
- **The server enforces each agent's limits** whatever the model asks for.
- **Screens (A2UI) can't act.** A screen's buttons only send the user's choices back to
  the assistant or open a tab; a filed request shows as `OrderRequest`, the normal
  approval card. Never add a component or function that places, approves or links out
  (`openUrl` is left out on purpose). Every screen passes A2UI's strict processor on the
  server first. Add a component in `shared/a2ui.ts` (schema + a line in `CATALOG_GUIDE`)
  and draw it in `web/src/a2ui/components.tsx`; `test/screens.test.ts` checks the guide
  lists every component. `@a2ui/*` are pinned to 0.13.0 (with `@a2ui/markdown-it` held
  at 0.2.1); upgrade them together and rerun the tests.
- **Hosted mode never uses `.env` Upstox tokens**: each person's own only.
- **Database:** the Supabase project is "Scanners" (`bvxsqcoprnggxlpqkmcz`), shared
  with the owner's other app, `custom-screener`. This app owns only `public.agents_kv`
  and the `agents_*` functions. Don't touch anything else there. Run DELETE/DROP in the
  dashboard's SQL Editor: the Supabase MCP holds those for a confirmation that never
  arrives.
- **Design like a retail consumer app** (the owner's standing rule): plain words, one
  obvious main button per screen, phone first (375 px, 44 px targets, no sideways
  scroll), Undo toasts instead of "are you sure?", money confirmed by sliding, colour
  tokens from `web/src/styles.css` only.
- **Claude API:** default `claude-sonnet-5-5`, Opus 5.5 switchable per person. Always
  pass `effort` (Sonnet 5.5 defaults to high). Don't send `thinking: {type: "disabled"}`
  or a forced `tool_choice` (both are rejected). Keep the conversation append-only.
  Check the `claude-api` skill before changing `server/ai/model.ts`.
