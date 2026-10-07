# Consoto Offsite Assistant: Design

Date: 2026-10-06. Status: approved in brainstorming, pending written review.

Related: `docs/research.md` (reading notes, API research), `docs/api-guide.md`
(how each external API works and how we call it), `docs/assignment-brief.pdf`
(the original brief, local only).

## 1. Goal

A chat assistant that plans team offsites for Consoto, a fictional 150-person
software company in Tel Aviv. It answers by fetching real data (Consoto's
internal data and public APIs) through a multi-agent backend, and shows its
work while it streams.

It is built for the U-BTech "Multi-Agent Chat Challenge". It must handle, in one
chat and in order:

1. "Hi, we want a 3 day offsite for the Platform team somewhere in Europe,
   second half of March. Where should we go?"
2. "Lisbon sounds good. What's the weather usually like then? And does it clash
   with any holidays, ours or theirs?"
3. "Ok, let's go with it. Can you draft the 3 days, make sure everyone can eat
   and get around, and tell me the total in shekels? Are we within policy?"

Then one message written by the panel, likely a change of mind ("what about
Prague?") or a policy break ("make it 4 days").

### Success criteria (from the brief)

- An orchestrator plus at least two specialist agents, each with its own tools
  and instructions, and a visible explanation of how the orchestrator decides.
- All three messages answered in one chat, with memory of earlier turns.
- Streaming answers; the chat shows which agent is working, which tool it
  called and what it got back.
- Real data from Consoto's data and the public APIs, called for real.
- All numbers (costs, exchange rate, totals), dates and policy rules computed in
  code, not by the model.
- The assistant says so when it lacks data (for example, March is too far out
  for a forecast).
- A clear policy verdict, and what to do when the plan breaks a rule.
- Visible, graceful behavior when a free model hits its rate limit.
- Runs with one command; keys in `.env` with a committed `.env.example`; a
  README that lets someone run it in 5 minutes and add a tool without help.

## 2. Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| LLM provider | OpenRouter only, `:free` models with tool calling | Required free tier; one OpenAI-compatible API |
| Backend | Node.js 22+ and TypeScript, Express, run with `tsx` | One runtime for whoever clones it; shared types with the UI |
| Frontend | React + Vite + TypeScript | Required React; Vite is the standard fast setup |
| Orchestration | Hand-written on the official `openai` npm client | Every line explainable; the brief values design over library |
| Routing | Planner LLM call returns a validated JSON plan; code executes it | Predictable, visible routing; bounded LLM calls; testable |
| Internal data | Appendix data as JSON files, read through one module | Brief leaves access open; the module is the swap point for a REST API or MCP server later |
| Deployment | Local only; the panel can clone and run it | No Docker; `npm install && npm start` |
| Observability | Chat only, with expandable step rows | The brief requires steps in the chat; no separate trace tab |
| State | In memory per conversation, saved to `.cache/conversations/<id>.json` after every turn | One user, no login; survives a page refresh and a server restart, and feeds the History list |
| Weekend rule | None; label days that fall on the Israeli weekend (Fri, Sat) | The brief has no weekend rule |
| Israeli holiday rule | Every Hebcal item from major, minor and modern holidays (Israel schedule) blocks its date; minor fast days are excluded | Simple and cautious reading of policy rule 3 |
| Tests | Unit tests for code logic, plus a scenario eval script | Proves numbers live in code; the brief points to evals |
| Out of scope | CI, trace tab, auth, persistence across restarts, deployment, booking | Not required by the brief |

### Assumptions (stated in the UI and the README)

- **Cost formula.** The appendix says "Cost per person = return flight + hotel
  per night + meals and activities per day". We read it as
  `flight + nights * hotelPerNight + days * (mealsPerDay + activitiesPerDay)`,
  with `nights = days - 1`, matching the 3-day, 2-night policy.
- **Default length.** If the user gives no length, the trip is 3 days (the
  policy maximum).
- **Default dates.** If a city and search period are set but no start date,
  code picks the earliest clean window and the answer says it assumed it.
- **Year.** A month with no year means its next occurrence after today (from
  October 2026, "March" is March 2027).
- **Places.** Food and sights are searched within 3 km of the geocoded city
  center. A missing OSM tag means "unknown", never "yes" or "no".

## 3. Architecture

One Node.js process serves the API and the built React app on one port
(default 3000), so there is no CORS setup.

```text
Browser (React chat)
   |  POST /api/chat  ->  text/event-stream (typed events)
   v
Express server
   |-- orchestrator: plan (LLM) -> execute agents (code) -> policy check (code) -> answer (LLM, streamed)
   |-- agents: Budget & policy | Weather & calendar | Venues scout | Itinerary writer
   |-- tools: zod-validated functions; agents call them, and the orchestrator can call them directly
   |-- domain: pure functions (cost, policy, dates, climate, places, itinerary check)
   |-- data: Consoto JSON files behind consoto-data.ts
   |-- clients: shared HTTP helper + Open-Meteo, Frankfurter, Nager.Date, Hebcal, Overpass
   |-- llm: OpenRouter client with limiter, fallback models, retries
   v
Public APIs and OpenRouter
```

### Repo layout

```text
package.json            npm workspaces (server, web) and root scripts
.env.example            OPENROUTER_API_KEY, OPENROUTER_MODELS, PORT, LLM_REQUESTS_PER_MINUTE
shared/                 domain.ts (trip, results) and events.ts (stream events, cards, API payloads), types only; text.ts (cleanAnswer, the one runtime import)
server/src/
  index.ts              entry point: loads .env, config, starts the server, prints the health check
  app.ts                Express routes: POST /api/chat (SSE), GET /api/conversations/:id, /api/health, /api/agents, static web/dist
  config.ts             reads and validates env
  health.ts, runtime.ts OpenRouter health check; builds the real dependencies
  orchestrator/         plan.ts, trip.ts, turn.ts, answer.ts, cards.ts, tool-data.ts
  agents/               registry.ts (the four agents, their instructions and tools), ids.ts, runner.ts
  tools/                one file per tool + helpers.ts + types.ts (ToolResult)
  domain/               cost.ts, policy.ts, dates.ts, climate.ts, places.ts, itinerary-check.ts
  data/consoto/         team.json, policy.json, costs.json (appendix, verbatim)
  data/reference/       destinations.json (country and subdivision codes; not from the appendix)
  data/consoto-data.ts  getTeam, getPolicy, getCityCosts, listCities
  clients/              http.ts, data-sources.ts, open-meteo.ts, frankfurter.ts, nager.ts, hebcal.ts, overpass.ts
  llm/                  openrouter.ts (limiter, fallback, retries), schema.ts (zod to JSON schema)
  state/                conversations.ts (store, saved as JSON files)
  scripts/              warm-cache.ts, eval.ts, check-models.ts
  evals/                scenarios.ts, graders.ts
server/test/            unit tests (vitest) and fixtures recorded from live API calls
web/src/                main.tsx, App.tsx, api.ts, sse.ts, demo.ts, format.ts, components/, hooks/useChat.ts, state/turnReducer.ts
docs/                   research, API guide, specs, plans
.cache/                 disk cache for API responses (gitignored)
evals/runs/             eval transcripts (gitignored)
```

### Scripts

- `npm start`: builds the web app, then starts the server on `PORT`. Prints a
  clear message and exits if `OPENROUTER_API_KEY` is missing.
- `npm run dev`: server in watch mode plus the Vite dev server (proxy `/api` to
  the server), using `concurrently`.
- `npm test`: unit tests. `npm run typecheck`: `tsc` across workspaces.
- `npm run warm-cache`: fetches the demo's public API data ahead of time.
- `npm run eval`: runs the scenario evals against the real model.

### Dependencies

Server: `express`, `openai`, `zod`, `tsx`. Web: `react`, `react-dom`, `vite`,
`react-markdown`, `remark-gfm` (free models write markdown tables even when told not to). Dev: `typescript`, `vitest`, `concurrently`, `@types/*`. Any
addition needs a reason in the plan.

## 4. Data

### Consoto internal data (verbatim from the appendix)

- `team.json`: teams keyed by id. `platform`: 12 members, each with name, role,
  `dietary` (`vegan`, `kosher`, `gluten_free` or null) and `accessibility`
  (`wheelchair` or null).
- `policy.json`: the six rule texts verbatim, plus the parameters code uses:
  `maxDays: 3`, `maxNights: 2`, `budgetIlsPerPerson: 4000`,
  `overBudgetApprover: "CFO"`, `plannedCurrency: "EUR"`,
  `reportedCurrency: "ILS"`, `rateSource: "ECB"`.
- `costs.json`: EUR per person for Lisbon, Barcelona, Athens, Prague, Budapest:
  `returnFlight`, `hotelPerNight`, `mealsPerDay`, `activitiesPerDay`.

`consoto-data.ts` is the only code that reads these files. Its functions return
typed objects or a typed "not found" result listing what does exist.

### Reference data (ours, labeled as such)

`destinations.json` maps each cost-table city to `countryCode` (PT, ES, GR, CZ,
HU) and an optional `subdivisionCode` for regional holidays (Barcelona
`ES-CT`, which matters because Easter Monday 2027-03-29 is a Catalonia
holiday). Nager.Date lists no Lisbon-only holidays, so Lisbon has none. Both
were checked against live Nager.Date responses on 2026-10-06.

## 5. One turn

Conversation state, in memory and saved to disk after every turn, keyed by `conversationId` (kept in the browser
URL):

```ts
type Trip = {
  team: string | null;                    // "platform"
  region: string | null;                  // "Europe"
  searchWindow: { from: string; to: string } | null;   // ISO dates, resolved by code
  candidateCities: string[];              // cities the user named; otherwise all cities with cost data in the region
  city: string | null;                    // as typed; matched to known cities case-insensitively
  start: { date: string; source: "user" | "assumed" } | null;
  days: number;                           // default 3
  nights: number;                         // days - 1
};
type Conversation = {
  id: string;
  trip: Trip;
  findings: Partial<Record<AgentId, { depsKey: string; result: AgentResult }>>;
  turns: Turn[];                          // user message, events, answer text, status
  updatedAt: string;                      // ISO time of the last save
  activeTurn: AbortController | null;
};
```

### Steps

1. **Plan (LLM, forced tool call).** The planner gets the agent catalog, the
   trip state, the last 10 messages (stopped or failed turns included, with "(No answer: this turn was stopped or failed.)" as their answer) and the new message, and must call
   `submit_plan` (forced with `tool_choice`). Its input is validated with zod:

   ```ts
   {
     tripUpdate: {
       team?: string; region?: string; city?: string; candidateCities?: string[];
       searchPeriod?: { month: number; part: "whole" | "first_half" | "second_half" };
       startDay?: { month: number; day: number };   // only when the user names a date
       days?: number;
     };
     agents: { agent: "budget_policy" | "weather_calendar" | "venues" | "itinerary"; task: string }[];
     reason: string;          // shown in the chat
     clarify?: string;        // ask the user instead of running agents
   }
   ```

   The planner returns meanings, never computed dates. `tripUpdate` and `agents`
   are required (`{}` and `[]` when empty): with defaults the model treated them
   as optional and sometimes sent only `reason` and `clarify`. On invalid output
   it gets the zod error back once; if that also fails, the assistant asks the
   user to rephrase. It is also asked once more when the plan only asks a
   question although the trip already has cities and dates (seen live on the
   free model: "Which European cities?" for message 1), and when the plan runs
   `weather_calendar` or `itinerary` but neither the trip nor the plan has a
   search period or start date (seen live: "second half of March" with no
   `searchPeriod`); the second plan is accepted as it is, and if that attempt
   fails the first plan still runs.
2. **Update the trip (code).** Resolve `searchPeriod` to ISO dates (16th to the
   last day for `second_half`) and its year; resolve `startDay` to an ISO date
   inside the search window (or the next occurrence of that date if there is no
   window) with `source: "user"`; set `nights = days - 1`; match the city. When
   a region is set, code keeps only the `candidateCities` the user named in the
   message (the planner may invent others); if none remain, `candidateCities`
   is every city with cost data in the region; a region with no such cities becomes a tool gap. Values that
   break policy are kept as given; the policy check flags them. Findings whose `depsKey` no longer matches the trip are dropped.
   Emit `plan`. If `clarify` is set and the plan names no agents, stream it as the answer and end the turn (a plan that names agents runs them; seen live: agents plus "Which cities?").
3. **Run agents (code).** Independent agents run in parallel. The itinerary
   writer runs last and needs the venues finding for the current city and a
   start date; code runs the venues agent first if that finding is missing, and
   assigns the earliest clean window if there is no start date (via the
   `calendar_find_clean_windows` tool, called by code). The agent phase has a
   90-second budget; agents still running after that are aborted and marked
   `timeout`.
4. **Policy check (code).** Whenever the trip has a city, the orchestrator calls
   the `policy_check` tool directly (no model involved) and emits its steps.
5. **Cards (code).** Pure functions turn findings and the policy verdict into
   result cards (section 8).
6. **Answer (LLM, streamed).** Input: the user message, recent history, trip
   state, compact findings (summaries, trimmed tool data, gaps, sources), the
   policy verdict. Rules: use only numbers present in the input; restate at
   most the headline numbers and point to the cards; name every gap; say when a
   date was assumed; cite sources; keep it short. Emit `answer_delta` events,
   then `turn_end`. Code applies `cleanAnswer` (shared/text.ts) to the text: it strips
   tool-name citations such as `【budget_estimate_cost】` and replaces em and en
   dashes with a hyphen. The same function runs in the UI while streaming.

### Findings dependencies

| Agent | `depsKey` built from |
| --- | --- |
| budget_policy | cities, days, nights, team |
| weather_calendar | cities, searchWindow, days |
| venues | city, team |
| itinerary | city, start, days, team |

### Mind changes and cancellation

- "What about Prague?" sets `city: "Prague"`; findings tied to Lisbon are
  dropped; the planner picks the agents for the stage the user is at.
- "Make it 4 days" sets `days: 4`, `nights: 3`; cost is recomputed; rule 1
  fails with a computed fix.
- Only one turn runs per conversation. A new message, the Stop button, or a
  closed connection aborts the active turn: the `AbortSignal` reaches every LLM
  call and HTTP request. The partial turn is saved with status `stopped`.
- A city without cost data (Rome) or a team without data (Data team) returns a
  tool gap, and the answer says what is missing and what it can still do.

## 6. Agents and tools

Every tool is one file exporting `{ name, description, input (zod), execute }`.
`execute(input, ctx)` gets the trip state, an `AbortSignal` and an event
emitter, and returns:

```ts
type ToolResult =
  | { ok: true; summary: string; data: unknown; sources: Source[]; gaps: string[] }
  | { ok: false; summary: string; error: { code: string; message: string; hint: string } };
type Source = { name: string; url: string; fetchedAt: string; cached: boolean };
```

`summary` is one line written by code for the chat step. Invalid input returns
`ok: false` with a hint, so the model can correct the call.

| Agent | Tool | Input | Output |
| --- | --- | --- | --- |
| Budget & policy | `budget_get_team` | `team` | members, size, needs count (vegan 2, kosher 1, gluten_free 1, wheelchair 1) |
| | `budget_estimate_cost` | `cities[]`, `days`, `team` | per city: EUR breakdown, EUR and ILS per person, ILS team total, ECB rate and its date, budget fit and headroom |
| Weather & calendar | `calendar_find_clean_windows` | `cities[]`, `from`, `to`, `days` | Israeli and local holidays with sources; every window with weekdays, clashes, clean flag, Israeli-weekend note |
| | `weather_get_outlook` | `cities[]`, `from`, `to` | a daily forecast if the whole range is within 16 days, otherwise a labeled climate average and `forecastAvailable: false` with the reason |
| Venues scout | `places_find_for_team` | `city`, `team` | per need: top places with OSM links and wheelchair status; places covering the most needs; accessible sights; counts; gaps |
| Orchestrator (code only, no agent) | `policy_check` | none (reads the trip and findings) | rules 1-6 with status, detail and fix; overall verdict |
| Itinerary writer | `itinerary_submit_plan` | `days[{ date, items[{ slot, kind, venueIds[], catering[], note }] }]` | `accepted`, `problems[]`, `notes[]` from the code check |

Itinerary items: `slot` is `morning`, `lunch`, `afternoon` or `dinner`;
`kind` is `activity` or `meal`; `venueIds` are OSM ids from the venues finding
(for example `node/1831989609`); `catering` may list `kosher`, `vegan` or
`gluten_free` to cover a need no venue covers.

### Agent runner

- System prompt: the agent's instructions, today's date, the trip state. User
  message: the planner's task.
- Non-streaming LLM calls (only the final answer streams). Up to 3 rounds; tool
  calls from one round run in parallel (Overpass still runs one at a time).
- Every tool call emits `tool_start` and `tool_end`.
- Returns `AgentResult { agent, status, summary, toolResults[], gaps, sources }`.
  The orchestrator works from `toolResults`, not only from the model's summary.

The itinerary writer may submit at most twice: draft, read the code's
problems, fix, resubmit. After the second submission the last plan is kept and
its problems are reported (evaluator-optimizer pattern).

### Agent instructions (outline)

All agents: use only your tools, never compute or invent numbers, report gaps
plainly, end with a 2-3 sentence summary of what you found.

- Budget & policy: answers cost, budget and policy questions; compares cities
  on cost.
- Weather & calendar: holidays on both sides, clean windows, weather outlook;
  says "climate average, not a forecast" when that is what it has.
- Venues scout: finds food and sights that fit the team's needs; never claims
  accessibility or diet coverage that the data does not show.
- Itinerary writer: drafts the days from the verified venues only and fixes
  what the check reports. When a draft already exists, it sees the current
  draft, so "swap day 2 dinner" edits it instead of starting over.
- Planner: picks the smallest set of agents the message needs. Comparing
  destinations needs budget_policy and weather_calendar. Weather, holidays and
  dates need weather_calendar. Costs, totals and policy need budget_policy.
  Food, access and places need venues. A drafted plan needs itinerary. Use
  `clarify` only when essential information is missing and cannot be defaulted.

## 7. Domain rules (pure functions, unit tested)

- **Cost:** `perPersonEur = flight + nights * hotel + days * (meals + activities)`.
  `perPersonIls = perPersonEur * rate`; `teamTotalIls = perPersonIls * size`;
  both rounded to whole shekels only for display, from unrounded values.
- **Exchange rate:** Frankfurter v2 with `providers=ECB`; the rate's own `date`
  is shown with every ILS figure.
- **Holidays:** Israel = Hebcal (`i=on`, `maj`, `min`, `mod` on; `mf`, `nx`,
  `ss`, `s`, `c` off), every returned holiday blocks its date. Destination =
  Nager.Date v4 items whose `holidayTypes` include `Public` and that are
  national or list the city's `subdivisionCode`.
- **Windows:** every run of `days` consecutive dates inside the search window;
  clean when no day is blocked on either side; days falling on Friday or
  Saturday get an "Israeli weekend" note, never a block.
- **Weather:** forecast only when the whole range ends within today + 15 days.
  Otherwise climate: for each of the last 10 years with complete data for the
  window (2017-2026 for March), one archive request covering all requested
  cities; per city: average high, average low, share of days with at least
  1 mm of rain, average rain per day, and the years used.
- **Places:** Overpass radius 3000 m around the geocoded center. Diet tags come
  from the team's needs (`diet:vegan`, `diet:kosher`, `diet:gluten_free`, values
  `yes` or `only`). Wheelchair is read as `yes`, `limited`, `no` or `unknown`.
  Ranking: needs covered (desc), then wheelchair `yes`, `limited`, `unknown`,
  `no`. Sights: museum, attraction, gallery, viewpoint tagged `wheelchair=yes`,
  max 30, deduplicated by name. Gaps: no single place covers all diets; a need
  with zero places; more than half of the places with unknown wheelchair status.
