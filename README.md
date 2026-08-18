# PDF 页面拆分工具

基于 **React + TypeScript + Ant Design** 的纯前端 PDF 页面拆分工具。上传一个 PDF，把它拆分成多个新的 PDF 文件下载。

## 功能

- **上传 PDF**：拖拽或点击上传，不限制大小，仅支持 `.pdf`
- **页面预览**：默认关闭，开启后按需渲染可视区域的页面缩略图（虚拟滚动），并联动高亮当前拆分范围覆盖的页面
- **两种拆分方式**
  - 按每份页数自动拆分：输入 N（如 100），自动切成 `1-N`、`N+1-2N`…，最后不足 N 页单独成一份
  - 自定义页码范围：任意增删 `起始页-结束页`，支持重复包含；越界会阻断，重叠只给警告
- **下载**：每份单独下载，或一键打包全部为 ZIP

## 技术栈

| 用途 | 库 |
| --- | --- |
| UI | antd v6（Ant Design） |
| PDF 解析 / 缩略图渲染 | pdfjs-dist v6 |
| PDF 拆分 | pdf-lib |
| ZIP 打包 | jszip（按需加载） |
| 构建 | Vite 8 + React 19 + TypeScript |

## 本地运行

```bash
npm install
npm run dev      # 开发（默认 http://localhost:5173）
npm run build    # 生产构建到 dist/
npm run preview  # 预览生产构建
```

> 注意：dev server 默认占用 5173，如与本地其他项目冲突，可用 `npm run dev -- --port <端口>` 换端口。

## 说明

- 所有处理均在浏览器本地完成，PDF 不会上传到任何服务器。
- 拆分基于 pdf-lib 的 `copyPages`，页面内容（文字、图片、矢量）完整保留；原 PDF 中的书签/超链接等文档级结构不保留。
- `splitPdf` 默认对加密 PDF 使用 `ignoreEncryption: true`（适合仅"所有者加密"的文档）；带用户口令的加密 PDF 无法处理。
