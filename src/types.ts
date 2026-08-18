/** 一个页码范围（1-based，包含两端） */
export interface PageRange {
  start: number
  end: number
}

/** 拆分产出的一个新 PDF 文件 */
export interface SplitFile {
  id: string
  name: string
  range: PageRange
  size: number
  blob: Blob
}

export type SplitMode = 'auto' | 'custom'