- **Itinerary check:** dates match the trip; every venue id exists in the venues
  finding; every meal covers every team diet through venues or catering;
  wheelchair `no` is a problem, `limited` or `unknown` is a note to confirm.
- **Policy check:** status per rule is `pass`, `fail`, `needs_action` or
  `unknown`:
  1. Length: days and nights within limits, or fail with a computed fix
     ("Shorten to 3 days and 2 nights: N ILS per person").
  2. Budget: per-person ILS at most 4,000, or fail with the fix "needs CFO
     approval" plus the cities that fit at the same length, with their prices.
  3. Dates: start window clean, or fail with its clashes and the nearest clean
     windows; `unknown` with no start date.
  4. Meals: every meal covered by venues (pass), by catering (`needs_action`:
     book it), or not covered (fail); `unknown` without an itinerary.
  5. Access: every place `wheelchair=yes` (pass), any `limited` or `unknown`
     (`needs_action`: confirm step-free access), any `no` (fail); `unknown`
     without an itinerary.
  6. Currency: costs in EUR converted at the latest ECB rate (pass), or
     `unknown` if the rate is unavailable.

  Overall: any fail gives `outside_policy`; else any `needs_action` gives
  `within_policy_if_actions`; else any `unknown` gives `not_enough_data`; else
  `within_policy`.

