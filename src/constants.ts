export const KEY_PREFIX_CLIENT = 'ak_live_';
export const KEY_PREFIX_ADMIN = 'ak_admin_';
export const KEY_PREFIX_BASE = 'ak_';

// Must not exceed Docker's stop_grace_period (default 10s) or Docker force-kills before we drain.
export const SHUTDOWN_DRAIN_MS = 10_000;
