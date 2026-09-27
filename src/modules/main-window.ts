import { config } from "../../package.json";
import { getString } from "../utils/locale";

const BUTTON_ID = `${config.addonRef}-image-manager-toolbar-button`;
const STYLE_ID = `${config.addonRef}-zotero-pane-style`;

export function installMainWindowUI(win: _ZoteroTypes.MainWindow) {
  ensureStyleSheet(win);
  ensureToolbarButton(win);
}

export function uninstallMainWindowUI(win: Window) {
  win.document.getElementById(BUTTON_ID)?.remove();
  win.document.getElementById(STYLE_ID)?.remove();
}

function ensureStyleSheet(win: Window) {
  if (win.document.getElementById(STYLE_ID)) {
    return;
  }

  const link = ztoolkit.UI.createElement(win.document, "link", {
    properties: {
      id: STYLE_ID,
      type: "text/css",
      rel: "stylesheet",
      href: `chrome://${config.addonRef}/content/zoteroPane.css`,
    },
  });
  win.document.documentElement?.appendChild(link);
}

function ensureToolbarButton(win: _ZoteroTypes.MainWindow) {
  const toolbar = getToolbarButtonContainer(win);
  if (!toolbar) {
    return;
  }

  const button =
    win.document.getElementById(BUTTON_ID) ?? createToolbarButton(win);
  const insertBefore = getToolbarButtonInsertBefore(win, toolbar, button);
  if (
    button.parentElement !== toolbar ||
    (insertBefore && button.nextElementSibling !== insertBefore)
  ) {
    toolbar.insertBefore(button, insertBefore);
  }
}

function getToolbarButtonContainer(win: Window) {
  return (
    win.document.getElementById("zotero-tabs-toolbar") ??
    win.document.getElementById("zotero-items-toolbar")
  );
}

function getToolbarButtonInsertBefore(
  win: Window,
  toolbar: Element,
  button: Element,
) {
  if (toolbar.id !== "zotero-tabs-toolbar") {
    return null;
  }

  const insertBefore =
    win.document.getElementById("zotero-tb-tabs-menu") ?? toolbar.firstChild;
  return insertBefore === button ? null : insertBefore;
}

function createToolbarButton(win: _ZoteroTypes.MainWindow) {
  const button = win.document.createXULElement("toolbarbutton");
  button.id = BUTTON_ID;
  button.className = "zotero-tb-button";
  button.setAttribute("tabindex", "-1");
  button.setAttribute("tooltiptext", getString("toolbar-button-tooltip"));
  button.setAttribute("aria-label", getString("toolbar-button-tooltip"));
  button.addEventListener("command", () => {
    addon.api.openOverview();
  });
  return button;
}
