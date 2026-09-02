import type { PopoverViewModel, PreviewMode, ResultContent } from "./types";

const resultContent: ResultContent = {
  word: "component",
  phonetic: "/kəmˈpoʊnənt/",
  partOfSpeech: "NOUN",
  translation: "组件 / 零件",
  context: [
    { text: "在 " },
    { text: "Cursor", highlight: true },
    { text: " 中，component 通常指一个可复用的软件模块；在 " },
    { text: "React", highlight: true },
    { text: " 项目中，常指 UI 组件。" },
  ],
};

const longResultContent: ResultContent = {
  ...resultContent,
  translation: "组件 / 零件 / 组成部分 / 成分",
  context: [
    { text: "在 " },
    { text: "Cursor", highlight: true },
    {
      text: " 中，component 通常指一个可复用的软件模块，负责处理特定功能。在 ",
    },
    { text: "React", highlight: true },
    {
      text: " 项目中，它常指 UI 组件：一个封装了结构、样式与行为的独立单元。函数式组件通过 props 接收数据，通过 state 管理内部状态。组件可以嵌套组合，形成完整的界面树。良好的组件设计强调单一职责、高内聚低耦合，有利于复用、测试与长期维护。",
    },
  ],
};

export const previewLabels: Record<PreviewMode, string> = {
  result: "Result",
  loading: "Loading",
  error: "Error",
  offline: "Offline",
  long: "Long Content",
};

export function getPreviewModel(mode: PreviewMode): PopoverViewModel {
  switch (mode) {
    case "result":
      return { state: "result", content: resultContent };
    case "loading":
      return { state: "loading", word: resultContent.word };
    case "error":
      return { state: "error", word: resultContent.word };
    case "offline":
      return { state: "offline", word: resultContent.word };
    case "long":
      return {
        state: "result",
        content: longResultContent,
        longContent: true,
      };
  }
}
