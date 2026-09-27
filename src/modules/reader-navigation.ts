import type {
  FigureAnnotationPosition,
  FigureAnnotationRecord,
} from "./figure-annotations";

export type { FigureAnnotationRecord };

export interface ReaderOpenLike {
  open: (...args: unknown[]) => Promise<unknown> | unknown;
}

export type FigureReaderLocation =
  | { annotationID: string }
  | { position: FigureAnnotationPosition };

export function buildReaderLocation(
  record: FigureAnnotationRecord,
): FigureReaderLocation {
  if (record.position) {
    return { position: record.position };
  }

  return { annotationID: record.key };
}

export async function openFigureInReader(
  record: FigureAnnotationRecord,
  reader: ReaderOpenLike = Zotero.Reader as unknown as ReaderOpenLike,
) {
  await reader.open(record.attachmentID, buildReaderLocation(record), {
    allowDuplicate: false,
  });
}
