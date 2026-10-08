import { describe, expect, it } from "vitest";
import type { AgentResult } from "../src/agents/runner";
import { applyTripUpdate, depsKey, dropStaleFindings, fillCity, fillPeriod, namedCandidates, newTrip, periodFromMessage } from "../src/orchestrator/trip";
import { createStore, historyMessages } from "../src/state/conversations";

const TODAY = "2026-10-06";
const M1 = { team: "Platform team", region: "Europe", searchPeriod: { month: 3, part: "second_half" as const }, days: 3 };

describe("trip updates", () => {
  it("starts with the policy's maximum length", () => {
    expect(newTrip()).toMatchObject({ days: 3, nights: 2, city: null, start: null });
  });

  it("turns message 1 into facts computed in code", () => {
    const trip = applyTripUpdate(newTrip(), M1, TODAY);
    expect(trip).toMatchObject({
      team: "platform",
      region: "Europe",
      searchWindow: { from: "2027-03-16", to: "2027-03-31" },
      candidateCities: ["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"],
      days: 3,
      nights: 2,
    });
  });

  it("matches the city name and keeps unknown cities as typed", () => {
    const base = applyTripUpdate(newTrip(), M1, TODAY);
    expect(applyTripUpdate(base, { city: "lisbon" }, TODAY).city).toBe("Lisbon");
    expect(applyTripUpdate(base, { city: "Rome" }, TODAY).city).toBe("Rome");
  });

  it("resolves a named start day inside the search window", () => {
    const base = applyTripUpdate(newTrip(), M1, TODAY);
    expect(applyTripUpdate(base, { startDay: { month: 3, day: 29 } }, TODAY).start).toEqual({ date: "2027-03-29", source: "user" });
  });

  it("keeps a policy-breaking length so the policy check can flag it", () => {
    expect(applyTripUpdate(newTrip(), { days: 4 }, TODAY)).toMatchObject({ days: 4, nights: 3 });
  });

  it("drops an assumed start date when the city changes, but keeps one the user chose", () => {
    const lisbon = { ...applyTripUpdate(newTrip(), { ...M1, city: "Lisbon" }, TODAY), start: { date: "2027-03-16", source: "assumed" as const } };
    expect(applyTripUpdate(lisbon, { city: "Prague" }, TODAY).start).toBeNull();
    const chosen = { ...lisbon, start: { date: "2027-03-29", source: "user" as const } };
    expect(applyTripUpdate(chosen, { city: "Prague" }, TODAY).start?.date).toBe("2027-03-29");
  });

  it("drops a start date outside a new search window", () => {
    const trip = { ...applyTripUpdate(newTrip(), M1, TODAY), start: { date: "2027-03-29", source: "user" as const } };
    expect(applyTripUpdate(trip, { searchPeriod: { month: 4, part: "first_half" } }, TODAY).start).toBeNull();
  });

  it("finds no candidates in a region without cost data", () => {
    expect(applyTripUpdate(newTrip(), { region: "Asia" }, TODAY).candidateCities).toEqual([]);
  });
});

describe("findings", () => {
  it("drops findings that depended on a changed city", () => {
    const store = createStore(newTrip);
    const conversation = store.getOrCreate();
    conversation.trip = applyTripUpdate(conversation.trip, { ...M1, city: "Lisbon" }, TODAY);
    const result: AgentResult = { agent: "venues", status: "ok", summary: "", toolRuns: [] };
    conversation.findings.venues = { depsKey: depsKey("venues", conversation.trip), result };
    dropStaleFindings(conversation);
    expect(conversation.findings.venues).toBeDefined();
    conversation.trip = applyTripUpdate(conversation.trip, { city: "Prague" }, TODAY);
    dropStaleFindings(conversation);
    expect(conversation.findings.venues).toBeUndefined();
  });
});

