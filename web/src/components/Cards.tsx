import {
  Accessibility,
  CalendarDays,
  CircleCheck,
  CircleHelp,
  CircleX,
  CloudRain,
  Droplets,
  Info,
  Leaf,
  Moon,
  Receipt,
  Route,
  Scale,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  ShieldX,
  Sun,
  Sunrise,
  Thermometer,
  TriangleAlert,
  Utensils,
  UtensilsCrossed,
  WheatOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import type { DietNeed, ItinerarySlot, PolicyVerdict, RuleStatus } from "../../../shared/domain";
import type { Card } from "../../../shared/events";
import { calendarDays } from "../calendar";
import { DIET_NAMES, eur, ils, pct, range, shortDate } from "../format";
import { OwnerTag, toneClass, type Owner } from "./icons";

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

// Every card names the agents whose tool results it shows; the top border takes the first one's colour.
function CardShell(props: { icon: LucideIcon; title: string; owners: Owner[]; note?: ReactNode; children: ReactNode }) {
  const Icon = props.icon;
  return (
    <section className={`card ${toneClass(props.owners[0])}`}>
      <header className="card-head">
        <Icon size={18} className="card-icon" aria-hidden="true" />
        <h3>{props.title}</h3>
        <span className="card-owners">
          {props.owners.map((owner) => (
            <OwnerTag key={owner} owner={owner} />
          ))}
        </span>
      </header>
      {props.note && <p className="card-note">{props.note}</p>}
      {props.children}
    </section>
  );
}

function ComparisonCard({ card }: { card: CardOf<"comparison"> }) {
  const costs = card.rows.map((row) => row.perPersonIls).filter((value): value is number => value !== null);
  const windows = card.rows.map((row) => row.cleanWindows).filter((value): value is number => value !== null);
  const cheapest = costs.length > 0 ? Math.min(...costs) : null;
  const mostWindows = windows.length > 0 ? Math.max(...windows) : null;
  const note = (
    <>
      {card.days} days, {card.nights} nights{card.rate ? `. ECB rate ${card.rate.value} (${card.rate.date})` : ""}.
      {card.rows.some((row) => row.avgHighC !== null) && " Weather is a climate average of past years, not a forecast."}
    </>
  );
  return (
    <CardShell icon={Scale} title="Destinations compared" owners={["budget_policy", "weather_calendar"]} note={note}>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>City</th>
              <th className="num">Per person</th>
              <th className="num">Team total</th>
              <th>Budget</th>
              <th className="num">Clean windows</th>
              <th className="num">Avg high</th>
              <th className="num">Rainy days</th>
            </tr>
          </thead>
          <tbody>
            {card.rows.map((row) => (
              <tr key={row.city}>
                <th scope="row">{row.city}</th>
                <td className={`num ${row.perPersonIls !== null && row.perPersonIls === cheapest ? "best" : ""}`}>{ils(row.perPersonIls)}</td>
                <td className="num">{ils(row.teamTotalIls)}</td>
                <td>
                  <span className={`state-pill ${row.withinBudget === null ? "muted" : row.withinBudget ? "good" : "bad"}`}>
                    {row.withinBudget === null ? "no data" : row.withinBudget ? "within" : "over"}
                  </span>
                </td>
                <td className={`num ${row.cleanWindows !== null && row.cleanWindows === mostWindows ? "best" : ""}`}>{row.cleanWindows ?? "-"}</td>
                <td className="num">{row.avgHighC === null ? "-" : `${row.avgHighC} °C`}</td>
                <td className="num">{row.rainyDayShare === null ? "-" : pct(row.rainyDayShare)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="card-foot">Highlighted: the lowest cost per person and the most clean 3-day windows.</p>
    </CardShell>
  );
}

function CostCard({ card }: { card: CardOf<"cost"> }) {
  const e = card.estimate;
  const budget = e.budgetIlsPerPerson.toLocaleString("en-US");
  const lines: [string, string][] = [
    ["Return flight", eur(e.breakdownEur.flight)],
    [`Hotel, ${e.nights} nights`, eur(e.breakdownEur.hotel)],
    [`Meals, ${e.days} days`, eur(e.breakdownEur.meals)],
    [`Activities, ${e.days} days`, eur(e.breakdownEur.activities)],
  ];
  return (
    <CardShell
      icon={Receipt}
      title={`Cost for ${e.city}`}
      owners={["budget_policy"]}
      note={`${e.days} days, ${e.nights} nights, ${e.teamSize} people. ECB rate ${e.rate.value} (${e.rate.date}).`}
    >
      <dl className="receipt">
        {lines.map(([label, value]) => (
          <div key={label} className="receipt-line">
            <dt>{label}</dt>
            <span className="leader" aria-hidden="true" />
            <dd>{value}</dd>
          </div>
        ))}
        <div className="receipt-line total">
          <dt>Per person</dt>
          <span className="leader" aria-hidden="true" />
          <dd>
            {eur(e.perPersonEur)} = {ils(e.perPersonIls)}
          </dd>
        </div>
        <div className="receipt-line total">
          <dt>Team of {e.teamSize}</dt>
          <span className="leader" aria-hidden="true" />
          <dd>{ils(e.teamTotalIls)}</dd>
        </div>
      </dl>
      <div className="meter" role="img" aria-label={`${ils(e.perPersonIls)} of the ${budget} ILS per-person budget`}>
        <div className={`meter-fill ${e.withinBudget ? "good" : "bad"}`} style={{ width: `${Math.min(100, (e.perPersonIls / e.budgetIlsPerPerson) * 100)}%` }} />
      </div>
      <p className={`meter-text ${e.withinBudget ? "good" : "bad"}`}>
        {e.withinBudget
          ? `Within the ${budget} ILS per-person budget, with ${e.headroomIls.toLocaleString("en-US")} ILS to spare.`
          : `Over the ${budget} ILS per-person budget by ${(-e.headroomIls).toLocaleString("en-US")} ILS.`}
      </p>
    </CardShell>
  );
}

// The calendar strip is the one place the dates come alive: every day of the period, its holidays on both sides,
// and the Israeli weekend, so a clash is visible before reading the list.
function DatesCard({ card }: { card: CardOf<"dates"> }) {
  const days = calendarDays(card.from, card.to, card.holidays);
  const country = card.holidays.find((holiday) => holiday.side === "destination")?.country ?? card.city;
  const clean = card.windows.filter((window) => window.clean);
  return (
    <CardShell icon={CalendarDays} title={`Dates for ${card.city}, ${range(card.from, card.to)}`} owners={["weather_calendar"]}>
      <ol className="calendar" aria-label="Days of the period">
        {days.map((day) => {
          const holidays = [...day.israel, ...day.destination];
          return (
            <li key={day.date} className={`cal-day ${day.israeliWeekend ? "weekend" : ""} ${holidays.length > 0 ? "holiday" : ""}`} title={holidays.join(", ") || undefined}>
              <span className="cal-weekday">{day.weekday}</span>
              <span className="cal-date">{day.day}</span>
              <span className="cal-marks" aria-label={holidays.join(", ") || undefined}>
                {day.israel.length > 0 && <span className="mark israel" />}
                {day.destination.length > 0 && <span className="mark destination" />}
              </span>
            </li>
          );
        })}
      </ol>
      <ul className="legend">
        <li><span className="mark israel" /> Israeli holiday</li>
        <li><span className="mark destination" /> Public holiday in {country}</li>
        <li><span className="swatch weekend" /> Israeli weekend</li>
      </ul>
      <h4>Holidays</h4>
      {card.holidays.length === 0 ? (
        <p className="muted">No holidays in this period.</p>
      ) : (
        <ul className="holidays">
          {card.holidays.map((holiday) => (
            <li key={`${holiday.date}-${holiday.name}`}>
              <span className={`mark ${holiday.side}`} /> <strong>{shortDate(holiday.date)}</strong> {holiday.name}{" "}
              <span className="muted">({holiday.country}, via {holiday.source})</span>
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
            <span key={window.start} className="chip window">
              {range(window.start, window.end)} <span className="muted">({window.weekdays.join(", ")})</span>
              {window.israeliWeekendDays.length > 0 && <em> includes the Israeli weekend</em>}
            </span>
          ))}
        </div>
      )}
    </CardShell>
  );
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="stat">
      <Icon size={18} aria-hidden="true" />
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function WeatherCard({ card }: { card: CardOf<"weather"> }) {
  const outlook = card.outlook;
  if (outlook.kind === "forecast") {
    return (
      <CardShell icon={Thermometer} title={`Forecast for ${card.city}`} owners={["weather_calendar"]}>
        <ul className="forecast">
          {outlook.days.map((day) => (
            <li key={day.date}>
              <strong>{shortDate(day.date)}</strong> {day.lowC} to {day.highC} °C
              {day.rainChancePct !== null && <span className="muted">, {day.rainChancePct}% chance of rain</span>}
            </li>
          ))}
        </ul>
      </CardShell>
    );
  }
  const { stats } = outlook;
  return (
    <CardShell icon={Thermometer} title={`Typical weather in ${card.city}, ${range(outlook.from, outlook.to)}`} owners={["weather_calendar"]}>
      <div className="stats">
        <Stat icon={Thermometer} label="Average high" value={`${stats.avgHighC} °C`} />
        <Stat icon={Thermometer} label="Average low" value={`${stats.avgLowC} °C`} />
        <Stat icon={CloudRain} label="Days with rain" value={pct(stats.rainyDayShare)} />
        <Stat icon={Droplets} label="Rain per day" value={`${stats.avgRainMm} mm`} />
      </div>
      <p className="notice info">
        <Info size={16} aria-hidden="true" />
        <span>
          Climate average of {stats.years[0]}-{stats.years[stats.years.length - 1]}, not a forecast. {outlook.reason}
        </span>
      </p>
    </CardShell>
  );
}

const NEED_ICON: Record<DietNeed, LucideIcon> = { vegan: Leaf, kosher: Utensils, gluten_free: WheatOff };
const WHEELCHAIR_TEXT = { yes: "wheelchair accessible", limited: "limited wheelchair access", no: "not wheelchair accessible", unknown: "wheelchair access not recorded" };

function VenuesCard({ card }: { card: CardOf<"venues"> }) {
  const result = card.result;
  return (
    <CardShell
      icon={UtensilsCrossed}
      title={`Food and access in ${result.city}`}
      owners={["venues"]}
      note={`From OpenStreetMap, within ${result.radiusM / 1000} km of the center. A missing tag means unknown.`}
    >
      <div className="chips">
        {result.needs.map((need) => {
          const Icon = NEED_ICON[need];
          const count = result.counts.byNeed[need] ?? 0;
          return (
            <span key={need} className={`need-chip ${count === 0 ? "none" : count < 3 ? "few" : ""}`}>
              <Icon size={15} aria-hidden="true" /> {DIET_NAMES[need]} <strong>{count}</strong>
            </span>
          );
        })}
      </div>
      <h4>Best matches</h4>
      <ul className="places">
        {result.bestFood.map((place) => (
          <li key={place.id}>
            <Accessibility size={15} className={`wheelchair wheelchair-${place.wheelchair}`} aria-label={WHEELCHAIR_TEXT[place.wheelchair]} role="img" />
            <a href={place.osmUrl} target="_blank" rel="noreferrer">{place.name}</a>
            <span className="muted">
              {place.diets.map((diet) => DIET_NAMES[diet]).join(", ") || "no diet tags"}, {WHEELCHAIR_TEXT[place.wheelchair]}
            </span>
          </li>
        ))}
      </ul>
      <h4>Wheelchair-accessible sights</h4>
      <ul className="places">
        {result.sights.map((place) => (
          <li key={place.id}>
            <Accessibility size={15} className="wheelchair wheelchair-yes" aria-hidden="true" />
            <a href={place.osmUrl} target="_blank" rel="noreferrer">{place.name}</a>
          </li>
        ))}
      </ul>
      {result.gaps.length > 0 && (
        <div className="notice warn">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>Gaps</strong>
            <ul>{result.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
          </div>
        </div>
      )}
    </CardShell>
  );
}

const SLOT_ICON: Record<ItinerarySlot, LucideIcon> = { morning: Sunrise, lunch: Utensils, afternoon: Sun, dinner: Moon };

function ItineraryCard({ card }: { card: CardOf<"itinerary"> }) {
  const name = (id: string) => card.placeNames[id] ?? id;
  return (
    <CardShell icon={Route} title={`Draft plan for ${card.city}`} owners={["itinerary"]}>
      <ol className="days">
        {card.plan.days.map((day, index) => (
          <li key={day.date} className="day">
            <h4>
              Day {index + 1} <span className="muted">{shortDate(day.date)}</span>
            </h4>
            <ul className="slots">
              {day.items.map((item, itemIndex) => {
                const Icon = SLOT_ICON[item.slot];
                return (
                  <li key={itemIndex}>
                    <Icon size={15} className="slot-icon" aria-hidden="true" />
                    <span className="slot-name">{item.slot}</span>
                    <span className="slot-what">
                      {item.venueIds.map(name).join(" + ") || item.note}
                      {item.catering.map((diet) => (
                        <span key={diet} className="catering">{DIET_NAMES[diet]} catering</span>
                      ))}
                      {item.note && item.venueIds.length > 0 && <span className="muted slot-note">{item.note}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
      {card.check.problems.length > 0 && (
        <div className="notice bad">
          <CircleX size={16} aria-hidden="true" />
          <div>
            <strong>Problems</strong>
            <ul>{card.check.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
          </div>
        </div>
      )}
      {card.check.notes.length > 0 && (
        <div className="notice warn">
          <TriangleAlert size={16} aria-hidden="true" />
          <div>
            <strong>To confirm</strong>
            <ul>{card.check.notes.map((note) => <li key={note}>{note}</li>)}</ul>
          </div>
        </div>
      )}
    </CardShell>
  );
}

const OVERALL: Record<PolicyVerdict["overall"], { text: string; tone: string; icon: LucideIcon }> = {
  within_policy: { text: "Within policy", tone: "good", icon: ShieldCheck },
  within_policy_if_actions: { text: "Within policy, if the actions below are taken", tone: "warn", icon: ShieldAlert },
  outside_policy: { text: "Outside policy", tone: "bad", icon: ShieldX },
  not_enough_data: { text: "Not enough data to decide yet", tone: "muted", icon: ShieldQuestion },
};
const RULE: Record<RuleStatus, { tone: string; label: string; icon: LucideIcon }> = {
  pass: { tone: "good", label: "Pass", icon: CircleCheck },
  fail: { tone: "bad", label: "Fail", icon: CircleX },
  needs_action: { tone: "warn", label: "Action needed", icon: TriangleAlert },
  unknown: { tone: "muted", label: "Unknown", icon: CircleHelp },
};

function PolicyCard({ card }: { card: CardOf<"policy"> }) {
  const overall = OVERALL[card.verdict.overall];
  const VerdictIcon = overall.icon;
  return (
    <CardShell icon={ShieldCheck} title={`Policy check for ${card.city}`} owners={["orchestrator"]}>
      <div className={`verdict-banner ${overall.tone}`} role="status">
        <VerdictIcon size={20} aria-hidden="true" />
        {overall.text}
      </div>
      <ol className="rules">
        {card.verdict.rules.map((rule) => {
          const status = RULE[rule.status];
          const Icon = status.icon;
          return (
            <li key={rule.id} className={`rule rule-${status.tone}`}>
              <Icon size={18} className="rule-icon" aria-label={status.label} role="img" />
              <div>
                <strong>{rule.rule}</strong>
                <div className="rule-detail">{rule.detail}</div>
                {rule.fix && (
                  <div className="fix">
                    <Wrench size={14} aria-hidden="true" /> {rule.fix}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </CardShell>
  );
}
