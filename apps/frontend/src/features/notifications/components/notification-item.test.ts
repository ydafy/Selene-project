import { expect, test } from 'bun:test';

// Native Restyle and vector-icon modules require an Expo renderer; assert the bounded wiring here.
test('item uses presentation policy and localized read state without implicit mark-read', async () => {
  const source = await Bun.file(
    new URL('notification-item.tsx', import.meta.url),
  ).text();
  expect(source).toContain('getNotificationPresentation(notification)');
  expect(source).toContain('name={presentation.icon}');
  expect(source).toContain('notifications:itemLabel');
  expect(source).toContain('notifications:unreadState');
  expect(source).toContain('notifications:readState');
  expect(source).not.toContain('onMarkRead');
  expect(source).not.toContain('onDismiss');
  expect(source).not.toContain('ConfirmDialog');
  expect(source).toContain('getVerifiedEventIdentity(notification)');
  expect(source).toContain(
    "fontStyle={emphasizeMessage ? 'italic' : 'normal'}",
  );
  expect(source).toContain('onPress={() => onPress(notification)}');
  // Kinds with localized text render it in place of the stored server copy.
  expect(source).toContain('getNotificationText(');
  expect(source).toContain('{text.title}');
  expect(source).toContain('{text.message}');
  expect(source).not.toContain('{notification.title}');
});
