-- Notifications (Web Push): one row per device and audience.
-- scope 'owner' = one of the owner's devices; otherwise the share link's id
-- (a guest's device on that link). guest_id is set when that device has a
-- name on the link (so it hears about replies); listen-only links have none.
-- endpoint/p256dh/auth come from the browser's PushSubscription.
CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  guest_id TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (endpoint, scope)
);
CREATE INDEX push_by_scope ON push_subscriptions(scope);
CREATE INDEX push_by_guest ON push_subscriptions(guest_id);
