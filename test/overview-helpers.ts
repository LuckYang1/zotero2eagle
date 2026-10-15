import { config, version } from "../package.json";

const OVERVIEW_URL = `chrome://${config.addonRef}/content/overview.xhtml`;
const WAIT_TIMEOUT_MS = 20_000;

async function waitUntil(check: () => boolean, failure: string) {
  const startedAt = Date.now();
  while (!check()) {
    if (Date.now() - startedAt > WAIT_TIMEOUT_MS) {
      throw new Error(failure);
    }
    await Zotero.Promise.delay(20);
  }
}

// openDialog 返回时窗口中可能仍是初始的 about:blank，并且在部分平台上它的
// readyState 已经是 complete；插件完成初始化后会把版本号写入窗口标题
export function waitForOverviewReady(manager: Window) {
  return waitUntil(
    () =>
      !manager.closed &&
      manager.document.documentURI === OVERVIEW_URL &&
      manager.document.readyState === "complete" &&
      !!manager.document.getElementById(
        `${config.addonRef}-image-manager-grid`,
      ) &&
      !!manager.document.documentElement
        ?.getAttribute("title")
        ?.includes(`v${version}`),
    "The image manager window did not finish initializing",
  );
}

export function closeOverviewWindow(manager: Window) {
  manager.close();
  return waitUntil(
    () => manager.closed,
    "The image manager window did not close",
  );
}