## 8. Streaming and UI

### Transport

`POST /api/chat` with `{ conversationId?, message }` (1 to 2,000 characters)
responds with `text/event-stream`. Each event is one `data: <json>` line with a
`type` field; a `: ping` comment is sent every 15 seconds. The browser reads it
with `fetch` and a stream reader, and stops it with `AbortController`.

Other routes: `GET /api/conversations/:id` (turns, events and answers, for
reloading), `GET /api/health` (key valid, free requests left today from
OpenRouter `GET /key`, configured models still listed with tool support),
`GET /api/agents` (the agent registry for the "How it works" drawer).

### Events (`shared/src/events.ts`)

| Event | Payload | Chat rendering |
| --- | --- | --- |
| `turn_start` | conversationId, turnId | new assistant turn |
| `plan` | agents[{agent, task}], reason, trip, clarify? | "Orchestrator: running X and Y, because ..." |
| `agent_start` / `agent_end` | agent, task / status, summary | agent group with spinner, then check or warning |
| `tool_start` / `tool_end` | callId, agent or `orchestrator`, tool, input / ok, summary, data, sources, gaps, cached, ms | one-line step, expandable |
| `llm_call` | who, model, attempt, status (`ok`, `rate_limited`, `error`, `empty`), ms, tokens | detail inside the step; `rate_limited` shows a warning row |
| `llm_wait` | who, waitMs, reason (`local_limit`, `retry_after`) | "waiting for a free slot" row |
| `card` | kind, data | result card |
| `answer_delta` | text | streamed answer |
| `turn_end` | status (`done`, `stopped`, `error`), llmCalls, ms, error? | footer: "done in 14 s, 7 LLM calls" |

