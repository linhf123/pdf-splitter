/** 触发浏览器下载一个 Blob */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** 把多个文件打包成一个 ZIP 并下载 */
export async function downloadZip(
  files: { name: string; blob: Blob }[],
  zipName: string,
): Promise<void> {
  const JSZip = (await import('jszip')).default
  const zip = new JSZip()
  files.forEach((f) => zip.file(f.name, f.blob))
  const blob = await zip.generateAsync({ type: 'blob' })
  downloadBlob(blob, zipName)
}

/** 文件大小的人类可读展示 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}
