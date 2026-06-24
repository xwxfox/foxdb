import type { DatabaseOptions } from "../database";

interface WorkerSuccessResponse { taskId: number; success: true; result: unknown[]; }
interface WorkerErrorResponse { taskId: number; success: false; error: string; }
type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

interface PendingTask {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    sql: string;
}

interface QueuedPayload {
    sql: string;
    params: any[];
    zeroCopy: boolean;
    resolve: (value: any) => void;
    reject: (reason: any) => void;
}

export class ReadScheduler {
    private workers: Worker[] = [];
    private workerStatus: boolean[] = [];
    private taskCounter = 0;

    private readonly MAX_PENDING_TASKS = 65536;
    private readonly pendingTasks: (PendingTask | null)[];

    private readonly overflowQueue: QueuedPayload[] = [];
    private overflowHead = 0;

    private nextWorkerHint = 0;

    private readonly columnCache = new Map<string, string[]>();

    constructor(opts: DatabaseOptions = {}, workerCount?: number) {
        const count = workerCount ?? navigator.hardwareConcurrency ?? 4;
        this.pendingTasks = new Array(this.MAX_PENDING_TASKS).fill(null);

        this.initWorkers(count, opts);
    }

    private initWorkers(count: number, opts: DatabaseOptions): void {
        const workerUrl = new URL("./worker.ts", import.meta.url).href;

        for (let i = 0; i < count; i++) {
            const worker = new Worker(workerUrl);

            worker.postMessage({ type: "INIT", opts });

            const workerIdx = i;
            worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                const data = event.data;
                const task = this.pendingTasks[data.taskId];
                if (!task) return;

                this.pendingTasks[data.taskId] = null;

                if (!data.success) {
                    task.reject(new Error(data.error));
                    this.dequeueOrIdle(workerIdx);
                    return;
                }

                const columns = this.columnCache.get(task.sql);
                if (columns) {
                    const rawRows = data.result as unknown[][];
                    const out = new Array(rawRows.length);
                    for (let r = 0; r < rawRows.length; r++) {
                        const row = rawRows[r] as unknown[];
                        const obj: Record<string, unknown> = {};
                        for (let c = 0; c < columns.length; c++) {
                            obj[columns[c]!] = row[c];
                        }
                        out[r] = obj;
                    }
                    task.resolve(out);
                } else {
                    task.resolve(data.result);
                }

                this.dequeueOrIdle(workerIdx);
            };

            this.workers.push(worker);
            this.workerStatus.push(true);
        }
    }

    private dispatch(
        workerIdx: number,
        sql: string,
        params: any[],
        zeroCopy: boolean,
        resolve: (v: any) => void,
        reject: (r: any) => void
    ): void {
        this.workerStatus[workerIdx] = false;

        const taskId = this.taskCounter;
        this.taskCounter = (this.taskCounter + 1) % this.MAX_PENDING_TASKS;

        this.pendingTasks[taskId] = { resolve, reject, sql };

        if (this.workers[workerIdx]) {
            this.workers[workerIdx].postMessage({
                type: "EXEC" as const,
                taskId,
                sql,
                params,
                zeroCopy
            });
        } else {
            throw new Error("tried dispatching message to non-existent worker thread");
        }
    }

    private dequeueOrIdle(workerIdx: number): void {
        if (this.overflowHead < this.overflowQueue.length) {
            const nextTask = this.overflowQueue[this.overflowHead]!;
            this.overflowQueue[this.overflowHead] = undefined as any;
            this.overflowHead++;
            this.dispatch(workerIdx, nextTask.sql, nextTask.params, nextTask.zeroCopy, nextTask.resolve, nextTask.reject);
        } else {
            this.overflowQueue.length = 0;
            this.overflowHead = 0;
            this.workerStatus[workerIdx] = true;
        }
    }

    public exec<T = any>(sql: string, params: any[] = []): Promise<T> {
        return this.enqueue<T>(sql, params, false);
    }

    public execWithCols<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params: any[],
        columns: string[]
    ): Promise<T[]> {
        this.columnCache.set(sql, columns);
        return this.enqueue<T[]>(sql, params, true);
    }

    private enqueue<T>(sql: string, params: any[], zeroCopy: boolean): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            const n = this.workerStatus.length;
            for (let j = 0; j < n; j++) {
                const i = (this.nextWorkerHint + j) % n;
                if (this.workerStatus[i]) {
                    this.nextWorkerHint = (i + 1) % n;
                    this.dispatch(i, sql, params, zeroCopy, resolve as (v: any) => void, reject);
                    return;
                }
            }

            this.overflowQueue.push({ sql, params, zeroCopy, resolve: resolve as (v: any) => void, reject });
        });
    }

    public terminate(): void {
        for (let i = 0; i < this.workers.length; i++) {
            try {
                this.workers[i]!.terminate();
            } catch {
            }
        }
        this.workers = [];
        this.overflowQueue.length = 0;
        this.overflowHead = 0;
    }
}
