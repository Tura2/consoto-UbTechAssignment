// Types shared by the server and the web app. Types only: no runtime code.

export type AgentId = "budget_policy" | "weather_calendar" | "venues" | "itinerary";
export type DietNeed = "vegan" | "kosher" | "gluten_free";
export type Wheelchair = "yes" | "limited" | "no" | "unknown";

export type Trip = {
  team: string | null;
  region: string | null;
  searchWindow: { from: string; to: string } | null;
  candidateCities: string[];
  city: string | null;
  start: { date: string; source: "user" | "assumed" } | null;
  days: number;
  nights: number;
};

export type Source = { name: string; url: string; fetchedAt: string; cached: boolean };

export type HolidayItem = {
  date: string;
  name: string;
  side: "israel" | "destination";
  country: string;
  source: string;
};

export type DateWindow = {
  start: string;
  end: string;
  weekdays: string[];
  clean: boolean;
  clashes: HolidayItem[];
  israeliWeekendDays: string[];
};

export type ClimateStats = {
  avgHighC: number;
  avgLowC: number;
  rainyDayShare: number;
  avgRainMm: number;
  years: number[];
};

export type ForecastDay = { date: string; highC: number; lowC: number; rainChancePct: number | null };

export type WeatherOutlook =
  | { kind: "forecast"; from: string; to: string; days: ForecastDay[] }
  | { kind: "climate_average"; from: string; to: string; stats: ClimateStats; reason: string };

export type CostBreakdownEur = { flight: number; hotel: number; meals: number; activities: number };

export type CityCost = {
  city: string;
  days: number;
  nights: number;
  breakdownEur: CostBreakdownEur;
  perPersonEur: number;
  perPersonIls: number;
  teamSize: number;
  teamTotalIls: number;
  rate: { value: number; date: string };
  budgetIlsPerPerson: number;
  withinBudget: boolean;
  headroomIls: number;
};

export type Place = {
  id: string;
  name: string;
  kind: "food" | "sight";
  diets: DietNeed[];
  wheelchair: Wheelchair;
  lat: number;
  lon: number;
  osmUrl: string;
  cuisine: string | null;
};

export type VenuesResult = {
  city: string;
  radiusM: number;
  needs: DietNeed[];
  byNeed: Partial<Record<DietNeed, Place[]>>;
  bestFood: Place[];
  sights: Place[];
  counts: {
    food: number;
    sights: number;
    byNeed: Partial<Record<DietNeed, number>>;
    wheelchairUnknown: number;
  };
  gaps: string[];
};

export type ItinerarySlot = "morning" | "lunch" | "afternoon" | "dinner";

export type ItineraryItem = {
  slot: ItinerarySlot;
  kind: "activity" | "meal";
  venueIds: string[];
  catering: DietNeed[];
  note: string;
};

export type ItineraryPlan = { days: { date: string; items: ItineraryItem[] }[] };

export type ItineraryCheck = {
  accepted: boolean;
  problems: string[];
  notes: string[];
  uncoveredMeals: string[];
  mealsCoveredByCatering: string[];
  inaccessible: string[];
  accessToConfirm: string[];
};

export type RuleStatus = "pass" | "fail" | "needs_action" | "unknown";

export type PolicyRuleResult = {
  id: number;
  rule: string;
  status: RuleStatus;
  detail: string;
  fix: string | null;
};

export type PolicyVerdict = {
  overall: "within_policy" | "within_policy_if_actions" | "outside_policy" | "not_enough_data";
  rules: PolicyRuleResult[];
};
