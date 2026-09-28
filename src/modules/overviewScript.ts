import { config, version } from "../../package.json";
import { getString } from "../utils/locale";
import { getPref, setPref } from "../utils/prefs";
import { deleteFigureAnnotation } from "./annotation-deletion";
import {
  readTrashEntries,
  reconcileTrashEntries,
  recordIdentity,
  writeTrashEntries,
  type TrashEntry,
} from "./image-manager-trash";
import {
  pruneSelection,
  selectedVisibleRecords,
} from "./image-manager-selection";
import { deleteRecordBatch } from "./image-manager-operations";
import {
  createCollapsedCollectionTreeState,
  expandAllCollectionNodes,
  getDescendantKeys,
  sortCollectionTreeNodes,
  type CollectionTreeNode,
  type CollectionTreeSection,
  type CollectionTreeState,
} from "./collection-tree";
import {
  collectFigureAnnotations,
  type FigureAnnotationRecord,
} from "./figure-annotations";
import {
  COLLECTION_KEY_PREFIX,
  UNCATEGORIZED_COLLECTION_KEY,
  clampThumbnailSize,
  createDefaultOverviewFilters,
  getAvailableColors,
  matchesFigureFilenameSearch,
  recordMatchesOverviewFilters,
  recordMatchesSingleCollection,
  setThumbnailSizeStyle,
  type OverviewFilters,
} from "./overview-filters";
import { openFigureInReader } from "./reader-navigation";
import { closeImagePreview, showImagePreview } from "./image-preview";
import { NoteManager } from "./note-manager";
import { initImageSortControls } from "./image-sort-controls";

const XHTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
const INITIAL_EAGER_IMAGE_COUNT = 24;
const LAZY_IMAGE_ROOT_MARGIN = "640px 0px";
const LAZY_IMAGE_FALLBACK_BATCH_SIZE = 6;
const LAZY_IMAGE_FALLBACK_DELAY_MS = 48;

class OverviewController {
  private records: FigureAnnotationRecord[] = [];
  private filters: OverviewFilters = createDefaultOverviewFilters([]);
  private sections: CollectionTreeSection[] = [];
  private collectionTreeState: CollectionTreeState =
    createCollapsedCollectionTreeState();
  private collapsedLibraryKeys = new Set<string>();
  private activeCollectionKey: string | null = null;
  private multiCollectionMode = false;
  private imageObserver: IntersectionObserver | null = null;
  private lazyImageQueue: HTMLImageElement[] = [];
  private lazyImageQueueTimer: number | null = null;
  private reloadVersion = 0;
  private trashEntries: TrashEntry[] = readTrashEntries();
  private selected = new Set<string>();
  private view: "library" | "trash" = "library";
  private busy = false;
  private searchQuery = "";
  private sort = {
    field: getPref("defaultSortField") || "dateModified",
    order: getPref("defaultSortOrder") || "desc",
  };
  private sortControls?: ReturnType<typeof initImageSortControls>;
  private previewClickTimer: number | null = null;

  constructor(private readonly win: Window) {}

