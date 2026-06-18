/**
 * src/events.ts
 * Zero-overhead event bus. Uses lazy Map+Set. No payload construction
 * unless at least one listener is registered for the event key.
 */

import type { TableConfig, TableOperation, BroadOperation, TableEventOperation, TableEventPayload, Infer, AnyTableConfig } from "./types.ts";
import type { TableDescriptor } from "./table.ts";
/** @category Events */
export type Listener = (payload: unknown) => void;

// --- Typed event map ----------------------------------------------------------

// --- Lifecycle event payloads (concrete, no remapping) -----------------------

/**
 * lifecycle events emitted by the orm
 * @category Events
 */
export interface LifecycleEventMap {
  start: { phase: "start"; timestamp: number };
  ready: { phase: "ready"; timestamp: number };
  shutdown: { phase: "shutdown"; timestamp: number };
  exit: { phase: "exit"; timestamp: number };
  fail: { phase: "fail"; error: Error; timestamp: number };
}

/** @internal */
export type TableEventKey<Tables extends Record<string, AnyTableConfig>> =
  | { [K in keyof Tables & string]: `${K}.${TableOperation}` }[keyof Tables & string]
  | { [K in keyof Tables & string]: `${K}.${BroadOperation}` }[keyof Tables & string];

/** @internal */
export type ExtractEventPayload<
  K extends string,
  Tables extends Record<string, AnyTableConfig>
> = K extends `${infer T}.${infer Op}`
  ? T extends keyof Tables
  ? Op extends TableEventOperation
  ? TableEventPayload<
    Tables[T] extends TableConfig<infer S> ? Infer<S> : never,
    Op
  >
  : never
  : never
  : K extends keyof LifecycleEventMap
  ? LifecycleEventMap[K]
  : never;

// --- Public events interface --------------------------------------------------

/**
 * typed event listener api
 * @category Events
 */
export interface ORMEvents<
  Tables extends Record<string, TableDescriptor<any, any, any, any>>
> {
  /** listen to lifecycle events (start, ready, shutdown, exit, fail) */
  on<K extends (keyof LifecycleEventMap) & string>(
    event: K,
    listener: (payload: LifecycleEventMap[K]) => void
  ): () => void;

  /** listen to table events (insert, update, findMany, etc) */
  on<Table extends keyof Tables & string, Op extends TableOperation | BroadOperation>(
    table: Table,
    operation: Op,
    listener: (payload: TableEventPayload<
      Tables[Table] extends TableConfig<infer S> ? Infer<S> : never,
      Op extends TableOperation ? Op : BroadOperation
    >) => void
  ): () => void;
}

/**
 * @internal
 * @category Events
 */
export class EventBus {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly tableActive = new Set<string>();

  has(event: string): boolean {
    const set = this.listeners.get(event);
    return set !== undefined && set.size > 0;
  }

  hasAny(tableName: string): boolean {
    return this.tableActive.has(tableName);
  }

  on(event: string, fn: Listener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(fn);

    // Track table-level activity for fast-path skipping
    const table = event.split(".")[0];
    if (table && table !== "*") {
      this.tableActive.add(table);
    }

    return () => {
      const set = this.listeners.get(event);
      if (set) {
        set.delete(fn);
        if (set.size === 0) {
          this.listeners.delete(event);
          // We intentionally leave tableActive as a coarse flag - correctness
          // is guaranteed by the final has() check inside emit().
        }
      }
    };
  }

  emit(event: string, payload: unknown): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const fn of set) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[foxdb] event listener error for "${event}":`, err);
        }
      }
    }

    // Check for wildcard listeners (e.g. "users.*" for "users.insert")
    const dotIndex = event.indexOf(".");
    if (dotIndex > 0) {
      const table = event.slice(0, dotIndex);
      const wildcard = `${table}.*`;
      const wildcardSet = this.listeners.get(wildcard);
      if (wildcardSet) {
        for (const fn of wildcardSet) {
          try {
            fn(payload);
          } catch (err) {
            console.error(`[foxdb] event listener error for "${wildcard}":`, err);
          }
        }
      }
    }
  }

  emitIf(event: string, payload: unknown): void {
    // Check exact-match listeners OR wildcard listeners for this table
    const dotIndex = event.indexOf(".");
    const hasWildcard = dotIndex > 0 && this.has(`${event.slice(0, dotIndex)}.*`);
    if (this.has(event) || hasWildcard) {
      this.emit(event, payload);
    }
  }
}
