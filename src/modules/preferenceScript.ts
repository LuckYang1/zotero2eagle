import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { testEagleConnection } from "../services/eagleClient";

const getRef = () => addon.data.config.addonRef;
const prefId = (suffix: string) => `zotero-prefpane-${getRef()}-${suffix}`;
const buttonId = (suffix: string) => `${getRef()}-${suffix}`;

function getDocument() {
  return addon.data.prefs?.window.document;
}

function getInputElement(id: string) {
  return getDocument()?.getElementById(id) as HTMLInputElement | null;
}

function getStatusElement() {
  return getDocument()?.getElementById(
    buttonId("connection-status"),
  ) as HTMLElement | null;
}

function setStatus(message: string, color: string) {
  const status = getStatusElement();
  if (!status) {
    return;
  }

  status.textContent = message;
  status.style.color = color;
}

async function updatePrefsUI() {
  getInputElement(prefId("auto-import"))!.checked =
    !!getPref("enableAutoImport");
  getInputElement(prefId("api-url"))!.value =
    getPref("eagleApiUrl") || "http://localhost:41595";
  getInputElement(prefId("api-token"))!.value = getPref("eagleApiToken") || "";
  getInputElement(prefId("eagle-folder"))!.value =
    getPref("eagleFolderId") || "";

  // Image manager settings
  getInputElement(prefId("show-file-size"))!.checked =
    !!getPref("showFileSize");
  getInputElement(prefId("show-modified-time"))!.checked =
    !!getPref("showModifiedTime");

  const sortFieldSelect = getDocument()?.getElementById(
    prefId("sort-field"),
  ) as HTMLSelectElement | null;
  if (sortFieldSelect) {
    sortFieldSelect.value = getPref("defaultSortField") || "dateModified";
  }

  const sortOrderSelect = getDocument()?.getElementById(
    prefId("sort-order"),
  ) as HTMLSelectElement | null;
  if (sortOrderSelect) {
    sortOrderSelect.value = getPref("defaultSortOrder") || "desc";
  }

  const noteOpenModeSelect = getDocument()?.getElementById(
    prefId("note-double-click-open-mode"),
  ) as HTMLSelectElement | null;
  if (noteOpenModeSelect) {
    noteOpenModeSelect.value =
      getPref("noteDoubleClickOpenMode") === "tab" ? "tab" : "window";
  }

  const excludeTextarea = getDocument()?.getElementById(
    prefId("exclude-folders"),
  ) as HTMLTextAreaElement | null;
  if (excludeTextarea) {
    excludeTextarea.value = getPref("excludeFolders") || "";
  }

  getInputElement(prefId("confirm-delete"))!.checked =
    !!getPref("confirmDelete");
}

function bindPrefEvents() {
  getInputElement(prefId("auto-import"))?.addEventListener(
    "change",
    (event: Event) => {
      const checked = (event.target as HTMLInputElement).checked;
      setPref("enableAutoImport", checked);
      setStatus(
        checked
          ? getString("status-auto-enabled")
          : getString("status-auto-disabled"),
        checked ? "#22863a" : "#996800",
      );
    },
  );

  getInputElement(prefId("api-url"))?.addEventListener(
    "input",
    (event: Event) => {
      setPref("eagleApiUrl", (event.target as HTMLInputElement).value);
    },
  );

  getInputElement(prefId("api-token"))?.addEventListener(
    "input",
    (event: Event) => {
      setPref("eagleApiToken", (event.target as HTMLInputElement).value);
    },
  );

  getInputElement(prefId("eagle-folder"))?.addEventListener(
    "input",
    (event: Event) => {
      setPref("eagleFolderId", (event.target as HTMLInputElement).value);
    },
  );

  getDocument()
    ?.getElementById(buttonId("test-connection"))
    ?.addEventListener("click", async () => {
      const button = getDocument()?.getElementById(
        buttonId("test-connection"),
      ) as HTMLButtonElement | null;
      if (button) {
        button.disabled = true;
      }
      setStatus("Testing...", "#57606a");

      const result = await testEagleConnection(
        getInputElement(prefId("api-url"))?.value,
        getInputElement(prefId("api-token"))?.value,
      );

      if (result.success) {
        setStatus(getString("status-connection-success"), "#22863a");
      } else {
        setStatus(
          `${getString("status-connection-failed")} ${result.message}`,
          "#d1242f",
        );
      }

      if (button) {
        button.disabled = false;
      }
    });

  // Image manager settings
  getInputElement(prefId("show-file-size"))?.addEventListener(
    "change",
    (event: Event) => {
      setPref("showFileSize", (event.target as HTMLInputElement).checked);
    },
  );

  getInputElement(prefId("show-modified-time"))?.addEventListener(
    "change",
    (event: Event) => {
      setPref("showModifiedTime", (event.target as HTMLInputElement).checked);
    },
  );

  getDocument()
    ?.getElementById(prefId("sort-field"))
    ?.addEventListener("change", (event: Event) => {
      setPref(
        "defaultSortField",
        (event.target as HTMLSelectElement).value,
      );
    });

  getDocument()
    ?.getElementById(prefId("sort-order"))
    ?.addEventListener("change", (event: Event) => {
      setPref(
        "defaultSortOrder",
        (event.target as HTMLSelectElement).value,
      );
    });

  getDocument()
    ?.getElementById(prefId("note-double-click-open-mode"))
    ?.addEventListener("change", (event: Event) => {
      setPref(
        "noteDoubleClickOpenMode",
        (event.target as HTMLSelectElement).value,
      );
    });

  getDocument()
    ?.getElementById(prefId("exclude-folders"))
    ?.addEventListener("input", (event: Event) => {
      setPref(
        "excludeFolders",
        (event.target as HTMLTextAreaElement).value,
      );
    });

  getInputElement(prefId("confirm-delete"))?.addEventListener(
    "change",
    (event: Event) => {
      setPref("confirmDelete", (event.target as HTMLInputElement).checked);
    },
  );
}

export async function registerPrefsScripts(window: Window) {
  addon.data.prefs = {
    window,
  };

  await updatePrefsUI();
  bindPrefEvents();
}
