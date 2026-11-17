import { useEffect } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Screen readers announce an onboarding notice (pending, rejected, expired
 * link) when it appears or changes, because it lives in the screen header
 * instead of an alert.
 */
export function useAnnounceOnboardingNotice(message: string | null) {
  useEffect(() => {
    if (message) AccessibilityInfo.announceForAccessibility(message);
  }, [message]);
}
