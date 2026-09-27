import type { FigureAnnotationRecord } from "./figure-annotations";
import { recordIdentity } from "./image-manager-trash";

export async function deleteRecordBatch(
  records: FigureAnnotationRecord[],
  deleteOne: (record: FigureAnnotationRecord) => Promise<unknown>,
  onError: (error: unknown) => void,
) {
  const deleted = new Set<string>();
  let failed = 0;
  let cleanupFailed = 0;
  for (const record of records) {
    try {
      const result = await deleteOne(record);
      deleted.add(recordIdentity(record));
      if (
        result &&
        typeof result === "object" &&
        "imageCleanupError" in result &&
        result.imageCleanupError
      ) {
        cleanupFailed += 1;
        onError(result.imageCleanupError);
      }
    } catch (error) {
      failed += 1;
      onError(error);
    }
  }
  return {
    deleted,
    failed,
    cleanupFailed,
  };
}
