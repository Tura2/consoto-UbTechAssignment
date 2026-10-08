// The brief: "Cost per person = return flight + hotel per night + meals and activities per day."
// We read it as flight + nights * hotel + days * (meals + activities), with nights = days - 1.
import type { CityCost, CostBreakdownEur, Rate } from "../../../shared/domain";

export type CostRates = {
  returnFlight: number;
  hotelPerNight: number;
  mealsPerDay: number;
  activitiesPerDay: number;
};

export function perPersonEur(rates: CostRates, days: number, nights: number): { breakdown: CostBreakdownEur; total: number } {
  const breakdown = {
    flight: rates.returnFlight,
    hotel: rates.hotelPerNight * nights,
    meals: rates.mealsPerDay * days,
    activities: rates.activitiesPerDay * days,
  };
  return { breakdown, total: breakdown.flight + breakdown.hotel + breakdown.meals + breakdown.activities };
}

export function estimateCityCost(args: {
  city: string;
  rates: CostRates;
  days: number;
  nights: number;
  teamSize: number;
  rate: Rate;
  budgetIlsPerPerson: number;
}): CityCost {
  const { breakdown, total } = perPersonEur(args.rates, args.days, args.nights);
  const perPersonIlsExact = total * args.rate.value;
  return {
    city: args.city,
    days: args.days,
    nights: args.nights,
    breakdownEur: breakdown,
    perPersonEur: total,
    perPersonIls: Math.round(perPersonIlsExact),
    teamSize: args.teamSize,
    teamTotalIls: Math.round(perPersonIlsExact * args.teamSize),
    rate: args.rate,
    budgetIlsPerPerson: args.budgetIlsPerPerson,
    withinBudget: perPersonIlsExact <= args.budgetIlsPerPerson,
    headroomIls: Math.round(args.budgetIlsPerPerson - perPersonIlsExact),
  };
}