describe("conversation store", () => {
  it("creates, finds and reuses conversations", () => {
    const store = createStore(newTrip);
    const created = store.getOrCreate();
    expect(store.get(created.id)).toBe(created);
    expect(store.getOrCreate(created.id)).toBe(created);
    expect(store.getOrCreate("from-an-old-tab").id).toBe("from-an-old-tab");
    expect(store.get("missing")).toBeNull();
  });

  it("builds chat history from every earlier turn, with a placeholder when a turn has no answer", () => {
    const store = createStore(newTrip);
    const conversation = store.getOrCreate();
    conversation.turns.push({ id: "1", userMessage: "Hi", events: [], answer: "Hello!", status: "done" });
    conversation.turns.push({ id: "2", userMessage: "Stopped", events: [], answer: "", status: "running" });
    expect(historyMessages(conversation)).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "Stopped" },
      { role: "assistant", content: "(No answer: this turn was stopped or failed.)" },
    ]);
  });
});

describe("namedCandidates", () => {
  it("drops cities the user did not type, so message 1 compares all five region cities", () => {
    const update = namedCandidates({ ...M1, candidateCities: ["Lisbon", "Prague", "Amsterdam"] }, "We want a 3 day offsite somewhere in Europe.");
    expect(update.candidateCities).toBeUndefined();
    expect(applyTripUpdate(newTrip(), update, TODAY).candidateCities).toEqual(["Lisbon", "Barcelona", "Athens", "Prague", "Budapest"]);
  });

  it("keeps the cities the user named, in any letter case", () => {
    const update = namedCandidates({ candidateCities: ["Lisbon", "Rome", "Prague"] }, "compare lisbon and ROME");
    expect(update.candidateCities).toEqual(["Lisbon", "Rome"]);
  });

  it("ignores empty city names", () => {
    expect(namedCandidates({ candidateCities: [" ", "Prague"] }, "what about Prague?").candidateCities).toEqual(["Prague"]);
  });

  it("leaves an update without candidates alone", () => {
    expect(namedCandidates({ city: "Lisbon" }, "Lisbon sounds good")).toEqual({ city: "Lisbon", candidateCities: undefined });
  });
});

// The planner gives the period as a meaning; when a free model drops it, code reads the user's own words.
describe("periodFromMessage", () => {
  it("reads a month and the part of it", () => {
    expect(periodFromMessage("somewhere in Europe, second half of March. Where should we go?")).toEqual({ month: 3, part: "second_half" });
    expect(periodFromMessage("late march please")).toEqual({ month: 3, part: "second_half" });
    expect(periodFromMessage("Early April works")).toEqual({ month: 4, part: "first_half" });
    expect(periodFromMessage("Any time in June")).toEqual({ month: 6, part: "whole" });
    expect(periodFromMessage("in May")).toEqual({ month: 5, part: "whole" });
  });

  it("finds nothing when no month is named", () => {
    expect(periodFromMessage("Lisbon sounds good. What's the weather usually like then?")).toBeNull();
    expect(periodFromMessage("We may want to make it 4 days")).toBeNull();
  });
});

describe("fillPeriod", () => {
  const empty = newTrip();
  it("fills a period the plan left out, from the message, when the trip has none", () => {
    expect(fillPeriod({ team: "platform" }, "second half of March", empty)).toEqual({ team: "platform", searchPeriod: { month: 3, part: "second_half" } });
  });

  it("keeps the plan's own period, and never overrides a trip that already has dates", () => {
    const planned = { searchPeriod: { month: 4, part: "whole" as const } };
    expect(fillPeriod(planned, "second half of March", empty)).toEqual(planned);
    const dated = applyTripUpdate(empty, { searchPeriod: { month: 3, part: "second_half" } }, TODAY);
    expect(fillPeriod({}, "what about April?", dated)).toEqual({});
  });
});

describe("fillCity", () => {
  it("takes the one city with cost data that the message names, when the plan sets none", () => {
    expect(fillCity({ days: 3 }, "What about Prague instead?")).toEqual({ days: 3, city: "Prague" });
  });

  it("keeps the plan's city, and skips messages with no city, two cities or a city without cost data", () => {
    expect(fillCity({ city: "Lisbon" }, "What about Prague instead?")).toEqual({ city: "Lisbon" });
    expect(fillCity({}, "Ok, let's go with it.")).toEqual({});
    expect(fillCity({}, "Is Prague cheaper than Lisbon?")).toEqual({});
    expect(fillCity({}, "What about Rome?")).toEqual({});
  });
});
