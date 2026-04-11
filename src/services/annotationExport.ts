import { config } from "../../package.json";
import {
  addItemFromPath,
  buildEagleOptions,
  ExportResult,
  MetadataSummary,
} from "./eagleClient";
import { getPageNumber, waitForAnnotationCachePath } from "./annotationImage";
import { getPref } from "../utils/prefs";
import { logger } from "../utils/logger";
import { buildOpenPdfLink } from "../utils/zoteroLink";
import { getString } from "../utils/locale";

interface ExportJob {
  annotationItem: Zotero.Item;
  cachePath: string;
  metadata: MetadataSummary;
  website: string;
}

type ExportMode = "auto" | "manual";

function isPdfAttachment(item: Zotero.Item) {
  return item.isPDFAttachment?.() || (item.isAttachment() && item.attachmentContentType === "application/pdf");
}

function isImageAnnotation(item: Zotero.Item) {
  return item.isAnnotation?.() && (item as any).annotationType === "image";
}

function getActivePane() {
  return ((Zotero as any).getActiveZoteroPane?.() || ztoolkit.getGlobal("ZoteroPane")) as any;
}

async function coerceItems(values: Array<number | Zotero.Item>) {
  const output: Zotero.Item[] = [];
  for (const value of values) {
    if (typeof value === "number") {
      const item = await Zotero.Items.getAsync(value);
      if (item) {
        output.push(item);
      }
      continue;
    }

    output.push(value);
  }

  return output;
}

function getCreators(item?: Zotero.Item | null) {
  if (!item?.getCreators) {
    return [];
  }

  return item
    .getCreators()
    .filter((creator: any) => creator.creatorType === "author")
    .map((creator: any) => creator.name || [creator.firstName, creator.lastName].filter(Boolean).join(" "))
    .filter(Boolean);
}

function getYear(item?: Zotero.Item | null) {
  if (!item?.getField) {
    return null;
  }

  const year = item.getField("year") || item.getField("date");
  if (!year) {
    return null;
  }

  const match = String(year).match(/\d{4}/);
  return match?.[0] || null;
}

export class AnnotationExportService {
  private autoExportObserverID: string | null = null;
  private processedAnnotations = new Map<string, number>();

  init() {
    if (this.autoExportObserverID) {
      return;
    }

    this.autoExportObserverID = Zotero.Notifier.registerObserver(
      {
        notify: async (event: string, type: string, ids: Array<string | number>) => {
          if (event !== "add" || type !== "item" || !getPref("enableAutoImport")) {
            return;
          }

          for (const id of ids) {
            const item = await Zotero.Items.getAsync(Number(id));
            if (!item || !isImageAnnotation(item)) {
              continue;
            }

            if (!this.claimAutoExport(item.key)) {
              continue;
            }

            void this.exportAnnotation(item, "auto");
          }
        },
      },
      ["item"],
    ) as string;
  }

  shutdown() {
    if (this.autoExportObserverID) {
      Zotero.Notifier.unregisterObserver(this.autoExportObserverID);
      this.autoExportObserverID = null;
    }
    this.processedAnnotations.clear();
  }

  async exportSelected() {
    const pane = getActivePane();
    const selectedItems = (pane?.getSelectedItems?.() || []) as Zotero.Item[];
    const annotations = await this.collectImageAnnotations(selectedItems);

    return this.exportAnnotations(annotations, "manual");
  }

  async exportAnnotationIDs(annotationIDs: number[]) {
    const items = await Zotero.Items.getAsync(annotationIDs);
    const annotations = items.filter((item) => isImageAnnotation(item));
    return this.exportAnnotations(annotations, "manual");
  }

  private claimAutoExport(annotationKey: string) {
    const now = Date.now();
    const lastSeen = this.processedAnnotations.get(annotationKey);
    if (lastSeen && now - lastSeen < 60_000) {
      return false;
    }

    this.processedAnnotations.set(annotationKey, now);
    for (const [key, timestamp] of this.processedAnnotations) {
      if (now - timestamp > 5 * 60_000) {
        this.processedAnnotations.delete(key);
      }
    }

    return true;
  }

  private async collectImageAnnotations(selectedItems: Zotero.Item[]) {
    const annotations = new Map<number, Zotero.Item>();

    for (const item of selectedItems) {
      if (isImageAnnotation(item)) {
        annotations.set(item.id, item);
        continue;
      }

      if (isPdfAttachment(item)) {
        const annotationValues = ((item as any).getAnnotations?.() || []) as Array<
          number | Zotero.Item
        >;
        for (const annotation of await coerceItems(annotationValues)) {
          if (isImageAnnotation(annotation)) {
            annotations.set(annotation.id, annotation);
          }
        }
        continue;
      }

      if (!item.isRegularItem?.()) {
        continue;
      }

      const attachmentValues = (item.getAttachments?.() || []) as Array<
        number | Zotero.Item
      >;
      for (const attachment of await coerceItems(attachmentValues)) {
        if (!isPdfAttachment(attachment)) {
          continue;
        }

        const annotationValues = ((attachment as any).getAnnotations?.() || []) as Array<
          number | Zotero.Item
        >;
        for (const annotation of await coerceItems(annotationValues)) {
          if (isImageAnnotation(annotation)) {
            annotations.set(annotation.id, annotation);
          }
        }
      }
    }

    return [...annotations.values()];
  }

