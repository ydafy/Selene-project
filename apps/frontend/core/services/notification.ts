import { router } from 'expo-router';
import { Notification } from '@selene/types';

// ---------------------------------------------------------------------------
// NotificationService — Pub/Sub module for realtime event routing
// ---------------------------------------------------------------------------
// Pure module (no React, no Zustand). Push-ready: Expo Push tokens can call
// dispatch() identically to realtime events. Follows OrderService class pattern.

type NotificationListener = (notification: Notification) => void;

const listeners = new Map<string, NotificationListener>();
let listenerCounter = 0;

export const NotificationService = {
  /**
   * Broadcast a notification to all subscribed listeners.
   * Used by NotificationWatcher (realtime INSERT) and by future push handlers.
   */
  dispatch(notification: Notification): void {
    listeners.forEach((listener) => {
      try {
        listener(notification);
      } catch (error) {
        console.error('[NotificationService] Listener error:', error);
      }
    });
  },

  /**
   * Subscribe a listener to notification events.
   * @returns listenerId — pass to unsubscribe() to remove.
   */
  subscribe(listener: NotificationListener): string {
    const id = `nl_${++listenerCounter}`;
    listeners.set(id, listener);
    return id;
  },

  /**
   * Remove a previously subscribed listener.
   */
  unsubscribe(listenerId: string): void {
    listeners.delete(listenerId);
  },
};

// ---------------------------------------------------------------------------
// NotificationLinking — Validated deep-link router
// ---------------------------------------------------------------------------
// Validates action_path against a known route map before navigating.
// Invalid paths fall back to /profile/notifications.
// /profile redirects to /profile/listings (preserving existing behaviour).

interface RouteEntry {
  pattern: string;
  params: string[];
  redirectTo?: string;
}

const ROUTE_MAP: RouteEntry[] = [
  // Redirects
  { pattern: '/profile', params: [], redirectTo: '/profile/listings' },

  // Static routes
  { pattern: '/profile/listings', params: [] },
  { pattern: '/profile/orders', params: [] },
  { pattern: '/profile/wallet', params: [] },
  { pattern: '/profile/favorites', params: [] },
  { pattern: '/profile/notifications', params: [] },
  { pattern: '/profile/support', params: [] },
  { pattern: '/help/verification', params: [] },

  // Dynamic routes
  { pattern: '/product/[id]', params: ['id'] },
  { pattern: '/profile/[id]', params: ['id'] },
  { pattern: '/profile/orders/[id]', params: ['id'] },
  { pattern: '/verify/[id]', params: ['id'] },
];

/**
 * Resolve an action_path to a valid Expo Router path, or the fallback.
 */
function resolvePath(actionPath: string): string {
  // Check static and redirect routes first
  const staticEntry = ROUTE_MAP.find(
    (entry) => entry.pattern === actionPath && entry.params.length === 0,
  );
  if (staticEntry) {
    return staticEntry.redirectTo ?? staticEntry.pattern;
  }

  // Check dynamic routes — extract param values from the incoming path
  for (const entry of ROUTE_MAP) {
    if (entry.params.length === 0) continue; // Already checked above

    const patternSegments = entry.pattern.split('/');
    const pathSegments = actionPath.split('/');

    if (patternSegments.length !== pathSegments.length) continue;

    let isMatch = true;
    const params: Record<string, string> = {};

    for (let i = 0; i < patternSegments.length; i++) {
      const patternSeg = patternSegments[i];
      const pathSeg = pathSegments[i];

      if (patternSeg.startsWith('[') && patternSeg.endsWith(']')) {
        // Dynamic segment — capture the value
        const paramName = patternSeg.slice(1, -1);
        params[paramName] = pathSeg;
      } else if (patternSeg !== pathSeg) {
        isMatch = false;
        break;
      }
    }

    if (isMatch && Object.keys(params).length === entry.params.length) {
      // Build the Expo Router path with params
      // e.g. /product/abc123 or /profile/orders/xyz
      return actionPath;
    }
  }

  // No match — fallback
  return '/profile/notifications';
}

export const NotificationLinking = {
  /**
   * Navigate to the notification's action_path, validated against the route map.
   * Falls back to /profile/notifications for invalid or null paths.
   */
  navigate(actionPath: string | null | undefined): void {
    if (!actionPath) {
      router.push('/profile/notifications');
      return;
    }

    const resolved = resolvePath(actionPath);
    router.push(resolved as Parameters<typeof router.push>[0]);
  },
};