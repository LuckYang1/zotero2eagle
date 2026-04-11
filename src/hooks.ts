import { getString, initLocale } from "./utils/locale";
import { registerPrefsScripts } from "./modules/preferenceScript";
import { createZToolkit } from "./utils/ztoolkit";
import { logger } from "./utils/logger";

let readerAnnotationMenuRegistered = false;

const onCreateAnnotationContextMenu: _ZoteroTypes.Reader.EventHandler<"createAnnotationContextMenu"> =
  (event) => {
    try {
      const selectedIDs = new Set(
        [...event.params.ids, event.params.currentID].filter(Boolean),
      );
      const annotationItems = Zotero.Items.get(
        event.reader.annotationItemIDs || [],
      ) as Zotero.Item[];

      event.append({
        label: getString("menuitem-label"),
        onCommand: () => {
          const imageAnnotationItemIDs = annotationItems
            .filter((item) => {
              if (
                !(
                  item.isAnnotation?.() &&
                  (item as any).annotationType === "image"
                )
              ) {
                return false;
              }

              const readerAnnotation = event.reader._getAnnotation(item) as
                | { id?: string; key?: string }
                | null;
              return (
                selectedIDs.has(item.key) ||
                selectedIDs.has(String(item.id)) ||
                (!!readerAnnotation?.id &&
                  selectedIDs.has(readerAnnotation.id)) ||
                (!!readerAnnotation?.key &&
                  selectedIDs.has(readerAnnotation.key))
              );
            })
            .map((item) => item.id);

          void addon.data.annotationExport.exportAnnotationIDs(
            imageAnnotationItemIDs,
          );
        },
      });
    } catch (error) {
      logger.error("hooks", "Failed to build annotation context menu", error);
    }
  };

function registerPreferencePane() {
  Zotero.PreferencePanes.register({
    image: rootURI + "content/icons/favicon.png",
    label: getString("prefs-title"),
    pluginID: addon.data.config.addonID,
    src: rootURI + "content/preferences.xhtml",
  });
}

function registerReaderAnnotationMenu() {
  if (readerAnnotationMenuRegistered) {
    return;
  }

  Zotero.Reader.registerEventListener(
    "createAnnotationContextMenu",
    onCreateAnnotationContextMenu,
    addon.data.config.addonID,
  );
  readerAnnotationMenuRegistered = true;
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
    logger.error(
      "hooks",
      "Failed to initialize annotation export service",
      error,
    );
  }

  try {
    registerReaderAnnotationMenu();
  } catch (error) {
    logger.error(
      "hooks",
      "Failed to register reader annotation context menu",
      error,
    );
  }

  await Promise.allSettled(
    Zotero.getMainWindows().map((win) => onMainWindowLoad(win)),
  );

  addon.data.initialized = true;
  logger.info("hooks", "Zotero2Eagle started");
}

async function onMainWindowLoad(_win: _ZoteroTypes.MainWindow): Promise<void> {
  addon.data.ztoolkit = createZToolkit();
}

async function onMainWindowUnload(_win: Window): Promise<void> {}

function onShutdown(): void {
  addon.data.annotationExport.shutdown();
  if (readerAnnotationMenuRegistered) {
    Zotero.Reader.unregisterEventListener(
      "createAnnotationContextMenu",
      onCreateAnnotationContextMenu,
    );
    readerAnnotationMenuRegistered = false;
  }
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
