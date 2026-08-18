import { PDFDocument } from 'pdf-lib'
import type { PageRange } from '../types'

// pdf-lib 的 save()/copyPages 是 CPU 密集操作，放在 Web Worker 里避免阻塞主线程。
// 不引入 webworker lib，用最小类型声明避免与 DOM lib 冲突。
type WorkerScope = {
  postMessage: (message: unknown, transfer?: Transferable[]) => void
  onmessage: ((e: MessageEvent) => void) | null
}
const ctx = self as unknown as WorkerScope

interface SplitRequest {
  id: number
  arrayBuffer: ArrayBuffer
  ranges: PageRange[]
}

interface SplitProgress {
  id: number
  type: 'progress'
  done: number
  total: number
}

interface SplitResult {
  id: number
  type: 'result'
  buffers: ArrayBuffer[]
}

interface SplitError {
  id: number
  type: 'error'
  message: string
}

ctx.onmessage = async (e: MessageEvent<SplitRequest>) => {
  const { id, arrayBuffer, ranges } = e.data
  try {
    const src = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
    const buffers: ArrayBuffer[] = []
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i]
      const out = await PDFDocument.create()
      const indices: number[] = []
      for (let p = r.start; p <= r.end; p++) indices.push(p - 1)
      const pages = await out.copyPages(src, indices)
      pages.forEach((pg) => out.addPage(pg))
      const bytes = await out.save()
      buffers.push(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      )
      ctx.postMessage({ id, type: 'progress', done: i + 1, total: ranges.length } satisfies SplitProgress)
    }
    // 转移（transfer）ArrayBuffer，避免结构化克隆的二次拷贝
    ctx.postMessage({ id, type: 'result', buffers } satisfies SplitResult, buffers)
  } catch (err) {
    ctx.postMessage({
      id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies SplitError)
  }
}
