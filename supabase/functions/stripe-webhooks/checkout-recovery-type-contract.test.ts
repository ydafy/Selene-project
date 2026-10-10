import { expect, test } from 'bun:test';

const webhook = await Bun.file(new URL('./index.ts', import.meta.url)).text();

test('checkout recovery narrows the RPC payload before reading runtime_version', () => {
  expect(webhook).toContain('const shellPayload: unknown = shellData;');
  expect(webhook).toContain("'runtime_version' in shellPayload");
});
