import {
  clearFigureAnnotationCache,
  type FigureAnnotationRecord,
} from "./figure-annotations";

interface DeletableAnnotation {
  id: number;
  key: string;
  libraryID: number;
  parentItemID: number;
  annotationType: string;
  isAnnotation: () => boolean;
  isEditable: () => boolean;
  eraseTx: () => Promise<unknown>;
}

type AnnotationLookup = (
  id: number,
) => Promise<DeletableAnnotation | false | undefined>;

type CacheImageRemoval = (annotation: DeletableAnnotation) => Promise<void>;
export interface DeleteFigureOptions {
  lookup?: AnnotationLookup;
  removeCacheImage?: CacheImageRemoval;
}

export async function deleteFigureAnnotation(
  record: FigureAnnotationRecord,
  options: DeleteFigureOptions = {},
) {
  const lookup =
    options.lookup ??
    ((id) => Zotero.Items.getAsync(id) as Promise<DeletableAnnotation | false>);
  const removeCacheImage =
    options.removeCacheImage ??
    ((annotation) => Zotero.Annotations.removeCacheImage(annotation));
  const annotation = await lookup(record.id);
  if (
    !annotation ||
    !annotation.isAnnotation() ||
    annotation.annotationType !== "image" ||
    annotation.key !== record.key ||
    annotation.libraryID !== record.libraryID ||
    annotation.parentItemID !== record.attachmentID
  ) {
    throw new Error("Image annotation no longer matches the overview record");
  }
  if (!annotation.isEditable()) {
    throw new Error("Image annotation is not editable");
  }

  // Match Zotero Reader's annotation deletion path so open readers receive
  // the normal item notifier and the deletion is synced.
  await annotation.eraseTx();
  clearFigureAnnotationCache();
  let imageCleanupError: unknown = null;
  try {
    await removeCacheImage(annotation);
  } catch (error) {
    imageCleanupError = error;
  }
  // The annotation is already gone, so cleanup errors must be reported without
  // keeping an impossible-to-retry annotation in the manager trash.
  return {
    imageCleanupError,
  };
}
