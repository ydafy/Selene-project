import { describe, expect, it } from "bun:test";
import "../_shared/__tests__/zod-runtime.bun.preload.ts";

const {
  quoteListingShipment,
  resolvePackagePreset,
} = await import("./quote-contract.ts");

const validPreset = {
  weight: "1.5",
  length: "30",
  width: "20",
  height: "15",
};

const validProviderRate = {
  carrier: "Paquetexpress",
  service: "ground",
  currency: "MXN",
  totalPrice: "168.75",
  basePrice: 150,
  additionalCharges: 18.75,
};

const quoteInput = {
  requestedPackageId: "gpu_1",
  packagePresets: { gpu_1: validPreset },
  originZip: "64000",
  destinationZip: "06500",
  price: 10_000,
  runtimeMode: "sandbox" as const,
  apiUrl: "https://provider.example/",
  apiKey: "test-key",
};

const providerResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("listing quote package preset contract", () => {
  it("resolves the requested server-side preset without fallback", () => {
    expect(resolvePackagePreset({ gpu_1: validPreset }, "gpu_1")).toEqual({
      id: "gpu_1",
      ...validPreset,
      weight: 1.5,
      length: 30,
      width: 20,
      height: 15,
    });
  });

  it("rejects an unknown preset before calling the provider", async () => {
    let fetchCalls = 0;

    await expect(
      quoteListingShipment({
        ...quoteInput,
        requestedPackageId: "missing",
        fetch: () => {
          fetchCalls += 1;
          return Promise.resolve(
            providerResponse({ data: [validProviderRate] }),
          );
        },
      }),
    ).rejects.toMatchObject({
      code: "UNKNOWN_PACKAGE_PRESET",
    });

    expect(fetchCalls).toBe(0);
  });

  it("rejects non-finite or non-positive preset dimensions before calling the provider", async () => {
    let fetchCalls = 0;

    for (const weight of ["Infinity", "0"]) {
      await expect(
        quoteListingShipment({
          ...quoteInput,
          packagePresets: { gpu_1: { ...validPreset, weight } },
          fetch: () => {
            fetchCalls += 1;
            return Promise.resolve(
              providerResponse({ data: [validProviderRate] }),
            );
          },
        }),
      ).rejects.toMatchObject({
        code: "INVALID_PACKAGE_PRESET",
      });
    }

    expect(fetchCalls).toBe(0);
  });
});

describe("listing quote provider contract", () => {
  it("returns the V1 Paquetexpress Ground MXN quote and sanitized production diagnostics", async () => {
    const logs: Array<Record<string, unknown>> = [];

    const result = await quoteListingShipment({
      ...quoteInput,
      fetch: () =>
        Promise.resolve(providerResponse({ data: [validProviderRate] })),
      log: (event) => logs.push(event),
    });

    expect(result.rates).toEqual([
      {
        carrier: "Paquetexpress",
        service: "ground",
        price: 168.75,
        estimated_days: 3,
      },
    ]);
    expect(logs).toContainEqual({
      event: "shipping_quote_resolved",
      requestedPresetId: "gpu_1",
      resolvedPresetId: "gpu_1",
      presetFound: true,
      weight: 1.5,
      dimensions: { length: 30, width: 20, height: 15 },
      originZipPresent: true,
      originZipFormatValidated: true,
      destinationZipPresent: true,
      destinationZipFormatValidated: true,
      destinationIsListingReference: true,
      runtimeMode: "sandbox",
      carrier: "Paquetexpress",
      service: "ground",
      currency: "MXN",
      providerTotalPrice: 168.75,
      providerCharges: { basePrice: 150, additionalCharges: 18.75 },
    });
    expect(JSON.stringify(logs)).not.toContain("test-key");
    expect(JSON.stringify(logs)).not.toContain(quoteInput.originZip);
    expect(JSON.stringify(logs)).not.toContain(quoteInput.destinationZip);
  });

  it("maps malformed provider JSON and HTTP failures to stable provider codes", async () => {
    await expect(
      quoteListingShipment({
        ...quoteInput,
        fetch: () => Promise.resolve(new Response("not json")),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_MALFORMED_RESPONSE",
    });

    await expect(
      quoteListingShipment({
        ...quoteInput,
        fetch: () =>
          Promise.resolve(
            providerResponse({ message: "private provider detail" }, 503),
          ),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_HTTP_ERROR",
    });
  });

  it("maps timeouts and network failures to stable provider codes", async () => {
    await expect(
      quoteListingShipment({
        ...quoteInput,
        fetch: () =>
          Promise.reject(new DOMException("timed out", "TimeoutError")),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_TIMEOUT",
    });

    await expect(
      quoteListingShipment({
        ...quoteInput,
        fetch: () => Promise.reject(new TypeError("connection reset")),
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_NETWORK_ERROR",
    });
  });
});
