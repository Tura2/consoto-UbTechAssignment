// Cleanup for model-written answers, used by the server (stored answer and history) and the UI (while
// streaming). Free models add tool-name citations like 【budget_estimate_cost】 and em or en dashes.
export function cleanAnswer(text: string): string {
  return text.replace(/\s*【[^】]*(】|$)/g, "").replace(/[–—]/g, "-");
}
