/**
 * Simple counter-based race guard.
 *
 * Because the current Supabase edge-client wrapper does not accept an
 * AbortController signal, we drop the result of any request that was
 * superseded by a newer one.
 */
export class RequestRaceGuard {
  private latestId = 0;

  start(): number {
    this.latestId += 1;
    return this.latestId;
  }

  isCurrent(id: number): boolean {
    return id === this.latestId;
  }
}
