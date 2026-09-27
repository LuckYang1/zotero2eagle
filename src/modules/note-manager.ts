import { getString } from "../utils/locale";
import { exportNoteImages } from "../services/noteImageExport";
import {
  collectNoteImages,
  deleteNoteImageBatch,
  filterNoteImages,
  scanNoteReferences,
  type NoteImageRecord,
  type NoteReference,
} from "./note-images";
import { readNoteTrashEntries, reconcileTrashEntries, recordIdentity, writeNoteTrashEntries, type TrashEntry } from "./image-manager-trash";
import { showImagePreview } from "./image-preview";
import { getPref } from "../utils/prefs";

const NS = "http://www.w3.org/1999/xhtml";
type ReferenceFilter = "all" | "referenced" | "unreferenced";
type DropdownName = "collection" | "reference-filter";
type DropdownOption = { value: string; label: string };

export class NoteManager {
  private records: NoteImageRecord[] = [];
  private trash: TrashEntry[] = readNoteTrashEntries();
  private selected = new Set<string>();
  private references: Map<string, NoteReference[]> | null = null;
  private view: "library" | "trash" = "library";
  private query = "";
  private collection = "all";
  private collectionOptions: DropdownOption[] = [];
  private referenceFilter: ReferenceFilter = "all";
  private referenceOptions: DropdownOption[] = [];
  private busy = false;
  private loadVersion = 0;
  private initialized = false;
  private previewClickTimer: number | null = null;

  constructor(private readonly win: Window) {}

