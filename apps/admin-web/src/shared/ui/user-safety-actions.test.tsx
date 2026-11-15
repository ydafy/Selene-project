import { expect, it, mock, spyOn } from 'bun:test';
import * as React from 'react';

// The actions mock the Supabase client, the auth store and the toasts: keep
// those mocks out of the shared Bun module cache.
if (process.env.USER_SAFETY_ACTIONS_CHILD !== '1') {
  it('checks the user safety actions in an isolated process', () => {
    const result = Bun.spawnSync({
      cmd: [process.execPath, 'test', import.meta.filename],
      env: { ...process.env, USER_SAFETY_ACTIONS_CHILD: '1' },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const output = new TextDecoder().decode(result.stderr);
    console.info(output);
    expect(result.exitCode, output).toBe(0);
  });
} else {
  const calls: [string, Record<string, unknown>][] = [];
  mock.module('../lib/supabase', () => ({
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        return { error: null };
      },
    },
  }));
  mock.module('../store/use-auth-store', () => ({
    useAuthStore: () => ({ user: { id: 'admin-1' } }),
  }));
  mock.module('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined },
  }));
  const { UserSafetyActions } = await import('./user-safety-actions');

  type Node = React.ReactElement<Record<string, unknown>>;
  const flatten = (node: unknown): Node[] => {
    if (Array.isArray(node)) return node.flatMap(flatten);
    if (!React.isValidElement(node)) return [];
    const element = node as Node;
    return [element, ...flatten(element.props.children)];
  };

  function harness() {
    const values: unknown[] = [];
    let index = 0;
    spyOn(React, 'useState').mockImplementation(((initial: unknown) => {
      const slot = index++;
      if (!(slot in values)) values[slot] = initial;
      return [
        values[slot],
        (value: unknown) => {
          values[slot] = value;
        },
      ];
    }) as typeof React.useState);
    return () => {
      index = 0;
      return flatten(
        UserSafetyActions({
          user: {
            id: 'seller-1',
            username: 'seller',
            status: 'active',
            is_verified_seller: false,
          },
          onUpdate: () => undefined,
        }),
      );
    };
  }

  it('toggles the verified badge without sending an admin id', async () => {
    calls.length = 0;
    const render = harness();
    const toggle = render().find(
      (node) => node.props.title === 'Otorgar Sello de Verificación VIP',
    )!;
    await (toggle.props.onClick as () => Promise<void>)();
    expect(calls).toEqual([
      [
        'fn_admin_toggle_verified_seller',
        { p_target_user_id: 'seller-1', p_is_verified: true },
      ],
    ]);
    mock.restore();
  });

  it('changes the account status without sending an admin id', async () => {
    calls.length = 0;
    const render = harness();
    const suspend = render().find(
      (node) => node.props.title === 'Suspender Usuario',
    )!;
    (suspend.props.onClick as () => void)();
    const modal = render().find((node) => 'onConfirm' in node.props)!;
    await (modal.props.onConfirm as (reason: string) => Promise<void>)(
      'fraude',
    );
    expect(calls).toEqual([
      [
        'fn_admin_update_user_status',
        {
          p_target_user_id: 'seller-1',
          p_new_status: 'suspended',
          p_reason: 'fraude',
        },
      ],
    ]);
    mock.restore();
  });
}
