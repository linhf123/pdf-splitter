import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Empty, Spin } from 'antd'
import { EyeInvisibleOutlined } from '@ant-design/icons'

const CELL_MIN_WIDTH = 120
const THUMB_HEIGHT = 90
// 「第 N 页」标签高度（字号 12 + padding）
const LABEL_HEIGHT = 22
// 每格上下边框 2px × 2
const BORDER = 4
const GAP = 12
// 每行整体高度（含行间距），虚拟滚动按它定位行
const ROW_HEIGHT = THUMB_HEIGHT + LABEL_HEIGHT + BORDER + GAP
// 可视区域外额外渲染的行数
const OVERSCAN = 3
// 滚动容器高度
const CONTAINER_HEIGHT = 480

interface Props {
  pageCount: number
  /** 按页码索引的缩略图 dataURL，未渲染的为 null */
  previews: (string | null)[]
  /** 需要高亮展示的页码集合（1-based），用于联动拆分范围 */
  covered?: Set<number>
  /** 是否开启预览；关闭时只渲染占位提示，不请求任何页面 */
  enabled: boolean
  /** 请求渲染若干缺失页面的缩略图（页码 1-based） */
  onRequestPages: (pages: number[]) => void
}

export default function PreviewGrid({
  pageCount,
  previews,
  covered,
  enabled,
  onRequestPages,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ width: 500, height: CONTAINER_HEIGHT })
  const [scrollTop, setScrollTop] = useState(0)

  const rendered = previews.filter(Boolean).length
  const columnCount = Math.max(1, Math.floor((viewport.width + GAP) / (CELL_MIN_WIDTH + GAP)))
  const rowCount = Math.ceil(pageCount / columnCount)

  // 监听滚动容器尺寸变化，计算列数
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight })
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [enabled])

  // 虚拟滚动：只渲染可视行 + 上下 overscan
  const firstVisibleRow = Math.floor(scrollTop / ROW_HEIGHT)
  const visibleRowCount = Math.ceil(viewport.height / ROW_HEIGHT) + OVERSCAN * 2
  const startRow = Math.max(0, firstVisibleRow - OVERSCAN)
  const endRow = Math.min(rowCount - 1, firstVisibleRow + visibleRowCount)
  const rows: number[] = []
  for (let r = startRow; r <= endRow; r++) rows.push(r)

  // 可视区域内缺失的缩略图，按需请求渲染；已入队/渲染中的由 onRequestPages 去重
  useEffect(() => {
    if (!enabled) return
    const missing: number[] = []
    for (let r = startRow; r <= endRow; r++) {
      for (let c = 0; c < columnCount; c++) {
        const p = r * columnCount + c + 1
        if (p > pageCount) break
        if (previews[p - 1] == null) missing.push(p)
      }
    }
    if (missing.length) onRequestPages(missing)
  }, [enabled, onRequestPages, pageCount, columnCount, previews, startRow, endRow])

  if (pageCount === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="上传 PDF 后此处显示每页缩略图" />
  }

  if (!enabled) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 0', color: 'rgba(0,0,0,0.45)' }}>
        <EyeInvisibleOutlined style={{ fontSize: 36, marginBottom: 8, color: 'rgba(0,0,0,0.25)' }} />
        <div>预览已关闭</div>
        <div style={{ fontSize: 12, marginTop: 4 }}>
          打开右上角开关后，仅渲染可视区域内的页面，超大 PDF 也能流畅浏览
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span>
          共 <b>{pageCount}</b> 页，已加载 {rendered}/{pageCount}
        </span>
        {covered && covered.size > 0 && (
          <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>
            绿框 = 当前拆分范围覆盖的页
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        onScroll={() => setScrollTop(scrollRef.current?.scrollTop ?? 0)}
        style={{
          height: CONTAINER_HEIGHT,
          overflow: 'auto',
          position: 'relative',
          border: '1px solid #f0f0f0',
          borderRadius: 6,
        }}
      >
        <div style={{ height: rowCount * ROW_HEIGHT, position: 'relative', width: '100%' }}>
          {rows.map((rowIndex) => {
            const startPage = rowIndex * columnCount + 1
            const cells: ReactNode[] = []
            for (let c = 0; c < columnCount; c++) {
              const page = startPage + c
              if (page > pageCount) break
              const isCovered = covered?.has(page)
              cells.push(
                <div
                  key={page}
                  style={{
                    border: `2px solid ${isCovered ? '#52c41a' : '#f0f0f0'}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#fff',
                  }}
                >
                  <div
                    style={{
                      height: THUMB_HEIGHT,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: '#fafafa',
                    }}
                  >
                    {previews[page - 1] ? (
                      <img
                        src={previews[page - 1]!}
                        alt={`第 ${page} 页`}
                        style={{ maxWidth: '100%', maxHeight: '100%' }}
                      />
                    ) : (
                      <Spin size="small" />
                    )}
                  </div>
                  <div
                    style={{
                      textAlign: 'center',
                      fontSize: 12,
                      padding: '2px 0',
                      color: 'rgba(0,0,0,0.65)',
                    }}
                  >
                    第 {page} 页
                  </div>
                </div>,
              )
            }
            return (
              <div
                key={rowIndex}
                style={{
                  position: 'absolute',
                  top: rowIndex * ROW_HEIGHT,
                  left: 0,
                  right: 0,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                  gap: GAP,
                  paddingBottom: GAP,
                }}
              >
                {cells}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
