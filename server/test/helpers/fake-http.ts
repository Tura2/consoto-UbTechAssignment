import type { Http, RequestSpec } from "../../src/clients/http";

// An Http that answers every request with `body` and records what was asked.
export function fakeHttp(body: unknown): { http: Http; calls: RequestSpec[] } {
  const calls: RequestSpec[] = [];
  const http: Http = {
    async getJson(spec) {
      calls.push(spec);
      return {
        body,
        source: { name: spec.name, url: spec.url, fetchedAt: "2026-10-06T08:00:00.000Z", cached: false },
        stale: false,
      };
    },
  };
  return { http, calls };
}
