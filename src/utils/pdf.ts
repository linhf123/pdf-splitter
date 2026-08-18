import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { PDFDocument } from 'pdf-lib'
import type { PageRange } from '../types'

// pdf.js 在浏览器里通过 worker 解析 PDF，worker 文件由 Vite 以 ?url 方式暴露
GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfInfo {
  pageCount: number
  doc: PDFDocumentProxy
}

/** 用 pdfjs 加载 PDF，拿到总页数 */
export async function loadPdfInfo(arrayBuffer: ArrayBuffer): Promise<PdfInfo> {
  // 拷贝一份 buffer 交给 pdfjs（worker 可能转移底层内存），保留原始 arrayBuffer 给 pdf-lib 拆分用
  const data = new Uint8Array(arrayBuffer.slice(0))
  const doc = await getDocument({ data }).promise
  return { pageCount: doc.numPages, doc }
}

/** 把某一页渲染成指定宽度的 PNG dataURL */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNum: number,
  width = 140,
): Promise<string> {
  const page = await doc.getPage(pageNum)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 canvas 上下文')
  await page.render({ canvasContext: ctx, viewport, canvas }).promise
  return canvas.toDataURL('image/png')
}

/** 按页码范围用 pdf-lib 拆分出多个新 PDF 的 Blob */
export async function splitPdf(
  arrayBuffer: ArrayBuffer,
  ranges: PageRange[],
  onFileDone?: (done: number, total: number) => void,
): Promise<Blob[]> {
  const src = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
  const blobs: Blob[] = []
  for (let i = 0; i < ranges.length; i++) {
    const r = ranges[i]
    const out = await PDFDocument.create()
    const indices: number[] = []
    for (let p = r.start; p <= r.end; p++) indices.push(p - 1)
    const pages = await out.copyPages(src, indices)
    pages.forEach((pg) => out.addPage(pg))
    const bytes = await out.save()
    // pdf-lib 返回的 Uint8Array 一定是 ArrayBuffer 支撑，安全断言为 BlobPart
    const buf = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer
    blobs.push(new Blob([buf], { type: 'application/pdf' }))
    onFileDone?.(i + 1, ranges.length)
  }
  return blobs
}

/** 自动模式：每份 pagesPerFile 页，计算分块 */
export function computeAutoRanges(pageCount: number, pagesPerFile: number): PageRange[] {
  const ranges: PageRange[] = []
  for (let s = 1; s <= pageCount; s += pagesPerFile) {
    ranges.push({ start: s, end: Math.min(s + pagesPerFile - 1, pageCount) })
  }
  return ranges
}

export interface RangeValidation {
  /** 阻断拆分的错误 */
  error: string | null
  /** 仅提示的警告（如范围重叠） */
  warning: string | null
}

/** 校验自定义范围：越界/顺序错为错误；重叠只给警告 */
export function validateRanges(ranges: PageRange[], pageCount: number): RangeValidation {
  for (const r of ranges) {
    if (r.start < 1 || r.end > pageCount || r.start > r.end) {
      return {
        error: `范围 ${r.start}-${r.end} 超出有效页数（1-${pageCount}）`,
        warning: null,
      }
    }
  }
  let warning: string | null = null
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].start <= ranges[j].end && ranges[j].start <= ranges[i].end) {
        warning = `第 ${i + 1} 份与第 ${j + 1} 份页码范围重叠（允许但会重复包含页面）`
      }
    }
  }
  return { error: null, warning }
}
