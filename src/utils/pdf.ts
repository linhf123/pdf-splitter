import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

// pdf.js 在浏览器里通过 worker 解析 PDF，worker 文件由 Vite 以 ?url 方式暴露
GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfInfo {
  pageCount: number
  doc: PDFDocumentProxy
}

/** 用 pdfjs 加载 PDF，拿到总页数 */
export async function loadPdfInfo(arrayBuffer: ArrayBuffer): Promise<PdfInfo> {
  // 拷贝一份 buffer 交给 pdfjs（worker 可能转移底层内存），保留原始 arrayBuffer 给拆分用
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
