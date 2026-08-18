import { useCallback, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Card, Flex, Space, Switch, Tag, Typography } from 'antd'
import { FilePdfOutlined } from '@ant-design/icons'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import UploadArea from './components/UploadArea'
import PreviewGrid from './components/PreviewGrid'
import SplitConfig from './components/SplitConfig'
import ResultList from './components/ResultList'
import { loadPdfInfo, renderPage } from './utils/pdf'
import { computeAutoRanges, validateRanges } from './utils/ranges'
import { splitPdfInWorker } from './utils/split'
import { formatSize } from './utils/download'
import type { PageRange, SplitFile, SplitMode } from './types'

// 缩略图并发渲染数，避免大文件时同时渲染过多页面卡住主线程
const RENDER_CONCURRENCY = 2
// 缩略图缓存上限：超过后按 LRU 淘汰视野外的页，控制超大 PDF 滚动时的内存
const PREVIEW_CACHE_CAP = 300

export default function App() {
  const { message } = AntdApp.useApp()
  const [file, setFile] = useState<File | null>(null)
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [previews, setPreviews] = useState<(string | null)[]>([])
  const [previewEnabled, setPreviewEnabled] = useState(false)
  // 渲染失败的页码：展示占位提示并停止重试，避免无限 spinner 与滚动时重复渲染
  const [failedPages, setFailedPages] = useState<Set<number>>(new Set())
  const [mode, setMode] = useState<SplitMode>('auto')
  const [pagesPerFile, setPagesPerFile] = useState(100)
  const [customRanges, setCustomRanges] = useState<PageRange[]>([{ start: 1, end: 1 }])
  const [results, setResults] = useState<SplitFile[]>([])
  const [splitting, setSplitting] = useState(false)
  const [splitProgress, setSplitProgress] = useState({ done: 0, total: 0 })
  // 上传/重置计数：用于丢弃过期文件的异步渲染结果
  const genRef = useRef(0)
  // 预览用的 pdfjs 文档对象：上传后常驻，直到重置/换文件才销毁，供按需渲染页面
  const docRef = useRef<PDFDocumentProxy | null>(null)
  // 待渲染页面队列 / 正在渲染的页面集合 / 当前并发数
  const queueRef = useRef<number[]>([])
  const inFlightRef = useRef<Set<number>>(new Set())
  const busyRef = useRef(0)
  // 已渲染缩略图的 LRU 缓存：page -> dataURL，Map 迭代顺序即最近使用序
  const previewCacheRef = useRef<Map<number, string>>(new Map())
  // 当前可视页集合（由 PreviewGrid 上报），LRU 淘汰时避开这些页
  const visibleRef = useRef<Set<number>>(new Set())
  // 当前拆分 worker 的取消控制器（换文件/重置时终止）
  const controllerRef = useRef<AbortController | null>(null)
  // 供回调读取的最新页数（渲染时保证已提交）
  const pageCountRef = useRef(pageCount)
  pageCountRef.current = pageCount

  const autoRanges = useMemo(
    () => computeAutoRanges(pageCount, pagesPerFile),
    [pageCount, pagesPerFile],
  )
  const effectiveRanges = mode === 'auto' ? autoRanges : customRanges
  const { error: rangeError, warning: rangeWarning } =
    pageCount > 0 ? validateRanges(effectiveRanges, pageCount) : { error: null, warning: null }

  // 当前拆分范围覆盖的页码集合，用于预览高亮
  const covered = useMemo(() => {
    const s = new Set<number>()
    for (const r of effectiveRanges) {
      for (let p = r.start; p <= r.end; p++) s.add(p)
    }
    return s
  }, [effectiveRanges])

  const clearRenderState = () => {
    docRef.current?.loadingTask.destroy()
    docRef.current = null
    queueRef.current = []
    inFlightRef.current.clear()
    busyRef.current = 0
    previewCacheRef.current.clear()
    visibleRef.current = new Set()
    setFailedPages(new Set())
  }

  /** 提交一页渲染结果到 LRU 缓存；超出上限时淘汰视野外的最久未用页 */
  const commitRender = useCallback((page: number, url: string) => {
    const cache = previewCacheRef.current
    cache.delete(page)
    cache.set(page, url)
    while (cache.size > PREVIEW_CACHE_CAP) {
      const oldest = cache.keys().next().value as number | undefined
      if (oldest == null || visibleRef.current.has(oldest)) break
      cache.delete(oldest)
    }
    const next = new Array<string | null>(pageCountRef.current).fill(null)
    for (const [p, u] of cache) next[p - 1] = u
    setPreviews(next)
  }, [])

  /** 从队列里按并发上限逐页渲染缩略图 */
  const pumpQueue = useCallback((gen: number) => {
    const doc = docRef.current
    if (!doc) return
    while (busyRef.current < RENDER_CONCURRENCY && queueRef.current.length > 0) {
      // 期间文件被重置，丢弃剩余任务
      if (genRef.current !== gen) {
        queueRef.current = []
        return
      }
      const page = queueRef.current.shift()!
      busyRef.current++
      renderPage(doc, page)
        .then((url) => {
          busyRef.current--
          inFlightRef.current.delete(page)
          if (genRef.current !== gen) return
          commitRender(page, url)
          pumpQueue(gen)
        })
        .catch(() => {
          busyRef.current--
          inFlightRef.current.delete(page)
          if (genRef.current === gen) {
            setFailedPages((prev) => {
              if (prev.has(page)) return prev
              const next = new Set(prev)
              next.add(page)
              return next
            })
          }
          pumpQueue(gen)
        })
    }
  }, [commitRender])

  /** 请求渲染缺失页面（1-based），已缓存或已入队的自动去重 */
  const requestPages = useCallback(
    (pages: number[]) => {
      const doc = docRef.current
      if (!doc) return
      for (const p of pages) {
        if (p < 1 || p > pageCountRef.current) continue
        if (inFlightRef.current.has(p)) continue
        inFlightRef.current.add(p)
        queueRef.current.push(p)
      }
      pumpQueue(genRef.current)
    },
    [pumpQueue],
  )

  /** 记录 PreviewGrid 当前可视页，供 LRU 淘汰时避开 */
  const handleVisibleChange = useCallback((pages: Set<number>) => {
    visibleRef.current = pages
  }, [])

  const handleFile = async (f: File, ab: ArrayBuffer) => {
    const gen = ++genRef.current
    controllerRef.current?.abort()
    controllerRef.current = null
    clearRenderState()
    setFile(f)
    setArrayBuffer(ab)
    setPageCount(0)
    setPreviews([])
    setResults([])
    setSplitting(false)
    setPreviewEnabled(false)
    try {
      const info = await loadPdfInfo(ab)
      if (genRef.current !== gen) {
        info.doc.loadingTask.destroy()
        return
      }
      docRef.current = info.doc
      setPageCount(info.pageCount)
      setPreviews(new Array<string | null>(info.pageCount).fill(null))
      setCustomRanges([{ start: 1, end: info.pageCount }])
      // 每份页数不得超过新文件总页数
      setPagesPerFile((prev) => Math.min(prev, info.pageCount))
    } catch (e) {
      if (genRef.current !== gen) return
      // 解析失败时回滚文件状态，避免界面停在「已选文件但 0 页」的中间态
      setFile(null)
      setArrayBuffer(null)
      setPageCount(0)
      setPreviews([])
      setPreviewEnabled(false)
      setResults([])
      setSplitting(false)
      message.error(`PDF 解析失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 开关预览：开启后按需渲染可视区域；关闭时清空缩略图缓存释放内存 */
  const handleTogglePreview = (enabled: boolean) => {
    setPreviewEnabled(enabled)
    if (!enabled) {
      queueRef.current = []
      inFlightRef.current.clear()
      busyRef.current = 0
      previewCacheRef.current.clear()
      visibleRef.current = new Set()
      setFailedPages(new Set())
      setPreviews((prev) =>
        prev.length > 0 ? new Array<string | null>(prev.length).fill(null) : prev,
      )
    }
  }

  const handleStartSplit = async () => {
    if (!arrayBuffer || rangeError) return
    const gen = genRef.current
    const controller = new AbortController()
    controllerRef.current = controller
    setSplitting(true)
    setResults([])
    setSplitProgress({ done: 0, total: effectiveRanges.length })
    try {
      const blobs = await splitPdfInWorker(
        arrayBuffer,
        effectiveRanges,
        (done, total) => {
          if (genRef.current === gen) setSplitProgress({ done, total })
        },
        controller.signal,
      )
      if (genRef.current !== gen) return
      const base = (file?.name ?? 'output').replace(/\.pdf$/i, '')
      const list: SplitFile[] = blobs.map((blob, i) => {
        const r = effectiveRanges[i]
        const suffix = r.start === r.end ? `第${r.start}页` : `第${r.start}-${r.end}页`
        return {
          id: `${i}-${Date.now()}`,
          name: `${base}_${suffix}.pdf`,
          range: r,
          size: blob.size,
          blob,
        }
      })
      setResults(list)
      message.success(`已生成 ${list.length} 份 PDF`)
    } catch (e) {
      // 换文件/重置导致的中途取消不弹错误
      if (genRef.current !== gen || controller.signal.aborted) return
      message.error(`拆分失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (genRef.current === gen) setSplitting(false)
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }

  const reset = () => {
    genRef.current++
    controllerRef.current?.abort()
    controllerRef.current = null
    clearRenderState()
    setFile(null)
    setArrayBuffer(null)
    setPageCount(0)
    setPreviews([])
    setPreviewEnabled(false)
    setResults([])
    setSplitting(false)
  }

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px 48px' }}>
      <Typography.Title level={3} style={{ marginBottom: 4 }}>
        PDF 页面拆分工具
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
        上传一个 PDF，按每份页数自动切分，或自定义页码范围，拆分成多个新 PDF 下载。
      </Typography.Paragraph>

      <Card title={file ? '重新上传（或点击右侧「重新上传」）' : '第一步：上传 PDF'}>
        <UploadArea onFile={handleFile} disabled={splitting} />
      </Card>

      {file && (
        <>
          <Space wrap style={{ margin: '12px 0' }} size={[8, 8]}>
            <Tag color="blue" icon={<FilePdfOutlined />}>
              {file.name}
            </Tag>
            <Tag>{formatSize(file.size)}</Tag>
            <Tag color="green">共 {pageCount} 页</Tag>
          </Space>

          <Flex gap={16} wrap>
            <Card
              title={
                <Flex align="center" gap={8}>
                  <span>页面预览</span>
                  <Switch
                    size="small"
                    checked={previewEnabled}
                    onChange={handleTogglePreview}
                    checkedChildren="开"
                    unCheckedChildren="关"
                  />
                </Flex>
              }
              style={{ flex: '2 1 480px' }}
            >
              <PreviewGrid
                pageCount={pageCount}
                previews={previews}
                covered={covered}
                failed={failedPages}
                enabled={previewEnabled}
                onRequestPages={requestPages}
                onVisibleChange={handleVisibleChange}
              />
            </Card>
            <Card title="第二步：设置拆分规则" style={{ flex: '1 1 300px' }}>
              <SplitConfig
                mode={mode}
                onModeChange={setMode}
                pagesPerFile={pagesPerFile}
                onPagesPerFileChange={setPagesPerFile}
                customRanges={customRanges}
                onCustomRangesChange={setCustomRanges}
                pageCount={pageCount}
                effectiveRanges={effectiveRanges}
                rangeError={rangeError}
                rangeWarning={rangeWarning}
                splitting={splitting}
                onStartSplit={handleStartSplit}
              />
            </Card>
          </Flex>

          <Card title="第三步：下载拆分结果" style={{ marginTop: 16 }}>
            <ResultList
              results={results}
              splitting={splitting}
              splitProgress={splitProgress}
              onReset={reset}
            />
          </Card>
        </>
      )}
    </div>
  )
}