  async init() {
    this.getElement<HTMLInputElement>(
      "zotero2eagle-image-manager-search",
    ).placeholder = getString("overview-search-pdf");
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-library",
    ).addEventListener("click", () => this.switchView("library"));
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-trash",
    ).addEventListener("click", () => this.switchView("trash"));
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-select-all",
    ).addEventListener("click", () => {
      const visibleIds = this.getVisibleRecords().map(recordIdentity);
      const allSelected = visibleIds.every((id) => this.selected.has(id));
      this.selected = allSelected ? new Set() : new Set(visibleIds);
      this.render();
    });
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-save",
    ).addEventListener(
      "click",
      () => void this.saveRecords(this.getSelectedRecords()),
    );
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-move-trash",
    ).addEventListener("click", () =>
      this.moveToTrash(this.getSelectedRecords()),
    );
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-restore",
    ).addEventListener("click", () =>
      this.restoreRecords(this.getSelectedRecords()),
    );
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-delete-forever",
    ).addEventListener(
      "click",
      () => void this.deletePermanently(this.getSelectedRecords()),
    );
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-empty-trash",
    ).addEventListener(
      "click",
      () => void this.deletePermanently(this.getViewRecords()),
    );
    this.win.document.addEventListener("click", () => {
      this.hideContextMenu();
      this.sortControls?.hideMenu();
    });
    this.win.document.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") {
        this.hideContextMenu();
        this.sortControls?.hideMenu();
      }
    });
    this.getRefreshButton().addEventListener("click", () => {
      void this.reload({ forceRefresh: true });
    });
    this.getElement<HTMLInputElement>(
      "zotero2eagle-image-manager-search",
    ).addEventListener("input", (event) => {
      this.searchQuery = (event.target as HTMLInputElement).value;
      this.render();
    });
    this.sortControls = initImageSortControls(
      this.win.document,
      "zotero2eagle-image-manager",
      this.sort,
      () => this.render(),
    );
    this.getSizeInput().addEventListener("input", () => {
      this.filters.thumbnailSize = clampThumbnailSize(
        Number(this.getSizeInput().value),
      );
      setPref("thumbnailSize", this.filters.thumbnailSize);
      this.render();
    });
    this.getExpandAllButton().addEventListener("click", () => {
      this.collapsedLibraryKeys.clear();
      this.collectionTreeState = expandAllCollectionNodes(this.sections);
      this.renderCollections();
    });
    this.getCollapseAllButton().addEventListener("click", () => {
      this.collapsedLibraryKeys = new Set(
        this.sections
          .filter((section) => section.label.trim())
          .map((section) => section.key),
      );
      this.collectionTreeState = createCollapsedCollectionTreeState();
      this.renderCollections();
    });
    this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-multi-collections",
    ).addEventListener("click", () => this.toggleMultiCollectionMode());
    await this.reload();
  }

  teardown() {
    closeImagePreview(this.win);
    this.sortControls?.hideMenu();
    if (this.previewClickTimer !== null)
      this.win.clearTimeout(this.previewClickTimer);
    this.hideContextMenu();
    this.resetLazyImageLoading();
    this.getGrid().replaceChildren();
  }

  private async reload(options: { forceRefresh?: boolean } = {}) {
    const reloadVersion = ++this.reloadVersion;
    this.getStatus().textContent = getString("overview-loading");
    const refreshBtn = this.getRefreshButton();
    refreshBtn.classList.add("is-loading");
    try {
      const records = await collectFigureAnnotations(options);
      if (reloadVersion !== this.reloadVersion) {
        return;
      }
      this.records = records;
      const reconciled = reconcileTrashEntries(this.trashEntries, records);
      if (reconciled.length !== this.trashEntries.length) {
        this.trashEntries = reconciled;
        writeTrashEntries(reconciled);
      }
      this.sections = getCollectionTreeSections(this.records);
      this.activeCollectionKey = this.sections[0]?.key ?? null;
      this.multiCollectionMode = false;
      this.collapsedLibraryKeys.clear();
      this.collectionTreeState = createCollapsedCollectionTreeState();
      this.filters = createDefaultOverviewFilters(this.records);
      this.filters.thumbnailSize = clampThumbnailSize(getPref("thumbnailSize"));
      for (const key of getAllCollectionKeys(this.sections)) {
        this.filters.selectedCollectionKeys.add(key);
      }
      this.getSizeInput().value = String(this.filters.thumbnailSize);
      this.render();
    } catch (error) {
      if (reloadVersion !== this.reloadVersion) {
        return;
      }
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.records = [];
      this.sections = [];
      this.filters = createDefaultOverviewFilters([]);
      this.getCollections().replaceChildren();
      this.getColors().replaceChildren();
      this.getGrid().replaceChildren();
      this.getCount().textContent = "";
      this.getStatus().textContent = getString("overview-load-failed");
    } finally {
      if (reloadVersion === this.reloadVersion) {
        refreshBtn.classList.remove("is-loading");
      }
    }
  }

  private render() {
    this.hideContextMenu();
    const visibleRecords = this.getVisibleRecords();
    this.selected = pruneSelection(this.selected, visibleRecords);

    setThumbnailSizeStyle(this.getGrid(), this.filters.thumbnailSize);
    this.renderColors();
    this.renderCollections();
    this.renderCards(visibleRecords);
    this.getStatus().textContent = visibleRecords.length
      ? ""
      : getString(
          this.view === "trash" ? "overview-trash-empty" : "overview-empty",
        );
    this.getCount().textContent = getString("overview-count", {
      args: {
        shown: visibleRecords.length,
        total: this.getViewRecords().length,
      },
    });
    this.updateActions();
  }

  private switchView(view: "library" | "trash") {
    if (this.view === view) return;
    this.view = view;
    this.selected.clear();
    this.render();
  }

  private getViewRecords() {
    const trashed = new Set(this.trashEntries.map(recordIdentity));
    return this.records.filter(
      (record) =>
        trashed.has(recordIdentity(record)) === (this.view === "trash"),
    );
  }

  private getVisibleRecords() {
    let records = this.getViewRecords().filter(
      (record) =>
        this.filters.selectedColors.has(record.color) &&
        (this.multiCollectionMode
          ? recordMatchesOverviewFilters(record, this.filters)
          : recordMatchesSingleCollection(record, this.activeCollectionKey)) &&
        matchesFigureFilenameSearch(record, this.searchQuery),
    );

    const excludeStr = getPref("excludeFolders") as string | undefined;
    if (excludeStr) {
      const excludes = excludeStr.split('\n').map(s => s.trim()).filter(Boolean);
      if (excludes.length > 0) {
        records = records.filter(record => {
          if (!record.filePath) return true;
          return !excludes.some(ex => record.filePath!.includes(ex));
        });
      }
    }

    records.sort((a, b) => {
      let cmp: number;
      switch (this.sort.field) {
        case "dateAdded":
          cmp = (a.dateAdded || "").localeCompare(b.dateAdded || "");
          break;
        case "title":
          cmp = (a.topLevelTitle || "").localeCompare(b.topLevelTitle || "");
          break;
        case "color":
          cmp = (a.color || "").localeCompare(b.color || "");
          break;
        case "dateModified":
        default:
          cmp = (a.dateModified || "").localeCompare(b.dateModified || "");
          break;
      }
      if (cmp === 0) {
        cmp = a.key.localeCompare(b.key);
      }
      return this.sort.order === "asc" ? cmp : -cmp;
    });

    return records;
  }

  private getSelectedRecords() {
    return selectedVisibleRecords(this.selected, this.getVisibleRecords());
  }

  private updateActions() {
    const count = this.selected.size;
    const inTrash = this.view === "trash";
    for (const id of ["library", "trash"] as const) {
      this.getElement<HTMLButtonElement>(
        `zotero2eagle-image-manager-${id}`,
      ).classList.toggle("is-active", this.view === id);
    }
    const button = (name: string) =>
      this.getElement<HTMLButtonElement>(`zotero2eagle-image-manager-${name}`);
    button("save").hidden = inTrash;
    button("move-trash").hidden = inTrash;
    button("restore").hidden = !inTrash;
    button("delete-forever").hidden = !inTrash;
    button("empty-trash").hidden = !inTrash;
    button("save").disabled = this.busy || !count;
    button("move-trash").disabled = this.busy || !count;
    button("restore").disabled = this.busy || !count;
    button("delete-forever").disabled = this.busy || !count;
    button("empty-trash").disabled = this.busy || !this.getViewRecords().length;
    const visibleRecords = this.getVisibleRecords();
    const allSelected =
      visibleRecords.length > 0 &&
      visibleRecords.every((record) => this.selected.has(recordIdentity(record)));
    const selectAllButton = button("select-all");
    selectAllButton.disabled = this.busy || !visibleRecords.length;
    selectAllButton.setAttribute("aria-pressed", String(allSelected));
    const selectAllLabel = getString(
      allSelected
        ? "overview-deselect-visible-icon"
        : "overview-select-visible-icon",
    );
    selectAllButton.setAttribute("aria-label", selectAllLabel);
    this.getElement<HTMLElement>(
      "zotero2eagle-image-manager-select-all-tooltip",
    ).textContent = selectAllLabel;
    this.getElement<HTMLElement>(
      "zotero2eagle-image-manager-selected-count",
    ).textContent = getString("overview-selected-count", { args: { count } });
  }

  private moveToTrash(records: FigureAnnotationRecord[]) {
    if (this.busy || !records.length) return;
    const existing = new Set(this.trashEntries.map(recordIdentity));
    for (const record of records) {
      const identity = recordIdentity(record);
      if (!existing.has(identity)) {
        this.trashEntries.push({
          libraryID: record.libraryID,
          key: record.key,
          deletedAt: Date.now(),
        });
        existing.add(identity);
      }
    }
    writeTrashEntries(this.trashEntries);
    this.selected.clear();
    this.render();
  }

  private restoreRecords(records: FigureAnnotationRecord[]) {
    if (this.busy || !records.length) return;
    const restored = new Set(records.map(recordIdentity));
    this.trashEntries = this.trashEntries.filter(
      (entry) => !restored.has(recordIdentity(entry)),
    );
    writeTrashEntries(this.trashEntries);
    this.selected.clear();
    this.render();
  }

  private async saveRecords(records: FigureAnnotationRecord[]) {
    if (this.busy || !records.length) return;
    this.busy = true;
    this.updateActions();
    try {
      const results = await addon.data.annotationExport.exportAnnotationIDs(
        records.map((record) => record.id),
      );
      const successful = results.filter((result) => result.success).length;
      this.getStatus().textContent = getString("overview-save-result", {
        args: { successful, total: results.length },
      });
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.getStatus().textContent = getString("overview-save-failed");
    } finally {
      this.busy = false;
      this.updateActions();
    }
  }

  private async deletePermanently(records: FigureAnnotationRecord[]) {
    if (this.busy || !records.length) return;
    if (
      getPref("confirmDelete") &&
      !this.win.confirm(
        getString("overview-delete-confirm", {
          args: { count: records.length },
        }),
      )
    )
      return;
    this.busy = true;
    this.updateActions();
    const { deleted, failed, cleanupFailed } = await deleteRecordBatch(
      records,
      (record) => deleteFigureAnnotation(record),
      (error) =>
        Zotero.logError(
          error instanceof Error ? error : new Error(String(error)),
        ),
    );
    this.trashEntries = this.trashEntries.filter(
      (entry) => !deleted.has(recordIdentity(entry)),
    );
    writeTrashEntries(this.trashEntries);
    this.records = this.records.filter(
      (record) => !deleted.has(recordIdentity(record)),
    );
    this.sections = getCollectionTreeSections(this.records);
    this.selected.clear();
    this.reloadVersion += 1;
    this.busy = false;
    this.render();
    this.getStatus().textContent = getString("overview-delete-result", {
      args: {
        successful: deleted.size,
        failed,
        cleanupFailed,
      },
    });
  }

  private renderColors() {
    const container = this.getColors();
    container.replaceChildren();
    const availableColors = getAvailableColors(this.records);
    const isFiltered =
      availableColors.length > 0 &&
      this.filters.selectedColors.size < availableColors.length;

    for (const color of availableColors) {
      const chip = createHTMLElement(this.win, "button");
      chip.className = "figure-color-chip";
      chip.type = "button";
      chip.style.setProperty("--chip-color", color);

      const isSelected = this.filters.selectedColors.has(color);
      const pressed = isFiltered && isSelected;
      chip.setAttribute("aria-pressed", String(pressed));

      if (isFiltered) {
        chip.classList.toggle("is-active", isSelected);
        chip.classList.toggle("is-dimmed", !isSelected);
      }

      chip.setAttribute("title", color);
      chip.addEventListener("click", (event: MouseEvent) => {
        if (!isFiltered) {
          this.filters.selectedColors = new Set([color]);
        } else if (event.ctrlKey || event.metaKey) {
          toggleSetValue(this.filters.selectedColors, color);
          if (
            this.filters.selectedColors.size === 0 ||
            this.filters.selectedColors.size === availableColors.length
          ) {
            this.filters.selectedColors = new Set(availableColors);
          }
        } else {
          if (
            this.filters.selectedColors.size === 1 &&
            this.filters.selectedColors.has(color)
          ) {
            this.filters.selectedColors = new Set(availableColors);
          } else {
            this.filters.selectedColors = new Set([color]);
          }
        }
        this.render();
      });
      container.append(chip);
    }
  }

  private renderCollections() {
    const container = this.getCollections();
    const multiButton = this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-multi-collections",
    );
    multiButton.textContent = getString(
      this.multiCollectionMode
        ? "overview-multi-collections-close"
        : "overview-multi-collections",
    );
    multiButton.classList.toggle("is-active", this.multiCollectionMode);
    multiButton.setAttribute("aria-pressed", String(this.multiCollectionMode));
    container.setAttribute("aria-multiselectable", String(this.multiCollectionMode));
    container.replaceChildren();
    for (const section of this.sections) {
      const sectionElement = createHTMLElement(this.win, "section");
      if (section.label.trim()) {
        const row = createHTMLElement(this.win, "div");
        row.className = "figure-collection-node figure-library-node";
        row.classList.toggle(
          "is-active",
          !this.multiCollectionMode && this.activeCollectionKey === section.key,
        );
        row.setAttribute("role", "treeitem");
        row.setAttribute("aria-selected", String(row.classList.contains("is-active")));
        row.tabIndex = 0;

        const disclosure = createHTMLElement(this.win, "button");
        disclosure.className = "figure-disclosure";
        disclosure.type = "button";
        disclosure.disabled = !section.children.length;
        const collapsed = this.collapsedLibraryKeys.has(section.key);
        disclosure.textContent = collapsed ? "▸" : "▾";
        disclosure.setAttribute("aria-expanded", String(!collapsed));
        disclosure.addEventListener("click", (event) => {
          event.stopPropagation();
          if (collapsed) {
            this.collapsedLibraryKeys.delete(section.key);
          } else {
            this.collapsedLibraryKeys.add(section.key);
          }
          this.renderCollections();
        });
        const icon = createHTMLElement(this.win, "span");
        icon.className = "figure-collection-icon figure-collection-icon-library";
        const label = createHTMLElement(this.win, "span");
        label.className = "figure-collection-label";
        label.textContent = section.label;
        row.append(disclosure, icon, label);
        const selectLibrary = () => {
          this.multiCollectionMode = false;
          this.activeCollectionKey = section.key;
          this.render();
        };
        row.addEventListener("click", selectLibrary);
        row.addEventListener("keydown", (event) => {
          if (event.target !== row) return;
          if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") {
            event.preventDefault();
            selectLibrary();
          }
        });
        sectionElement.append(row);
      }
      if (!this.collapsedLibraryKeys.has(section.key)) {
        for (const node of section.children) {
          this.appendCollectionNode(sectionElement, node, section.label.trim() ? 1 : 0);
        }
      }
      container.append(sectionElement);
    }
  }

  private toggleMultiCollectionMode() {
    if (this.multiCollectionMode) {
      this.multiCollectionMode = false;
    } else {
      this.filters.selectedCollectionKeys =
        this.activeCollectionKey?.startsWith(COLLECTION_KEY_PREFIX) ||
        this.activeCollectionKey === UNCATEGORIZED_COLLECTION_KEY
          ? new Set([this.activeCollectionKey])
          : new Set(getAllCollectionKeys(this.sections));
      this.multiCollectionMode = true;
    }
    this.render();
  }

  private appendCollectionNode(
    container: Element,
    node: CollectionTreeNode,
    depth: number,
  ) {
    const row = createHTMLElement(this.win, "div");
    row.className = "figure-collection-node";
    row.style.setProperty("--depth", String(depth));
    row.classList.toggle(
      "is-active",
      !this.multiCollectionMode && this.activeCollectionKey === node.key,
    );
    row.setAttribute("role", "treeitem");
    row.setAttribute("aria-selected", String(row.classList.contains("is-active")));
    row.tabIndex = 0;

    const toggleMultiSelection = (checked: boolean) => {
      const keys = [node.key, ...getDescendantKeys(node)];
      for (const key of keys) {
        if (checked) {
          this.filters.selectedCollectionKeys.add(key);
        } else {
          this.filters.selectedCollectionKeys.delete(key);
        }
      }
      this.render();
    };

    const label = createHTMLElement(this.win, "span");
    label.className = "figure-collection-label";
    label.textContent = node.label;
    const disclosure = this.createDisclosureButton(node);
    row.append(disclosure);
    if (this.multiCollectionMode) {
      const checkbox = createHTMLElement(this.win, "input");
      checkbox.type = "checkbox";
      checkbox.checked = this.filters.selectedCollectionKeys.has(node.key);
      checkbox.setAttribute("aria-label", node.label);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () =>
        toggleMultiSelection(checkbox.checked),
      );
      row.append(checkbox);
    }
    const icon = createHTMLElement(this.win, "span");
    icon.className = `figure-collection-icon figure-collection-icon-${
      node.key === UNCATEGORIZED_COLLECTION_KEY ? "unfiled" : "folder"
    }`;
    row.append(icon, label);
    const selectNode = () => {
      if (this.multiCollectionMode) {
        toggleMultiSelection(!this.filters.selectedCollectionKeys.has(node.key));
      } else {
        this.activeCollectionKey = node.key;
        this.render();
      }
    };
    row.addEventListener("click", selectNode);
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) return;
      if ((event as KeyboardEvent).key === "Enter" || (event as KeyboardEvent).key === " ") {
        event.preventDefault();
        selectNode();
      }
    });
    container.append(row);

    if (this.collectionTreeState.expandedCollectionKeys.has(node.key)) {
      for (const child of node.children) {
        this.appendCollectionNode(container, child, depth + 1);
      }
    }
  }

  private createDisclosureButton(node: CollectionTreeNode) {
    const button = createHTMLElement(this.win, "button");
    button.className = "figure-disclosure";
    button.type = "button";
    if (!node.children.length) {
      button.disabled = true;
      button.textContent = "";
      return button;
    }

    const expanded = this.collectionTreeState.expandedCollectionKeys.has(
      node.key,
    );
    button.textContent = expanded ? "▾" : "▸";
    button.setAttribute("aria-expanded", String(expanded));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (expanded) {
        this.collectionTreeState.expandedCollectionKeys.delete(node.key);
      } else {
        this.collectionTreeState.expandedCollectionKeys.add(node.key);
      }
      this.renderCollections();
    });
    return button;
  }

  private renderCards(records: FigureAnnotationRecord[]) {
    this.resetLazyImageLoading();
    this.imageObserver = this.createImageObserver();
    const grid = this.getGrid();
    grid.replaceChildren();
    let eagerImageCount = 0;

    for (const record of records) {
      const card = createHTMLElement(this.win, "article");
      card.className = "figure-card";
      card.tabIndex = 0;
      const identity = recordIdentity(record);
      card.classList.toggle("is-selected", this.selected.has(identity));
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        const mouseEvent = event as MouseEvent;
        this.showContextMenu(record, mouseEvent.clientX, mouseEvent.clientY);
      });
      card.addEventListener("dblclick", () => {
        if (this.previewClickTimer !== null)
          this.win.clearTimeout(this.previewClickTimer);
        this.previewClickTimer = null;
        void this.openRecord(record);
      });
      card.addEventListener("keydown", (event) => {
        const keyEvent = event as KeyboardEvent;
        if (keyEvent.key === "Enter") {
          void this.openRecord(record);
        } else if (keyEvent.key === "F10" && keyEvent.shiftKey) {
          keyEvent.preventDefault();
          const rect = card.getBoundingClientRect();
          this.showContextMenu(record, rect.left + 16, rect.top + 16);
        }
      });

      const checkbox = createHTMLElement(this.win, "input");
      checkbox.className = "figure-select-checkbox";
      checkbox.type = "checkbox";
      checkbox.checked = this.selected.has(identity);
      checkbox.setAttribute("aria-label", getString("overview-select-image"));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(identity);
        else this.selected.delete(identity);
        card.classList.toggle("is-selected", checkbox.checked);
        this.updateActions();
      });
      checkbox.addEventListener("click", (event) => {
        event.stopPropagation();
      });
      checkbox.addEventListener("dblclick", (event) => {
        event.stopPropagation();
      });
      checkbox.addEventListener("keydown", (event) => {
        event.stopPropagation();
      });

      const imageWrap = createHTMLElement(this.win, "div");
      const previewHeight = `${getImageWrapHeight(
        this.filters.thumbnailSize,
      )}px`;
      imageWrap.className = "figure-image-wrap";
      imageWrap.style.setProperty("--figure-image-height", previewHeight);
      imageWrap.style.height = previewHeight;
      if (record.imageURI) {
        const image = createHTMLElement(this.win, "img");
        image.draggable = false;
        image.alt = record.topLevelTitle;
        this.configureLazyImage(
          image,
          record.imageURI,
          eagerImageCount < INITIAL_EAGER_IMAGE_COUNT,
        );
        eagerImageCount += 1;
        image.addEventListener("error", () => {
          imageWrap.replaceChildren(this.createMissingImageMessage());
        });
        imageWrap.addEventListener("mouseenter", () => {
          this.loadLazyImage(image);
        });
        imageWrap.addEventListener("click", () => {
          if (this.previewClickTimer !== null)
            this.win.clearTimeout(this.previewClickTimer);
          this.previewClickTimer = this.win.setTimeout(() => {
            this.previewClickTimer = null;
            showImagePreview(this.win, {
              title: record.topLevelTitle,
              imageURI: record.imageURI,
              details: [
                record.attachmentFilename,
                record.pageLabel ? `p. ${record.pageLabel}` : "",
                `Annotation Key: ${record.key}`,
              ].filter(Boolean),
              open: () => void this.openRecord(record),
            });
          }, 250);
        });
        imageWrap.append(image);
      } else {
        imageWrap.append(this.createMissingImageMessage());
      }

      const meta = createHTMLElement(this.win, "div");
      meta.className = "figure-meta";
      const swatch = createHTMLElement(this.win, "div");
      swatch.className = "figure-swatch";
      swatch.style.setProperty("--annotation-color", record.color);
      const title = createHTMLElement(this.win, "div");
      title.className = "figure-title";
      title.textContent = record.topLevelTitle;
      const page = createHTMLElement(this.win, "div");
      page.className = "figure-page";
      page.textContent = record.pageLabel ? `p. ${record.pageLabel}` : "";
      meta.append(swatch, title, page);
      if (record.comment) {
        const comment = createHTMLElement(this.win, "div");
        comment.className = "figure-comment";
        comment.textContent = record.comment;
        meta.append(comment);
      }

      const showSize = getPref("showFileSize");
      const showTime = getPref("showModifiedTime");

      if (showSize || showTime) {
        const infoRow = createHTMLElement(this.win, "div");
        infoRow.className = "figure-file-info";
        infoRow.style.gridColumn = "1 / -1";
        infoRow.style.display = "flex";
        infoRow.style.justifyContent = "space-between";
        infoRow.style.fontSize = "11px";
        infoRow.style.color = "var(--figure-secondary)";
        infoRow.style.marginTop = "2px";

        if (showSize) {
          const sizeSpan = createHTMLElement(this.win, "span");
          sizeSpan.className = "figure-size";
          sizeSpan.textContent = "—";
          if (record.imagePath) {
            try {
              const file = Zotero.File.pathToFile(record.imagePath);
              if (file && file.exists() && file.isFile()) {
                const bytes = file.fileSize;
                if (bytes < 1024) sizeSpan.textContent = bytes + " B";
                else if (bytes < 1024 * 1024) sizeSpan.textContent = (bytes / 1024).toFixed(1) + " KB";
                else sizeSpan.textContent = (bytes / (1024 * 1024)).toFixed(1) + " MB";
              }
            } catch (e) {
              // ignore
            }
          }
          infoRow.append(sizeSpan);
        }

        if (showTime) {
          const timeSpan = createHTMLElement(this.win, "span");
          timeSpan.className = "figure-time";
          if (record.dateModified) {
            const d = new Date(record.dateModified.replace(" ", "T"));
            if (!isNaN(d.getTime())) {
              timeSpan.textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            }
          }
          infoRow.append(timeSpan);
        }

        meta.append(infoRow);
      }

      card.append(imageWrap, meta, checkbox);
      grid.append(card);
    }
  }

  private showContextMenu(
    record: FigureAnnotationRecord,
    x: number,
    y: number,
  ) {
    if (this.busy) return;
    const menu = this.getElement<HTMLElement>(
      "zotero2eagle-image-manager-context-menu",
    );
    menu.replaceChildren();
    const actions =
      this.view === "trash"
        ? [
            {
              label: getString("overview-restore"),
              run: () => this.restoreRecords([record]),
            },
            {
              label: getString("overview-delete-forever"),
              run: () => void this.deletePermanently([record]),
            },
          ]
        : [
            {
              label: getString("overview-save-eagle"),
              run: () => void this.saveRecords([record]),
            },
            {
              label: getString("overview-move-trash"),
              run: () => this.moveToTrash([record]),
            },
          ];
    for (const action of actions) {
      const button = createHTMLElement(this.win, "button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = action.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.hideContextMenu();
        action.run();
      });
      menu.append(button);
    }
    menu.hidden = false;
    menu.style.left = `${Math.max(0, Math.min(x, this.win.innerWidth - 180))}px`;
    menu.style.top = `${Math.max(0, Math.min(y, this.win.innerHeight - 90))}px`;
    menu.querySelector("button")?.focus();
  }

  private hideContextMenu() {
    this.getElement<HTMLElement>(
      "zotero2eagle-image-manager-context-menu",
    ).hidden = true;
  }

  private createMissingImageMessage() {
    const message = createHTMLElement(this.win, "div");
    message.className = "figure-missing";
    message.textContent = getString("overview-image-missing");
    return message;
  }

  private configureLazyImage(
    image: HTMLImageElement,
    source: string,
    loadImmediately: boolean,
  ) {
    image.setAttribute("data-figure-src", source);
    image.setAttribute("loading", "lazy");
    image.setAttribute("decoding", "async");

    if (loadImmediately) {
      this.loadLazyImage(image);
      return;
    }

    if (this.imageObserver) {
      this.imageObserver.observe(image);
      return;
    }

    this.queueLazyImage(image);
  }

  private createImageObserver() {
    const Observer = this.win.IntersectionObserver;
    if (typeof Observer !== "function") {
      return null;
    }

    return new Observer(
      (entries: IntersectionObserverEntry[]) => {
        for (const entry of entries) {
          if (entry.isIntersecting || entry.intersectionRatio > 0) {
            this.loadLazyImage(entry.target as HTMLImageElement);
          }
        }
      },
      {
        root: this.getGridScrollFrame(),
        rootMargin: LAZY_IMAGE_ROOT_MARGIN,
      },
    );
  }

  private loadLazyImage(image: HTMLImageElement) {
    const source = image.getAttribute("data-figure-src");
    if (!source) {
      return;
    }

    image.removeAttribute("data-figure-src");
    this.imageObserver?.unobserve(image);
    image.src = source;
  }

  private queueLazyImage(image: HTMLImageElement) {
    this.lazyImageQueue.push(image);
    this.scheduleLazyImageQueue();
  }

  private scheduleLazyImageQueue() {
    if (this.lazyImageQueueTimer !== null) {
      return;
    }

    this.lazyImageQueueTimer = this.win.setTimeout(() => {
      this.lazyImageQueueTimer = null;
      const batch = this.lazyImageQueue.splice(
        0,
        LAZY_IMAGE_FALLBACK_BATCH_SIZE,
      );
      for (const image of batch) {
        this.loadLazyImage(image);
      }
      if (this.lazyImageQueue.length) {
        this.scheduleLazyImageQueue();
      }
    }, LAZY_IMAGE_FALLBACK_DELAY_MS);
  }

  private resetLazyImageLoading() {
    this.imageObserver?.disconnect();
    this.imageObserver = null;
    this.lazyImageQueue = [];
    if (this.lazyImageQueueTimer !== null) {
      this.win.clearTimeout(this.lazyImageQueueTimer);
      this.lazyImageQueueTimer = null;
    }
  }

  private async openRecord(record: FigureAnnotationRecord) {
    try {
      await openFigureInReader(record);
    } catch (error) {
      Zotero.logError(
        error instanceof Error ? error : new Error(String(error)),
      );
      this.getStatus().textContent = getString("overview-open-failed");
    }
  }

  private getRefreshButton() {
    return this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-refresh",
    );
  }

  private getExpandAllButton() {
    return this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-expand-all",
    );
  }

  private getCollapseAllButton() {
    return this.getElement<HTMLButtonElement>(
      "zotero2eagle-image-manager-collapse-all",
    );
  }

  private getCollections() {
    return this.getElement<HTMLElement>(
      "zotero2eagle-image-manager-collections",
    );
  }

  private getColors() {
    return this.getElement<HTMLElement>("zotero2eagle-image-manager-colors");
  }

  private getSizeInput() {
    return this.getElement<HTMLInputElement>("zotero2eagle-image-manager-size");
  }

  private getCount() {
    return this.getElement<HTMLElement>("zotero2eagle-image-manager-count");
  }

  private getStatus() {
    return this.getElement<HTMLElement>("zotero2eagle-image-manager-status");
  }

  private getGrid() {
    return this.getElement<HTMLElement>("zotero2eagle-image-manager-grid");
  }

  private getGridScrollFrame() {
    return this.getGrid().parentElement;
  }

  private getElement<T extends HTMLElement>(id: string) {
    const element = this.win.document.getElementById(id);
    if (!element) {
      throw new Error(`Missing overview element: ${id}`);
    }
    return element as T;
  }
}

