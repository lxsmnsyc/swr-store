import { describe, expect, it } from 'vitest';
import LRUMap from '../../src/cache/lru-map';

describe('LRUMap', () => {
  it('works as a Map', () => {
    const map = new LRUMap<string, number>(10);
    map.set('a', 1).set('b', 2);

    expect(map.size).toBe(2);
    expect(map.get('a')).toBe(1);
    expect(map.has('b')).toBe(true);
    expect(map.delete('b')).toBe(true);
    expect(map.delete('b')).toBe(false);
    expect(map.has('b')).toBe(false);

    map.clear();
    expect(map.size).toBe(0);
    expect([...map]).toEqual([]);
    expect(Object.prototype.toString.call(map)).toBe('[object LRUMap]');
  });

  it('iterates from the most to the least recently used entry', () => {
    const map = new LRUMap<string, number>(10);
    map.set('a', 1).set('b', 2).set('c', 3);
    map.get('a');

    expect([...map.keys()]).toEqual(['a', 'c', 'b']);
    expect([...map.values()]).toEqual([1, 3, 2]);
    expect([...map.entries()]).toEqual([
      ['a', 1],
      ['c', 3],
      ['b', 2],
    ]);

    const seen: string[] = [];
    map.forEach((_value, key) => {
      seen.push(key);
    });
    expect(seen).toEqual(['a', 'c', 'b']);
  });

  it('removes the least recently used entry when full', () => {
    const map = new LRUMap<string, number>(2);
    map.set('a', 1).set('b', 2);
    map.get('a');
    map.set('c', 3);

    expect([...map.keys()]).toEqual(['c', 'a']);
    expect(map.has('b')).toBe(false);
  });

  it('marks an entry as used when it is updated', () => {
    const map = new LRUMap<string, number>(2);
    map.set('a', 1).set('b', 2).set('a', 10);
    map.set('c', 3);

    expect(map.get('a')).toBe(10);
    expect(map.has('b')).toBe(false);
  });

  it('does not change the order on peek or has', () => {
    const map = new LRUMap<string, number>(2);
    map.set('a', 1).set('b', 2);

    expect(map.peek('a')).toBe(1);
    expect(map.has('a')).toBe(true);
    map.set('c', 3);

    expect(map.has('a')).toBe(false);
  });

  it('supports getOrInsert and getOrInsertComputed', () => {
    const map = new LRUMap<string, number>(10);

    expect(map.getOrInsert('a', 1)).toBe(1);
    expect(map.getOrInsert('a', 2)).toBe(1);
    expect(map.getOrInsertComputed('b', (key) => key.length)).toBe(1);
    expect(map.getOrInsertComputed('b', () => 5)).toBe(1);
  });

  it('evicts when maxSize shrinks', () => {
    const map = new LRUMap<string, number>(3);
    map.set('a', 1).set('b', 2).set('c', 3);
    map.maxSize = 1;

    expect(map.maxSize).toBe(1);
    expect([...map.keys()]).toEqual(['c']);
  });

  it('keeps the list intact after deleting from the ends and the middle', () => {
    const map = new LRUMap<string, number>(10);
    map.set('a', 1).set('b', 2).set('c', 3).set('d', 4);

    map.delete('d');
    map.delete('a');
    map.delete('b');
    map.set('e', 5);

    expect([...map.keys()]).toEqual(['e', 'c']);
  });

  it('allows deleting entries while iterating', () => {
    const map = new LRUMap<string, number>(10);
    map.set('a', 1).set('b', 2).set('c', 3);

    for (const [key] of map) {
      map.delete(key);
    }
    expect(map.size).toBe(0);
  });

  it('rejects sizes that are not positive integers', () => {
    expect(() => new LRUMap(0)).toThrow(RangeError);
    expect(() => new LRUMap(1.5)).toThrow(RangeError);
    const map = new LRUMap(1);
    expect(() => {
      map.maxSize = -1;
    }).toThrow(RangeError);
  });
});
