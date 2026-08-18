import { App, Upload } from 'antd'
import { InboxOutlined } from '@ant-design/icons'
import type { UploadProps } from 'antd'

interface Props {
  onFile: (file: File, arrayBuffer: ArrayBuffer) => void
  disabled?: boolean
}

export default function UploadArea({ onFile, disabled }: Props) {
  const { message } = App.useApp()

  const beforeUpload: UploadProps['beforeUpload'] = (file) => {
    const isPdf = file.type.includes('pdf') || /\.pdf$/i.test(file.name)
    if (!isPdf) {
      message.error('仅支持 PDF 文件')
      return Upload.LIST_IGNORE
    }
    file
      .arrayBuffer()
      .then((ab) => onFile(file, ab))
      .catch(() => message.error('读取文件失败'))
    return Upload.LIST_IGNORE
  }

  return (
    <Upload.Dragger
      beforeUpload={beforeUpload}
      multiple={false}
      showUploadList={false}
      disabled={disabled}
      accept=".pdf,application/pdf"
    >
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">点击或拖拽 PDF 文件到此处</p>
      <p className="ant-upload-hint">支持拆分成多个新 PDF，按每份页数自动切分或自定义页码范围；超大文件首次解析和预览需耐心等待</p>
    </Upload.Dragger>
  )
}
