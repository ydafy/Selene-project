/**
 * Pure helpers for WizardSteps accessibility labels.
 *
 * Isolated in this file so the label-building logic can be unit-tested in Bun
 * without importing React Native through the component tree.
 */

export type WizardTranslator = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export const buildWizardStepA11yLabel = (
  stepName: string,
  index: number,
  currentStep: number,
  totalSteps: number,
  t: WizardTranslator,
): string => {
  const isActive = index === currentStep;
  const isCompleted = index < currentStep;

  const stepStatus = isCompleted
    ? t('a11y.stepCompleted')
    : isActive
      ? t('a11y.stepCurrent')
      : t('a11y.stepPending');

  return `${t('a11y.wizardProgress', { current: index + 1, total: totalSteps })}. ${stepName}: ${stepStatus}.`;
};

export const buildWizardParentA11yLabel = (
  currentStep: number,
  totalSteps: number,
  steps: string[],
  t: WizardTranslator,
): string => {
  const currentStepName = steps[currentStep] ?? '';
  const completedCount = Math.max(0, Math.min(currentStep, totalSteps));
  const pendingCount = Math.max(0, totalSteps - completedCount - 1);

  return `${t('a11y.wizardProgress', { current: currentStep + 1, total: totalSteps })}. ${t('a11y.stepCurrent')}: ${currentStepName}. ${t('a11y.stepCompleted')}: ${completedCount}. ${t('a11y.stepPending')}: ${pendingCount}.`;
};
