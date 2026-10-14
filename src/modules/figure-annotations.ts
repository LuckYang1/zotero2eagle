import {
  getContentLibraries,
  loadItemsWithData,
  uniqueIDs,
} from "./item-loading";

export interface FigureAnnotationRecord {
  id: number;
  key: string;
  libraryID: number;
  color: string;
  pageLabel: string;
  sortIndex: string;
  comment: string;
  dateAdded: string;
  dateModified: string;
  attachmentID: number;
  attachmentKey: string;
  attachmentTitle: string;
  attachmentFilename: string;
  topLevelItemID: number;
  topLevelTitle: string;
  collectionIDs: number[];
  position: FigureAnnotationPosition | null;
  imageHeightRatio: number | null;
  imageURI: string | null;
  imagePath: string | null;
  filePath: string | null;
}

export const IMAGE_ANNOTATION_TYPE_ID = 3;

export interface FigureAnnotationPosition {
  pageIndex?: number;
  rects?: number[][];
  paths?: unknown;
  [key: string]: unknown;
}

export interface ImageAnnotationIDQuery {
  sql: string;
  params: Array<number | string>;
}

export interface RuntimeTopLevelItem {
  id: number;
  getCollections?: () => number[];
  getDisplayTitle?: () => string;
}

export interface RuntimeAttachmentItem {
  id: number;
  key?: string;
  topLevelItem?: RuntimeTopLevelItem;
  getDisplayTitle?: () => string;
  attachmentFilename?: string;
  getFilePath?: () => string | false;
}

export interface RuntimeAnnotationItem {
  id: number;
  key: string;
  libraryID: number;
  annotationType: string;
  annotationColor?: string;
  annotationPageLabel?: string;
  annotationSortIndex?: string | number;
  annotationPosition?: string;
  annotationComment?: string;
  dateAdded?: string;
  dateModified?: string;
  parentItemID: number;
  parentItem?: RuntimeAttachmentItem;
  topLevelItem?: RuntimeTopLevelItem;
  deleted?: boolean;
  isAnnotation?: () => boolean;
}

export function isFigureAnnotationItem(item: RuntimeAnnotationItem) {
  if (item.isAnnotation && !item.isAnnotation()) {
    return false;
  }
  return item.annotationType === "image" && !item.deleted;
}

export function createFigureAnnotationRecord(
  annotation: RuntimeAnnotationItem,
  imageURI: string | null,
  imagePath: string | null,
): FigureAnnotationRecord {
  const attachment = annotation.parentItem;
  const topLevelItem = attachment?.topLevelItem ?? annotation.topLevelItem;
  const attachmentTitle =
    attachment?.getDisplayTitle?.() || annotation.parentItemID.toString();
  const topLevelTitle = topLevelItem?.getDisplayTitle?.() || attachmentTitle;
  const position = parseAnnotationPosition(annotation.annotationPosition);

  return {
    id: annotation.id,
    key: annotation.key,
    libraryID: annotation.libraryID,
    color: annotation.annotationColor || "#ffd400",
    pageLabel: annotation.annotationPageLabel || "",
    sortIndex: String(annotation.annotationSortIndex || ""),
    comment: annotation.annotationComment || "",
    dateAdded: annotation.dateAdded || "",
    dateModified: annotation.dateModified || "",
    attachmentID: annotation.parentItemID,
    attachmentKey: attachment?.key || "",
    attachmentTitle,
    attachmentFilename: attachment?.attachmentFilename || attachmentTitle,
    topLevelItemID:
      topLevelItem?.id ?? attachment?.id ?? annotation.parentItemID,
    topLevelTitle,
    collectionIDs: topLevelItem?.getCollections?.() ?? [],
    position,
    imageHeightRatio: getImageHeightRatio(position),
    imageURI,
    imagePath,
    filePath: attachment?.getFilePath?.() || null,
  };
}

export function sortFigureAnnotationRecords(records: FigureAnnotationRecord[]) {
  const groupRecency = getDocumentGroupRecency(records);

  return [...records].sort((left, right) => {
    if (left.topLevelItemID !== right.topLevelItemID) {
      const recency =
        (groupRecency.get(right.topLevelItemID) ?? Number.NEGATIVE_INFINITY) -
        (groupRecency.get(left.topLevelItemID) ?? Number.NEGATIVE_INFINITY);
      if (recency) {
        return recency;
      }

      const title = left.topLevelTitle.localeCompare(right.topLevelTitle);
      if (title) {
        return title;
      }

      return left.topLevelItemID - right.topLevelItemID;
    }

    const sortIndex = left.sortIndex.localeCompare(right.sortIndex);
    if (sortIndex) {
      return sortIndex;
    }
    return left.key.localeCompare(right.key);
  });
}

