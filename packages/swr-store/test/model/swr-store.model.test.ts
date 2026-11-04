import * as fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Model, ModelEntry, ModelResult } from './reference-model';
import type { SWREntry, SWRResult } from '../../src';
import { createSWRStore } from '../../src';
import { getMutation } from '../../src/cache/mutation-cache';
import { fetches } from '../../src/fetches';
import {
  advanceTime,
  applyUpdater,
  createModel,
  focusWindow,
  mutateKey,
  revalidateKey,
  settleFetch,
  subscribeKey,
  triggerKey,
  unsubscribeKey,
  writeResult,
} from './reference-model';

// Notes on guarantees the model leaves out:
// - `maxRetryCount` is 0, so a failed fetch fails at once. Retries have
//   their own tests.
// - A forced read while a fetch runs never starts a second fetch in the
//   current source, so the model has no case for replacing a running fetch.
// - The cache size is the default, so no entry is evicted. The LRU has its
//   own property.

const KEY_COUNT = 3;
const START_TIME = 1_000_000;
const RUNS = 150;

type Command =
  | { kind: 'get'; id: number; revalidate: boolean }
  | { kind: 'subscribe'; id: number }
  | { kind: 'unsubscribe'; pick: number }
  | { kind: 'mutate'; id: number; value: number; useUpdater: boolean; revalidate: boolean }
  | { kind: 'setError'; id: number; revalidate: boolean }
  | { kind: 'trigger'; id: number }
  | { kind: 'focus' }
  | { kind: 'advance'; ms: number }
  | { kind: 'settle'; pick: number; reject: boolean; value: number };

interface Scenario {
  freshAge: number;
  staleAge: number;
  refreshInterval: number | undefined;
  commands: Command[];
}

const idArb = fc.nat(KEY_COUNT - 1);
const valueArb = fc.nat(2);

const commandArb: fc.Arbitrary<Command> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('get' as const),
      id: idArb,
      revalidate: fc.boolean(),
    }),
  },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('subscribe' as const), id: idArb }) },
  {
    weight: 2,
    arbitrary: fc.record({ kind: fc.constant('unsubscribe' as const), pick: fc.nat(10) }),
  },
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant('mutate' as const),
      id: idArb,
      value: valueArb,
      useUpdater: fc.boolean(),
      revalidate: fc.boolean(),
    }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      kind: fc.constant('setError' as const),
      id: idArb,
      revalidate: fc.boolean(),
    }),
  },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('trigger' as const), id: idArb }) },
  { weight: 1, arbitrary: fc.constant({ kind: 'focus' as const }) },
  {
    weight: 4,
    arbitrary: fc.record({
      kind: fc.constant('advance' as const),
      ms: fc.constantFrom(0, 50, 100, 300, 600, 1000, 2500, 6000, 40_000),
    }),
  },
  {
    weight: 6,
    arbitrary: fc.record({
      kind: fc.constant('settle' as const),
      pick: fc.nat(10),
      reject: fc.boolean(),
      value: valueArb,
    }),
  },
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  freshAge: fc.constantFrom(0, 100, 1000),
  staleAge: fc.constantFrom(0, 500, 5000),
  refreshInterval: fc.constantFrom(undefined, 300, 1000),
  commands: fc.array(commandArb, { minLength: 1, maxLength: 40 }),
});

interface Subscriber {
  key: string;
  log: ModelEntry[];
  closed: boolean;
  unsubscribe: () => void;
}

interface Call {
  key: string;
  resolve: (value: number) => void;
  reject: (reason: unknown) => void;
}

let runIndex = 0;

afterEach(() => {
  vi.useRealTimers();
});

