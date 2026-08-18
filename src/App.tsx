import { useCallback, useMemo, useRef, useState } from 'react'
import { App as AntdApp, Card, Flex, Space, Switch, Tag, Typography } from 'antd'
import { FilePdfOutlined } from '@ant-design/icons'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import UploadArea from './components/UploadArea'
import PreviewGrid from './components/PreviewGrid'
import SplitConfig from './components/SplitConfig'
import ResultList from './components/ResultList'
import {
  computeAutoRanges,
  loadPdfInfo,
  renderPage,
  splitPdf,
  validateRanges,
} from './utils/pdf'
import { formatSize } from './utils/download'
import type { PageRange, SplitFile, SplitMode } from './types'

// 缩略图并发渲染数，避免大文件时同时渲染过多页面卡住主线程
const RENDER_CONCURRENCY = 2

export default function App() {
  const { message } = AntdApp.useApp()
  const [file, setFile] = useState<File | null>(null)
  const [arrayBuffer, setArrayBuffer] = useState<ArrayBuffer | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [previews, setPreviews] = useState<(string | null)[]>([])
  const [previewEnabled, setPreviewEnabled] = useState(false)
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
  }

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
          setPreviews((prev) => {
            if (page - 1 >= prev.length) return prev
            const next = [...prev]
            next[page - 1] = url
            return next
          })
          pumpQueue(gen)
        })
        .catch(() => {
          busyRef.current--
          inFlightRef.current.delete(page)
          pumpQueue(gen)
        })
    }
  }, [])

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

  const handleFile = async (f: File, ab: ArrayBuffer) => {
    const gen = ++genRef.current
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
    } catch (e) {
      if (genRef.current !== gen) return
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
      setPreviews((prev) =>
        prev.length > 0 ? new Array<string | null>(prev.length).fill(null) : prev,
      )
    }
  }

  const handleStartSplit = async () => {
    if (!arrayBuffer || rangeError) return
    const gen = genRef.current
    setSplitting(true)
    setResults([])
    setSplitProgress({ done: 0, total: effectiveRanges.length })
    try {
      const blobs = await splitPdf(arrayBuffer, effectiveRanges, (done, total) => {
        if (genRef.current === gen) setSplitProgress({ done, total })
      })
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
      message.error(`拆分失败：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      if (genRef.current === gen) setSplitting(false)
    }
  }

  const reset = () => {
    genRef.current++
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
                enabled={previewEnabled}
                onRequestPages={requestPages}
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
