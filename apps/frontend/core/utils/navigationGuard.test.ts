import { describe, expect, it, mock } from 'bun:test';

import { routeBlockedRemove } from './navigationGuard';

const setup = () => {
  const proceed = mock<(action: { type: string }) => void>(() => {});
  const confirmExit = mock<(action: { type: string }) => void>(() => {});
  return { proceed, confirmExit };
};

describe('routeBlockedRemove', () => {
  it('lets a REPLACE (publishing) through without opening the dialog', () => {
    const { proceed, confirmExit } = setup();
    const action = { type: 'REPLACE' };

    routeBlockedRemove(action, { proceed, confirmExit });

    expect(proceed).toHaveBeenCalledTimes(1);
    expect(proceed).toHaveBeenCalledWith(action);
    expect(confirmExit).not.toHaveBeenCalled();
  });

  it.each(['GO_BACK', 'POP', 'POP_TO_TOP', 'NAVIGATE', 'PUSH'])(
    'asks for confirmation on %s and does not proceed',
    (type) => {
      const { proceed, confirmExit } = setup();
      const action = { type };

      routeBlockedRemove(action, { proceed, confirmExit });

      expect(confirmExit).toHaveBeenCalledTimes(1);
      expect(confirmExit).toHaveBeenCalledWith(action);
      expect(proceed).not.toHaveBeenCalled();
    },
  );
});
