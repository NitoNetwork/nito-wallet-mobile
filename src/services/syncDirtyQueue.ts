export type DirtySyncOptions = {
  force?: boolean;
  silent?: boolean;
  pendingOnly?: boolean;
  onlyAddresses?: readonly string[];
  rescanGap?: boolean;
};

type RequestSync = (options: DirtySyncOptions) => void;
type RequestWork = () => void;

const mergeOptions = (
  current: DirtySyncOptions,
  incoming: DirtySyncOptions,
): DirtySyncOptions => ({
  force: Boolean(current.force || incoming.force),
  silent: Boolean(current.silent && incoming.silent),
  pendingOnly: Boolean(current.pendingOnly && incoming.pendingOnly),
  rescanGap: Boolean(current.rescanGap || incoming.rescanGap),
  onlyAddresses: current.onlyAddresses && incoming.onlyAddresses
    ? [...new Set([...current.onlyAddresses, ...incoming.onlyAddresses])]
    : undefined,
});

export class DirtySyncQueue {
  private pending: DirtySyncOptions | null = null;

  request(
    options: DirtySyncOptions,
    syncInFlight: boolean,
    requestSync: RequestSync,
  ): 'requested' | 'deferred' {
    if (!syncInFlight) {
      requestSync(options);
      return 'requested';
    }

    this.pending = this.pending ? mergeOptions(this.pending, options) : { ...options };
    return 'deferred';
  }

  flush(syncInFlight: boolean, requestSync: RequestSync): boolean {
    if (syncInFlight || !this.pending) {
      return false;
    }

    const pending = this.pending;
    this.pending = null;
    requestSync(pending);
    return true;
  }

  clear(): void {
    this.pending = null;
  }
}

export class DirtyRequestQueue {
  private pending = false;

  request(
    workInFlight: boolean,
    requestWork: RequestWork,
  ): 'requested' | 'deferred' {
    if (!workInFlight) {
      requestWork();
      return 'requested';
    }

    this.pending = true;
    return 'deferred';
  }

  flush(workInFlight: boolean, requestWork: RequestWork): boolean {
    if (workInFlight || !this.pending) {
      return false;
    }

    this.pending = false;
    requestWork();
    return true;
  }

  clear(): void {
    this.pending = false;
  }
}