### Layout

- Header: app name; "How it works" drawer (agents, their tools, how the
  orchestrator routes, from `GET /api/agents`); New chat; free requests left
  today (from `GET /api/health`).
- Each assistant turn: a compact steps block (collapses after the turn ends),
  then result cards, then the answer. Expanding a step shows raw input and
  output, sources, cache status, model, attempts and fallbacks.
- Cards: once a city is chosen, the cards are built for that city only; `comparison` appears only before a city is chosen (per city: ILS per person, team total, budget fit, clean
  windows, average high, rainy-day share), `dates` (holidays and windows),
  `weather` (forecast or labeled climate average), `cost` (breakdown, rate and
  date), `policy` (rules with status and fixes, overall verdict), `venues`
  (coverage per need, top places, gaps), `itinerary` (days, slots, venues,
  access notes).
- Composer: Send becomes Stop while streaming; sending mid-turn aborts the turn.
- Empty state: a short explanation; the user types the messages. A finished demo conversation (, committed) shows under History.
- Rendering: a reducer applies events to the current turn; answer text is
  appended; large JSON renders only when a step is expanded.
- Styling: plain CSS with CSS variables; no UI framework.

## 9. Failure handling

### LLM (OpenRouter)

- `OPENROUTER_MODELS` is an ordered list of free tool-capable models, ending
  with `openrouter/free`. Default:
  `google/gemma-4-31b-it:free,nvidia/nemotron-3-super-120b-a12b:free,openrouter/free`.
  The first implementation task checks latency and tool calling for the
  defaults and reorders them if needed.
