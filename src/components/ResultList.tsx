import { useState } from 'react'
import { Alert, App, Button, Empty, List, Progress, Space, Typography } from 'antd'
import {
  CloudDownloadOutlined,
  DownloadOutlined,
  RedoOutlined,
  FileZipOutlined,
} from '@ant-design/icons'
import { downloadBlob, downloadZip, formatSize } from '../utils/download'
import type { SplitFile } from '../types'

/** 按当前时间生成文件名后缀，如 20260818-234600 */
function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  )
}

interface Props {
  results: SplitFile[]
  splitting: boolean
  splitProgress: { done: number; total: number }
  /** 原 PDF 文件名，用于 ZIP 包命名 */
  fileName: string
  onReset: () => void
}

export default function ResultList({ results, splitting, splitProgress, fileName, onReset }: Props) {
  const { message } = App.useApp()
  const [zipping, setZipping] = useState(false)

  if (results.length === 0 && !splitting) return null

  const handleZip = async () => {
    if (zipping) return
    setZipping(true)
    try {
      // 包名带原文件名 + 点击时刻的时间戳；原文件名为空或本身就是「拆分结果」时避免重复拼接
      const base = fileName.replace(/\.pdf$/i, '').replace(/_?拆分结果$/, '')
      const zipName = `${base ? `${base}_` : ''}拆分结果_${timestamp()}.zip`
      await downloadZip(
        results.map((r) => ({ name: r.name, blob: r.blob })),
        zipName,
      )
    } catch {
      message.error('打包 ZIP 失败，请重试或逐份下载')
    } finally {
      setZipping(false)
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }}>
        <Typography.Title level={5} style={{ margin: 0 }}>
          拆分结果（{splitting ? splitProgress.done + '/' + splitProgress.total : results.length} 份）
        </Typography.Title>
        <Space>
          <Button
            icon={<RedoOutlined />}
            onClick={onReset}
            disabled={splitting}
          >
            重新上传
          </Button>
          <Button
            type="primary"
            icon={<FileZipOutlined />}
            loading={zipping}
            disabled={splitting || results.length === 0}
            onClick={handleZip}
          >
            全部打包下载 ZIP
          </Button>
        </Space>
      </Space>

      {splitting && (
        <Alert
          type="info"
          showIcon
          message={`正在生成第 ${splitProgress.done}/${splitProgress.total} 份…`}
          description={
            <Progress percent={Math.round((splitProgress.done / splitProgress.total) * 100)} />
          }
        />
      )}

      {!splitting && results.length === 0 && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无结果" />
      )}

      {!splitting && results.length > 0 && (
        <List
          size="small"
          bordered
          dataSource={results}
          renderItem={(r) => (
            <List.Item
              actions={[
                <Button
                  key="dl"
                  type="link"
                  icon={<DownloadOutlined />}
                  onClick={() => downloadBlob(r.blob, r.name)}
                >
                  下载
                </Button>,
              ]}
            >
              <Space direction="vertical" size={0}>
                <Typography.Text ellipsis={{ tooltip: r.name }} style={{ maxWidth: 320 }}>
                  {r.name}
                </Typography.Text>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {r.range.start === r.range.end
                    ? `第 ${r.range.start} 页`
                    : `第 ${r.range.start}-${r.range.end} 页`}{' '}
                  · {formatSize(r.size)}
                </Typography.Text>
              </Space>
              <CloudDownloadOutlined style={{ marginLeft: 12, color: 'rgba(0,0,0,0.25)' }} />
            </List.Item>
          )}
        />
      )}
    </div>
  )
}
