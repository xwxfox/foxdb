declare var self: Worker;

import { Database } from "bun:sqlite";

interface DatabaseOptions {
    path?: string;
    cacheSize?: number;
    busyTimeout?: number;
    synchronous?: "OFF" | "NORMAL" | "FULL" | "EXTRA";
    mmapSize?: number;
}

type WorkerInMessage = {
    type: "INIT";
    opts?: DatabaseOptions;
} | {
    type: "EXEC";
    taskId: number;
    sql: string;
    zeroCopy: boolean;
    params: any[];
};

type WorkerSuccessResponse = { taskId: number; success: true; result: unknown[] };
type WorkerErrorResponse = { taskId: number; success: false; error: string };
type WorkerOutMessage = WorkerSuccessResponse | WorkerErrorResponse;

let db: Database;

const MAX_CACHE_SIZE = 256;
const stmtCache = new Map<string, any>();

function evictOldestEntry(): void {
    const firstKey = stmtCache.keys().next().value;
    if (firstKey !== undefined) {
        const stmt = stmtCache.get(firstKey);
        try { stmt?.finalize(); } catch { }
        stmtCache.delete(firstKey);
    }
}

self.onmessage = (event: MessageEvent<WorkerInMessage>) => {
    const data = event.data;

    if (data.type === "INIT") {
        const opts = data.opts ?? {};
        const path = opts.path ?? ":memory:";

        try {
            db = new Database(path, {
                create: false,
                readonly: true
            });
        } catch {
            const response: WorkerErrorResponse = { taskId: -1, success: false, error: "failed to open database (read-only): " + path };
            self.postMessage(response);
            return;
        }

        const sync = opts.synchronous ?? "NORMAL";
        const cache = opts.cacheSize ?? -64000;
        const busy = opts.busyTimeout ?? 5000;
        const mmap = opts.mmapSize ?? 268435456;

        db.run(`PRAGMA journal_mode = WAL;`);
        db.run(`PRAGMA synchronous = ${sync};`);
        db.run(`PRAGMA cache_size = ${cache};`);
        db.run(`PRAGMA busy_timeout = ${busy};`);
        db.run(`PRAGMA mmap_size = ${mmap};`);
        db.run("PRAGMA foreign_keys = ON;");
        db.run("PRAGMA temp_store = MEMORY;");
        return;
    }

    if (data.type === "EXEC") {
        const { taskId, sql, params, zeroCopy } = data;

        try {
            let stmt = stmtCache.get(sql);
            if (!stmt) {
                stmt = db.prepare(sql);
                if (stmtCache.size >= MAX_CACHE_SIZE) {
                    evictOldestEntry();
                }
                stmtCache.set(sql, stmt);
            }

            const result: unknown[] = zeroCopy
                ? stmt.values(params) as unknown as unknown[]
                : stmt.all(params) as unknown[];

            const response: WorkerSuccessResponse = { taskId, success: true, result };
            self.postMessage(response);
        } catch (err: any) {
            const response: WorkerErrorResponse = { taskId, success: false, error: err.message };
            self.postMessage(response);
        }
    }
};
