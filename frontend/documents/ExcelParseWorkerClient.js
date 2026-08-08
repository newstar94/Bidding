function parserError(message, code) {
  return Object.assign(new Error(message), { code });
}

function defaultWorkerFactory() {
  if (typeof globalThis.Worker !== "function") {
    throw parserError("Excel worker is unavailable.", "WORKER_UNAVAILABLE");
  }
  return new globalThis.Worker(new URL("./excelParseWorker.js", import.meta.url));
}

export class ExcelParseWorkerClient {
  constructor({ createWorker = defaultWorkerFactory } = {}) {
    this.createWorker = createWorker;
    this.active = null;
  }

  cancel(code = "STALE_EXCEL_PARSE") {
    if (!this.active) return;
    const active = this.active;
    this.active = null;
    active.worker.terminate();
    active.cleanup();
    active.reject(parserError("Excel parse job was replaced.", code));
  }

  parse(data, mode, { signal } = {}) {
    if (!(data instanceof ArrayBuffer)) {
      return Promise.reject(new TypeError("Excel parser requires an ArrayBuffer."));
    }
    this.cancel();
    let worker;
    try {
      worker = this.createWorker();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => this.cancel("EXCEL_PARSE_ABORTED");
      const cleanup = () => signal?.removeEventListener?.("abort", onAbort);
      const finish = (callback, value) => {
        if (this.active?.worker !== worker) return;
        this.active = null;
        worker.terminate();
        cleanup();
        callback(value);
      };
      this.active = { worker, reject, cleanup };
      worker.onmessage = (event) => {
        if (event.data?.ok) finish(resolve, event.data.result);
        else finish(
          reject,
          parserError(
            event.data?.error || "Không thể đọc nội dung tệp Excel.",
            "EXCEL_PARSE_FAILED",
          ),
        );
      };
      worker.onerror = () => finish(
        reject,
        parserError("Excel worker gặp lỗi khi xử lý tệp.", "EXCEL_PARSE_FAILED"),
      );
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener?.("abort", onAbort, { once: true });
      worker.postMessage({ data, mode }, [data]);
    });
  }
}

export const excelParseWorkerClient = new ExcelParseWorkerClient();
