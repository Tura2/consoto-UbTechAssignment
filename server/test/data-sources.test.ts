import { describe, expect, it } from "vitest";
import { createDataSources } from "../src/clients/data-sources";
import { ECB_RATE_URL } from "../src/clients/frankfurter";
import { OVERPASS_URL } from "../src/clients/overpass";
import fx from "./fixtures/frankfurter-ecb.json";
import overpass from "./fixtures/overpass-lisbon.json";
import { fakeHttp } from "./helpers/fake-http";

describe("createDataSources", () => {
  it("wires the ECB rate to Frankfurter", async () => {
    const { http, calls } = fakeHttp(fx);
    const result = await createDataSources(http).ecbRate(new AbortController().signal);
    expect(calls[0].url).toBe(ECB_RATE_URL);
    expect(result.rate.value).toBe(3.431);
  });

  it("wires places to Overpass", async () => {
    const { http, calls } = fakeHttp(overpass);
    await createDataSources(http).overpass("[out:json];", new AbortController().signal);
    expect(calls[0]).toMatchObject({ url: OVERPASS_URL, method: "POST" });
  });
});
