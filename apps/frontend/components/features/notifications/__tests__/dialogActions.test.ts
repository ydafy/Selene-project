import { expect, test, describe } from 'bun:test';
import { resolveDialogControls } from '../dialogActions';

describe('resolveDialogControls', () => {
  test('isLast=true offers action + cancel', () => {
    const controls = resolveDialogControls(true);
    expect(controls.confirmAction).toBe('action');
    expect(controls.cancelAction).toBe('cancel');
  });

  test('isLast=false offers skipAll + skip', () => {
    const controls = resolveDialogControls(false);
    expect(controls.confirmAction).toBe('skipAll');
    expect(controls.cancelAction).toBe('skip');
  });
});
