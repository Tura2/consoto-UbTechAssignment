import { describe, expect, it } from "vitest";
import { keepFollowing } from "./scroll";

const view = (scrollTop: number, scrollHeight = 5000, clientHeight = 600) => ({ scrollTop, scrollHeight, clientHeight });

describe("keepFollowing", () => {
  it("follows when the view is near the bottom", () => {
    expect(keepFollowing(false, 4500, view(4350))).toBe(true);
  });

  it("stops when the user scrolls up", () => {
    expect(keepFollowing(true, 4400, view(3000))).toBe(false);
  });

  it("keeps following when content grew before a late scroll event", () => {
    // Our own scroll to the end moved scrollTop down to 4400; by the time the event fires the page is taller.
    expect(keepFollowing(true, 3800, view(4400, 7000))).toBe(true);
  });

  it("stays paused while the user reads above", () => {
    expect(keepFollowing(false, 3000, view(3000, 7000))).toBe(false);
  });
});
