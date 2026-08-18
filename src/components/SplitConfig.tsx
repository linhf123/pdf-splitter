import { Alert, Button, Divider, InputNumber, Segmented, Space, Tag, Tooltip } from 'antd'
import { DeleteOutlined, PlusOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { PageRange, SplitMode } from '../types'

interface Props {
  mode: SplitMode
  onModeChange: (mode: SplitMode) => void
  pagesPerFile: number
  onPagesPerFileChange: (n: number) => void
  customRanges: PageRange[]
  onCustomRangesChange: (ranges: PageRange[]) => void
  pageCount: number
  effectiveRanges: PageRange[]
  rangeError: string | null
  rangeWarning: string | null
  splitting: boolean
  onStartSplit: () => void
}

function rangeLabel(r: PageRange) {
  return r.start === r.end ? `第 ${r.start} 页` : `第 ${r.start}-${r.end} 页`
}

export default function SplitConfig({
  mode,
  onModeChange,
  pagesPerFile,
  onPagesPerFileChange,
  customRanges,
  onCustomRangesChange,
  pageCount,
  effectiveRanges,
  rangeError,
  rangeWarning,
  splitting,
  onStartSplit,
}: Props) {
  const updateRange = (index: number, patch: Partial<PageRange>) => {
    const next = customRanges.map((r, i) => (i === index ? { ...r, ...patch } : r))
    onCustomRangesChange(next)
  }

  const addRange = () => {
    onCustomRangesChange([...customRanges, { start: 1, end: pageCount }])
  }

  const removeRange = (index: number) => {
    onCustomRangesChange(customRanges.filter((_, i) => i !== index))
  }

  return (
    <div>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Segmented
          value={mode}
          onChange={(v) => onModeChange(v as SplitMode)}
          options={[
            { label: '按每份页数自动拆分', value: 'auto' },
            { label: '自定义页码范围', value: 'custom' },
          ]}
        />

        {mode === 'auto' ? (
          <Space wrap align="center">
            <span>每份页数</span>
            <InputNumber
              min={1}
              max={pageCount}
              value={pagesPerFile}
              onChange={(v) => {
                if (v != null) onPagesPerFileChange(Math.max(1, v))
              }}
              style={{ width: 120 }}
              addonAfter="页"
            />
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>
              将生成 <b>{effectiveRanges.length}</b> 份
            </span>
          </Space>
        ) : (
          <div>
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {customRanges.map((r, i) => (
                <Space key={i} align="center">
                  <span style={{ width: 44, textAlign: 'right' }}>第 {i + 1} 份</span>
                  <InputNumber
                    min={1}
                    max={pageCount}
                    value={r.start}
                    placeholder="起始页"
                    onChange={(v) => {
                      if (v != null) updateRange(i, { start: v })
                    }}
                    style={{ width: 110 }}
                  />
                  <span>至</span>
                  <InputNumber
                    min={1}
                    max={pageCount}
                    value={r.end}
                    placeholder="结束页"
                    onChange={(v) => {
                      if (v != null) updateRange(i, { end: v })
                    }}
                    style={{ width: 110 }}
                  />
                  <Tooltip title="删除这一份">
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => removeRange(i)}
                    />
                  </Tooltip>
                </Space>
              ))}
              <Button icon={<PlusOutlined />} onClick={addRange}>
                添加一份
              </Button>
            </Space>
          </div>
        )}

        {(rangeError || rangeWarning) && (
          <Alert
            type={rangeError ? 'error' : 'warning'}
            showIcon
            message={rangeError ?? rangeWarning}
          />
        )}

        {effectiveRanges.length > 0 && (
          <div>
            <Divider style={{ margin: '4px 0 8px' }} />
            <div style={{ maxHeight: 120, overflow: 'auto' }}>
              <Space size={[6, 6]} wrap>
                {effectiveRanges.slice(0, 100).map((r, i) => (
                  <Tag key={i} color={rangeError ? 'red' : 'green'}>
                    {i + 1}. {rangeLabel(r)}
                  </Tag>
                ))}
                {effectiveRanges.length > 100 && <Tag>… 共 {effectiveRanges.length} 份</Tag>}
              </Space>
            </div>
          </div>
        )}

        <Button
          type="primary"
          size="large"
          icon={<ThunderboltOutlined />}
          loading={splitting}
          disabled={!!rangeError || effectiveRanges.length === 0}
          onClick={onStartSplit}
          block
        >
          {splitting ? '正在拆分…' : `开始拆分（${effectiveRanges.length} 份）`}
        </Button>
      </Space>
    </div>
  )
}
