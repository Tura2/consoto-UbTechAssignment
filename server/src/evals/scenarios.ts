// The demo plus the curveballs the panel is likely to try. Each step is one chat message.
import {
  answerMentions,
  cityCostMatchesCode,
  comparisonHasCities,
  costCardFor,
  datesInclude,
  gapMentions,
  hasCard,
  itineraryDays,
  planIncludes,
  policyFixMentions,
  policyRule,
  teamTotalMatches,
  tripCity,
  tripDays,
  turnSucceeded,
  weatherIsClimateAverage,
  type Grader,
} from "./graders";

export type Scenario = { name: string; steps: { message: string; graders: Grader[] }[] };

const MESSAGE_1 = "Hi, we want a 3 day offsite for the Platform team somewhere in Europe, second half of March. Where should we go?";
const MESSAGE_2 = "Lisbon sounds good. What's the weather usually like then? And does it clash with any holidays, ours or theirs?";
const MESSAGE_3 =
  "Ok, let's go with it. Can you draft the 3 days, make sure everyone can eat and get around, and tell me the total in shekels? Are we within policy?";

// Honest "I do not have that" answers, in the wordings the model tends to use.
// Apostrophes may be straight or curly (’): models write both.
export const SAYS_NO_DATA = /\bno (\w+ )?(data|information|entry)\b|don['’]?t have|do not have|only (have|cover)|does ?n[o'’]t (have|contain|include)|only (\w+ )?(team|teams|available)|unable|not available|can['’]?t|\bno\b[^.]{0,40}\bteam\b|only\W{0,3}platform/i;

export const SCENARIOS: Scenario[] = [
  {
    name: "demo",
    steps: [
      { message: MESSAGE_1, graders: [turnSucceeded, planIncludes("budget_policy", "weather_calendar"), comparisonHasCities(5), cityCostMatchesCode("Lisbon")] },
      {
        message: MESSAGE_2,
        graders: [turnSucceeded, planIncludes("weather_calendar"), weatherIsClimateAverage, datesInclude("2027-03-23", "Purim"), datesInclude("2027-03-26", "Good Friday"), answerMentions(/average|not a forecast/i)],
      },
      { message: MESSAGE_3, graders: [turnSucceeded, hasCard("itinerary"), itineraryDays(3), teamTotalMatches, hasCard("policy"), answerMentions(/kosher/i)] },
    ],
  },
  {
    name: "four-days",
    steps: [
      { message: MESSAGE_1, graders: [turnSucceeded] },
      { message: "Let's do Lisbon, but make it 4 days. Are we still within policy?", graders: [turnSucceeded, tripDays(4), policyRule(1, "fail"), policyFixMentions(1, /3 days/)] },
    ],
  },
  {
    name: "prague",
    steps: [
      { message: MESSAGE_1, graders: [turnSucceeded] },
      { message: "What about Prague instead? What would it cost in shekels?", graders: [turnSucceeded, tripCity("Prague"), costCardFor("Prague")] },
    ],
  },
  {
    name: "rome",
    steps: [
      {
        message: "Could we do a 3 day offsite in Rome for the Platform team, second half of March? What would it cost?",
        graders: [turnSucceeded, gapMentions(/Rome/), answerMentions(SAYS_NO_DATA)],
      },
    ],
  },
  {
    name: "unknown-team",
    steps: [
      {
        message: "Plan a 3 day offsite in Europe for the Data team, second half of March. What would it cost?",
        graders: [turnSucceeded, gapMentions(/no team data/i), answerMentions(SAYS_NO_DATA)],
      },
    ],
  },
];