function getDocumentGroupRecency(records: FigureAnnotationRecord[]) {
  const groupRecency = new Map<number, number>();
  for (const record of records) {
    const time = getRecordRecencyTime(record);
    const existing = groupRecency.get(record.topLevelItemID);
    if (existing === undefined || time > existing) {
      groupRecency.set(record.topLevelItemID, time);
    }
  }
  return groupRecency;
}

function getRecordRecencyTime(record: FigureAnnotationRecord) {
  return (
    dateStringToTime(record.dateAdded) || dateStringToTime(record.dateModified)
  );
}

function dateStringToTime(value: string) {
  if (!value) {
    return 0;
  }

  const time = Date.parse(value.replace(" ", "T"));
  return Number.isFinite(time) ? time : 0;
}

export async function collectFigureAnnotations() {
  const annotationIDs = await getImageAnnotationIDs(
    getContentLibraries().map((library) => library.id),
  );
  const annotations = await loadItemsWithData(annotationIDs, [
    "annotation",
    "annotationDeferred",
  ]);
  const attachments = await loadItemsWithData(
    uniqueIDs(annotations.map((annotation) => annotation.parentItemID)),
    ["itemData"],
  );
  // 部分条目类型的显示标题由作者生成，creators 必须先于 itemData 加载
  await loadItemsWithData(
    uniqueIDs(
      attachments.map((attachment) => attachment.parentItemID || attachment.id),
    ),
    ["creators", "itemData", "collections"],
  );

  const records: FigureAnnotationRecord[] = [];
  for (const annotation of annotations) {
    const runtimeAnnotation = annotation as unknown as RuntimeAnnotationItem;
    if (!isFigureAnnotationItem(runtimeAnnotation)) {
      continue;
    }

    const attachment = annotation.parentItem;
    if (!attachment || !isReadableAttachment(attachment)) {
      continue;
    }

    const imagePath = Zotero.Annotations.getCacheImagePath(annotation);
    records.push(
      createFigureAnnotationRecord(
        runtimeAnnotation,
        Zotero.File.pathToFileURI(imagePath),
        imagePath,
      ),
    );
  }

  return sortFigureAnnotationRecords(records);
}

export function buildImageAnnotationIDQuery(
  libraryIDs: number[],
  imageAnnotationTypeID = IMAGE_ANNOTATION_TYPE_ID,
): ImageAnnotationIDQuery {
  const placeholders = libraryIDs.map(() => "?").join(",");
  return {
    sql: [
      "SELECT IA.itemID",
      "FROM itemAnnotations IA",
      "JOIN items I ON I.itemID = IA.itemID",
      "JOIN itemAttachments Attachment ON Attachment.itemID = IA.parentItemID",
      "LEFT JOIN deletedItems annotationDeleted ON annotationDeleted.itemID = IA.itemID",
      "LEFT JOIN deletedItems parentDeleted ON parentDeleted.itemID = IA.parentItemID",
      "WHERE IA.type=?",
      "AND annotationDeleted.itemID IS NULL",
      "AND parentDeleted.itemID IS NULL",
      `AND I.libraryID IN (${placeholders})`,
      "ORDER BY I.libraryID, IA.parentItemID, IA.sortIndex",
    ].join(" "),
    params: [imageAnnotationTypeID, ...libraryIDs],
  };
}

async function getImageAnnotationIDs(libraryIDs: number[]) {
  if (!libraryIDs.length) {
    return [];
  }

  const query = buildImageAnnotationIDQuery(
    libraryIDs,
    Zotero.Annotations.ANNOTATION_TYPE_IMAGE,
  );
  return (await Zotero.DB.columnQueryAsync(
    query.sql,
    query.params,
  )) as number[];
}

function isReadableAttachment(item: Zotero.Item) {
  return Boolean(
    item.isFileAttachment?.() &&
    item.attachmentReaderType &&
    item.getAnnotations,
  );
}

function parseAnnotationPosition(
  position: string | undefined,
): FigureAnnotationPosition | null {
  if (!position) {
    return null;
  }

  try {
    const parsed = JSON.parse(position) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as FigureAnnotationPosition;
    }
  } catch {
    return null;
  }

  return null;
}

export function getImageHeightRatio(position: FigureAnnotationPosition | null) {
  const rect = position?.rects?.[0];
  if (!rect || rect.length < 4) {
    return null;
  }

  const width = Math.abs(rect[2] - rect[0]);
  const height = Math.abs(rect[3] - rect[1]);
  if (!width || !height) {
    return null;
  }

  return clampImageHeightRatio(height / width);
}

export function clampImageHeightRatio(ratio: number) {
  if (!Number.isFinite(ratio)) {
    return null;
  }

  return Math.min(2.4, Math.max(0.08, ratio));
}
