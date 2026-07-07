# Zopilot

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)

**English** · [简体中文](../README.md)

Zopilot is a modern Zotero AI plugin that brings AI into the Zopilot sidebar as your paper-reading assistant.

## Highlights

- Standalone sidebar window
- Minimal, information-dense UI design
- Supports BYOK (OpenAI-compatible API) and Codex CLI

## Requirements

- Zotero 9.0
- macOS or Windows x86_64

## Getting Started

- Install Zopilot: Zotero -> Tools -> Plugins -> drag in the `xpi` file
- Configure PDF parsing dependencies: Zotero -> Settings -> Zopilot -> Dependency Management -> Install
- Configure a provider: Zotero -> Settings -> Zopilot -> Provider -> enter the URL and API key. Codex CLI is supported by default and can be used without additional configuration.

## Preview

**Main Page**

![main-page](../assets/preview/main-page.jpeg)

**Workspace Selection**

![workspace-selection](../assets/preview/workspace-selection.jpeg)

**Use @ to Mention Multiple Papers**

![use-@](../assets/preview/use-@.jpeg)

**Select Model**

![provider-selection](../assets/preview/provider-selection.jpeg)

**Insert a Custom Prompt**

![prompt-insert](../assets/preview/prompt-insert.jpeg)

## Features

- Native Zotero workspace support, allowing you to ask questions about papers in a library or collection
- Supports Codex CLI with a Codex subscription and BYOK with OpenAI-compatible APIs
- Supports attachment uploads, including local PDFs and images
- Supports saved session history
- Supports custom prompt configuration

## Known Issues

- When processing long papers (>100 pages), document parsing can be slow and may cause response timeouts or UI blocking.

## Feedback

- Please open an issue for any problems you encounter, or contact `qyang@bupt.edu.cn`.
