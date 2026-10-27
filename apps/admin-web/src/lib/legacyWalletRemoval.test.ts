import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC_ROOT = join(import.meta.dir, '..');
const SELF = join('lib', 'legacyWalletRemoval.test.ts');
const LEGACY_NAME = /wallet|drain|UserTransactions|UserPayouts|UserBankCard|PayoutsTable|PreExportModal|usePayoutRequests|useUpdatePayoutStatus|KPIPaymentsCards|bbva/i;
const LEGACY_CONTENT =
  /wallets|wallet_transactions|payout_requests|seller_bank_accounts|mexico_banks|admin_payments_overview|drain-legacy|drain_legacy|DrainLegacy|connect_enabled|fn_request_payout|fn_save_bank_account|UserWalletCard|UserTransactionsTable|available_balance|pending_balance/i;

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

const files = listFiles(SRC_ROOT).filter((path) => relative(SRC_ROOT, path) !== SELF);
const rel = (path: string) => relative(SRC_ROOT, path).split(sep).join('/');

describe('legacy wallet removal', () => {
  it('keeps no legacy wallet, drain or withdrawal file in admin-web', () => {
    expect(files.map(rel).filter((path) => LEGACY_NAME.test(path))).toEqual([]);
  });

  it('keeps no legacy wallet table, RPC or balance reference in admin-web sources', () => {
    const offenders = files
      .filter((path) => LEGACY_CONTENT.test(readFileSync(path, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });
});