- Fallback is our own loop, not OpenRouter's `models` parameter, so every
  attempt is visible in the chat. On 429, 5xx, 408, a network error, an empty
  reply, or a 400 or 404 that one model cannot serve, emit `llm_call` with the
  status and try the next model at once. When the list is exhausted, wait
  (`Retry-After`, capped at 10 s, else 2 s) and run the list once more. Then
  fail the call. A 429 for OpenRouter's free daily cap (`free-models-per-day`)
  is the exception: no model can help, so it is a fatal error with a clear
  message.
- 401, 402 and 403 are account-level: no retry, no fallback, and the error
  names the fix (for example "check OPENROUTER_API_KEY").
- A local limiter allows `LLM_REQUESTS_PER_MINUTE` (default 15) attempts per
  rolling minute and queues the rest, emitting `llm_wait`.
- Requests send `reasoning: { effort: "low" }` and generous `max_tokens` (5000 for
  the planner). A reply with `finish_reason: "length"` counts as a failed
  attempt, even if it has text or tool calls, and falls back to the next model.
- If the answer stream fails midway, the partial text stays and the turn ends
  with `error`; the UI offers "Try again", which resends the message.
- The answer stream reader checks each chunk for a top-level `error` field, in
  case the `openai` client does not raise OpenRouter's mid-stream errors itself
  (checked during implementation).

