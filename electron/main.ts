import { app, BrowserWindow, clipboard, screen } from "electron";
import { execFile } from "node:child_process";
import path from "node:path";

let mainWindow: BrowserWindow | null = null;
let floatingWindow: BrowserWindow | null = null;
let clipboardTimer: NodeJS.Timeout | null = null;
const isSmokeTest = process.argv.includes("--smoke-test");
const CLIPBOARD_POLL_INTERVAL_MS = 500;
const FLOATING_WINDOW_WIDTH = 220;
const FLOATING_WINDOW_HEIGHT = 104;
const FLOATING_WINDOW_OFFSET = 16;

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
        justify-content: center;
        min-height: 100vh;
        margin: 0;
        border: 1px solid #d1d5db;
        box-sizing: border-box;
        padding: 14px 16px;
      }

      #word {
        overflow: hidden;
        font-size: 20px;
        font-weight: 600;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      #current-app-label {
        margin-top: 10px;
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
    </style>
  </head>
  <body>
    <div id="word"></div>
    <div id="current-app-label">Current App:</div>
    <div id="current-app"></div>
  </body>
</html>`;

function isSingleEnglishWord(value: string) {
  return /^[A-Za-z]+$/.test(value);
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

async function showFloatingWord(word: string, currentApplication: string) {
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
    });

    await floatingWindow.loadURL(
      `data:text/html;charset=UTF-8,${encodeURIComponent(floatingWindowHtml)}`,
    );
    console.log("[floating] Window created.");
  }

  await floatingWindow.webContents.executeJavaScript(
    `document.getElementById("word").textContent = ${JSON.stringify(word)};
     document.getElementById("current-app").textContent = ${JSON.stringify(currentApplication)};`,
  );
  moveFloatingWindowNearCursor();
  floatingWindow.showInactive();
  console.log(
    `[floating] Showing word: ${word}; current app: ${currentApplication}`,
  );
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
      void getFrontmostApplicationName()
        .then((currentApplication) =>
          showFloatingWord(normalizedText, currentApplication),
        )
        .catch((error: unknown) => {
          console.error("[floating] Failed to show window:", error);
        });
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
