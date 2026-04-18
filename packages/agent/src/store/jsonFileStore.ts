import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  BaseStore,
  type Item,
  type SearchItem,
  type Operation,
  type OperationResults,
  type GetOperation,
  type SearchOperation,
  type PutOperation,
  type ListNamespacesOperation,
  type MatchCondition,
} from '@langchain/langgraph-checkpoint';

interface SerializedItem {
  value: Record<string, unknown>;
  key: string;
  namespace: string[];
  createdAt: string;
  updatedAt: string;
}

type SerializedData = Record<string, Record<string, SerializedItem>>;

function namespaceKey(namespace: string[]): string {
  return namespace.join('::');
}

function matchesFilter(value: Record<string, unknown>, filter: Record<string, unknown>): boolean {
  for (const [key, condition] of Object.entries(filter)) {
    const itemValue = value[key];

    if (condition !== null && typeof condition === 'object' && !Array.isArray(condition)) {
      const ops = condition as Record<string, unknown>;
      for (const [op, expected] of Object.entries(ops)) {
        switch (op) {
          case '$eq':
            if (itemValue !== expected) return false;
            break;
          case '$ne':
            if (itemValue === expected) return false;
            break;
          case '$gt':
            if (
              typeof itemValue !== 'number' ||
              typeof expected !== 'number' ||
              itemValue <= expected
            )
              return false;
            break;
          case '$gte':
            if (
              typeof itemValue !== 'number' ||
              typeof expected !== 'number' ||
              itemValue < expected
            )
              return false;
            break;
          case '$lt':
            if (
              typeof itemValue !== 'number' ||
              typeof expected !== 'number' ||
              itemValue >= expected
            )
              return false;
            break;
          case '$lte':
            if (
              typeof itemValue !== 'number' ||
              typeof expected !== 'number' ||
              itemValue > expected
            )
              return false;
            break;
        }
      }
    } else {
      if (itemValue !== condition) return false;
    }
  }
  return true;
}

/**
 * A BaseStore implementation that persists data to a local JSON file.
 *
 * Suitable for examples, tests, and local development where you need
 * data to survive process restarts without requiring an external database.
 *
 * @example
 * ```ts
 * const store = new JsonFileStore({ filePath: './data/store.json' });
 * await store.start();
 * ```
 */
export class JsonFileStore extends BaseStore {
  private readonly filePath: string;
  private data: Map<string, Map<string, Item>> = new Map();

  constructor(options: { filePath: string }) {
    super();
    this.filePath = options.filePath;
  }

  override start(): void {
    if (!existsSync(this.filePath)) return;

    const raw = readFileSync(this.filePath, 'utf-8');
    const parsed: SerializedData = JSON.parse(raw);

    for (const [nsKey, items] of Object.entries(parsed)) {
      const nsMap = new Map<string, Item>();
      for (const [key, serialized] of Object.entries(items)) {
        nsMap.set(key, {
          value: serialized.value,
          key: serialized.key,
          namespace: serialized.namespace,
          createdAt: new Date(serialized.createdAt),
          updatedAt: new Date(serialized.updatedAt),
        });
      }
      this.data.set(nsKey, nsMap);
    }
  }

  private persist(): void {
    const serialized: SerializedData = {};
    for (const [nsKey, nsMap] of this.data) {
      const items: Record<string, SerializedItem> = {};
      for (const [key, item] of nsMap) {
        items[key] = {
          value: item.value,
          key: item.key,
          namespace: item.namespace,
          createdAt: item.createdAt.toISOString(),
          updatedAt: item.updatedAt.toISOString(),
        };
      }
      serialized[nsKey] = items;
    }

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(serialized, null, 2), 'utf-8');
  }

  async batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    let needsPersist = false;
    const results = operations.map((op) => {
      if ('key' in op && 'value' in op) {
        // PutOperation
        return this.putOp(op as PutOperation, () => {
          needsPersist = true;
        });
      } else if ('key' in op && !('namespacePrefix' in op) && !('matchConditions' in op)) {
        // GetOperation
        return this.getOp(op as GetOperation);
      } else if ('namespacePrefix' in op) {
        // SearchOperation
        return this.searchOp(op as SearchOperation);
      } else {
        // ListNamespacesOperation
        return this.listNamespacesOp(op as ListNamespacesOperation);
      }
    });

    if (needsPersist) {
      this.persist();
    }

    return results as OperationResults<Op>;
  }

  private getOp(op: GetOperation): Item | null {
    const nsMap = this.data.get(namespaceKey(op.namespace));
    if (!nsMap) return null;
    return nsMap.get(op.key) ?? null;
  }

  private putOp(op: PutOperation, markDirty: () => void): void {
    const nsKey = namespaceKey(op.namespace);

    if (op.value === null) {
      // Delete
      const nsMap = this.data.get(nsKey);
      if (nsMap) {
        nsMap.delete(op.key);
        if (nsMap.size === 0) this.data.delete(nsKey);
        markDirty();
      }
      return;
    }

    let nsMap = this.data.get(nsKey);
    if (!nsMap) {
      nsMap = new Map();
      this.data.set(nsKey, nsMap);
    }

    const existing = nsMap.get(op.key);
    const now = new Date();
    nsMap.set(op.key, {
      value: op.value,
      key: op.key,
      namespace: op.namespace,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    markDirty();
  }

  private searchOp(op: SearchOperation): SearchItem[] {
    const prefix = namespaceKey(op.namespacePrefix);
    const items: SearchItem[] = [];

    for (const [nsKey, nsMap] of this.data) {
      // Check if namespace starts with the prefix
      if (op.namespacePrefix.length === 0 || nsKey === prefix || nsKey.startsWith(prefix + '::')) {
        for (const item of nsMap.values()) {
          if (op.filter && !matchesFilter(item.value, op.filter)) continue;
          items.push({ ...item });
        }
      }
    }

    const offset = op.offset ?? 0;
    const limit = op.limit ?? 10;
    return items.slice(offset, offset + limit);
  }

  private listNamespacesOp(op: ListNamespacesOperation): string[][] {
    const allNamespaces: string[][] = [];

    for (const nsKey of this.data.keys()) {
      const ns = nsKey.split('::');

      if (op.matchConditions && op.matchConditions.length > 0) {
        const matched = op.matchConditions.every((cond: MatchCondition) =>
          this.matchCondition(ns, cond),
        );
        if (!matched) continue;
      }

      const truncated = op.maxDepth != null ? ns.slice(0, op.maxDepth) : ns;

      // Deduplicate
      if (!allNamespaces.some((existing) => existing.join('::') === truncated.join('::'))) {
        allNamespaces.push(truncated);
      }
    }

    return allNamespaces.slice(op.offset, op.offset + op.limit);
  }

  private matchCondition(ns: string[], cond: MatchCondition): boolean {
    if (cond.matchType === 'prefix') {
      return cond.path.every((segment, i) => segment === '*' || ns[i] === segment);
    }
    if (cond.matchType === 'suffix') {
      const offset = ns.length - cond.path.length;
      if (offset < 0) return false;
      return cond.path.every((segment, i) => segment === '*' || ns[offset + i] === segment);
    }
    return false;
  }
}
