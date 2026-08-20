import { app, BrowserWindow, clipboard, screen } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let floatingWindowLoadPromise: Promise<void> | null = null;
let clipboardTimer: NodeJS.Timeout | null = null;
let activeAIRequestController: AbortController | null = null;
let latestAIRequestId = 0;
const isSmokeTest = process.argv.includes("--smoke-test");
const CLIPBOARD_POLL_INTERVAL_MS = 500;
const FLOATING_WINDOW_WIDTH = 360;
const FLOATING_WINDOW_HEIGHT = 300;
const FLOATING_WINDOW_OFFSET = 16;
const BACKEND_EXPLAIN_URL = "http://127.0.0.1:3001/ai/explain";
const AI_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_USER_GOAL = "learn English while working";

interface ExplanationResult {
  word: string;
  phonetic: string;
  translation: string;
  general_meaning: string;
  context_explanation: string;
  example: string;
}

type FloatingWindowState =
  | {
      status: "loading";
      word: string;
      currentApplication: string;
    }
  | {
      status: "result";
      result: ExplanationResult;
      currentApplication: string;
    }
  | {
      status: "error";
      word: string;
      currentApplication: string;
    };

const floatingWindowHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <style>
      :root {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #111827;
        background: #ffffff;
      }

      body {
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        margin: 0;
        border: 1px solid #d1d5db;
        box-sizing: border-box;
        padding: 14px 16px;
        overflow: hidden;
      }

      #word {
        overflow: hidden;
        font-size: 20px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #loading,
      #error {
        margin-top: 18px;
        color: #6b7280;
        font-size: 14px;
      }

      #retry {
        margin-top: 8px;
        color: #2563eb;
      }

      #result {
        margin-top: 8px;
      }

      #phonetic {
        color: #6b7280;
        font-size: 13px;
      }

      #translation {
        margin-top: 4px;
        font-size: 17px;
        font-weight: 600;
      }

      #context-explanation,
      #example {
        margin-top: 12px;
        font-size: 13px;
        line-height: 1.45;
      }

      #example {
        color: #4b5563;
        font-style: italic;
      }

      #current-app-label {
        margin-top: auto;
        color: #6b7280;
        font-size: 12px;
      }

      #current-app {
        margin-top: 2px;
        overflow: hidden;
        font-size: 14px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      [hidden] {
        display: none !important;
      }
    </style>
  </head>
  <body>
    <div id="word"></div>
    <div id="loading" hidden>AI is thinking...</div>
    <div id="result" hidden>
      <div id="phonetic"></div>
      <div id="translation"></div>
      <div id="context-explanation"></div>
      <div id="example"></div>
    </div>
    <div id="error" hidden>
      <div>Unable to connect to AI.</div>
      <div id="retry">Try again</div>
    </div>
    <div id="current-app-label">Current App:</div>
    <div id="current-app"></div>
  </body>
</html>`;

function isSingleEnglishWord(value: string) {
  return /^[A-Za-z]+$/.test(value);
}

function isExplanationResult(value: unknown): value is ExplanationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const result = value as Record<string, unknown>;
  const requiredFields = [
    "word",
    "phonetic",
    "translation",
    "general_meaning",
    "context_explanation",
    "example",
  ];

  return requiredFields.every((field) => typeof result[field] === "string");
}

function getFrontmostApplicationName() {
  const helperPath = path.join(__dirname, "../dist-native/frontmost-app");

  return new Promise<string>((resolve) => {
    execFile(helperPath, { timeout: 2_000 }, (error, stdout) => {
      if (error) {
        console.error("[current-app] Detection failed:", error.message);
        resolve("Unknown");
        return;
      }

      const applicationName = stdout.trim() || "Unknown";
      console.log(`[current-app] Detected: ${applicationName}`);
      resolve(applicationName);
    });
  });
}

function moveFloatingWindowNearCursor() {
  if (floatingWindow === null) {
    return;
  }

  const cursorPoint = screen.getCursorScreenPoint();
  const { workArea } = screen.getDisplayNearestPoint(cursorPoint);
  const maximumX = workArea.x + workArea.width - FLOATING_WINDOW_WIDTH;
  const maximumY = workArea.y + workArea.height - FLOATING_WINDOW_HEIGHT;
  const preferredX = cursorPoint.x + FLOATING_WINDOW_OFFSET;
  const preferredY = cursorPoint.y + FLOATING_WINDOW_OFFSET;
  const fallbackX = cursorPoint.x - FLOATING_WINDOW_WIDTH - FLOATING_WINDOW_OFFSET;
  const fallbackY = cursorPoint.y - FLOATING_WINDOW_HEIGHT - FLOATING_WINDOW_OFFSET;
  const x = Math.min(
    Math.max(preferredX <= maximumX ? preferredX : fallbackX, workArea.x),
    maximumX,
  );
  const y = Math.min(
    Math.max(preferredY <= maximumY ? preferredY : fallbackY, workArea.y),
    maximumY,
  );

  floatingWindow.setPosition(Math.round(x), Math.round(y), false);
}

async function ensureFloatingWindow() {
  if (floatingWindow === null) {
    floatingWindow = new BrowserWindow({
      width: FLOATING_WINDOW_WIDTH,
      height: FLOATING_WINDOW_HEIGHT,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    floatingWindow.setAlwaysOnTop(true, "floating");
    floatingWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });

    floatingWindow.on("closed", () => {
      floatingWindow = null;
      floatingWindowLoadPromise = null;
    });

    floatingWindowLoadPromise = floatingWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(floatingWindowHtml)}`,
    );
    await floatingWindowLoadPromise;
    console.log("[floating] Window created.");
  } else if (floatingWindowLoadPromise !== null) {
    await floatingWindowLoadPromise;
  }

  if (floatingWindow === null) {
    throw new Error("Floating window was closed before it finished loading");
  }

  return floatingWindow;
}

