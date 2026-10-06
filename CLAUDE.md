# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Consoto Offsite Assistant: a chat app with a multi-agent backend that plans team
offsites for "Consoto", a fictional 150-person software company in Tel Aviv.
Built for the U-BTech "Multi-Agent Chat Challenge" (Full Stack Engineer).

The original brief is `docs/assignment-brief.pdf` (kept local, gitignored). If
this file and the PDF disagree, the PDF wins.

## Hard requirements (from the brief)

- **Multi-agent.** An orchestrator plus at least two specialist agents, each
  with its own tools and instructions. One agent with many tools is explicitly
  rejected.
- **One conversation.** The three demo messages below are answered in order in
  the same chat, with memory of earlier turns. The panel then types one message
  of its own.
- **Visible work.** Answers stream. The chat shows which agent is working,
  which tool it called, and what came back.
- **Real data.** Consoto's internal data plus the public APIs, called for real.
  Nothing made up.
- **Numbers in code.** Costs, exchange rate, totals, dates, and policy rules are
  computed in code, never by the model.
- **Honest gaps.** Say so when data is missing (for example, March is past the
  16-day forecast window).
- **Clear policy verdict.** Within budget and rules or not, and if not, what can
  be done.
- **Rate limits.** Free models will hit limits. Fewer calls, retries with
  backoff, a fallback model or provider.
- **Free services only.** The panel runs the demo on the same free tiers.
- **One command to run.** Keys in `.env`, with `.env.example` committed.
- **README** with setup, architecture, trade-offs, and next steps. Someone else
  can run it in 5 minutes and add a tool without help.

### The three demo messages (from Maya, Head of AI)

1. "Hi, we want a 3 day offsite for the Platform team somewhere in Europe,
   second half of March. Where should we go?"
2. "Lisbon sounds good. What's the weather usually like then? And does it clash
   with any holidays, ours or theirs?"
3. "Ok, let's go with it. Can you draft the 3 days, make sure everyone can eat
   and get around, and tell me the total in shekels? Are we within policy?"

### What the panel grades

1. How the problem is split into agents, and why it needs more than one.
2. Tool design: inputs, outputs, error handling.
3. What the model does vs what code does.
4. Trust: streaming, visible steps, sources, saying "I don't know".
5. Full stack: API design, conversation state, a UI that doesn't freeze.
6. Failures: rate limits, API timeouts, the user changing their mind halfway.
7. Runnable from the README in 5 minutes, and extensible with a new tool.

## Decided

- **LLM:** OpenRouter only, `:free` models that support tool calling. No other
  providers (Gemini, Groq, Ollama). Fallback means falling back to other
  OpenRouter free models.
- **Frontend:** React.
- **No Docker.** The one-command start uses package scripts instead.
- **Backend:** Node.js + TypeScript. One runtime for whoever clones it, and
  shared TypeScript types between the backend and the UI.
- **UI:** one chat view. Answers stream, and each agent's steps (tool called,
  input, result, source) appear inline as expandable rows. Expanding a step
  shows the engineering detail (raw tool input and output, model, fallbacks,
  retries). No separate tracing tab.
- **Internal data:** the appendix data as JSON files in the repo, read only
  through one module (for example `getTeam`, `getPolicy`, `getCityCosts`). A
  real customer system would replace that one module (REST API or MCP server).
- **Runs locally.** No cloud deployment; the panel must be able to clone and
  run it.

## Architecture

See `README.md` ("How it works") and the spec in `docs/superpowers/specs/`. Server code is in
`server/src/` (orchestrator, agents, tools, domain, data, clients, llm, state); the React app is in
`web/src/`; shared types are in `shared/`.

## Commands

- `npm install && npm start`: build the UI and serve everything on http://localhost:3000
- `npm run dev`: server plus Vite with hot reload on http://localhost:5173
- `npm test` / `npm run typecheck`: unit tests and type checks (no network)
- `npm run warm-cache`: cache the demo's public API data
- `npm run eval [-- --scenario demo] [--trials 3]`: scenario evals against the real model
- `npm run check-models`: one tool call per configured model

## Data sources

### Consoto internal data (appendix of the brief)

- **Policy:** max 3 days and 2 nights; up to 4,000 ILS per person including
  flights, hotel, food and activities (above that needs CFO approval); no dates
  on an Israeli holiday or a public holiday in the destination country; every
  team meal has an option for every dietary need; all places and activities are
  accessible to everyone; costs planned in EUR and reported in ILS at the latest
  ECB rate.
- **Platform team (12):** Noa Levi (team lead), Omer Haddad (backend, vegan),
  Dana Mizrahi (backend), Yossi Ben-David (DevOps, uses a wheelchair), Tamar
  Peretz (frontend, vegan), Eitan Shapiro (backend, kosher), Lior Avraham (QA),
  Shira Katz (frontend, gluten-free), Amit Friedman (DevOps), Rotem Biton
  (data), Gil Azoulay (backend), Yael Dahan (product).
- **Costs (EUR per person):**

  | City | Return flight from TLV | Hotel per night | Meals per day | Activities per day |
  | --- | --- | --- | --- | --- |
  | Lisbon | 320 | 140 | 55 | 40 |
  | Barcelona | 300 | 160 | 60 | 45 |
  | Athens | 180 | 110 | 45 | 35 |
  | Prague | 260 | 100 | 40 | 30 |
  | Budapest | 240 | 95 | 40 | 30 |

### Public APIs (no key needed, cache results)

| API | Use | Notes |
| --- | --- | --- |
| Open-Meteo | Geocoding, 16-day forecast, historical weather since 1940 | Non-commercial use only |
| Frankfurter | EUR to ILS | Use the ECB provider |
| Nager.Date | Public holidays by country | Use the v4 API |
| Hebcal | Israeli holidays | Add `i=on` |
| OSM Overpass | Places by tag (vegan, kosher, gluten-free, wheelchair) | Must send a User-Agent |

## Domain notes

- **Cost formula is ambiguous.** "Hotel per night" for how many nights? Working
  interpretation: return flight + 2 hotel nights + 3 days of meals and
  activities, matching the 3-day, 2-night policy. State it in the UI and README.
- **"Somewhere in Europe"** but cost data exists for only 5 cities. Rank those
  5, and say plainly that there is no cost data for anywhere else.
- **Holidays.** Late March has Purim in Israel and Easter in Christian
  countries. Compute clean date windows from the holiday APIs, never hardcode.
- **Weather.** March is past the 16-day forecast. Use historical data for the
  same dates in past years and label it a climate average, not a forecast.
- **Food and access.** Kosher food and wheelchair access are sparse in OSM.
  Report gaps and propose fixes (for example, kosher catering). Never invent a
  venue.
- **Mind changes.** The panel's own message will likely switch city or break a
  rule ("what about Prague?", "make it 4 days"). The policy check is code that
  re-runs on the current plan, not prose.

## Conventions

- **No em dashes or en dashes** anywhere: code, UI strings, docs, commit
  messages, chat. Use a regular hyphen.
- **Commits:** plain messages with no `Co-Authored-By` trailer. Commit or push
  only when asked.
- **Every line must be defensible in a live code walkthrough.** Prefer simple,
  explicit code over clever abstractions. No dead code, no speculative
  features.
- **Secrets** live only in `.env`. Never commit it.
- **Cross-platform.** Developed on Windows, but the panel may run it anywhere.
  Scripts must not depend on a specific shell.

## Reference reading

- <https://www.anthropic.com/engineering/building-effective-agents>
- <https://www.anthropic.com/engineering/writing-tools-for-agents>
- <https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents>
