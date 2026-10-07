import type { PolicyVerdict, RuleStatus } from "../../../shared/domain";
import type { Card } from "../../../shared/events";
import { DIET_NAMES, eur, ils, pct, range, shortDate } from "../format";

type CardOf<K extends Card["kind"]> = Extract<Card, { kind: K }>;

export function CardView({ card }: { card: Card }) {
  switch (card.kind) {
    case "comparison":
      return <ComparisonCard card={card} />;
    case "cost":
      return <CostCard card={card} />;
    case "dates":
      return <DatesCard card={card} />;
    case "weather":
      return <WeatherCard card={card} />;
    case "venues":
      return <VenuesCard card={card} />;
    case "itinerary":
      return <ItineraryCard card={card} />;
    case "policy":
      return <PolicyCard card={card} />;
  }
}

function ComparisonCard({ card }: { card: CardOf<"comparison"> }) {
  return (
    <section className="card">
      <h3>Destinations compared</h3>
      <p className="muted">
        {card.days} days, {card.nights} nights{card.rate ? `. ECB rate ${card.rate.value} (${card.rate.date})` : ""}.
        {card.rows.some((row) => row.avgHighC !== null) && " Weather is a climate average of past years, not a forecast."}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>City</th>
              <th>Per person</th>
              <th>Team total</th>
              <th>Budget</th>
              <th>Clean windows</th>
              <th>Avg high</th>
              <th>Rainy days</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row) => (
              <tr key={row.city}>
                <td>{row.city}</td>
                <td>{ils(row.perPersonIls)}</td>
                <td>{ils(row.teamTotalIls)}</td>
                <td className={row.withinBudget === false ? "bad" : ""}>{row.withinBudget === null ? "no data" : row.withinBudget ? "within" : "over"}</td>
                <td>{row.cleanWindows ?? "-"}</td>
                <td>{row.avgHighC === null ? "-" : `${row.avgHighC} C`}</td>
                <td>{row.rainyDayShare === null ? "-" : pct(row.rainyDayShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CostCard({ card }: { card: CardOf<"cost"> }) {
  const e = card.estimate;
  const budget = e.budgetIlsPerPerson.toLocaleString("en-US");
  return (
    <section className="card">
      <h3>Cost for {e.city}</h3>
      <p className="muted">
        {e.days} days, {e.nights} nights, {e.teamSize} people. ECB rate {e.rate.value} ({e.rate.date}).
      </p>
      <table>
        <tbody>
          <tr><td>Return flight</td><td>{eur(e.breakdownEur.flight)}</td></tr>
          <tr><td>Hotel, {e.nights} nights</td><td>{eur(e.breakdownEur.hotel)}</td></tr>
          <tr><td>Meals, {e.days} days</td><td>{eur(e.breakdownEur.meals)}</td></tr>
          <tr><td>Activities, {e.days} days</td><td>{eur(e.breakdownEur.activities)}</td></tr>
          <tr className="total"><td>Per person</td><td>{eur(e.perPersonEur)} = {ils(e.perPersonIls)}</td></tr>
          <tr className="total"><td>Team of {e.teamSize}</td><td>{ils(e.teamTotalIls)}</td></tr>
        </tbody>
      </table>
      <p className={e.withinBudget ? "good" : "bad"}>
        {e.withinBudget
          ? `Within the ${budget} ILS per-person budget, with ${e.headroomIls.toLocaleString("en-US")} ILS to spare.`
          : `Over the ${budget} ILS per-person budget by ${(-e.headroomIls).toLocaleString("en-US")} ILS.`}
      </p>
    </section>
  );
}

function DatesCard({ card }: { card: CardOf<"dates"> }) {
  const clean = card.windows.filter((window) => window.clean);
  return (
    <section className="card">
      <h3>Dates for {card.city}, {range(card.from, card.to)}</h3>
      <h4>Holidays</h4>
      {card.holidays.length === 0 ? (
        <p className="muted">No holidays in this period.</p>
      ) : (
        <ul>
          {card.holidays.map((holiday) => (
            <li key={`${holiday.date}-${holiday.name}`}>
              {shortDate(holiday.date)}: {holiday.name} <span className="muted">({holiday.country}, via {holiday.source})</span>
            </li>
          ))}
        </ul>
      )}
      <h4>Clean windows</h4>
      {clean.length === 0 ? (
        <p className="bad">No clean window in this period.</p>
      ) : (
        <div className="chips">
          {clean.map((window) => (
            <span key={window.start} className="chip">
              {range(window.start, window.end)} ({window.weekdays.join("-")})
              {window.israeliWeekendDays.length > 0 && <em> includes the Israeli weekend</em>}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

function WeatherCard({ card }: { card: CardOf<"weather"> }) {
  const outlook = card.outlook;
  if (outlook.kind === "forecast") {
    return (
      <section className="card">
        <h3>Forecast for {card.city}</h3>
        <ul>
          {outlook.days.map((day) => (
            <li key={day.date}>
              {shortDate(day.date)}: {day.lowC} to {day.highC} C{day.rainChancePct !== null ? `, ${day.rainChancePct}% chance of rain` : ""}
            </li>
          ))}
        </ul>
      </section>
    );
  }
  const { stats } = outlook;
  return (
    <section className="card">
      <h3>Typical weather in {card.city}, {range(outlook.from, outlook.to)}</h3>
      <p className="notice">
        Climate average of {stats.years[0]}-{stats.years[stats.years.length - 1]}, not a forecast. {outlook.reason}
      </p>
      <p>
        Highs around {stats.avgHighC} C, lows around {stats.avgLowC} C. Rain on {pct(stats.rainyDayShare)} of days, {stats.avgRainMm} mm per day on average.
      </p>
    </section>
  );
}

function VenuesCard({ card }: { card: CardOf<"venues"> }) {
  const result = card.result;
  return (
    <section className="card">
      <h3>Food and access in {result.city}</h3>
      <p className="muted">From OpenStreetMap, within {result.radiusM / 1000} km of the center. A missing tag means unknown.</p>
      <ul>
        {result.needs.map((need) => (
          <li key={need}>
            <strong>{DIET_NAMES[need]}:</strong> {result.counts.byNeed[need] ?? 0} places
            {(result.byNeed[need] ?? []).length > 0 && `, for example ${(result.byNeed[need] ?? []).slice(0, 3).map((place) => place.name).join(", ")}`}
          </li>
        ))}
      </ul>
      <h4>Best matches</h4>
      <ul>
        {result.bestFood.map((place) => (
          <li key={place.id}>
            <a href={place.osmUrl} target="_blank" rel="noreferrer">{place.name}</a>{" "}
            <span className="muted">
              {place.diets.map((diet) => DIET_NAMES[diet]).join(", ") || "no diet tags"}; wheelchair {place.wheelchair}
            </span>
          </li>
        ))}
      </ul>
      <h4>Wheelchair-accessible sights</h4>
      <ul>
        {result.sights.map((place) => (
          <li key={place.id}>
            <a href={place.osmUrl} target="_blank" rel="noreferrer">{place.name}</a>
          </li>
        ))}
      </ul>
      {result.gaps.length > 0 && (
        <div className="notice warn">
          <strong>Gaps</strong>
          <ul>{result.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function ItineraryCard({ card }: { card: CardOf<"itinerary"> }) {
  const name = (id: string) => card.placeNames[id] ?? id;
  return (
    <section className="card">
      <h3>Draft plan for {card.city}</h3>
      {card.plan.days.map((day, index) => (
        <div key={day.date} className="day">
          <h4>Day {index + 1}, {shortDate(day.date)}</h4>
          <ul>
            {day.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <span className="slot">{item.slot}</span> {item.venueIds.map(name).join(" + ") || item.note}
                {item.catering.length > 0 && ` + ${item.catering.map((diet) => DIET_NAMES[diet].toLowerCase()).join(", ")} catering`}
                {item.note && item.venueIds.length > 0 && <span className="muted"> ({item.note})</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {card.check.problems.length > 0 && (
        <div className="notice bad">
          <strong>Problems</strong>
          <ul>{card.check.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
        </div>
      )}
      {card.check.notes.length > 0 && (
        <div className="notice warn">
          <strong>To confirm</strong>
          <ul>{card.check.notes.map((note) => <li key={note}>{note}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

const OVERALL: Record<PolicyVerdict["overall"], { text: string; tone: string }> = {
  within_policy: { text: "Within policy", tone: "good" },
  within_policy_if_actions: { text: "Within policy, if the actions below are taken", tone: "warn" },
  outside_policy: { text: "Outside policy", tone: "bad" },
  not_enough_data: { text: "Not enough data to decide yet", tone: "muted" },
};
const RULE_TONE: Record<RuleStatus, string> = { pass: "good", fail: "bad", needs_action: "warn", unknown: "muted" };
const RULE_LABEL: Record<RuleStatus, string> = { pass: "Pass", fail: "Fail", needs_action: "Action", unknown: "Unknown" };

function PolicyCard({ card }: { card: CardOf<"policy"> }) {
  const overall = OVERALL[card.verdict.overall];
  return (
    <section className="card">
      <h3>Policy check for {card.city}</h3>
      <p className={`verdict ${overall.tone}`}>{overall.text}</p>
      <ol className="rules">
        {card.verdict.rules.map((rule) => (
          <li key={rule.id}>
            <span className={`badge ${RULE_TONE[rule.status]}`}>{RULE_LABEL[rule.status]}</span> <strong>{rule.rule}</strong>
            <div>{rule.detail}</div>
            {rule.fix && <div className="fix">Fix: {rule.fix}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}
