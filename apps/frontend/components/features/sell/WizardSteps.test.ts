import { describe, expect, it } from 'bun:test';

import {
  buildWizardStepA11yLabel,
  buildWizardParentA11yLabel,
} from './wizardA11y';

const fakeT = (key: string, options?: Record<string, unknown>): string => {
  const map: Record<string, string> = {
    'a11y.wizardProgress': `Step ${options?.current ?? 0} of ${options?.total ?? 0}`,
    'a11y.stepCompleted': 'completed',
    'a11y.stepCurrent': 'current',
    'a11y.stepPending': 'pending',
  };
  return map[key] ?? key;
};

describe('buildWizardStepA11yLabel', () => {
  it('describes a completed step', () => {
    expect(buildWizardStepA11yLabel('Info', 0, 1, 4, fakeT)).toBe(
      'Step 1 of 4. Info: completed.',
    );
  });

  it('describes the current step', () => {
    expect(buildWizardStepA11yLabel('Specs', 1, 1, 4, fakeT)).toBe(
      'Step 2 of 4. Specs: current.',
    );
  });

  it('describes a pending step', () => {
    expect(buildWizardStepA11yLabel('Photos', 2, 1, 4, fakeT)).toBe(
      'Step 3 of 4. Photos: pending.',
    );
  });
});

describe('buildWizardParentA11yLabel', () => {
  it('announces progress plus current, completed, and pending counts', () => {
    const steps = ['Info', 'Specs', 'Photos', 'Done'];
    expect(buildWizardParentA11yLabel(1, steps.length, steps, fakeT)).toBe(
      'Step 2 of 4. current: Specs. completed: 1. pending: 2.',
    );
  });

  it('handles the first step with zero completed', () => {
    const steps = ['Info', 'Specs'];
    expect(buildWizardParentA11yLabel(0, steps.length, steps, fakeT)).toBe(
      'Step 1 of 2. current: Info. completed: 0. pending: 1.',
    );
  });

  it('handles the last step with zero pending', () => {
    const steps = ['Info', 'Specs'];
    expect(buildWizardParentA11yLabel(1, steps.length, steps, fakeT)).toBe(
      'Step 2 of 2. current: Specs. completed: 1. pending: 0.',
    );
  });
});
