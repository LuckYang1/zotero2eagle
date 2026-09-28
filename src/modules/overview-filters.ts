import type { FigureAnnotationRecord } from "./figure-annotations";

export type { FigureAnnotationRecord };

export const COLLECTION_KEY_PREFIX = "collection:";
export const UNCATEGORIZED_COLLECTION_KEY = "uncategorized";
export const DEFAULT_THUMBNAIL_SIZE = 220;
const THUMBNAIL_IMAGE_HEIGHT_RATIO = 0.72;

export interface OverviewFilters {
  selectedColors: Set<string>;
  selectedCollectionKeys: Set<string>;
  thumbnailSize: number;
}

export function getAvailableColors(records: FigureAnnotationRecord[]) {
  return [...new Set(records.map((record) => record.color).filter(Boolean))];
}

export function getRecordCollectionKeys(record: FigureAnnotationRecord) {
  if (!record.collectionIDs.length) {
    return [UNCATEGORIZED_COLLECTION_KEY];
  }
  return record.collectionIDs.map((id) => `${COLLECTION_KEY_PREFIX}${id}`);
}

export function createDefaultOverviewFilters(
  records: FigureAnnotationRecord[],
): OverviewFilters {
  return {
    selectedColors: new Set(getAvailableColors(records)),
    selectedCollectionKeys: new Set(
      records.flatMap((record) => getRecordCollectionKeys(record)),
    ),
    thumbnailSize: DEFAULT_THUMBNAIL_SIZE,
  };
}

export function recordMatchesOverviewFilters(
  record: FigureAnnotationRecord,
  filters: OverviewFilters,
) {
  if (!filters.selectedColors.has(record.color)) {
    return false;
  }
  return getRecordCollectionKeys(record).some((key) =>
    filters.selectedCollectionKeys.has(key),
  );
}

export function recordMatchesSingleCollection(
  record: FigureAnnotationRecord,
  selectionKey: string | null,
) {
  if (!selectionKey) return true;
  if (selectionKey === UNCATEGORIZED_COLLECTION_KEY) {
    return record.collectionIDs.length === 0;
  }
  if (selectionKey.startsWith("library:")) {
    return record.libraryID === Number(selectionKey.slice("library:".length));
  }
  if (selectionKey.startsWith(COLLECTION_KEY_PREFIX)) {
    return record.collectionIDs.includes(
      Number(selectionKey.slice(COLLECTION_KEY_PREFIX.length)),
    );
  }
  return false;
}

export function matchesFigureFilenameSearch(
  record: FigureAnnotationRecord,
  query: string,
) {
  const normalized = query.trim().toLocaleLowerCase();
  return (
    !normalized ||
    record.attachmentFilename.toLocaleLowerCase().includes(normalized)
  );
}

export function clampThumbnailSize(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_THUMBNAIL_SIZE;
  }
  return Math.min(420, Math.max(140, Math.round(value)));
}

export function setThumbnailSizeStyle(element: HTMLElement, size: number) {
  const thumbnailSize = clampThumbnailSize(size);
  element.style.setProperty("--figure-card-width", `${thumbnailSize}px`);
  element.style.setProperty(
    "--figure-image-height",
    `${Math.round(thumbnailSize * THUMBNAIL_IMAGE_HEIGHT_RATIO)}px`,
  );
}
