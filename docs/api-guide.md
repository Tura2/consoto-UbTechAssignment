# API guide

> Written before the code. Where this file and the code differ, the README is the source of truth.

How each external API works and how this project should call it: auth, the
request, pagination, rate limits, errors, caching, and how not to waste
requests. Checked on 2026-10-06 against the official docs and with live calls.
`research.md` has the broader research notes.

## At a glance

| API | Auth | Pagination | Official limit | Cache headers sent | Our cache | Requests in one demo (cold cache) |
| --- | --- | --- | --- | --- | --- | --- |
| Open-Meteo geocoding | None | None (`count`, max 100) | 600/min, 5,000/h, 10,000/day, weighted | None | Forever | 5, once ever |
| Open-Meteo archive | None | None (one date range) | Same, weighted by days and variables | None | Forever (past data) | 10 |
| Open-Meteo forecast | None | None | Same | None | 1 hour | 0 for March (code checks the range first) |
| Frankfurter v2 | None | None (time series via `from`/`to`) | No quotas, abuse protection only | `max-age` about 17 h, `stale-if-error` 1 day | Per `Cache-Control` | 1 |
| Nager.Date v4 | None | None (one country-year per call) | "No rate limits" | `max-age` 1 week | 1 week | Up to 5 |
| Hebcal | None | None (`start`/`end` range) | 90 requests per 10 s, then 429 | `max-age` 1 week, ETag | 1 week | 1 |
| OSM Overpass | None, but a User-Agent is required | None (limit with filters, radius, `out N`) | 4 slots per IP; about 100 queries/day for apps; no parallel queries | None | 7 days | 1 to 2 |
| OpenRouter | Bearer API key | Not applicable | Free models: 20/min; 50/day, or 1,000/day after $10 in credits | Not applicable | Never cache LLM output | Depends on the agent design |

Only OpenRouter needs a key. None of these APIs paginate. We control size with
filters and date ranges instead.

## Rules for every external call

These apply to all APIs. Each one is a single shared HTTP helper, not code
repeated per tool.

1. **Validate before calling.** Known city, ISO dates, dates inside the API's
   range. A request that is sure to fail is a wasted request. Example: a March
   trip is past the forecast window, so code returns "no forecast" without
   calling the forecast API.
2. **Cache first.** The key is the normalized request (URL with sorted params,
   or the Overpass query text). The cache is on disk so it survives restarts.
   TTLs are per API (table above).
3. **Deduplicate in-flight requests.** If two agents ask for the same thing at
   the same time, send one request and share the result.
4. **Serve stale on failure.** If the API fails and an expired cache entry
   exists, return it, labeled with its fetch date. Frankfurter's own headers
   allow this for a day (`stale-if-error=86400`).
5. **Retry only what can succeed.** Retry network errors, timeouts, 429, 502,
   503 and 504, at most twice, with exponential backoff and jitter, honoring
   `Retry-After`. Cap the total wait (for example 10 s) so the chat never
   freezes. Never retry 400, 401, 402, 403, 404 or 422: those mean bad input or
   a bug, and a retry is a wasted request. Return an actionable error to the
   agent instead. Overpass has stricter rules (see its section).
6. **Limit concurrency per host.** Overpass 1, OpenRouter by its per-minute
   budget, Open-Meteo 4, the rest 2.
7. **Set timeouts per API.** Most answer in under 1 s; Overpass can take
   15-30 s.
8. **Every result carries its source:** API name, URL, fetch time, and whether
   it came from cache. The UI uses this to show sources, and it covers the
   attribution the licenses ask for.
9. **Pre-warm before the demo.** A script runs the demo's data requests once,
   spaced out, so the live demo doesn't depend on Overpass being up at 10:30.
   The data is still real API data; the UI shows when it was fetched. The brief
   asks us to "cache API results where you can".

---

## Open-Meteo

**What it is:** a free weather service with three APIs we use: geocoding,
forecast, and historical (archive). No key. Free for non-commercial use, which
the brief says is fine. The data is CC BY 4.0, so credit Open-Meteo in sources.

**Limits** (pricing page): 600 calls/min, 5,000/hour, 10,000/day,
300,000/month. Calls are **weighted**: "more than 10 weather variables or
extending over a period of more than 2 weeks for a single location are
considered multiple API calls", counted fractionally (2 weeks with 15 variables
= 1.5 calls). No rate-limit or cache headers come back (checked), so we track
nothing from headers and cache on our side.

