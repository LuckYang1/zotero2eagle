import { config } from "../../package.json";
import {
  initializeOverviewWindow,
  teardownOverviewWindow,
} from "./overviewScript";

let overviewWindow: Window | null = null;
const initializedWindows = new WeakSet<Window>();
const initializingWindows = new WeakSet<Window>();

export function openOverviewWindow() {
  if (overviewWindow && !overviewWindow.closed) {
    overviewWindow.focus();
    return overviewWindow;
  }

  const parentWindow = Zotero.getMainWindow();
  overviewWindow = parentWindow.openDialog(
    `chrome://${config.addonRef}/content/overview.xhtml`,
    `${config.addonRef}-overview`,
    "chrome,resizable,centerscreen,width=1180,height=780",
  ) as Window;
  attachOverviewWindowListeners(overviewWindow);
  return overviewWindow;
}

export async function onOverviewWindowLoad(win: Window) {
  if (initializedWindows.has(win) || initializingWindows.has(win)) {
    return;
  }

  initializingWindows.add(win);
  overviewWindow = win;
  try {
    await initializeOverviewWindow(win);
    initializedWindows.add(win);
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    initializingWindows.delete(win);
  }
}

export function onOverviewWindowUnload(win: Window) {
  if (initializedWindows.has(win)) {
    teardownOverviewWindow(win);
    initializedWindows.delete(win);
  }
  if (overviewWindow === win) {
    overviewWindow = null;
  }
}

export function closeOverviewWindow() {
  if (overviewWindow && !overviewWindow.closed) {
    overviewWindow.close();
  }
  overviewWindow = null;
}

function attachOverviewWindowListeners(win: Window) {
  win.addEventListener("load", () => void onOverviewWindowLoad(win), {
    once: true,
  });
  win.addEventListener("unload", () => onOverviewWindowUnload(win), {
    once: true,
  });

  Promise.resolve().then(() => {
    if (win.document.readyState === "complete") {
      void onOverviewWindowLoad(win);
    }
  });
}