export async function initializeOverviewWindow(win: Window) {
  win.document.documentElement?.setAttribute(
    "title",
    `${config.addonName} 图片管理器 v${version}`,
  );
  const controller = new OverviewController(win);
  const noteManager = new NoteManager(win);
  (
    win as Window & {
      __figureOverviewController?: OverviewController;
      __noteManager?: NoteManager;
    }
  ).__figureOverviewController = controller;
  (win as Window & { __noteManager?: NoteManager }).__noteManager = noteManager;
  const figureTab = win.document.getElementById("zotero2eagle-tab-figures")!;
  const noteTab = win.document.getElementById("zotero2eagle-tab-notes")!;
  const figureRoot = win.document.getElementById(
    "zotero2eagle-image-manager-root",
  ) as HTMLElement;
  const noteRoot = win.document.getElementById(
    "zotero2eagle-note-manager-root",
  ) as HTMLElement;
  const activateTab = (active: "figures" | "notes") => {
    const figuresActive = active === "figures";
    figureRoot.hidden = !figuresActive;
    noteRoot.hidden = figuresActive;
    figureRoot.classList.toggle("is-active", figuresActive);
    noteRoot.classList.toggle("is-active", !figuresActive);
    figureTab.classList.toggle("is-active", figuresActive);
    noteTab.classList.toggle("is-active", !figuresActive);
    figureTab.setAttribute("aria-selected", String(figuresActive));
    noteTab.setAttribute("aria-selected", String(!figuresActive));
    closeImagePreview(win);
  };
  const showFigures = () => activateTab("figures");
  const showNotes = () => {
    activateTab("notes");
    void noteManager.init();
  };
  const bindTab = (tab: Element, activate: () => void) => {
    tab.addEventListener("mousedown", (event: Event) => {
      if ((event as MouseEvent).button === 0) activate();
    });
    tab.addEventListener("click", activate);
    tab.addEventListener("keydown", (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
        keyboardEvent.preventDefault();
        activate();
      }
    });
  };
  bindTab(figureTab, showFigures);
  bindTab(noteTab, showNotes);
  await controller.init();
}

