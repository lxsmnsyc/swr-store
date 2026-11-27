// A reference model of one store. It tracks only what the documented
// contract promises: the cache entry of each key, the running fetch, the
// subscribers and the polling ticks. It does not use any code from `src`.

export type ModelResult =
  | { status: 'pending' }
  | { status: 'success'; data: number }
  | { status: 'failure'; data: Error };

export interface ModelEntry {
  result: ModelResult;
  timestamp: number;
  validating: boolean;
}

export interface ModelFetch {
  seq: number;
  key: string;
  // False once a write cancelled the fetch. Its result is then dropped.
  current: boolean;
}

export interface ModelOptions {
  freshAge: number;
  staleAge: number;
  refreshInterval: number | undefined;
}

export interface Model {
  options: ModelOptions;
  now: number;
  entries: Map<string, ModelEntry>;
  // The one fetch the store runs for each key.
  fetches: Map<string, ModelFetch>;
  // Every fetch whose `get` promise is not settled yet, in start order.
  inflight: ModelFetch[];
  createdKeys: string[];
  subscriberCounts: Map<string, number>;
  // The time of the next polling tick of each subscribed key.
  nextTicks: Map<string, number>;
  // Keys whose subscribers must be notified during the current command.
  wrote: Set<string>;
}

export function createModel(options: ModelOptions, now: number): Model {
  return {
    options,
    now,
    entries: new Map(),
    fetches: new Map(),
    inflight: [],
    createdKeys: [],
    subscriberCounts: new Map(),
    nextTicks: new Map(),
    wrote: new Set(),
  };
}

// The updater used by tests. It reads the cached data like `mutate` does.
export function applyUpdater(previous: number | undefined): number {
  return previous === undefined ? 0 : (previous + 1) % 3;
}

function writeEntry(model: Model, key: string, entry: ModelEntry, notify = true): void {
  model.entries.set(key, entry);
  if (notify) {
    model.wrote.add(key);
  }
}

function cancelFetch(model: Model, key: string): void {
  const running = model.fetches.get(key);
  if (running) {
    running.current = false;
    model.fetches.delete(key);
  }
}

function isSubscribed(model: Model, key: string): boolean {
  return (model.subscriberCounts.get(key) ?? 0) > 0;
}

// Reads `key`. Starts a fetch when the entry is missing, not fresh or forced,
// and no fetch runs for the key.
export function revalidateKey(
  model: Model,
  key: string,
  force: boolean,
  shouldRevalidate = true,
): ModelResult {
  const { now } = model;
  const { freshAge, staleAge } = model.options;
  const entry = model.entries.get(key);
  const running = model.fetches.get(key);
  const pending: ModelResult = { status: 'pending' };
  const cached = entry?.result ?? (running ? pending : undefined);

  // Without revalidation, any cached result is returned as is.
  if (cached && !shouldRevalidate) {
    return cached;
  }

  // A fresh entry is returned. Only a forced read skips this.
  if (entry && !force && entry.timestamp + freshAge > now) {
    return entry.result;
  }

  // The running fetch is shared, even by a forced read.
  if (running && cached) {
    return cached;
  }

  // Start the fetch.
  const fetch: ModelFetch = { seq: model.createdKeys.length, key, current: true };
  model.createdKeys.push(key);
  model.inflight.push(fetch);
  model.fetches.set(key, fetch);

  if (entry && entry.result.status !== 'failure' && entry.timestamp + freshAge + staleAge > now) {
    // Stale: the old result stays while the fetch runs.
    writeEntry(model, key, { ...entry, validating: true });
    return entry.result;
  }
  // Expired, failed or missing: the entry becomes pending.
  writeEntry(model, key, { result: pending, timestamp: now, validating: true });
  return pending;
}

export function subscribeKey(model: Model, key: string): void {
  const count = model.subscriberCounts.get(key) ?? 0;
  model.subscriberCounts.set(key, count + 1);
  if (count === 0 && model.options.refreshInterval !== undefined) {
    model.nextTicks.set(key, model.now + model.options.refreshInterval);
  }
}

export function unsubscribeKey(model: Model, key: string): void {
  const count = (model.subscriberCounts.get(key) ?? 0) - 1;
  model.subscriberCounts.set(key, count);
  if (count === 0) {
    model.nextTicks.delete(key);
  }
}

// Writes a result and cancels the running fetch, which started before the
// write. Subscribers then fetch again when `revalidate` is set.
export function writeResult(
  model: Model,
  key: string,
  result: ModelResult,
  revalidate: boolean,
): void {
  const current = model.entries.get(key);
  cancelFetch(model, key);

  if (
    current?.result.status === 'success' &&
    result.status === 'success' &&
    current.result.data === result.data
  ) {
    // Equal data only renews the entry. Subscribers hear about it only when
    // the entry was validating.
    writeEntry(
      model,
      key,
      { ...current, timestamp: model.now, validating: false },
      current.validating,
    );
  } else {
    writeEntry(model, key, { result, timestamp: model.now, validating: false });
  }

  if (revalidate && isSubscribed(model, key)) {
    revalidateKey(model, key, true);
  }
}

export function mutateKey(
  model: Model,
  key: string,
  input: { kind: 'value'; data: number } | { kind: 'updater' },
  revalidate: boolean,
): void {
  const current = model.entries.get(key)?.result;
  let data: number;
  if (input.kind === 'value') {
    data = input.data;
  } else {
    data = applyUpdater(current?.status === 'success' ? current.data : undefined);
  }
  writeResult(model, key, { status: 'success', data }, revalidate);
}

// A trigger, a focus event and a polling tick all do the same thing.
export function triggerKey(model: Model, key: string): void {
  if (isSubscribed(model, key)) {
    revalidateKey(model, key, false);
  }
}

export function focusWindow(model: Model): void {
  for (const key of model.subscriberCounts.keys()) {
    triggerKey(model, key);
  }
}

// Moves the clock and fires the polling ticks that fall in the range.
export function advanceTime(model: Model, ms: number): void {
  const { refreshInterval } = model.options;
  const target = model.now + ms;
  if (refreshInterval !== undefined) {
    for (const [key, first] of model.nextTicks) {
      let tick = first;
      while (tick <= target) {
        model.now = tick;
        revalidateKey(model, key, false);
        tick += refreshInterval;
      }
      model.nextTicks.set(key, tick);
    }
  }
  model.now = target;
}

// Settles one in-flight fetch. A cancelled fetch changes nothing.
export function settleFetch(
  model: Model,
  index: number,
  outcome: { kind: 'resolve'; data: number } | { kind: 'reject'; reason: Error },
): ModelFetch {
  const [fetch] = model.inflight.splice(index, 1);
  if (!fetch.current) {
    return fetch;
  }
  model.fetches.delete(fetch.key);
  if (outcome.kind === 'resolve') {
    // A resolved fetch always writes its result, even when the data is equal.
    writeEntry(model, fetch.key, {
      result: { status: 'success', data: outcome.data },
      timestamp: model.now,
      validating: false,
    });
  } else {
    writeEntry(model, fetch.key, {
      result: { status: 'failure', data: outcome.reason },
      timestamp: model.now,
      validating: false,
    });
  }
  return fetch;
}