### Agents

- A failed or timed-out agent marks its group with a warning; the other agents
  and the answer continue; the answer names what is missing.
- Limits: 3 tool rounds per agent, 2 itinerary submissions, 90 s for the agent
  phase.

### Public APIs (details in `docs/api-guide.md`)

- One shared HTTP helper: per-API timeout, disk cache with per-API TTL, in-flight
  deduplication, retries only on network errors, timeouts, 429 and 5xx (max 2,
  with backoff and `Retry-After`, capped at 10 s total), stale cache served on
  failure and labeled with its fetch date, `User-Agent` on every request.
- Overpass: one query at a time, `[timeout:25]`, no retries inside a turn; on
  429, 504 or timeout use the cache or return a gap ("map servers are busy").
- `npm run warm-cache` fetches all demo data for the five cities ahead of time,
  with Overpass queries spaced out.

### Honest gaps (decided by code)

Forecast out of range, a city without cost data, a team without data, OSM tags
missing, an API down with no cache: each becomes a tool gap, and the answer
prompt requires naming every gap without filling it in.

## 10. Testing

### Unit tests (`npm test`, no network, no LLM)

- Cost formula for each city at 3/2 and 4/3 days and nights; ILS conversion and
  rounding; team totals.
- Every policy rule in each status, the fixes, and the overall verdict.
- Search-period resolution against a fixed "today"; clean windows from recorded
  holiday lists; weekend notes; the Hebcal and Nager filters.
