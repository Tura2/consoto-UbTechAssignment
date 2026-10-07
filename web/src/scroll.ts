// Whether the chat keeps following the stream after a scroll event. Only the user scrolling up stops it:
// content growth and our own scroll to the end never move scrollTop up, even when the event arrives late.
const NEAR_BOTTOM_PX = 120;

export function keepFollowing(following: boolean, previousTop: number, view: { scrollTop: number; scrollHeight: number; clientHeight: number }): boolean {
  if (view.scrollHeight - view.scrollTop - view.clientHeight < NEAR_BOTTOM_PX) return true;
  return view.scrollTop < previousTop ? false : following;
}
