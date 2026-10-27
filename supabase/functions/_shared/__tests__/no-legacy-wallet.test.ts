import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// The internal wallet was replaced by Stripe Connect (odd/tasks/remove-legacy-wallet.md).
// No Edge Function may read or write its tables or the cutover switch.
const functionsRoot = fileURLToPath(new URL("../../", import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const sourceFile = /\.(?:[cm]?[jt]sx?)$/;
const legacyWalletReference =
  /\b(?:wallets|wallet_transactions|payout_requests|seller_bank_accounts|mexico_banks|connect_enabled)\b/g;

const findLegacyWalletReferences = (source: string) =>
  [...source.matchAll(legacyWalletReference)].map((match) => match[0]);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceFile.test(entry.name) && path !== thisFile ? [path] : [];
  });

describe("Edge Functions without the legacy wallet", () => {
  it("recognizes the legacy wallet tables and the connect_enabled switch", () => {
    expect(
      findLegacyWalletReferences(
        [
          "supabaseAdmin.from('wallets')",
          "from('wallet_transactions')",
          "from('payout_requests')",
          "from('seller_bank_accounts')",
          "from('mexico_banks')",
          "select('value').eq('key', 'connect_enabled')",
        ].join("\n"),
      ),
    ).toEqual([
      "wallets",
      "wallet_transactions",
      "payout_requests",
      "seller_bank_accounts",
      "mexico_banks",
      "connect_enabled",
    ]);
    expect(
      findLegacyWalletReferences(
        "object: 'bank_account'; listCurrentBankAccounts(); wallet-guarded",
      ),
    ).toEqual([]);
  });

  it("no Edge Function references the legacy wallet tables or connect_enabled", () => {
    const offenders = sourceFiles(functionsRoot).flatMap((path) =>
      findLegacyWalletReferences(readFileSync(path, "utf8")).map(
        (name) =>
          `${relative(functionsRoot, path).replaceAll("\\", "/")}: ${name}`,
      ),
    );

    expect(offenders).toEqual([]);
  });

  it("drain-legacy-wallets is gone", () => {
    expect(existsSync(join(functionsRoot, "drain-legacy-wallets"))).toBe(false);
  });
});
