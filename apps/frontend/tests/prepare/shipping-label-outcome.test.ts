import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  generateLabelWithRecovery,
  openGeneratedLabel,
  resolveLabelFailureKey,
  type LabelDiagnostic,
} from '../../core/utils/shipping-label-outcome';

const labelUrl = 'https://labels.example.test/shipment.pdf';

const effects = () => {
  const events: LabelDiagnostic[] = [];
  const calls = { generate: 0, recover: 0, feedback: 0 };
  return {
    events,
    calls,
    generate: async () => {
      calls.generate++;
      return { labelUrl };
    },
    recover: async (): Promise<string | null> => {
      calls.recover++;
      return null;
    },
    feedback: async () => {
      calls.feedback++;
    },
    report: (event: LabelDiagnostic) => {
      events.push(event);
    },
  };
};

describe('shipping label outcome', () => {
  it('keeps the normal successful generation outcome and does not recover or repurchase', async () => {
    const deps = effects();
    expect(await generateLabelWithRecovery(deps)).toEqual({
      kind: 'generated',
      labelUrl,
    });
    expect(deps.calls).toEqual({ generate: 1, recover: 0, feedback: 1 });
    expect(deps.events).toEqual([]);
  });

  it('does not turn successful generation into failure when haptic feedback rejects', async () => {
    const deps = effects();
    deps.feedback = async () => {
      deps.calls.feedback++;
      throw new Error('native failure');
    };
    expect(await generateLabelWithRecovery(deps)).toEqual({
      kind: 'generated',
      labelUrl,
    });
    expect(deps.calls).toEqual({ generate: 1, recover: 0, feedback: 1 });
    expect(deps.events).toEqual(['feedback_unavailable']);
  });

  it('recovers the persisted guide after a lost response without making another purchase', async () => {
    const deps = effects();
    deps.generate = async () => {
      deps.calls.generate++;
      throw new Error('connection lost');
    };
    deps.recover = async () => {
      deps.calls.recover++;
      return labelUrl;
    };
    expect(await generateLabelWithRecovery(deps)).toEqual({
      kind: 'generated',
      labelUrl,
    });
    expect(deps.calls).toEqual({ generate: 1, recover: 1, feedback: 1 });
    expect(deps.events).toEqual(['generation_unconfirmed']);
  });

  it('returns a safe unconfirmed result even if generation and recovery both fail', async () => {
    const deps = effects();
    deps.generate = async () => {
      deps.calls.generate++;
      throw new Error('secret provider payload');
    };
    deps.recover = async () => {
      deps.calls.recover++;
      throw new Error('database unavailable');
    };
    expect(await generateLabelWithRecovery(deps)).toEqual({
      kind: 'failed',
      errorKey: 'prepare.errors.resultUnconfirmed',
    });
    expect(deps.calls).toEqual({ generate: 1, recover: 1, feedback: 0 });
    expect(deps.events).toEqual([
      'generation_unconfirmed',
      'recovery_unavailable',
    ]);
  });

  it('treats a missing label response as unconfirmed and checks persisted state', async () => {
    const deps = effects();
    deps.generate = async () => {
      deps.calls.generate++;
      return { labelUrl: '' };
    };
    expect(await generateLabelWithRecovery(deps)).toEqual({
      kind: 'failed',
      errorKey: 'prepare.errors.resultUnconfirmed',
    });
    expect(deps.calls).toEqual({ generate: 1, recover: 1, feedback: 0 });
    expect(deps.events).toEqual(['generation_unconfirmed']);
  });

  it('maps only known public failures and never returns raw technical messages', () => {
    for (const code of ['No autorizado', 'AUTH_REQUIRED']) {
      expect(resolveLabelFailureKey(new Error(code))).toBe(
        'prepare.errors.sessionExpired',
      );
    }
    for (const code of [
      'PAQUETEXPRESS_GROUND_UNAVAILABLE',
      'ENVIA_CONFIGURATION_INVALID',
    ]) {
      expect(resolveLabelFailureKey(new Error(code))).toBe(
        'prepare.errors.serviceUnavailable',
      );
    }
    for (const error of [
      new Error('LABEL_RECONCILIATION_REQUIRED'),
      new Error('secret token'),
      null,
    ]) {
      expect(resolveLabelFailureKey(error)).toBe(
        'prepare.errors.resultUnconfirmed',
      );
    }
  });

  it('provides all friendly failure categories in Spanish and English', () => {
    for (const locale of ['en', 'es']) {
      const copy = JSON.parse(
        readFileSync(
          join(
            process.cwd(),
            `apps/frontend/core/i18n/locales/${locale}/orders.json`,
          ),
          'utf8',
        ),
      );
      for (const key of [
        'sessionExpired',
        'serviceUnavailable',
        'resultUnconfirmed',
        'labelOpenFailed',
      ]) {
        expect(copy.prepare.errors?.[key]).toBeString();
      }
    }
  });

  it('opens a saved label or reports a safe failure without mutating the label', async () => {
    const events: LabelDiagnostic[] = [];
    const opened: string[] = [];
    const report = (event: LabelDiagnostic) => {
      events.push(event);
    };
    expect(
      await openGeneratedLabel(
        labelUrl,
        async (url) => {
          opened.push(url);
        },
        report,
      ),
    ).toBe(true);
    expect(opened).toEqual([labelUrl]);
    expect(events).toEqual([]);
    expect(
      await openGeneratedLabel(
        labelUrl,
        async () => {
          throw new Error('native error');
        },
        report,
      ),
    ).toBe(false);
    expect(events).toEqual(['label_open_failed']);
    expect(opened).toEqual([labelUrl]);
  });

  it('rejects non-HTTPS and malformed labels without invoking the URL handler', async () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///private/data',
      'http://example.test',
      'invalid',
      '',
    ]) {
      const events: LabelDiagnostic[] = [];
      let calls = 0;
      expect(
        await openGeneratedLabel(
          url,
          async () => {
            calls++;
          },
          (event) => {
            events.push(event);
          },
        ),
      ).toBe(false);
      expect(calls).toBe(0);
      expect(events).toEqual(['label_open_failed']);
    }
  });
});
