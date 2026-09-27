import type { FigureAnnotationRecord } from "./figure-annotations";
import { recordIdentity } from "./image-manager-trash";

export function selectedVisibleRecords(
  selected: Set<string>,
  visible: FigureAnnotationRecord[],
) {
  return visible.filter((record) => selected.has(recordIdentity(record)));
}

export function pruneSelection(
  selected: Set<string>,
  visible: FigureAnnotationRecord[],
) {
  const visibleKeys = new Set(visible.map(recordIdentity));
  return new Set([...selected].filter((key) => visibleKeys.has(key)));
}
