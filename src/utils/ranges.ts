import type { PageRange } from '../types'

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
  const overlaps: string[] = []
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].start <= ranges[j].end && ranges[j].start <= ranges[i].end) {
        overlaps.push(`第 ${i + 1} 份与第 ${j + 1} 份页码范围重叠`)
      }
    }
  }
  const warning = overlaps.length
    ? `${overlaps.join('、')}（允许，但会重复包含页面）`
    : null
  return { error: null, warning }
}