  private async exportAnnotations(
    annotations: Zotero.Item[],
    mode: ExportMode,
  ) {
    if (!annotations.length) {
      this.notify(getString("status-export-empty"), "warning");
      return [];
    }

    const results: ExportResult[] = [];
    for (const annotation of annotations) {
      results.push(await this.exportAnnotation(annotation, mode));
    }

    if (mode === "manual") {
      this.notify(
        this.buildBatchSummary(results),
        this.getBatchNotificationType(results),
      );
    }

    return results;
  }

  private async exportAnnotation(annotationItem: Zotero.Item, mode: ExportMode): Promise<ExportResult> {
    try {
      const job = await this.buildJob(annotationItem);
      if (!job) {
        const result = this.failResult(annotationItem.key, mode, "Annotation image cache was not available");
        if (mode === "auto") {
          this.notify(result.message, "error");
        }
        return result;
      }

      const response = await addItemFromPath(
        job.cachePath,
        buildEagleOptions(job.metadata, job.website),
      );

      if (!response.success) {
        const result = this.failResult(annotationItem.key, mode, response.message);
        if (mode === "auto") {
          this.notify(`${getString("status-export-failed")} ${response.message}`, "error");
        }
        return result;
      }

      const result: ExportResult = {
        annotationKey: job.metadata.annotationKey,
        itemId: response.itemId,
        message: `Imported annotation ${job.metadata.annotationKey} into Eagle`,
        mode,
        success: true,
      };

      if (mode === "auto") {
        this.notify(`${getString("status-export-success")} ${job.metadata.title}`, "success");
      }

      return result;
    } catch (error) {
      logger.error("annotation-export", "Unexpected export failure", error);
      const result = this.failResult(annotationItem.key, mode, String(error));
      if (mode === "auto") {
        this.notify(`${getString("status-export-failed")} ${String(error)}`, "error");
      }
      return result;
    }
  }

  private async buildJob(annotationItem: Zotero.Item): Promise<ExportJob | null> {
    const attachmentItem = annotationItem.parentItem;
    if (!attachmentItem) {
      return null;
    }

    const bibliographicItem = attachmentItem.parentItem || attachmentItem;
    const cachePath = await waitForAnnotationCachePath(annotationItem);
    if (!cachePath) {
      logger.warn("annotation-export", `No cache image found for annotation ${annotationItem.key}`);
      return null;
    }

    const metadata: MetadataSummary = {
      annotationKey: annotationItem.key,
      attachmentKey: attachmentItem.key,
      authors: getCreators(bibliographicItem),
      page: getPageNumber(annotationItem),
      title: String(
        bibliographicItem.getField?.("title") ||
          attachmentItem.getField?.("title") ||
          "Untitled",
      ),
      year: getYear(bibliographicItem),
    };

    const website = buildOpenPdfLink({
      annotationKey: metadata.annotationKey,
      attachmentKey: metadata.attachmentKey,
      page: metadata.page,
    });

    return {
      annotationItem,
      cachePath,
      metadata,
      website,
    };
  }

  private buildBatchSummary(results: ExportResult[]) {
    const successCount = results.filter((result) => result.success).length;
    const failedCount = results.length - successCount;
    if (!successCount) {
      return `${getString("status-export-failed")} ${failedCount}/${results.length}`;
    }
    if (!failedCount) {
      return `${getString("status-export-success")} ${successCount}/${results.length}`;
    }
    return `${getString("status-export-partial")} ${successCount}/${results.length}`;
  }

  private getBatchNotificationType(results: ExportResult[]) {
    if (results.every((result) => result.success)) {
      return "success" as const;
    }
    if (results.some((result) => result.success)) {
      return "warning" as const;
    }
    return "error" as const;
  }

  private failResult(annotationKey: string, mode: ExportMode, message: string): ExportResult {
    return {
      annotationKey,
      message,
      mode,
      success: false,
    };
  }

  private notify(message: string, type: "success" | "warning" | "error") {
    const progressType =
      type === "success" ? "success" : type === "warning" ? "default" : "fail";
    const popup = new ztoolkit.ProgressWindow(config.addonName)
      .createLine({
        progress: 100,
        text: message,
        type: progressType as any,
      });
    popup.show();
    popup.startCloseTimer(5000);
  }
}