// Lets every promise reaction and queued notification run.
async function flushMicrotasks(): Promise<void> {
  for (let step = 0; step < 20; step += 1) {
    // oxlint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

function toModelResult(result: SWRResult<number>): ModelResult {
  if (result.status === 'pending') {
    return { status: 'pending' };
  }
  if (result.status === 'success') {
    return { status: 'success', data: result.data };
  }
  // Every failure in this suite is an `Error`.
  const reason: unknown = result.data;
  if (!(reason instanceof Error)) {
    throw new TypeError('Expected the failure to be an Error');
  }
  return { status: 'failure', data: reason };
}

function expectSameResult(actual: ModelResult, expected: ModelResult): void {
  expect(actual.status).toBe(expected.status);
  if (actual.status !== 'pending' && expected.status !== 'pending') {
    expect(actual.data).toBe(expected.data);
  }
}

function expectSameEntry(actual: ModelEntry | undefined, expected: ModelEntry | undefined): void {
  expect(actual === undefined).toBe(expected === undefined);
  if (actual && expected) {
    expectSameResult(actual.result, expected.result);
    expect(actual.validating).toBe(expected.validating);
    expect(actual.timestamp).toBe(expected.timestamp);
  }
}

function toModelEntry(entry: SWREntry<number>): ModelEntry {
  return {
    result: toModelResult(entry.result),
    validating: entry.isValidating,
    timestamp: entry.timestamp,
  };
}

async function runScenario(scenario: Scenario): Promise<void> {
  vi.useFakeTimers({ now: START_TIME });
  runIndex += 1;
  const prefix = `model-${runIndex}-`;
  const keys: string[] = [];
  for (let id = 0; id < KEY_COUNT; id += 1) {
    keys.push(`${prefix}${id}`);
  }

  const model: Model = createModel(
    {
      freshAge: scenario.freshAge,
      staleAge: scenario.staleAge,
      refreshInterval: scenario.refreshInterval,
    },
    START_TIME,
  );
  const calls: Call[] = [];
  const subscribers: Subscriber[] = [];
  let lateNotifications = 0;
  let errorCount = 0;

  const store = createSWRStore<number, [number]>({
    key: (id) => `${prefix}${id}`,
    get: async (id) =>
      new Promise<number>((resolve, reject) => {
        calls.push({ key: `${prefix}${id}`, resolve, reject });
      }),
    freshAge: scenario.freshAge,
    staleAge: scenario.staleAge,
    refreshInterval: scenario.refreshInterval,
    revalidateOnFocus: true,
    maxRetryCount: 0,
  });

  // Takes the active subscribers in order.
  function listActive(): Subscriber[] {
    const active: Subscriber[] = [];
    for (const subscriber of subscribers) {
      if (!subscriber.closed) {
        active.push(subscriber);
      }
    }
    return active;
  }

  function createError(): Error {
    errorCount += 1;
    return new Error(`failure ${errorCount}`);
  }

  // Runs one command on the store and on the model, and compares both reads.
  function execute(command: Command): void {
    switch (command.kind) {
      case 'get': {
        const actual = store.get([command.id], { revalidate: command.revalidate });
        const expected = revalidateKey(model, keys[command.id], false, command.revalidate);
        expectSameResult(toModelResult(actual), expected);
        if (actual.status === 'pending') {
          expect(actual.data).toBeInstanceOf(Promise);
        }
        break;
      }
      case 'subscribe': {
        const key = keys[command.id];
        const subscriber: Subscriber = {
          key,
          log: [],
          closed: false,
          unsubscribe: () => undefined,
        };
        subscriber.unsubscribe = store.subscribe([command.id], (entry) => {
          if (subscriber.closed) {
            lateNotifications += 1;
          }
          subscriber.log.push(toModelEntry(entry));
        });
        subscribers.push(subscriber);
        subscribeKey(model, key);
        break;
      }
      case 'unsubscribe': {
        const active = listActive();
        const subscriber = active.at(command.pick % Math.max(active.length, 1));
        if (subscriber) {
          subscriber.unsubscribe();
          subscriber.closed = true;
          unsubscribeKey(model, subscriber.key);
        }
        break;
      }
      case 'mutate': {
        const key = keys[command.id];
        if (command.useUpdater) {
          store.mutate([command.id], applyUpdater, { revalidate: command.revalidate });
          mutateKey(model, key, { kind: 'updater' }, command.revalidate);
        } else {
          store.mutate([command.id], command.value, { revalidate: command.revalidate });
          mutateKey(model, key, { kind: 'value', data: command.value }, command.revalidate);
        }
        break;
      }
      case 'setError': {
        const reason = createError();
        store.setResult(
          [command.id],
          { status: 'failure', data: reason },
          {
            revalidate: command.revalidate,
          },
        );
        writeResult(
          model,
          keys[command.id],
          { status: 'failure', data: reason },
          command.revalidate,
        );
        break;
      }
      case 'trigger': {
        store.trigger([command.id]);
        triggerKey(model, keys[command.id]);
        break;
      }
      case 'focus': {
        window.dispatchEvent(new Event('focus'));
        focusWindow(model);
        break;
      }
      case 'advance': {
        vi.advanceTimersByTime(command.ms);
        advanceTime(model, command.ms);
        break;
      }
      case 'settle': {
        if (model.inflight.length === 0) {
          break;
        }
        const index = command.pick % model.inflight.length;
        const target = model.inflight[index];
        // The call list and the model list start fetches in the same order.
        const call = calls[target.seq];
        expect(call.key).toBe(target.key);
        if (command.reject) {
          const reason = createError();
          settleFetch(model, index, { kind: 'reject', reason });
          call.reject(reason);
        } else {
          settleFetch(model, index, { kind: 'resolve', data: command.value });
          call.resolve(command.value);
        }
        break;
      }
    }
  }

  // Compares the store with the model after a command.
  function checkState(before: Map<Subscriber, number>): void {
    // A fetch starts only when the model starts one, and for the same key.
    expect(calls.length).toBe(model.createdKeys.length);
    for (let index = 0; index < calls.length; index += 1) {
      expect(calls[index].key).toBe(model.createdKeys[index]);
    }

    for (const key of keys) {
      // The store runs one fetch per key, and only when the model does.
      expect(fetches.has(key)).toBe(model.fetches.has(key));

      // The cache entry equals the model: result, age and validating flag.
      const entry = getMutation<number>(key);
      expectSameEntry(entry && toModelEntry(entry), model.entries.get(key));
    }

    // Subscribers are notified when a write happened, and with the final
    // entry. They hear nothing when nothing was written.
    expect(lateNotifications).toBe(0);
    for (const subscriber of listActive()) {
      const added = subscriber.log.length - (before.get(subscriber) ?? 0);
      if (model.wrote.has(subscriber.key)) {
        expect(added).toBeGreaterThan(0);
        expectSameEntry(subscriber.log.at(-1), model.entries.get(subscriber.key));
      } else {
        expect(added).toBe(0);
      }
    }
  }

  try {
    for (const command of scenario.commands) {
      // Remember how many notifications each subscriber has seen.
      const before = new Map<Subscriber, number>();
      for (const subscriber of subscribers) {
        before.set(subscriber, subscriber.log.length);
      }
      model.wrote.clear();

      execute(command);
      // oxlint-disable-next-line no-await-in-loop
      await flushMicrotasks();
      checkState(before);
    }
  } finally {
    // Release polling timers and settle the fetches that are left.
    for (const subscriber of listActive()) {
      subscriber.unsubscribe();
      subscriber.closed = true;
    }
    for (const call of calls) {
      call.resolve(0);
    }
    await flushMicrotasks();
    vi.useRealTimers();
  }
}

describe('swr store against the reference model', () => {
  it('matches the model for random command sequences', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        await runScenario(scenario);
      }),
      { numRuns: RUNS },
    );
  });
});
