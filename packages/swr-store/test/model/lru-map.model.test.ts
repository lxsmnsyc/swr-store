import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import LRUMap from '../../src/cache/lru-map';

// Keys divisible by 3 are protected when the scenario sets `protect`.
function isProtected(key: number): boolean {
  return key % 3 === 0;
}

type Operation =
  | { kind: 'get'; key: number }
  | { kind: 'peek'; key: number }
  | { kind: 'set'; key: number; value: number }
  | { kind: 'has'; key: number }
  | { kind: 'delete'; key: number }
  | { kind: 'resize'; size: number };

interface Scenario {
  maxSize: number;
  protect: boolean;
  operations: Operation[];
}

const keyArb = fc.nat(7);

const operationArb: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({ kind: fc.constant('get' as const), key: keyArb }),
  fc.record({ kind: fc.constant('peek' as const), key: keyArb }),
  fc.record({ kind: fc.constant('set' as const), key: keyArb, value: fc.nat(100) }),
  fc.record({ kind: fc.constant('has' as const), key: keyArb }),
  fc.record({ kind: fc.constant('delete' as const), key: keyArb }),
  fc.record({ kind: fc.constant('resize' as const), size: fc.integer({ min: 1, max: 6 }) }),
);

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  maxSize: fc.integer({ min: 1, max: 6 }),
  protect: fc.boolean(),
  operations: fc.array(operationArb, { maxLength: 60 }),
});

// The reference keeps entries in a `Map` ordered from the least to the most
// recently used one.
class ReferenceLRU {
  readonly entries = new Map<number, number>();

  constructor(
    public maxSize: number,
    private readonly protect: boolean,
  ) {}

  get(key: number): number | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: number, value: number): void {
    const existed = this.entries.delete(key);
    this.entries.set(key, value);
    if (!existed) {
      this.evict();
    }
  }

  // Removes the oldest entries that are not protected. The newest entry
  // always stays.
  evict(): void {
    let newest: number | undefined;
    for (const key of this.entries.keys()) {
      newest = key;
    }
    for (const key of this.entries.keys()) {
      if (this.entries.size <= this.maxSize) {
        break;
      }
      if (key !== newest && !(this.protect && isProtected(key))) {
        this.entries.delete(key);
      }
    }
  }
}

function runScenario(scenario: Scenario): void {
  const reference = new ReferenceLRU(scenario.maxSize, scenario.protect);
  const map = new LRUMap<number, number>(
    scenario.maxSize,
    scenario.protect ? (key) => !isProtected(key) : undefined,
  );

  for (const operation of scenario.operations) {
    // Run the operation on both maps and compare what it returns.
    switch (operation.kind) {
      case 'get': {
        expect(map.get(operation.key)).toBe(reference.get(operation.key));
        break;
      }
      case 'peek': {
        expect(map.peek(operation.key)).toBe(reference.entries.get(operation.key));
        break;
      }
      case 'set': {
        map.set(operation.key, operation.value);
        reference.set(operation.key, operation.value);
        break;
      }
      case 'has': {
        expect(map.has(operation.key)).toBe(reference.entries.has(operation.key));
        break;
      }
      case 'delete': {
        expect(map.delete(operation.key)).toBe(reference.entries.delete(operation.key));
        break;
      }
      case 'resize': {
        map.maxSize = operation.size;
        reference.maxSize = operation.size;
        reference.evict();
        break;
      }
    }

    // The entries and their order, from the most to the least recently used.
    expect(map.size).toBe(reference.entries.size);
    const expected: [number, number][] = [];
    for (const entry of reference.entries) {
      expected.unshift(entry);
    }
    expect([...map.entries()]).toEqual(expected);
    if (!scenario.protect) {
      expect(map.size).toBeLessThanOrEqual(map.maxSize);
    }
  }
}

describe('LRUMap against a Map-based reference', () => {
  it('matches the reference for random get, peek, set, has, delete and resize sequences', () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        runScenario(scenario);
      }),
      { numRuns: 200 },
    );
  });
});