  async init() {
    if (this.initialized) return;
    this.initialized = true;
    this.input("search").placeholder = getString("overview-search-note");
    this.referenceOptions = (
      [
        ["all", "note-filter-all"],
        ["referenced", "note-filter-referenced"],
        ["unreferenced", "note-filter-unreferenced"],
      ] as const
    ).map(([value, label]) => ({ value, label: getString(label) }));
    this.initFilterDropdown("collection");
    this.initFilterDropdown("reference-filter");
    this.renderFilterDropdown("reference-filter");
    this.button("refresh").addEventListener("click", () => void this.reload());
    this.button("library").addEventListener("click", () =>
      this.switchView("library"),
    );
    this.button("trash").addEventListener("click", () =>
      this.switchView("trash"),
    );
    this.button("scan").addEventListener("click", () => void this.scan());
    this.button("select-all").addEventListener("click", () => {
      this.selected = new Set(this.visible().map(recordIdentity));
      this.render();
    });
    this.button("save").addEventListener(
      "click",
      () => void this.save(this.selectedRecords()),
    );
    this.button("move-trash").addEventListener("click", () =>
      this.moveToTrash(this.selectedRecords()),
    );
    this.button("restore").addEventListener("click", () =>
      this.restore(this.selectedRecords()),
    );
    this.button("delete-forever").addEventListener(
      "click",
      () => void this.deletePermanently(this.selectedRecords()),
    );
    this.button("empty-trash").addEventListener(
      "click",
      () => void this.deletePermanently(this.viewRecords()),
    );
    this.input("search").addEventListener("input", () => {
      this.query = this.input("search").value;
      this.render();
    });
    this.win.document.addEventListener("click", () => this.hideMenu());
    this.win.document.addEventListener("click", (event) => {
      const target = event.target as Node;
      for (const name of ["collection", "reference-filter"] as const) {
        if (!this.element(`${name}-trigger`).parentElement?.contains(target))
          this.closeFilterDropdown(name);
      }
    });
    this.win.document.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") this.hideMenu();
    });
    await this.reload();
  }

  teardown() {
    if (this.previewClickTimer !== null)
      this.win.clearTimeout(this.previewClickTimer);
    this.loadVersion += 1;
    this.hideMenu();
    this.closeFilterDropdown("collection");
    this.closeFilterDropdown("reference-filter");
    this.element("grid").replaceChildren();
  }

  private async reload() {
    if (this.busy) return;
    const version = ++this.loadVersion;
    this.busy = true;
    this.references = null;
    this.status(getString("note-loading"));
    this.updateActions();
    this.button("refresh").classList.add("is-loading");
    try {
      const records = await collectNoteImages();
      if (version !== this.loadVersion) return;
      this.records = records;
      const reconciled = reconcileTrashEntries(this.trash, records);
      if (reconciled.length !== this.trash.length) {
        this.trash = reconciled;
        writeNoteTrashEntries(reconciled);
      }
      this.renderCollections();
      this.render();
      this.status("");
    } catch (error) {
      this.log(error);
      this.status(getString("note-load-failed"));
    } finally {
      if (version === this.loadVersion) {
        this.busy = false;
        this.button("refresh").classList.remove("is-loading");
        this.updateActions();
      }
    }
  }

  private async scan() {
    if (this.busy) return;
    this.busy = true;
    this.references = null;
    this.render();
    this.updateActions();
    try {
      const result = await scanNoteReferences((checked, total) => {
        this.element("scan-status").textContent = getString(
          "note-scan-progress",
          {
            args: { checked, total },
          },
        );
      });
      this.references = result.references;
      const unreferenced = this.records.filter(
        (record) =>
          !(result.references.get(recordIdentity(record))?.length ?? 0),
      ).length;
      this.element("scan-status").textContent = getString("note-scan-result", {
        args: { checked: result.checked, unreferenced },
      });
      this.render();
    } catch (error) {
      this.log(error);
      this.references = null;
      this.render();
      this.element("scan-status").textContent = getString("note-scan-failed", {
        args: { reason: this.errorMessage(error) },
      });
    } finally {
      this.busy = false;
      this.updateActions();
    }
  }

  private renderCollections() {
    const options: DropdownOption[] = [
      { value: "all", label: getString("note-filter-all") },
    ];
    const ids = new Set(this.records.flatMap((record) => record.collectionIDs));
    for (const id of ids) {
      const collection = Zotero.Collections.get(id);
      if (!collection) continue;
      const library = Zotero.Libraries.get(collection.libraryID);
      options.push({
        value: `collection:${id}`,
        label: `${library ? library.name : "Zotero"} / ${collection.name}`,
      });
    }
    if (this.records.some((record) => !record.collectionIDs.length)) {
      options.push({
        value: "uncategorized",
        label: getString("overview-uncategorized"),
      });
    }
    this.collectionOptions = options;
    if (!options.some((option) => option.value === this.collection))
      this.collection = "all";
    this.renderFilterDropdown("collection");
  }

  private initFilterDropdown(name: DropdownName) {
    const trigger = this.button(`${name}-trigger`);
    const menu = this.element(`${name}-menu`);
    trigger.addEventListener("click", () => {
      if (!menu.hidden) {
        this.closeFilterDropdown(name);
        return;
      }
      for (const other of ["collection", "reference-filter"] as const)
        this.closeFilterDropdown(other);
      menu.hidden = false;
      trigger.parentElement?.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
    });
    trigger.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (
        keyboardEvent.key === "ArrowDown" ||
        keyboardEvent.key === "ArrowUp"
      ) {
        event.preventDefault();
        if (menu.hidden) trigger.click();
        const options = this.dropdownOptions(name);
        const selected = options.find(
          (option) => option.getAttribute("aria-selected") === "true",
        );
        (
          selected ??
          options[keyboardEvent.key === "ArrowDown" ? 0 : options.length - 1]
        )?.focus();
      } else if (keyboardEvent.key === "Escape") {
        this.closeFilterDropdown(name);
      }
    });
    menu.addEventListener("keydown", (event) => {
      const keyboardEvent = event as KeyboardEvent;
      const options = this.dropdownOptions(name);
      if (!options.length) return;
      const current = options.indexOf(
        this.win.document.activeElement as HTMLElement,
      );
      let next: number;
      if (keyboardEvent.key === "ArrowDown")
        next = (current + 1) % options.length;
      else if (keyboardEvent.key === "ArrowUp")
        next =
          current < 0
            ? options.length - 1
            : (current - 1 + options.length) % options.length;
      else if (keyboardEvent.key === "Home") next = 0;
      else if (keyboardEvent.key === "End") next = options.length - 1;
      else if (keyboardEvent.key === "Escape") {
        event.preventDefault();
        this.closeFilterDropdown(name);
        trigger.focus();
        return;
      } else return;
      event.preventDefault();
      options[next]?.focus();
    });
  }

  private dropdownOptions(name: DropdownName) {
    return Array.from(
      this.element(`${name}-menu`).querySelectorAll<HTMLElement>(
        '[role="option"]',
      ),
    ) as HTMLElement[];
  }

  private renderFilterDropdown(name: DropdownName) {
    const trigger = this.button(`${name}-trigger`);
    const menu = this.element(`${name}-menu`);
    const options =
      name === "collection" ? this.collectionOptions : this.referenceOptions;
    const value =
      name === "collection" ? this.collection : this.referenceFilter;
    const selected = options.find((option) => option.value === value);
    trigger.textContent = selected?.label || getString("note-filter-all");
    menu.replaceChildren();
    for (const option of options) {
      const item = this.create("button") as HTMLButtonElement;
      item.type = "button";
      item.className = "figure-dropdown-option";
      item.style.display = "block";
      item.style.width = "100%";
      item.style.textAlign = "left";
      item.dataset.value = option.value;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(option.value === value));
      item.tabIndex = -1;
      item.textContent = option.label;
      item.title = option.label;
      item.addEventListener("click", () => {
        if (name === "collection") {
          this.collection = option.value;
        } else {
          this.referenceFilter = option.value as ReferenceFilter;
        }
        this.renderFilterDropdown(name);
        this.render();
        if (
          name === "reference-filter" &&
          this.referenceFilter !== "all" &&
          !this.references
        )
          void this.scan();
        this.closeFilterDropdown(name);
        trigger.focus();
      });
      menu.append(item);
    }
  }

  private closeFilterDropdown(name: DropdownName) {
    const trigger = this.button(`${name}-trigger`);
    this.element(`${name}-menu`).hidden = true;
    trigger.parentElement?.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
  }

  private switchView(view: "library" | "trash") {
    this.view = view;
    this.selected.clear();
    this.render();
  }

  private viewRecords() {
    const trashed = new Set(this.trash.map(recordIdentity));
    return this.records.filter(
      (record) =>
        trashed.has(recordIdentity(record)) === (this.view === "trash"),
    );
  }

  private visible() {
    const collectionKeys =
      this.collection === "all"
        ? new Set([
            "uncategorized",
            ...this.records.flatMap((record) =>
              record.collectionIDs.map((id) => `collection:${id}`),
            ),
          ])
        : new Set([this.collection]);
    
    let filtered = filterNoteImages(this.viewRecords(), {
      query: this.query,
      collectionKeys,
      referenceFilter: this.referenceFilter,
      references: this.references,
    });

    const excludeStr = getPref("excludeFolders") as string | undefined;
    if (excludeStr) {
      const excludes = excludeStr.split('\n').map(s => s.trim()).filter(Boolean);
      if (excludes.length > 0) {
        filtered = filtered.filter(record => {
          if (!record.filePath) return true;
          return !excludes.some(ex => record.filePath!.includes(ex));
        });
      }
    }

    const sortField = getPref("defaultSortField") || "dateModified";
    const sortOrder = getPref("defaultSortOrder") || "desc";

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = (a.noteTitle || "").localeCompare(b.noteTitle || "");
          break;
        case "dateAdded":
        case "color":
        case "dateModified":
        default:
          cmp = 0; // Note manager doesn't track dates/colors, fallback to stable
          break;
      }
      if (cmp === 0) {
        cmp = a.key.localeCompare(b.key);
      }
      return sortOrder === "asc" ? cmp : -cmp;
    });

    return filtered;
  }

  private selectedRecords() {
    return this.visible().filter((record) =>
      this.selected.has(recordIdentity(record)),
    );
  }

  private render() {
    const visible = this.visible();
    const live = new Set(visible.map(recordIdentity));
    this.selected = new Set([...this.selected].filter((key) => live.has(key)));
    this.renderCards(visible);
    this.element("count").textContent = getString("overview-count", {
      args: { shown: visible.length, total: this.viewRecords().length },
    });
    this.updateActions();
  }

  private renderCards(records: NoteImageRecord[]) {
    const grid = this.element("grid");
    grid.replaceChildren();
    for (const record of records) {
      const identity = recordIdentity(record);
      const card = this.create("article");
      card.className = "figure-card";
      card.tabIndex = 0;
      card.classList.toggle("is-selected", this.selected.has(identity));
      card.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.showMenu(
          record,
          (event as MouseEvent).clientX,
          (event as MouseEvent).clientY,
        );
      });
      card.addEventListener("dblclick", () => {
        if (this.previewClickTimer !== null)
          this.win.clearTimeout(this.previewClickTimer);
        this.previewClickTimer = null;
        this.openNote(record.noteID);
      });
      card.addEventListener("keydown", (event) => {
        if ((event as KeyboardEvent).key === "Enter")
          this.openNote(record.noteID);
      });
      const imageArea = this.create("div");
      imageArea.className = "figure-image-wrap";
      imageArea.addEventListener("click", () => {
        if (this.previewClickTimer !== null)
          this.win.clearTimeout(this.previewClickTimer);
        this.previewClickTimer = this.win.setTimeout(() => {
          this.previewClickTimer = null;
          this.preview(record);
        }, 250);
      });
      if (record.imageURI) {
        const image = this.create("img") as HTMLImageElement;
        image.src = record.imageURI;
        image.alt = record.filename;
        image.loading = "lazy";
        imageArea.append(image);
      } else {
        imageArea.textContent = getString("overview-image-missing");
      }
      const badge = this.create("span");
      badge.className = "figure-ref-badge";
      badge.style.backgroundColor = "#49b357";
      badge.style.color = "#fff";
      const count = this.references?.get(identity)?.length ?? 0;
      badge.textContent = !this.references
        ? getString("note-unchecked")
        : count
          ? getString("note-reference-count", { args: { count } })
          : getString("note-unreferenced");
      const title = this.create("div");
      title.className = "figure-note-filename";
      title.textContent = record.filename;
      title.title = record.filename;
      const meta = this.create("div");
      meta.className = "figure-note-meta";
      meta.textContent = record.noteTitle;

      const showSize = getPref("showFileSize");
      const showTime = getPref("showModifiedTime");
      let fileInfoRow: HTMLElement | null = null;

      if (showSize || showTime) {
        fileInfoRow = this.create("div");
        fileInfoRow.className = "figure-file-info";
        fileInfoRow.style.width = "100%";
        fileInfoRow.style.display = "flex";
        fileInfoRow.style.justifyContent = "space-between";
        fileInfoRow.style.fontSize = "11px";
        fileInfoRow.style.color = "var(--figure-secondary)";
        fileInfoRow.style.marginTop = "2px";

        const sizeSpan = this.create("span");
        const timeSpan = this.create("span");

        if (showSize) {
          sizeSpan.className = "figure-size";
          sizeSpan.textContent = "—";
          fileInfoRow.append(sizeSpan);
        }

        if (showTime) {
          timeSpan.className = "figure-time";
          timeSpan.textContent = "—";
          fileInfoRow.append(timeSpan);
        }

        if (record.filePath) {
          try {
            const file = Zotero.File.pathToFile(record.filePath);
            if (file && file.exists() && file.isFile()) {
              if (showSize) {
                const bytes = file.fileSize;
                if (bytes < 1024) sizeSpan.textContent = bytes + " B";
                else if (bytes < 1024 * 1024) sizeSpan.textContent = (bytes / 1024).toFixed(1) + " KB";
                else sizeSpan.textContent = (bytes / (1024 * 1024)).toFixed(1) + " MB";
              }
              if (showTime) {
                const ms = file.lastModifiedTime;
                const d = new Date(ms);
                if (!isNaN(d.getTime())) {
                  timeSpan.textContent = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                }
              }
            }
          } catch (e) {
            // ignore
          }
        }
      }

      if (fileInfoRow) meta.append(fileInfoRow);

      const checkbox = this.create("input") as HTMLInputElement;
      checkbox.type = "checkbox";
      checkbox.className = "figure-select-checkbox";
      checkbox.checked = this.selected.has(identity);
      checkbox.setAttribute("aria-label", getString("overview-select-image"));
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("dblclick", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.add(identity);
        else this.selected.delete(identity);
        card.classList.toggle("is-selected", checkbox.checked);
        this.updateActions();
      });

      card.append(imageArea, badge, title, meta, checkbox);
      grid.append(card);
    }
  }

  private preview(record: NoteImageRecord) {
    const refs = this.references?.get(recordIdentity(record)) ?? [];
    showImagePreview(this.win, {
      title: record.filename,
      imageURI: record.imageURI,
      details: [record.noteTitle, `Image Key: ${record.key}`],
      references: this.references
        ? refs.map((ref) => ({
            title: ref.title,
            open: () => this.openNote(ref.noteID),
          }))
        : undefined,
      open: () => this.openNote(refs[0]?.noteID ?? record.noteID),
    });
  }

  private openNote(id: number) {
    try {
      const pane =
        (Zotero as any).getActiveZoteroPane?.() ||
        (Zotero.getMainWindow() as any).ZoteroPane;
      if (!pane?.openNote) throw new Error("Zotero note editor is unavailable");
      pane.openNote(id, { openInWindow: true });
    } catch (error) {
      this.log(error);
      this.status(getString("note-open-failed"));
    }
  }

  private async save(records: NoteImageRecord[]) {
    if (this.busy || !records.length) return;
    this.busy = true;
    this.updateActions();
    try {
      const results = await exportNoteImages(records);
      this.status(
        getString("overview-save-result", {
          args: {
            successful: results.filter((result) => result.success).length,
            total: results.length,
          },
        }),
      );
    } catch (error) {
      this.log(error);
      this.status(getString("overview-save-failed"));
    } finally {
      this.busy = false;
      this.updateActions();
    }
  }

  private moveToTrash(records: NoteImageRecord[]) {
    if (this.busy) return;
    const existing = new Set(this.trash.map(recordIdentity));
    for (const record of records) {
      if (existing.has(recordIdentity(record))) continue;
      this.trash.push({
        libraryID: record.libraryID,
        key: record.key,
        deletedAt: Date.now(),
      });
    }
    writeNoteTrashEntries(this.trash);
    this.selected.clear();
    this.render();
  }

  private restore(records: NoteImageRecord[]) {
    if (this.busy) return;
    const keys = new Set(records.map(recordIdentity));
    this.trash = this.trash.filter((entry) => !keys.has(recordIdentity(entry)));
    writeNoteTrashEntries(this.trash);
    this.selected.clear();
    this.render();
  }

  private async deletePermanently(records: NoteImageRecord[]) {
    if (this.busy || !records.length) return;
    if (
      getPref("confirmDelete") &&
      !this.win.confirm(
        getString("note-delete-confirm", { args: { count: records.length } }),
      )
    )
      return;
    this.busy = true;
    this.updateActions();
    let references: Map<string, NoteReference[]>;
    let scannedNotes: number;
    try {
      const scan = await scanNoteReferences((checked, total) => {
        this.element("scan-status").textContent = getString(
          "note-scan-progress",
          { args: { checked, total } },
        );
      });
      references = scan.references;
      scannedNotes = scan.checked;
      this.references = references;
    } catch (error) {
      this.log(error);
      this.busy = false;
      this.references = null;
      this.render();
      this.status(
        getString("note-scan-failed", {
          args: { reason: this.errorMessage(error) },
        }),
      );
      return;
    }
    const { deleted, protectedCount, failed, errors } =
      await deleteNoteImageBatch(records, references, {
        onError: (error) => this.log(error),
      });
    this.trash = this.trash.filter(
      (entry) => !deleted.has(recordIdentity(entry)),
    );
    writeNoteTrashEntries(this.trash);
    this.records = this.records.filter(
      (record) => !deleted.has(recordIdentity(record)),
    );
    this.selected.clear();
    this.busy = false;
    this.render();
    const unreferenced = this.records.filter(
      (record) => !(references.get(recordIdentity(record))?.length ?? 0),
    ).length;
    this.element("scan-status").textContent = getString("note-scan-result", {
      args: { checked: scannedNotes, unreferenced },
    });
    const summary = getString("note-delete-result", {
      args: { deleted: deleted.size, protected: protectedCount, failed },
    });
    const firstError = errors[0];
    this.status(
      firstError
        ? `${summary} ${getString("note-delete-error", {
            args: {
              key: firstError.record.key,
              reason: this.errorMessage(firstError.error),
            },
          })}`
        : summary,
    );
  }

  private showMenu(record: NoteImageRecord, x: number, y: number) {
    if (this.busy) return;
    const menu = this.element("context-menu");
    menu.replaceChildren();
    const actions =
      this.view === "trash"
        ? [
            {
              label: getString("overview-restore"),
              run: () => this.restore([record]),
            },
            {
              label: getString("overview-delete-forever"),
              run: () => void this.deletePermanently([record]),
            },
          ]
        : [
            {
              label: getString("overview-open"),
              run: () => this.openNote(record.noteID),
            },
            {
              label: getString("overview-save-eagle"),
              run: () => void this.save([record]),
            },
            {
              label: getString("overview-move-trash"),
              run: () => this.moveToTrash([record]),
            },
          ];
    for (const action of actions) {
      const button = this.create("button") as HTMLButtonElement;
      button.textContent = action.label;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.hideMenu();
        action.run();
      });
      menu.append(button);
    }
    menu.hidden = false;
    menu.style.left = `${Math.min(x, this.win.innerWidth - 190)}px`;
    menu.style.top = `${Math.min(y, this.win.innerHeight - 130)}px`;
  }

  private hideMenu() {
    this.element("context-menu").hidden = true;
  }
  private status(value: string) {
    this.element("status").textContent = value;
  }
  private button(name: string) {
    return this.element(name) as HTMLButtonElement;
  }
  private input(name: string) {
    return this.element(name) as HTMLInputElement;
  }
  private element(name: string) {
    const element = this.win.document.getElementById(
      `zotero2eagle-note-${name}`,
    );
    if (!element) throw new Error(`Missing note manager element: ${name}`);
    return element as HTMLElement;
  }
  private create(tag: string) {
    return this.win.document.createElementNS(NS, tag) as HTMLElement;
  }
  private log(error: unknown) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
  private errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  private updateActions() {
    if (!this.initialized) return;
    const inTrash = this.view === "trash";
    this.button("library").classList.toggle("is-active", !inTrash);
    this.button("trash").classList.toggle("is-active", inTrash);
    for (const name of [
      "save",
      "move-trash",
      "restore",
      "delete-forever",
      "empty-trash",
    ])
      this.button(name).hidden = inTrash
        ? name === "save" || name === "move-trash"
        : name !== "save" && name !== "move-trash";
    for (const name of ["save", "move-trash", "restore", "delete-forever"])
      this.button(name).disabled = this.busy || !this.selected.size;
    this.button("empty-trash").disabled =
      this.busy || !this.viewRecords().length;
    this.button("select-all").disabled = this.busy || !this.visible().length;
    this.button("scan").disabled = this.busy;
    this.element("selected-count").textContent = getString(
      "overview-selected-count",
      {
        args: { count: this.selected.size },
      },
    );
  }
}
