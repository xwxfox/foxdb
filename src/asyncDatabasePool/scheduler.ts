import type { DatabaseOptions } from "../database";

interface WorkerSuccessResponse { taskId: number; success: true; result: unknown[]; }
interface WorkerErrorResponse { taskId: number; success: false; error: string; }
type WorkerResponse = WorkerSuccessResponse | WorkerErrorResponse;

interface PendingTask {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
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

            worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
                const data = event.data;
                const task = this.pendingTasks[data.taskId];
                if (task) {
                    this.pendingTasks[data.taskId] = null;
                    if (data.success) {
                        task.resolve(data.result);
                    } else {
                        task.reject(new Error(data.error));
                    }
                }

                if (this.overflowQueue.length > 0) {
                    const nextTask = this.overflowQueue.shift()!;
                    this.dispatch(i, nextTask.sql, nextTask.params, nextTask.zeroCopy, nextTask.resolve, nextTask.reject);
                } else {
                    this.workerStatus[i] = true;
                }
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

        this.pendingTasks[taskId] = { resolve, reject };

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

    public exec<T = any>(sql: string, params: any[] = [], zeroCopy = false): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            for (let i = 0; i < this.workerStatus.length; i++) {
                if (this.workerStatus[i]) {
                    this.dispatch(i, sql, params, zeroCopy, resolve, reject);
                    return;
                }
            }

            this.overflowQueue.push({ sql, params, zeroCopy, resolve, reject });
        });
    }

    public terminate(): void {
        for (let i = 0; i < this.workers.length; i++) {
            try {
                this.workers[i]!.terminate();
            } catch {
                // noop
            }
        }
        this.workers = [];
        this.overflowQueue.length = 0;
    }
}
