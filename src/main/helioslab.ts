/**
 * HeliosLab desktop shell entry point (Electrobun).
 *
 * Opens a single native window hosting the HeliosLab web UI.
 * The Rust core (pheno-cli) runs as a sidecar communicating over stdio/socket.
 */
import Electrobun, { BrowserWindow } from "electrobun";

Electrobun.initialize();

const mainWindow = new BrowserWindow({
  title: "HeliosLab",
  url: "views://helioslab/index.html",
  width: 1024,
  height: 720,
  minWidth: 640,
  minHeight: 480,
  titleBarStyle: "hidden",
});

mainWindow.show();

Electrobun.app.on("window-all-closed", () => {
  Electrobun.app.quit();
});
