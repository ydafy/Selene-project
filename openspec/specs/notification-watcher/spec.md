# Notification Watcher Specification

## Requirements

### Requirement: One owner-scoped Realtime subscription (CONF-002, CONF-005)

The watcher SHALL own at most one `notifications_realtime_watcher_{userId}` channel per authenticated session, filtered by `user_id`. Query hooks SHALL create no notification channels. On user change or unmount, cleanup SHALL call `supabase.removeChannel(channel)` without awaiting it in the React effect cleanup. INSERT and UPDATE SHALL invalidate the owner-scoped list and unread caches; dismissed rows SHALL not be presented.

#### Scenario: Realtime read-state change
- GIVEN a notification is marked read on another device
- WHEN an UPDATE arrives
- THEN both caches refresh without presenting a second alert

### Requirement: Launch digest and foreground presentation (CONF-004, CONF-301, CONF-302)

On a signed-in launch, the app SHALL fetch eligible new unread notices once and offer at most one actionable digest for that launch. Until the trusted typed event cutover, all legacy notices have equal generic priority; the digest SHALL select the newest eligible legacy notice (with a deterministic ID tie-breaker). After that cutover, the digest SHALL show the highest-priority eligible notice with a primary validated destination action and a way to open the inbox for other important new notices; it SHALL NOT queue one dialog per event. Suppress duplicate digest appearances on rerender or Realtime replay. Opening, skipping, or displaying the digest SHALL NOT mark any row read; explicit item action or mark-read does. Foreground INSERTs MAY show a best-effort toast/haptic when app state permits, but failure, background delivery, or a missed Realtime message MUST NOT remove the persisted inbox row. Foreground display also SHALL NOT auto-mark read. After trusted typed cutover, urgency SHALL be determined by approved event kind/recipient role, never localized title, generic `type`, or route prefix. Legacy rows with no event identity use safe generic presentation and are never ranked by inferred urgency. The legacy-only slice does not implement typed highest-priority selection.

#### Scenario: Several unread notices at launch
- GIVEN several eligible unread notices are persisted when the app launches
- WHEN the digest loads
- THEN one digest offers a primary action and inbox access to the remainder, without changing read state

#### Scenario: Realtime replay
- GIVEN an INSERT for an already presented event is replayed
- WHEN the watcher receives it
- THEN it does not show another digest and the inbox stays authoritative

### Requirement: Typed, resilient payloads (CONF-303, CONF-304, CONF-305)

Payload handling SHALL use the `Notification` alias from `@selene/types`, avoid `any`, and handle subscription errors without crashing. Toasts SHALL use supported `visibilityTime` behavior, not id-based or static `Toast.hide()` calls. Legacy severity may select visual styling, but SHALL NOT determine urgency; localized error feedback SHALL surface subscription or handler failures without treating display as delivery confirmation.
