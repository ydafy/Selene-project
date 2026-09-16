import { describe, expect, it } from "bun:test";

import { resolveProductionQuoteRuntime } from "./runtime.ts";

describe("get-shipping-quote production runtime", () => {
  it("ignores ENVIA_MODE and sandbox credentials in favor of the production pair", () => {
    expect(
      resolveProductionQuoteRuntime({
        ENVIA_MODE: "sandbox",
        ENVIA_API_KEY_SANDBOX: "sandbox-key",
        ENVIA_API_URL_SANDBOX: "https://api-test.envia.com",
        ENVIA_API_KEY_PROD: "production-key",
        ENVIA_API_URL_PROD: "https://api.envia.com",
      }),
    ).toEqual({
      mode: "production",
      apiKey: "production-key",
      apiUrl: "https://api.envia.com/",
    });
  });

  it("fails closed when either production secret is missing or the URL is not HTTPS", () => {
    expect(
      resolveProductionQuoteRuntime({
        ENVIA_API_URL_PROD: "https://api.envia.com",
      }),
    ).toBeNull();
    expect(
      resolveProductionQuoteRuntime({ ENVIA_API_KEY_PROD: "production-key" }),
    ).toBeNull();
    expect(
      resolveProductionQuoteRuntime({
        ENVIA_API_KEY_PROD: "production-key",
        ENVIA_API_URL_PROD: "http://api.envia.com",
      }),
    ).toBeNull();
  });
});