async function showFloatingState(
  state: FloatingWindowState,
  requestId: number,
) {
  const window = await ensureFloatingWindow();

  if (requestId !== latestAIRequestId) {
    return;
  }

  await window.webContents.executeJavaScript(`(() => {
    const state = ${JSON.stringify(state)};
    const requestId = ${requestId};
    const previousRequestId = Number(document.body.dataset.requestId ?? "0");

    if (requestId < previousRequestId) {
      return;
    }

    document.body.dataset.requestId = String(requestId);
    const word = state.status === "result" ? state.result.word : state.word;
    document.getElementById("word").textContent = word;
    document.getElementById("current-app").textContent = state.currentApplication;
    document.getElementById("loading").hidden = state.status !== "loading";
    document.getElementById("result").hidden = state.status !== "result";
    document.getElementById("error").hidden = state.status !== "error";

    if (state.status === "result") {
      document.getElementById("phonetic").textContent = state.result.phonetic;
      document.getElementById("translation").textContent = state.result.translation;
      document.getElementById("context-explanation").textContent = state.result.context_explanation;
      document.getElementById("example").textContent = state.result.example;
    }
  })()`);

  if (requestId !== latestAIRequestId) {
    return;
  }

  moveFloatingWindowNearCursor();
  window.showInactive();
}

async function requestAIExplanation(
  word: string,
  currentApplication: string,
  signal: AbortSignal,
) {
  const response = await fetch(BACKEND_EXPLAIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word,
      source_app: currentApplication,
      user_goal: DEFAULT_USER_GOAL,
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Backend returned HTTP ${response.status}`);
  }

  const result: unknown = await response.json();

  if (!isExplanationResult(result) || result.word !== word) {
    throw new Error("Backend returned an invalid explanation result");
  }

  return result;
}

async function handleDetectedWord(word: string) {
  const requestId = ++latestAIRequestId;
  let currentApplication = "Detecting...";

  activeAIRequestController?.abort();
  activeAIRequestController = null;

  try {
    await showFloatingState(
      { status: "loading", word, currentApplication },
      requestId,
    );

    currentApplication = await getFrontmostApplicationName();

    if (requestId !== latestAIRequestId) {
      return;
    }

    await showFloatingState(
      { status: "loading", word, currentApplication },
      requestId,
    );

    const requestController = new AbortController();
    activeAIRequestController = requestController;
    const timeout = setTimeout(
      () => requestController.abort(),
      AI_REQUEST_TIMEOUT_MS,
    );

    let result: ExplanationResult;

    try {
      result = await requestAIExplanation(
        word,
        currentApplication,
        requestController.signal,
      );
    } finally {
      clearTimeout(timeout);

      if (activeAIRequestController === requestController) {
        activeAIRequestController = null;
      }
    }

    if (requestId !== latestAIRequestId) {
      return;
    }

    await showFloatingState(
      { status: "result", result, currentApplication },
      requestId,
    );
    console.log(`[ai] Explanation displayed for: ${word}`);
  } catch (error) {
    if (requestId !== latestAIRequestId) {
      return;
    }

    console.error(`[ai] Explanation failed for ${word}:`, error);

    try {
      await showFloatingState(
        { status: "error", word, currentApplication },
        requestId,
      );
    } catch (windowError) {
      console.error("[floating] Failed to show error state:", windowError);
    }
  }
}

function startClipboardMonitor() {
  let lastProcessedText = clipboard.readText();
  let pendingText: string | null = null;

  clipboardTimer = setInterval(() => {
    const currentClipboardText = clipboard.readText();

    if (currentClipboardText === lastProcessedText) {
      pendingText = null;
      return;
    }

    if (currentClipboardText !== pendingText) {
      pendingText = currentClipboardText;
      return;
    }

    lastProcessedText = currentClipboardText;
    pendingText = null;
    const normalizedText = currentClipboardText.trim();

    console.log("[clipboard]");

    if (isSingleEnglishWord(normalizedText)) {
      console.log(`Detected word: ${normalizedText}`);
      void handleDetectedWord(normalizedText);
      return;
    }

    console.log("Ignored: invalid input");
  }, CLIPBOARD_POLL_INTERVAL_MS);

  console.log("[clipboard] Monitoring started.");
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 720,
    height: 440,
    title: "AI English Companion — Technical Spike",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.on("did-fail-load", (_event, code, description) => {
    console.error(`[spike] Page failed to load (${code}): ${description}`);
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[spike] Renderer process stopped: ${details.reason}`);
  });

  void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));

  mainWindow.once("ready-to-show", () => {
    console.log("[spike] Window opened successfully.");
  });

  mainWindow.webContents.once("did-finish-load", async () => {
    const visibleText = await mainWindow?.webContents.executeJavaScript(
      "document.body.innerText.trim()",
    );
    console.log(`[spike] Page rendered: ${JSON.stringify(visibleText)}`);

    if (isSmokeTest) {
      mainWindow?.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    console.log("[spike] Window closed; app is still running in the background.");

    if (isSmokeTest) {
      setTimeout(() => {
        if (BrowserWindow.getAllWindows().length === 0) {
          console.log("[spike] Background survival verified after window close.");
          app.quit();
        }
      }, 1_000);
    }
  });
}

app.whenReady().then(() => {
  startClipboardMonitor();
  createWindow();

  app.on("activate", () => {
    if (mainWindow === null) {
      createWindow();
    }
  });
});

app.on("will-quit", () => {
  activeAIRequestController?.abort();
  activeAIRequestController = null;

  if (clipboardTimer !== null) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
