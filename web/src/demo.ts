// The three messages from the brief, in order.
export const DEMO_MESSAGES = [
  "Hi, we want a 3 day offsite for the Platform team somewhere in Europe, second half of March. Where should we go?",
  "Lisbon sounds good. What's the weather usually like then? And does it clash with any holidays, ours or theirs?",
  "Ok, let's go with it. Can you draft the 3 days, make sure everyone can eat and get around, and tell me the total in shekels? Are we within policy?",
];

// The first demo message with no finished turn yet. Null for an empty chat (the empty state offers them) or when all are done.
export function nextDemoMessage(turns: { userMessage: string; status: string }[]): string | null {
  if (turns.length === 0) return null;
  const answered = new Set(turns.filter((turn) => turn.status === "done").map((turn) => turn.userMessage));
  return DEMO_MESSAGES.find((message) => !answered.has(message)) ?? null;
}
