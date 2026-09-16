type Environment =
  | Record<string, string | undefined>
  | ((name: string) => string | undefined);

const readEnvironment = (environment: Environment, name: string) =>
  typeof environment === "function" ? environment(name) : environment[name];

export function resolveProductionQuoteRuntime(
  environment: Environment,
): { mode: "production"; apiKey: string; apiUrl: string } | null {
  const apiKey = readEnvironment(environment, "ENVIA_API_KEY_PROD")?.trim();
  const rawUrl = readEnvironment(environment, "ENVIA_API_URL_PROD")?.trim();
  if (!apiKey || !rawUrl) return null;

  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:"
      ? { mode: "production", apiKey, apiUrl: url.toString() }
      : null;
  } catch {
    return null;
  }
}
