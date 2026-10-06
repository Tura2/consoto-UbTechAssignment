# Research notes

Input for the design. Written 2026-10-06, before any code. Every API below was
called for real on that date; the responses quoted are what came back.

## 1. Reading takeaways

### Building effective agents

- **Workflows vs agents.** A workflow runs LLMs and tools through code paths you
  define. An agent lets the LLM decide its own steps. The advice is to use the
  simplest one that works and add autonomy only where it pays off.
- **Patterns that fit this brief:**
  - *Routing:* classify the message and send it to the right handler.
  - *Orchestrator-workers:* "subtasks aren't pre-defined, but determined by the
    orchestrator". This is what the brief's diagram describes.
  - *Parallelization:* independent specialists (weather, budget) run at the
    same time.
  - *Evaluator-optimizer:* a check that loops until clear criteria are met.
    The policy check followed by an itinerary fix fits this shape.
- **Three principles:** keep it simple, show the agent's planning steps
  (the brief asks for this in the UI), and invest in the tool interface.
- **Frameworks** "can obscure the underlying prompts and responses". If you use
  one, understand what it does underneath. Hand-written orchestration is easier
  to defend line by line.
- **Stopping conditions.** Cap the iterations of every tool loop.
- **Poka-yoke tools.** Shape the arguments so mistakes are hard to make. For
  example, a city parameter limited to the 5 cities we have data for, and ISO
  dates.

### Writing tools for agents

- **Don't wrap every endpoint.** Build tools around the task. For example, one
  `check_dates(city, start, end)` that returns the holidays on both sides plus a
  verdict, not two raw holiday lists the model has to cross-reference.
- **Return meaningful context.** Names and readable fields, not IDs. Support a
  concise vs detailed response where it helps.
- **Token efficiency.** Filter, truncate and summarize inside the tool (top N
  places plus a count, not 200 raw OSM elements).
- **Actionable errors.** "No cost data for Rome. Known cities: Lisbon,
  Barcelona, Athens, Prague, Budapest" beats a stack trace.
- **Namespacing.** Prefix tools by domain (`weather_`, `budget_`, ...) so each
  agent's toolset is clearly bounded.
- **Descriptions are prompts.** Write them like docs for a new teammate, with
  examples and clear boundaries from the other tools.

### Demystifying evals

- **Vocabulary:** task, trial, grader, transcript, outcome.
- **Graders:** use code-based graders where possible (fast, objective) and model
  graders for open-ended quality.
- **Start small:** "20-50 simple tasks drawn from real failures is a great
  start." Test both sides (the agent should and should not do X).
- **Grade outcomes, not paths.** pass@k vs pass^k: a customer-facing assistant
  needs pass^k (works every time).
- **Read the transcripts.**
- **For this project:** the deterministic parts (cost math, policy rules,
  holiday windows) get plain unit tests. The 3 demo messages plus panel-style
  curveballs ("make it 4 days", "what about Prague?", "what about Rome?") make
  a small scenario suite with code-checkable outcomes (the ILS total, the
  policy verdict, which tools were called).

## 2. Public APIs (verified 2026-10-06)

| API | Endpoint that works | What came back | Gotchas |
| --- | --- | --- | --- |
| Open-Meteo geocoding | `geocoding-api.open-meteo.com/v1/search?name=Lisbon&count=2` | Lisbon PT first (38.725, -9.150), Lisbon, Ohio second | Name is ambiguous. Filter by country code. |
| Open-Meteo forecast | `api.open-meteo.com/v1/forecast` | For 2027-03-16: `{"error":true,"reason":"Parameter 'start_date' is out of allowed range from 2026-07-05 to 2026-10-21"}` | Forecast reaches only about 16 days out. Check the range in code first; this is the "I don't have a forecast" case. |
| Open-Meteo archive | `archive-api.open-meteo.com/v1/archive?...&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` | Lisbon Mar 16-31 2025: highs 13.7-23.3 C, 33.9 mm of rain on Mar 20, dry from Mar 25 | One year is noisy. Average several years of the same window and label it a climate average. One call can cover many years; filter in code. |
| Frankfurter | `api.frankfurter.dev/v2/rates?base=EUR&quotes=ILS&providers=ECB` (or `/v2/providers/ecb/rate/eur/ils`) | `{"date":"2026-10-05","base":"EUR","quote":"ILS","rate":3.431}` | v1 is deprecated. The default v2 blends 100+ banks and returned 3.4384 dated today, which is **not** ECB. Pin `providers=ECB`. ECB publishes once per business day, so always show the rate date. |
| Nager.Date | `nagerholidays.com/api/v4/Holidays/PT/2027` | Good Friday 2027-03-26, Easter Sunday 2027-03-28 (`holidayTypes: ["Public"]`) | v4 lives on the new domain. `date.nager.at/api/v4` is a 404 (v3 there still works). Filter `holidayTypes` to Public: Carnival is "Optional". Regional holidays have `subdivisionCodes`. |
| Hebcal | `hebcal.com/hebcal?v=1&cfg=json&maj=on&min=on&mod=on&i=on&start=2027-03-15&end=2027-03-31` | Ta'anit Esther (fast) and Erev Purim on Mar 22, Purim on Mar 23 (major), Shushan Purim on Mar 24 (minor) | Decide which categories count as "a holiday in Israel". Purim yes; the fast day and Shushan Purim are judgment calls, so make the rule explicit in code. |
| OSM Overpass | `overpass-api.de/api/interpreter`, POST `data=...`, User-Agent header | Within 3 km of central Lisbon (`around:3000`, one query, 3 s): 2,793 food places, 89 vegan, 11 gluten-free, **1 kosher**, 105 wheelchair=yes, and only **3** that are vegan + gluten-free + wheelchair. None covers all four needs. | For about 10 minutes the main server returned **504 "too busy"**. The private.coffee and kumi.systems mirrors timed out at 60 s on every query. The maps.mail.ru mirror answered 2 of 4 whole-municipality queries in 24-29 s (4,179 food places, 107 vegan), then returned 504s. The main server recovered later. Mirrors are not a reliable fallback, so the cache is the real defense. The one kosher-tagged place is a Portuguese restaurant, so treat the tag with care. A radius query around geocoded coordinates is light (3 s); whole-municipality `area` queries are heavy. Needs one combined query per city, a disk cache, short timeouts, and an honest "map data unavailable" fallback. |

