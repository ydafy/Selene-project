import { withSentry } from '../_shared/sentry.ts';
import { createConnectOnboardingReturnHandler } from './handler.ts';

const handler = createConnectOnboardingReturnHandler({
  getEnv: (name) => Deno.env.get(name),
});

Deno.serve(withSentry('connect-onboarding-return', handler));
