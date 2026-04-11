import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { logger } from "./utils/logger";

function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    image: rootURI + "content/icons/favicon.png",
    label: getString("prefs-title"),
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
  });
}

function registerMenuEntries() {
  if (addon.data.menusRegistered) {
    return;
  }

  ztoolkit.Menu.register("item", {
    commandListener: () => {
      void addon.data.annotationExport.exportSelected();
    },
    icon: `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`,
    id: "zotero-itemmenu-zotero2eagle-export",
    label: getString("menuitem-label"),
    tag: "menuitem",
  });

  ztoolkit.Menu.register("menuTools", {
    tag: "menu",
    label: getString("menuitem-filemenulabel"),
    children: [
      {
        tag: "menuitem",
        label: getString("menuitem-label"),
        oncommand: `void Zotero.${addon.data.config.addonInstance}.data.annotationExport.exportSelected();`,
      },
    ],
  });

  addon.data.menusRegistered = true;
}

async function onStartup() {
  await Promise.all([
    Zotero.initializationPromise,
    Zotero.unlockPromise,
    Zotero.uiReadyPromise,
  ]);

  initLocale();
  try {
    registerPreferencePane();
  } catch (error) {
    logger.error("hooks", "Failed to register preference pane", error);
  }

  try {
    addon.data.annotationExport.init();
  } catch (error) {
    logger.error("hooks", "Failed to initialize annotation export service", error);
  }

  await Promise.allSettled(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
  logger.info("hooks", "Zotero2Eagle started");
}

async function onMainWindowLoad(_win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
  try {
    registerMenuEntries();
  } catch (error) {
    logger.error("hooks", "Failed to register menu entries", error);
  }
}

async function onMainWindowUnload(_win: Window): Promise<void> {}

function onShutdown(): void {
  addon.data.annotationExport.shutdown();
  ztoolkit.unregisterAll();
  addon.data.alive = false;
  // @ts-expect-error - Plugin instance is not typed
  delete Zotero[addon.data.config.addonInstance];
}

async function onNotify(
  _event: string,
  _type: string,
  _ids: Array<string | number>,
  _extraData: { [key: string]: any },
) {}

async function onPrefsEvent(type: string, data: { [key: string]: any }) {
  if (type === "load") {
    await registerPrefsScripts(data.window);
  }
}

export default {
  onStartup,
  onShutdown,
  onMainWindowLoad,
  onMainWindowUnload,
  onNotify,
  onPrefsEvent,
};
