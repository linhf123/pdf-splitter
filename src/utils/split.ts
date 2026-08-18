import type { PageRange } from '../types'

interface SplitRequest {
  id: number
  arrayBuffer: ArrayBuffer
  ranges: PageRange[]
}

interface WorkerMessage {
  id: number
  type: 'progress' | 'result' | 'error'
  done?: number
  total?: number
  buffers?: ArrayBuffer[]
  message?: string
}

let workerIdCounter = 0

/**
 * 在 Web Worker 里用 pdf-lib 拆分 PDF，返回各份的 Blob。
 * - arrayBuffer 拷贝后交给 worker，主线程保留原 buffer 供再次拆分
 * - 结果以 transfer 方式拿回，避免结构化克隆的二次拷贝
 * - signal 可用于中途取消（终止 worker）
 */
export function splitPdfInWorker(
  arrayBuffer: ArrayBuffer,
  ranges: PageRange[],
  onFileDone?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<Blob[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('拆分已取消', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('../workers/split.worker.ts', import.meta.url), {
      type: 'module',
    })
    const id = ++workerIdCounter

    const onAbort = () => {
      worker.terminate()
      reject(new DOMException('拆分已取消', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      const msg = e.data
      if (msg.id !== id) return
      if (msg.type === 'progress' && msg.done != null && msg.total != null) {
        onFileDone?.(msg.done, msg.total)
      } else if (msg.type === 'result' && msg.buffers) {
        signal?.removeEventListener('abort', onAbort)
        worker.terminate()
        resolve(msg.buffers.map((b) => new Blob([b], { type: 'application/pdf' })))
      } else if (msg.type === 'error') {
        signal?.removeEventListener('abort', onAbort)
        worker.terminate()
        reject(new Error(msg.message ?? '拆分失败'))
      }
    }
    worker.onerror = () => {
      signal?.removeEventListener('abort', onAbort)
      worker.terminate()
      reject(new Error('Web Worker 初始化失败'))
    }

    // 拷贝后转移，主线程的原 buffer 保留
    const data = arrayBuffer.slice(0)
    worker.postMessage({ id, arrayBuffer: data, ranges } satisfies SplitRequest, [data])
  })
}
