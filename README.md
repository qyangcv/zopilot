# Zopilot

[![使用 Zotero 插件模板](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

[English](./docs/README_EN.md) · **简体中文**

Zopilot 是一款简约、现代化的 Zotero AI 插件, 将 AI 接入 Zopilot 侧边栏中，作为你的论文阅读助手。

## 特点

- 独立的侧边栏窗口
- 简单、高信息密度的 UI 设计
- 支持 BYOK (OpenAI 兼容的 API) 和 Codex CLI

## 环境要求

- Zotero 9.0
- macOS 或 Windows x86_64

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

- Zotero 原生的 Workspace 支持，支持在文献库或合集中对多篇论文进行提问
- 支持使用 Codex CLI (使用 Codex 订阅) 和 BYOK (OpenAI 兼容的 API)
- 支持附件上传 (本地 PDF 或图片)
- 支持会话历史保存
- 支持配置自定义 Prompt

## 已知问题

- 处理长论文 (>100页) 时，文档解析速度较慢，可能遇到回答超时、 UI 阻塞问题

## 反馈

- 欢迎提 Issue 反馈在使用过程中遇到的问题，或联系 `qyang@bupt.edu.cn`

## 其他

- [llm-for-zotero](https://github.com/yilewang/llm-for-zotero): Zotero Agentic 插件，具有更丰富的 AI 功能。
