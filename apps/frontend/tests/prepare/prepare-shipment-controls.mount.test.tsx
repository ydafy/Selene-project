import { expect, test } from 'bun:test';

test('preparing controls and selection isolation through the real screen', () => {
  const child = Bun.spawnSync({
    cmd: [process.execPath, 'test', `${import.meta.dir}/prepare-shipment-submit.mount.test.tsx`],
    env: { ...process.env, SELENE_SUBMIT_CHILD: '1', SELENE_CONTROLS_CHILD: '1' },
    stdout: 'pipe', stderr: 'pipe',
  });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  expect(child.exitCode).toBe(0);
});
