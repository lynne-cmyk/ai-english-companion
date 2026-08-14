# AI English Companion

一个基于上下文感知的桌面 AI 英语助手。

## Problem

用户在 Cursor、Figma、浏览器等工作环境中会遇到大量英文内容。传统翻译工具通常要求用户离开当前工作流、切换应用或手动粘贴文本，打断工作节奏并增加英语学习成本。

## Solution

用户复制英文内容后，AI English Companion 会结合当前应用场景提供：

- 中文释义
- 音标
- 发音
- Context-aware explanation

## Key Features

- Clipboard-triggered assistant
- Floating window
- Current application detection
- Backend API
- LLM Provider abstraction
- Mock AI pipeline

## Architecture

```text
Electron
    ↓
Backend API
    ↓
AI Provider Layer
    ↓
LLM
```

## Tech Stack

- Electron
- React
- TypeScript
- Node.js
- DeepSeek（planned）

## Development Progress

- Checkpoint 01：Electron App、剪贴板监听与悬浮窗口
- Checkpoint 02：当前前台应用识别
- Checkpoint 03：Backend API 基础架构
- Checkpoint 04：LLM Provider 抽象与 Mock AI explanation API
