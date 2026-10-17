export type LabelFailureKey =
  | 'prepare.errors.sessionExpired'
  | 'prepare.errors.serviceUnavailable'
  | 'prepare.errors.resultUnconfirmed';

export type LabelDiagnostic =
  | 'generation_unconfirmed'
  | 'recovery_unavailable'
  | 'feedback_unavailable'
  | 'label_open_failed'
  | 'status_refresh_failed';

type LabelOutcome =
  | { kind: 'generated'; labelUrl: string }
  | { kind: 'failed'; errorKey: LabelFailureKey };

interface LabelEffects {
  generate: () => Promise<{ labelUrl?: string | null } | null | undefined>;
  recover: () => Promise<string | null>;
  feedback: () => Promise<unknown>;
  report: (event: LabelDiagnostic) => void;
}

export function resolveLabelFailureKey(error: unknown): LabelFailureKey {
  switch (error instanceof Error ? error.message : undefined) {
    case 'No autorizado':
      return 'prepare.errors.sessionExpired';
    case 'PAQUETEXPRESS_GROUND_UNAVAILABLE':
    case 'ENVIA_CONFIGURATION_INVALID':
      return 'prepare.errors.serviceUnavailable';
    default:
      return 'prepare.errors.resultUnconfirmed';
  }
}

/** A lost response must never cause another label purchase. */
export async function generateLabelWithRecovery(
  effects: LabelEffects,
): Promise<LabelOutcome> {
  let labelUrl: string | null = null;
  let generationError: unknown;
  try {
    const result = await effects.generate();
    labelUrl = result?.labelUrl || null;
  } catch (error: unknown) {
    generationError = error;
  }

  if (!labelUrl) {
    effects.report('generation_unconfirmed');
    try {
      labelUrl = await effects.recover();
    } catch {
      effects.report('recovery_unavailable');
    }
    if (!labelUrl) {
      return {
        kind: 'failed',
        errorKey: resolveLabelFailureKey(generationError),
      };
    }
  }

  try {
    await effects.feedback();
  } catch {
    effects.report('feedback_unavailable');
  }
  return { kind: 'generated', labelUrl };
}

export async function openGeneratedLabel(
  labelUrl: string,
  openUrl: (url: string) => Promise<unknown>,
  report: (event: LabelDiagnostic) => void,
): Promise<boolean> {
  try {
    if (new URL(labelUrl).protocol !== 'https:')
      throw new Error('UNSAFE_LABEL_URL');
    await openUrl(labelUrl);
    return true;
  } catch {
    report('label_open_failed');
    return false;
  }
}
