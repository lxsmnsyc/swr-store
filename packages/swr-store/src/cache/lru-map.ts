interface LRUNode<K, V> {
  key: K;
  value: V;
  prev: LRUNode<K, V> | undefined;
  next: LRUNode<K, V> | undefined;
}

// A `Map` that holds at most `maxSize` entries. Reading or writing an entry
// marks it as the most recently used one. When the map grows past
// `maxSize`, the least recently used entries are removed.
//
// `canEvict` can protect entries from removal. Protected entries are skipped,
// so the map may stay above `maxSize` while too many of them are protected.
//
// Entries sit in a doubly-linked list ordered from most to least recently
// used, so marking an entry and evicting the oldest one are both O(1).
export default class LRUMap<K, V> implements Map<K, V> {
  readonly [Symbol.toStringTag] = 'LRUMap';

  private readonly nodes = new Map<K, LRUNode<K, V>>();

  private head: LRUNode<K, V> | undefined;

  private tail: LRUNode<K, V> | undefined;

  private limit: number;

  private readonly canEvict: ((key: K, value: V) => boolean) | undefined;

  constructor(maxSize: number, canEvict?: (key: K, value: V) => boolean) {
    this.limit = LRUMap.checkSize(maxSize);
    this.canEvict = canEvict;
  }

  private static checkSize(size: number): number {
    if (!(Number.isInteger(size) && size > 0)) {
      throw new RangeError(`LRUMap size must be a positive integer, received ${size}`);
    }
    return size;
  }

  get size(): number {
    return this.nodes.size;
  }

  get maxSize(): number {
    return this.limit;
  }

  set maxSize(size: number) {
    this.limit = LRUMap.checkSize(size);
    this.evict();
  }

  // Returns the value and marks the entry as the most recently used.
  get(key: K): V | undefined {
    const node = this.nodes.get(key);
    if (!node) {
      return undefined;
    }
    this.moveToHead(node);
    return node.value;
  }

  // Returns the value without changing the usage order.
  peek(key: K): V | undefined {
    return this.nodes.get(key)?.value;
  }

  has(key: K): boolean {
    return this.nodes.has(key);
  }

  set(key: K, value: V): this {
    const node = this.nodes.get(key);
    if (node) {
      node.value = value;
      this.moveToHead(node);
      return this;
    }
    const newNode: LRUNode<K, V> = {
      key,
      value,
      prev: undefined,
      next: this.head,
    };
    if (this.head) {
      this.head.prev = newNode;
    }
    this.head = newNode;
    this.tail ??= newNode;
    this.nodes.set(key, newNode);
    this.evict();
    return this;
  }

  getOrInsert(key: K, defaultValue: V): V {
    const node = this.nodes.get(key);
    if (node) {
      this.moveToHead(node);
      return node.value;
    }
    this.set(key, defaultValue);
    return defaultValue;
  }

  getOrInsertComputed(key: K, callback: (key: K) => V): V {
    const node = this.nodes.get(key);
    if (node) {
      this.moveToHead(node);
      return node.value;
    }
    const value = callback(key);
    this.set(key, value);
    return value;
  }

  delete(key: K): boolean {
    const node = this.nodes.get(key);
    if (!node) {
      return false;
    }
    this.unlink(node);
    this.nodes.delete(key);
    return true;
  }

  clear(): void {
    this.nodes.clear();
    this.head = undefined;
    this.tail = undefined;
  }

  forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  // Iterates from the most to the least recently used entry.
  *entries(): MapIterator<[K, V]> {
    let node = this.head;
    while (node) {
      // Read the next node first, so the callback can delete the current one.
      const { next } = node;
      yield [node.key, node.value];
      node = next;
    }
  }

  *keys(): MapIterator<K> {
    for (const [key] of this.entries()) {
      yield key;
    }
  }

  *values(): MapIterator<V> {
    for (const [, value] of this.entries()) {
      yield value;
    }
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.entries();
  }

  private unlink(node: LRUNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
    node.prev = undefined;
    node.next = undefined;
  }

  private moveToHead(node: LRUNode<K, V>): void {
    if (this.head === node) {
      return;
    }
    this.unlink(node);
    node.next = this.head;
    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;
    this.tail ??= node;
  }

  private evict(): void {
    let node = this.tail;
    while (this.nodes.size > this.limit && node) {
      const { prev } = node;
      if (!this.canEvict || this.canEvict(node.key, node.value)) {
        this.unlink(node);
        this.nodes.delete(node.key);
      }
      node = prev;
    }
  }
}
