/**
 * Shared accent tones for the read-only workbench buckets. A tone sets the
 * status color of a bucket's rows and of its empty state, so every bucket
 * speaks the same color language.
 *
 * - `lion`: work authorized and still in flight.
 * - `amber`: outcome that needs operator attention.
 * - `forest`: server-confirmed successful outcome.
 * - `muted`: informational outcome without a corrective action.
 */
export type AccentTone = 'lion' | 'amber' | 'forest' | 'muted';