- Forecast-range check; climate statistics from recorded archive responses.
- OSM tag reading, ranking, deduplication and gaps.
- The itinerary check.
- Client parsing of recorded responses and error mapping (Frankfurter 422,
  Nager 404, Overpass HTML 504).
- The LLM wrapper: retry classification, fallback order, the limiter.
- The planner schema and trip update, including `depsKey` invalidation.

Fixtures are real responses recorded from the live APIs.

### Scenario evals (`npm run eval`)

Runs real turns in-process against the real model and APIs. Graders are code
that inspects events, cards, trip state and answer text:

- Demo, message 1: the plan includes `budget_policy` and `weather_calendar`; the
  comparison card has 5 cities; Lisbon's per-person ILS equals the domain
  calculation at the run's ECB rate.
- Demo, message 2: the plan includes `weather_calendar`; the weather card is a
  climate average; the dates card lists Purim (2027-03-23) and Good Friday
  (2027-03-26); the answer says it is an average, not a forecast.
- Demo, message 3: an itinerary card with 3 days; the cost card's team total
  equals per-person cost times 12; a policy card; the answer mentions kosher.
- "Make it 4 days": `trip.days` is 4; rule 1 fails; a fix mentions 3 days.
- "What about Prague?": `trip.city` is Prague; the cost card is for Prague.
- "What about Rome?": a gap names Rome; the answer says there is no cost data.
- "Plan it for the Data team": a gap about the team; the answer says there is
  no data for it.