### Calendar facts for the demo window

March 2027 starts on a Monday. In the second half, Mar 16 is a Tuesday, the
blocked days are Mar 22-24 (Purim) and Mar 26 and 28 (Portugal), and the
weekends are Mar 20-21 and 27-28.

The pre-check's clean windows (Mar 16-18, 17-19, 29-31) quietly excluded
windows that include a Saturday (Mar 18-20, 19-21). The brief has no weekend
rule. Decide whether "no Saturday" (or no Fri-Sat) is a rule, and if so, state
it as an assumption.

"Second half of March" also has to resolve to a year in code. From
2026-10-06, that is March 2027.

### Costs at the live ECB rate (3.431, 2026-10-05)

Formula: flight + nights x hotel + days x (meals + activities), with 3 days and
2 nights.

| City | EUR | ILS per person |
| --- | --- | --- |
| Lisbon | 885 | ~3,036 |
| Barcelona | 935 | ~3,208 |
| Athens | 640 | ~2,196 |
| Prague | 670 | ~2,299 |
| Budapest | 640 | ~2,196 |

All five fit the 4,000 ILS budget. At 4 days and 3 nights, Lisbon is 1,120 EUR
(still in budget, breaks the 3-day rule) and Barcelona is 1,200 EUR, about
4,117 ILS (breaks both rules, so it needs the CFO).

## 3. OpenRouter (the only LLM provider)

- **Free models with tool calling** (from `GET /api/v1/models`, 15 on
  2026-10-06): for example `nvidia/nemotron-3-super-120b-a12b:free`,
  `google/gemma-4-31b-it:free`, `nvidia/nemotron-3-ultra-550b-a55b:free`,
  `dots-studio/dots-3-note-preview:free`, `poolside/laguna-s-2.1:free`. The
  lineup changes often, so model IDs belong in `.env`, not in code.
- **Limits on `:free` models:** 20 requests per minute. **50 requests per day**
  if the account never bought credits, 1,000 per day after $10 in lifetime
  credits. The daily cap is per account and shared across all free models.
  Our dev account has credits (1,000 per day). The README must still warn that
  a fresh account without credits gets 50 per day, since the panel may run it
  with their own key.
- **429 response:** `{"error":{"code":429,"message":"Rate limit exceeded",...}}`
  with `X-RateLimit-*` headers and sometimes `Retry-After`. Docs say to back off
  exponentially and honor `Retry-After`.
- **Built-in fallback:** a `models: [...]` array in the request. "Any error can
  trigger the use of a fallback model", including rate limits and downtime. The
  response's `model` field says which one answered, which the UI can show. This
  covers one busy model, not an exhausted daily quota.

## 4. What this means for the design (inputs, not decisions)

1. **Keep LLM calls lean.** With credits, the daily cap (1,000) is fine for
   development. The tighter limit is 20 per minute: a single message that fans
   out to several agents with tool loops can hit it in a burst, and free models
   also return 429s on their own when their upstream is busy. On a key without
   credits (50 per day), one 4-message demo at about 8 calls per message uses
   about 32. So: let code do the work, have each agent make as few LLM calls as
   possible, run independent specialists in parallel but within the per-minute
   budget, and count calls per turn in the UI and the logs.
2. **Overpass is the least reliable dependency.** Cache to disk, pre-warm the
   cache before the demo with a script (the brief asks for caching), show the
   data's age, and degrade honestly.
3. **Everything numeric or date-based is a pure function** with unit tests:
   cost, FX conversion, policy rules, holiday windows, forecast-range check.
   The LLM only picks which tools to call and writes the prose.
4. **Every tool result carries its source** (API name, URL, date fetched) so the
   UI can show sources and the answer can cite them.
5. **Open questions for brainstorming:** the backend language, the agent split
   and routing style (an LLM router vs a code-first plan), how conversation and
   trip state are stored, the streaming transport (SSE vs WebSocket), the
   weekend rule, which Hebcal categories count as a holiday, and how to handle
   the 50-requests-per-day cap.