**Errors:** HTTP 400 with `{"error": true, "reason": "..."}`. Above the limits
expect HTTP 429 (not observed; we won't come near it).

**Several locations in one request:** comma-separated `latitude` and
`longitude` lists return a JSON **array**, one element per location, in the
same order. Checked: 5 cities in one request, 0.3 s.

### Geocoding

```text
GET https://geocoding-api.open-meteo.com/v1/search?name=Lisbon&count=1&language=en&countryCode=PT
```

- **Params:** `name` (prefix match, case and accent insensitive), `count`
  (default 10, max 100), `language`, `countryCode` (ISO alpha-2 filter).
- **Keep:** `name`, `latitude`, `longitude`, `country_code`, `timezone`.
- **Gotcha:** "Lisbon" also matches Lisbon, Ohio. Always pass `countryCode`
  (from our city data) and `count=1`.
- **Use:** once per city, cached forever, since cities don't move. That's 5
  requests in the app's lifetime. Keep it as a tool anyway, so a city we have
  no cost data for (the panel asks about Rome) can still get weather.

Checked results:

| City | Country | Lat | Lon | Timezone |
| --- | --- | --- | --- | --- |
| Lisbon | PT | 38.72509 | -9.1498 | Europe/Lisbon |
| Barcelona | ES | 41.38879 | 2.15899 | Europe/Madrid |
| Athens | GR | 37.98376 | 23.72784 | Europe/Athens |
| Prague | CZ | 50.08804 | 14.42076 | Europe/Prague |
| Budapest | HU | 47.49835 | 19.04045 | Europe/Budapest |

### Forecast

```text
GET https://api.open-meteo.com/v1/forecast?latitude=38.725&longitude=-9.150
    &daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code
    &timezone=auto&start_date=YYYY-MM-DD&end_date=YYYY-MM-DD
```

- **Window:** up to 16 days ahead (`forecast_days` max 16) and up to 92 days
  back. Out of range returns 400: `"Parameter 'start_date' is out of allowed
  range from 2026-07-05 to 2026-10-21"`.
- **Use:** code checks `trip_start <= today + 15 days` **before** calling. If
  it's out of range, don't call. Return `{available: false, reason: "Forecasts
  reach 16 days ahead; the trip starts in 161 days"}` and fall back to the
  climate average. That's the honest "no forecast" answer, and it costs zero
  requests. Call it only when the dates really are close (for example, the
  panel asks about next week).

### Archive (historical weather)

```text
GET https://archive-api.open-meteo.com/v1/archive?latitude=<5 lats>&longitude=<5 lons>
    &start_date=2025-03-16&end_date=2025-03-31
    &daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto
```

- **Data:** 1940 to about 5 days ago (ERA5 has a 5-day delay). The default
  "best match" blends IFS, ERA5 and ERA5-Land.
- **One year is noisy.** Lisbon had 33.9 mm of rain on 2025-03-20 and was dry
  a week later, so we average several years and label it a climate average.

There are two ways to get a 10-year average for 5 cities (both measured):

| Approach | HTTP requests | Weighted calls | Download | Time |
| --- | --- | --- | --- | --- |
| One continuous request, 2017-03-16 to 2026-03-31 | 1 | About 1,180 (3,303 days per city) | 457 KB | 1.0 s |
| One request per year, 16-day window each | 10 | About 57 | About 42 KB | 3.4 s one after another, under 1 s 4 at a time |

The weighted numbers assume each location counts separately, which the
pricing wording suggests. Either way we're far below 10,000 a day.

**Recommendation:** one request per year, sent in parallel, each cached
forever because past weather doesn't change. That's 20 times lighter on
Open-Meteo's quota and 10 times less data than the single big request.

Fetch the whole requested window (Mar 16-31) once. When the user narrows it to
Mar 29-31, compute that in code from the cached days, with no new request.
Code computes: average high and low, the share of days with at least 1 mm of
rain, average rain, and which years are covered.

Checked, 2017-2026, Mar 16-31:

| City | Avg high | Avg low | Days with rain (1 mm or more) | Avg rain per day |
| --- | --- | --- | --- | --- |
| Lisbon | 18.6 C | 10.8 C | 28% | 2.1 mm |
| Barcelona | 16.2 C | 8.1 C | 22% | 1.8 mm |
| Athens | 16.4 C | 8.3 C | 20% | 1.0 mm |
| Prague | 11.6 C | 1.7 C | 30% | 0.9 mm |
| Budapest | 13.3 C | 3.1 C | 22% | 1.6 mm |

**Conclusion:** geocode once and keep it forever. Never call the forecast
for dates past 16 days; code decides that. Get climate as per-year, 16-day
requests for all cities at once, cached forever, with stats computed in code.

---

## Frankfurter (exchange rates)

**What it is:** an open-source exchange-rate API. v2 blends 104 central banks;
v1 is deprecated (it was ECB only). No key.

**Request:**

```text
GET https://api.frankfurter.dev/v2/rates?base=EUR&quotes=ILS&providers=ECB
-> [{"date":"2026-10-05","base":"EUR","quote":"ILS","rate":3.431}]
```

`/v2/providers/ecb/rate/eur/ils` gives the same thing as a single object
instead of an array.

**Gotchas (checked):**

- **Without `providers=ECB`** you get the blended rate (3.4384, dated today).
  That breaks policy rule 6 ("using the latest ECB rate"). Always pin ECB.
- **Weekends and holidays.** Asking for Sunday 2026-10-04 returned Friday's
  rate, `"date":"2026-10-02", "rate":3.4408`. Always use the `date` in the
  response, never the date we asked for, and show it next to the total.
- **The response is an array** on `/v2/rates`, even for one pair.

**Pagination:** none. Time series use `from`/`to`, with `group=week|month` to
downsample and NDJSON for big series. We don't need a series.

**Limits:** "no quotas", with Cloudflare abuse protection only. Headers:
`cache-control: public, max-age=62704, stale-if-error=86400` plus an ETag.

**Errors:** `{"status": 422, "message": "invalid currency: XYZ"}`. Also 400 for
a bad parameter and 404 for not found.

**Use:** one shared cached value for all conversations, expiring per the
`max-age` in the response (ECB publishes once per business day). If the call
fails, use the stale value (up to 1 day, as the server allows) and label its
date. If there's no value at all, the budget agent says it can't convert and
shows euros only. The conversion and rounding happen in code.

**Conclusion:** 1 request a day, pinned to ECB, always showing the rate's date.

---

## Nager.Date (public holidays per country)

**What it is:** public holidays by country and year. v4 lives on a new
domain; the old `date.nager.at/api/v4` returns 404 (v3 there still works, with
different field names, so don't mix the two).

**Request:**

```text
GET https://nagerholidays.com/api/v4/Holidays/PT/2027
-> [{"date":"2027-03-26","name":"Good Friday","countryCode":"PT",
     "nationalHoliday":true,"subdivisionCodes":null,"holidayTypes":["Public"]}, ...]
```

Other v4 endpoints, from the OpenAPI spec at
`nagerholidays.com/openapi/community-v4.json`: `/api/v4/Countries/Available`,
`/api/v4/Countries/{code}`, `/api/v4/Holidays/{code}/Next`,
`/api/v4/IotHolidays/{isoCode}/IsToday/{offset}`, `/api/v4/Versions`. We only
need `Holidays/{code}/{year}`.

**Fields:** `holidayTypes` is a list from Public, Bank, School, Authorities,
Optional, Observance. `nationalHoliday` is false for regional holidays, which
list their `subdivisionCodes` (for example Azores, `PT-20`).

**Gotchas:**

- Keep only items whose `holidayTypes` include `Public`. Carnival (Feb 9) is
  `Optional`.
- Regional holidays count only if they cover the destination's subdivision
  (Lisbon is `PT-11`). Otherwise use national holidays only.
- A trip that crosses New Year needs two calls. Not our case.

**Pagination:** none, one country-year per call. **Limits:** the site says
"No Rate Limits". Header: `Cache-Control: public,max-age=604800` (1 week).

**Errors:** RFC "ProblemDetails" JSON, for example 404
`{"title":"Unknown country code","status":404,"detail":"..."}`; 400 for a bad
year.

**Use:** one call per destination country per year, cached 1 week. At most 5
calls (PT, ES, GR, CZ, HU) for all of 2027.

**Conclusion:** 1 call per country, cached a week, filtered to Public and
national (or matching subdivision) in code.

---

## Hebcal (Israeli holidays)

**What it is:** the Jewish calendar. `i=on` switches to the Israel schedule
(for example, one day of a holiday instead of two).

**Request:**

```text
GET https://www.hebcal.com/hebcal?v=1&cfg=json&i=on
    &maj=on&min=on&mod=on&mf=on&nx=off&ss=off&s=off&c=off
    &start=2027-03-01&end=2027-03-31
```

- `v=1` and `cfg=json` are required.
- `maj` / `min` / `mod` / `mf` are major, minor, modern (for example
  Independence Day) and minor fasts.
- `nx`, `ss`, `s` and `c` add Rosh Chodesh, special Shabbatot, the weekly Torah
  portion and candle lighting. Turn them off; we don't need them.
- Range is `start`/`end`, or `year` (+ `month`).

**Response:** `items[]` with `title`, `date`, `category` (holiday,
roshchodesh, ...), `subcat` (major, minor, fast, modern), `yomtov` (true on
full rest days), `hebrew`, `memo`.

Checked for late March 2027:

| Date | Item | category / subcat |
| --- | --- | --- |
| Mar 22 | Ta'anit Esther | holiday / fast |
| Mar 22 | Erev Purim | holiday / major |
| Mar 23 | Purim | holiday / major |
| Mar 24 | Shushan Purim | holiday / minor |

**Pagination:** none. **Limits:** "You may receive a 429 'Too Many Requests'
error if your client makes more than 90 requests in a 10-second window."
**Headers:** `cache-control: public, max-age=604800` plus an ETag.
**License:** CC BY 4.0, so credit Hebcal.com.

**Open decision:** which items block a date under policy rule 3 ("a holiday in
Israel")? Suggestion: `subcat` major or modern blocks a date, and minor and
fast days are shown as notes, not blockers. Decide in brainstorming and write
it in code as one explicit rule.

**Use:** one call per month (or per trip window with a margin), cached 1 week.
The calendar is fixed, so it could be cached longer.

**Conclusion:** 1 call per month of travel, cached, with the blocking rule in
code.

---

## OSM Overpass (places: food, accessibility)

**What it is:** OpenStreetMap (OSM) is the free, volunteer-built world map.
Every place has tags such as `amenity=restaurant`, `diet:vegan=yes`,
`wheelchair=yes`. Overpass is a read-only search engine over that data: we send
a query in its language (Overpass QL), and it returns the matching places with
their tags. The servers are run by volunteers and shared by everyone.

**Auth:** no key, but every request **must** send a `User-Agent` (or
`Referer`) that identifies the app, for example
`ConsotoOffsiteAssistant/0.1 (contact email)`.

**Request:** `POST https://overpass-api.de/api/interpreter` with a form body
`data=<query>`.

**Pagination:** none. We control size ourselves:

- **Tag filters**, so we only match what we need.
- **Radius:** `(around:3000,lat,lon)` is 3 km around the city center. This is
  light. Whole-municipality `area` queries are heavy and failed more often.
- **`out count`** returns numbers only, a few bytes.
- **`out tags center N`** returns at most N places, with tags and one point
  each and no shapes.

**Limits** (official docs):

- **Slots per IP:** the main server allows 4. Each query holds a slot for its
  run time plus a cooldown that "grows with the load of the server". A query
  waits up to 15 s for a free slot, then gets **429**.
- **Overload:** **504** "The server is probably too busy". This has nothing to
  do with our usage: we got 504s while the status page showed all 4 of our
  slots free.
- **Usage policy:** 10,000 queries and 1 GB per day for users; "regular
  applications should divide those limits by 100", so about 100 queries and
  10 MB a day. Running queries in parallel is prohibited. After a 429, wait
  30 s.
- **Server defaults:** timeout 180 s and 512 MiB. We set `[timeout:25]` so a
  stuck query fails fast.
- **Status:** `GET /api/status` shows free slots.

**Errors:** a 400 means a syntax error in the query. Error bodies are HTML or
XML even when we asked for JSON, so check the status and content type before
parsing.

**Observed on 2026-10-06:** the main server answered at times (3 s for a
radius count, 15 s for the 5-city count) and returned 504 at other times
(around 06:30-06:37 and 06:55-06:58 UTC). Mirrors: private.coffee and
kumi.systems timed out on every query. VK (maps.mail.ru) answered 2 of 4 heavy
queries in 24-29 s, then returned 504. **Overpass is the dependency most
likely to fail during the demo.**

### Do we need thousands of food places? No

- **The 4,179 was me measuring the haystack** (every restaurant, cafe and fast
  food place in Lisbon municipality). The app should never fetch that.
- **The brief asks for "places by tag: vegan, kosher, wheelchair".** Filtering
  by tag on the server is exactly the intended use.
- **We know the needs before asking OSM.** They come from Consoto's team data,
  not from the chat. The Platform team needs vegan (2 people), kosher (1),
  gluten-free (1) and wheelchair access (1). The tool builds its query from the
  team profile, so a different team automatically gets different tags.
- **Fetch details only for the chosen city, only when the conversation needs
  them.** That's message 3 ("make sure everyone can eat and get around") or a
  later city change. Messages 1 and 2 don't need restaurant lists.

### Two query shapes

**A. Counts, to rank cities (optional, message 1).** One request, `out count`
for each city and need: 20 numbers for 5 cities, 2.8 KB, 15 s.

```text
[out:json][timeout:25];
nwr["amenity"~"^(restaurant|cafe|fast_food)$"](around:3000,38.72509,-9.1498)->.f;
nwr.f["diet:vegan"~"^(yes|only)$"];out count;
nwr.f["diet:kosher"~"^(yes|only)$"];out count;
nwr.f["diet:gluten_free"~"^(yes|only)$"];out count;
nwr.f["wheelchair"="yes"];out count;
// ...same block for the other 4 cities, in the same request
```

Checked, 3 km around each center:

| City | Vegan | Kosher | Gluten-free | Wheelchair=yes |
| --- | --- | --- | --- | --- |
| Lisbon | 90 | 1 | 12 | 112 |
| Barcelona | 177 | 0 | 184 | 354 |
| Athens | 94 | 1 | 11 | 91 |
| Prague | 123 | 4 | 37 | 181 |
| Budapest | 131 | 4 | 42 | 204 |

These count **tags in OSM, not reality**. Barcelona shows 0 kosher-tagged
places, yet it certainly has kosher restaurants. Present them as "tagged in
OpenStreetMap" and weight them lightly in any ranking.

**B. Details for the chosen city (message 3).** One request: restaurants and
cafes within 3 km that carry any needed diet tag, plus wheelchair-accessible
sights (capped at 30).

```text
[out:json][timeout:25];
nwr["amenity"~"^(restaurant|cafe)$"](around:3000,38.72509,-9.1498)->.food;
(nwr.food["diet:vegan"~"^(yes|only)$"];
 nwr.food["diet:kosher"~"^(yes|only)$"];
 nwr.food["diet:gluten_free"~"^(yes|only)$"];)->.diet;
.diet out tags center;
nwr["tourism"~"^(museum|attraction|gallery|viewpoint)$"]["wheelchair"="yes"]
   (around:3000,38.72509,-9.1498);
out tags center 30;
```

Checked for Lisbon (it took two tries: both servers returned 504 at first,
then the main server answered 10 minutes later): **8 s, 76 KB, 89 diet-tagged
places and 25 wheelchair-accessible sights.**

- **Best matches:** Organi Chiado, AMUN Cafe and Ola Nepal House, each vegan +
  gluten-free + `wheelchair=yes`. None of them is kosher, so no single place
  covers the whole team.
- **Wheelchair tags on the 89 places:** 7 yes, 5 limited, 10 no, **67 not
  recorded (75%)**. "Unknown" is the normal case, so the answer has to say so.
- **The sights need light cleanup in code.** The same viewpoint came back as
  both a node and a way (dedupe by name), and one "attraction" is a single tree
  ("Figueira-da-Australia").

Code then ranks: places that cover the most needs first, `wheelchair=yes`
first. The model sees only the top few per need plus explicit gaps (for
example "kosher: 1 tagged place, wheelchair access not recorded"), never raw
OSM JSON.

**Reading tags honestly:**

- `diet:*` can be `yes`, `only`, `limited` or `no`. Count `yes` and `only` as
  covering, `limited` as partial.
- `wheelchair` can be `yes`, `limited` or `no`.
- **A missing tag means unknown,** not "no" and not "yes". Say "wheelchair
  access not recorded".

### Rate-limit guard

- One Overpass query at a time across the whole app, since policy forbids
  parallel queries.
- `[timeout:25]` in the query and about 30 s on the client.
- **On 504 or a timeout:** don't loop. Serve the cache (even stale, labeled),
  or return `{available: false, reason: "OpenStreetMap servers are overloaded
  right now"}`. The agent then says so and gives the practical fallback (book
  kosher catering, confirm step-free access with the venue).
- **On 429:** don't retry inside the chat turn. Policy says wait 30 s, which
  would freeze the UI. Same fallback.
- Cache 7 days per (city, radius, tags), since OSM changes slowly. Pre-warm all
  5 cities before the demo: 5 detail queries plus 1 count query, sent one at a
  time with pauses.
- **Attribution:** "(c) OpenStreetMap contributors" (ODbL) in the sources, and
  link each place to `https://www.openstreetmap.org/{type}/{id}`.

**Conclusion:** never fetch everything. Build the tag list from the team data,
query one city only when it's needed, run one query at a time, keep the
results in code, and treat the cache as the main defense.

---

## OpenRouter (the LLM)

**What it is:** one OpenAI-compatible API in front of hundreds of models. We
use `:free` models that support tool calling.

**Auth:** `Authorization: Bearer $OPENROUTER_API_KEY`. The optional headers
`HTTP-Referer` and `X-OpenRouter-Title` identify the app. Base URL
`https://openrouter.ai/api/v1`. The OpenAI SDK works by changing `baseURL`. A
missing or bad key returns 401 `{"error":{"message":"...","code":401}}`.

**Endpoints we use:**

- `POST /chat/completions` with `stream`, `tools`, `tool_choice`,
  `parallel_tool_calls`, `models` (fallbacks), `reasoning` and `max_tokens`.
- `GET /key` returns `limit_remaining`, `is_free_tier` and
  `free_model_daily_requests {used, limit, remaining}`. **It costs no LLM
  request.** Call it at startup and on a health endpoint, and show "free
  requests left today" in the UI.
- `GET /models` lists models. At startup, check that the model IDs in `.env`
  still exist and support tools (`supported_parameters` includes `tools`).

**Pagination:** none.

**Limits on free models:**

- 20 requests per minute.
- 50 per day without credits, or 1,000 per day after $10 in lifetime credits
  (your account has credits). The daily cap is per account and shared by all
  free models.
- Each free model's upstream provider can also return 429 on its own when it's
  busy, which is common on popular free models.
- A negative balance returns 402, even on free models.
- Cloudflare blocks extreme bursts.

**429 shape:**
`{"error":{"code":429,"message":"Rate limit exceeded","metadata":{"error_type":"rate_limit_exceeded"}}}`,
with `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`
headers, and `Retry-After` when the provider sends one.

| Code | Meaning | What we do |
| --- | --- | --- |
| 400 | Bad params | Don't retry. It's our bug, so log it. |
| 401 | Bad or missing key | Don't retry. Show a setup error. |
| 402 | No credits or negative balance | Don't retry. Show a clear message. |
| 403 | Moderation or guardrail | Don't retry. |
| 408 | Timeout | Retry once. |
| 429 | Rate limited | Back off, honor `Retry-After`, then try the next model. |
| 502 | Model down | Next model in the fallback list. |
| 503 | No provider available | Next model, or retry after `Retry-After`. |

**Fallback models:** `models: [primary, backup1, backup2]`. "By default, any
error can trigger the use of a fallback model", including rate limits and
downtime. The response's `model` field says which model answered; show it in
the UI. This doesn't help once the daily quota is gone. `openrouter/free` (a
router that picks an available free model, and supports tools) can be the last
resort, at the cost of an unpredictable model.

**Streaming (SSE):**

- Lines arrive as `data: {json}`. Skip lines that start with `:` (keepalives
  such as `: OPENROUTER PROCESSING`). The stream ends with `data: [DONE]`, and
  a usage chunk comes just before it.
- **Errors before the stream** are normal HTTP errors. **Errors mid-stream**
  arrive with HTTP 200 as a chunk with a top-level `error` and
  `finish_reason: "error"`, so check every chunk.
- **Tool calls stream as fragments.** The first delta carries `id` and the
  function `name`, and `arguments` arrive as string pieces. Merge by `index`,
  and `JSON.parse` only when `finish_reason` is `"tool_calls"`. The docs'
  sample just pushes deltas into an array, which breaks when arguments arrive
  in pieces.
- To cancel when the user stops or changes their mind, abort the request
  (AbortController). Supported providers stop processing right away.

**Tool loop:**

- Send `tools` on **every** request in the loop. The docs say it "must be
  included in every request".
- Return results as `{role: "tool", tool_call_id, content}`.
- Cap the iterations, for example 4.
- Keep `parallel_tool_calls` on so a model can request several tools in one
  turn, which means fewer LLM round trips.

**Reasoning models:** most free tool models have reasoning on by default (the
Nemotron, Inkling and Laguna families); the Gemma 4 models have it off.
Reasoning adds latency and counts against `max_tokens`. If it uses up the
budget, the response is 200 with `finish_reason: "length"` and empty content.
Detect that (`reasoning_tokens` close to `completion_tokens`) and retry with
lower effort. Options: a non-reasoning model for routing, and
`reasoning: {effort: "low"}` elsewhere. Pick after a quick latency test.

**Models change often.** Today 15 free models support tools, for example
`google/gemma-4-31b-it:free`, `nvidia/nemotron-3-super-120b-a12b:free` and
`dots-studio/dots-3-note-preview:free`. Keep model IDs in `.env`, check them
at startup.

**How not to waste LLM requests:**

1. Code does the deterministic work (money, dates, policy, ranking). The LLM
   routes and writes.
2. Don't ask the LLM anything code can answer, like "is this date in the
   forecast window?".
3. Consolidated tools plus parallel tool calls mean fewer round trips per
   agent.
4. Never retry 400, 401, 402 or 403.
5. Use a client-side limiter of 15 requests per rolling minute, leaving
   headroom under 20. Queue instead of firing.
6. Count LLM calls per turn and show them, along with the remaining daily
   quota from `GET /key`.
7. Run scenario evals on purpose, not on every save, since each run spends
   requests.

**Not yet checked live:** no key was set in this shell, so the streaming
tool-call shape, latency per free model and reasoning behavior get tested
first thing in the build.

**Conclusion:** use a fallback list of 2-3 free tool models plus
`openrouter/free`, a 15-per-minute client limiter, retries only on
429/502/503/408, check every stream chunk for errors, merge tool-call
fragments by index, and show the model and the quota in the UI.

---

## Request budget for the demo

External data requests (not LLM calls). This assumes the scout ranks all 5
cities on cost, holidays and climate (plus OSM counts, if we use them). The
final agent design may change it.

| Message | Data it needs | Cold cache | After pre-warm |
| --- | --- | --- | --- |
| 1. "Where should we go?" | Costs (internal, 0), FX 1, Hebcal 1, Nager 5, geocoding 5, climate 10, OSM counts 1 (optional) | About 23 | 0 |
| 2. "Lisbon: weather and holidays?" | Forecast range check (code, 0), climate and holidays already cached | 0 | 0 |
| 3. "Draft 3 days, food, access, ILS, policy" | OSM details for Lisbon 1; FX and costs cached or internal | 1 | 0 |
| Panel: "What about Prague?" | OSM details for Prague 1; the rest cached | 1 | 0 |

The live demo makes almost no external requests once the cache is warm, and
the ones it does make (OSM details for a new city) have an honest fallback.
LLM calls depend on the agent design, which is next.

## Sources

- Open-Meteo: <https://open-meteo.com/en/pricing>,
  <https://open-meteo.com/en/docs>,
  <https://open-meteo.com/en/docs/historical-weather-api>,
  <https://open-meteo.com/en/docs/geocoding-api>
- Frankfurter: <https://frankfurter.dev/docs/>
- Nager.Date: <https://nagerholidays.com/api>,
  <https://nagerholidays.com/openapi/community-v4.json>
- Hebcal: <https://www.hebcal.com/home/195/jewish-calendar-rest-api>,
  <https://www.hebcal.com/home/developer-apis>
- Overpass: <https://wiki.openstreetmap.org/wiki/Overpass_API>,
  <https://dev.overpass-api.de/overpass-doc/en/preface/commons.html>
- OpenRouter: <https://openrouter.ai/docs/api-reference/limits>,
  <https://openrouter.ai/docs/api-reference/errors>,
  <https://openrouter.ai/docs/api-reference/streaming>,
  <https://openrouter.ai/docs/api-reference/authentication>,
  <https://openrouter.ai/docs/guides/features/tool-calling.md>,
  <https://openrouter.ai/docs/guides/routing/model-fallbacks.md>,
  <https://openrouter.ai/docs/guides/best-practices/reasoning-tokens.md>