export function teardownOverviewWindow(win: Window) {
  const state = win as Window & {
    __figureOverviewController?: OverviewController;
    __noteManager?: NoteManager;
  };
  state.__figureOverviewController?.teardown();
  state.__noteManager?.teardown();
  delete state.__figureOverviewController;
  delete state.__noteManager;
}

function getCollectionTreeSections(records: FigureAnnotationRecord[]) {
  const sections: CollectionTreeSection[] = [];
  for (const library of Zotero.Libraries.getAll()) {
    if (library.libraryType === "feed") {
      continue;
    }
    const roots = sortCollectionTreeNodes(
      Zotero.Collections.getByLibrary(library.id, false).map((collection) =>
        buildCollectionNode(collection),
      ),
    );
    sections.push({
      key: `library:${library.id}`,
      label: library.name,
      children: roots,
    });
  }

  if (records.some((record) => !record.collectionIDs.length)) {
    sections.push({
      key: "special",
      label: "",
      children: [
        {
          key: UNCATEGORIZED_COLLECTION_KEY,
          label: getString("overview-uncategorized"),
          children: [],
        },
      ],
    });
  }

  return sections;
}

function buildCollectionNode(
  collection: Zotero.Collection,
): CollectionTreeNode {
  return {
    key: `${COLLECTION_KEY_PREFIX}${collection.id}`,
    label: collection.name,
    children: sortCollectionTreeNodes(
      collection
        .getChildCollections(false, false)
        .map((child) => buildCollectionNode(child)),
    ),
  };
}

function getAllCollectionKeys(sections: CollectionTreeSection[]) {
  return sections.flatMap((section) =>
    section.children.flatMap((node) => [node.key, ...getDescendantKeys(node)]),
  );
}

function toggleSetValue(set: Set<string>, value: string) {
  if (set.has(value)) {
    set.delete(value);
  } else {
    set.add(value);
  }
}

function createHTMLElement<K extends keyof HTMLElementTagNameMap>(
  win: Window,
  tagName: K,
) {
  return win.document.createElementNS(
    XHTML_NAMESPACE,
    tagName,
  ) as HTMLElementTagNameMap[K];
}

function getImageWrapHeight(thumbnailSize: number) {
  return Math.round(thumbnailSize * 0.72);
}
