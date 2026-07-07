# Zopilot

[![使用 Zotero 插件模板](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](./docs/README_EN.md) · **简体中文**

Zopilot 是一款 Zotero 插件，将 AI 接入 Zopilot 侧边栏中，作为你的论文阅读助手。

## 特点

- 独立的侧边栏窗口
- 简约、高信息密度的 UI 设计
- 支持 BYOK 和 Codex CLI

## 环境要求

- Zotero 9.0
- MacOS 或 Windows x64

## 开始使用

- 安装 zopilot: Zotero -> 工具 -> 插件 -> 拖入 `xpi` 文件
- 配置 PDF 解析依赖: Zotero -> 设置 -> Zopilot -> 依赖管理 -> 安装
- 配置 Provider: Zotero -> 设置 -> Zopilot -> Provider -> 填入 URL 和 API key (默认支持 codex cli，无需配置即可直接使用)

## 预览

**主页面**

![主页面](./assets/preview/main-page.jpeg)

**选择 Zotero Workspace**

![工作区选择](./assets/preview/workspace-selection.jpeg)

**使用 @ 提及多篇论文**

![使用 @](./assets/preview/use-@.jpeg)

**选择 Model**

![提供商选择](./assets/preview/provider-selection.jpeg)

**插入自定义 Prompt**

![提示词插入](./assets/preview/prompt-insert.jpeg)

## 功能

- Zotero 原生的 Workspace 支持，支持在文献库或合集中对论文进行提问
- 支持使用 Codex CLI (使用 Codex 订阅) 和 BYOK (OpenAI 兼容的 API)
- 支持附件上传 (本地 PDF 或图片)
- 支持会话历史保存
- 支持配置自定义 Prompt

## 反馈

- 欢迎提 Issue 反馈在使用过程中遇到的问题，或联系 `qyang@bupt.edu.cn`

<!-- ## 致谢

感谢以下项目让 Zopilot 成为可能：

- [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)：一个优秀的 Zotero 插件模板。
- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero)：为本插件的创建提供了灵感。
- [markdown-it](https://github.com/markdown-it/markdown-it)：用于渲染 Codex 响应的 Markdown 解析器。
- [mdit-plugins](https://github.com/mdit-plugins/mdit-plugins)：用于任务列表、脚注和 TeX 块的 Markdown-it 扩展。
- [Shiki](https://github.com/shikijs/shiki)：用于 Codex 响应中代码块的语法高亮。 -->
