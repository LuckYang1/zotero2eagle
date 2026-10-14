import { config } from "../../package.json";
import {
  initializeOverviewWindow,
  teardownOverviewWindow,
} from "./overviewScript";

const OVERVIEW_URL = `chrome://${config.addonRef}/content/overview.xhtml`;

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
    OVERVIEW_URL,
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

  // openDialog 返回时窗口中可能仍是初始的 about:blank，并且在部分平台上它的
  // readyState 已经是 complete，因此同时核对文档地址
  Promise.resolve().then(() => {
    if (
      win.document.documentURI === OVERVIEW_URL &&
      win.document.readyState === "complete"
    ) {
      void onOverviewWindowLoad(win);
    }
  });
}