Options: `--scenario <name>`, `--trials <n>` (reports pass^k). Each run prints a
pass/fail table and saves full transcripts to `evals/runs/` for reading. A full
run costs about 50 to 55 LLM requests.

## 11. README (English)

Setup in 5 minutes (Node 22+, an OpenRouter key, `npm install && npm start`,
and a note that accounts without credits get 50 free requests per day);
architecture diagram; agents table; how the orchestrator decides; model vs code
responsibilities; failure handling; assumptions; trade-offs (files vs REST or
MCP, planner vs agents-as-tools, our fallback loop vs OpenRouter's `models`,
JSON-file state); what we would do next (internal data as an MCP server,
a database for conversations, a trace view or OpenTelemetry export, CI, more teams and
cities); "Adding a tool" in three steps (create the tool file, add it to one
agent's tool list, add a unit test); how to run the evals; data attribution
(OpenStreetMap contributors, Open-Meteo, Hebcal, ECB via Frankfurter,
Nager.Date).

## 12. Expected demo behavior

1. **Message 1:** the planner sets team `platform`, region Europe, search
   window 2027-03-16 to 2027-03-31, 3 days, and runs Budget & policy and
   Weather & calendar for the 5 cities in parallel. Cards: comparison table.
   The answer recommends a city with reasons from the table and says there is
   cost data only for these 5 cities.
2. **Message 2:** city Lisbon; Weather & calendar runs for Lisbon. The forecast
   is unavailable (161 days out), so the climate average is shown and labeled.
   The dates card shows Purim (Mar 22-24) and Portugal's Good Friday and Easter
   (Mar 26, 28) and the clean windows Mar 16-18, 17-19, 18-20, 19-21 and 29-31,
   with weekend notes.
3. **Message 3:** start assumed as Mar 16-18 (said in the answer); Venues and
   Budget & policy run in parallel, then the itinerary writer; the policy check
   runs in code. Expected verdict: within budget (about 3,036 ILS per person at
   3.431), with actions: kosher catering (no tagged place covers every diet) and
   confirming step-free access where OSM has no data.
4. **Panel message:** handled through the same plan and executor; mind changes
   re-run only what depends on the changed fact.
