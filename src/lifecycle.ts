/**
 * src/lifecycle.ts
 * Orchestrates startup and shutdown sequences.
 * Hooks execute synchronously in order. If a hook returns a Promise,
 * it fires in the background (errors are logged to stderr).
 */

import type { BunDatabase } from "./database.ts";
import type { MetaStore } from "./meta.ts";
import type { foxdb } from "./orm.ts";
import type { AnyTableConfig, TableConfig } from "./types.ts";
import type { TypedRelation } from "./typed-relation.ts";
import type { TableDescriptor } from "./table.ts";
/**
 * context passed to lifecycle hooks
 * @category Lifecycle
 */
export interface ORMContext<
  T extends Record<string, TableDescriptor<any, any, any, any, any>> = Record<string, TableDescriptor<any, any, any, any, any>>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> {
  orm: foxdb<T, Rels>;
  db: BunDatabase;
  meta: MetaStore;
  tables: string[];
  repos: Map<string, unknown>;
  logger: { log: (...args: unknown[]) => void; error: (...args: unknown[]) => void };
}

/**
 * lifecycle hook signature
 * @category Lifecycle
 */
export type LifecycleHook<
  T extends Record<string, TableDescriptor<any, any, any, any, any>> = Record<string, TableDescriptor<any, any, any, any, any>>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> = (ctx: ORMContext<T, Rels>) => void | Promise<void>;

/** @internal */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as Record<string, unknown>).then === "function"
  );
}

/** @internal */
function runSyncOrLog<
  T extends Record<string, TableDescriptor<any, any, any, any, any>> = Record<string, TableDescriptor<any, any, any, any, any>>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
>(
  hooks: LifecycleHook<T, Rels>[],
  ctx: ORMContext<T, Rels>,
  label: string
): void {
  for (const h of hooks) {
    try {
      const result = h(ctx);
      if (result && isPromiseLike(result)) {
        result.catch((err: unknown) => {
          console.error(`[foxdb] async ${label} hook error:`, err);
        });
      }
    } catch (err) {
      console.error(`[foxdb] ${label} hook error:`, err);
    }
  }
}

/**
 * manages startup and shutdown hook execution
 * @category Lifecycle
 */
export class LifecycleManager<
  T extends Record<string, TableDescriptor<any, any, any, any, any>> = Record<string, TableDescriptor<any, any, any, any, any>>,
  Rels extends readonly TypedRelation[] = readonly TypedRelation[]
> {
  private startHooks: LifecycleHook<T, Rels>[] = [];
  private readyHooks: LifecycleHook<T, Rels>[] = [];
  private shutdownHooks: LifecycleHook<T, Rels>[] = [];
  private exitHooks: LifecycleHook<T, Rels>[] = [];

  private _ready = false;
  private _shutdown = false;

  /** true after runReady completes */
  get isReady() { return this._ready; }
  /** true after runShutdown completes */
  get isShutdown() { return this._shutdown; }

  /** register a startup hook */
  onStart(hook: LifecycleHook<T, Rels>) { this.startHooks.push(hook); }
  /** register a ready hook */
  onReady(hook: LifecycleHook<T, Rels>) { this.readyHooks.push(hook); }
  /** register a shutdown hook */
  onShutdown(hook: LifecycleHook<T, Rels>) { this.shutdownHooks.push(hook); }
  /** register an exit hook */
  onExit(hook: LifecycleHook<T, Rels>) { this.exitHooks.push(hook); }

  /** @internal */
  runStart(ctx: ORMContext<T, Rels>): void {
    runSyncOrLog(this.startHooks, ctx, "onStart");
  }

  /** @internal */
  runReady(ctx: ORMContext<T, Rels>): void {
    runSyncOrLog(this.readyHooks, ctx, "onReady");
    this._ready = true;
  }

  /** @internal */
  runShutdown(ctx: ORMContext<T, Rels>): void {
    if (this._shutdown) return;
    this._shutdown = true;
    runSyncOrLog(this.shutdownHooks, ctx, "onShutdown");
  }

  /** @internal */
  runExit(ctx: ORMContext<T, Rels>): void {
    runSyncOrLog(this.exitHooks, ctx, "onExit");
  }
}
