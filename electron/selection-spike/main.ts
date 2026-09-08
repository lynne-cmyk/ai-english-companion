import path from "node:path";
import { app } from "electron";
import { SelectionActionController } from "../selection/SelectionActionController";

const APP_NAME = "AI English Companion Selection Action Spike";
const repoRoot = path.resolve(__dirname, "../..");
let controller: SelectionActionController | null = null;

app.setName(APP_NAME);
app.setPath(
  "userData",
  path.join(app.getPath("appData"), "ai-english-companion-selection-action-spike"),
);

const hasSingleInstanceLock = app.requestSingleInstanceLock();

function stopExperiment() {
  controller?.stop();
  controller = null;
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    console.log("[selection-action] second experiment instance rejected");
  });
  app.on("before-quit", stopExperiment);
  app.on("window-all-closed", () => app.quit());

  void app.whenReady().then(() => {
    console.log(`[selection-action] experiment started pid=${process.pid}`);
    controller = new SelectionActionController({
      repoRoot,
      rendererPath: path.join(repoRoot, "dist/selection-action.html"),
      probePath: path.join(repoRoot, "dist-native/selection-probe"),
      preloadPath: path.join(__dirname, "../selection/preload.js"),
      onAcceptedSelection(snapshot) {
        const safeText = snapshot.text.replace(/\s+/g, " ").slice(0, 80);
        console.log(
          `[selection-action] clicked sample=${snapshot.sampleId} ` +
            `text=${JSON.stringify(safeText)} ` +
            `app=${JSON.stringify(snapshot.sourceApp)}`,
        );
      },
    });
    controller.start();
  });
}
