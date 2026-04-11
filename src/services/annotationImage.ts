import { logger } from "../utils/logger";

const DEFAULT_MAX_WAIT_MS = 30_000;
const DEFAULT_CHECK_INTERVAL_MS = 250;
const DEFAULT_STABLE_MS = 500;

function getDataDirectory() {
  try {
    const dataDir = (Zotero as any).DataDirectory?.dir;
    if (typeof dataDir === "string" && dataDir) {
      return dataDir;
    }

    const dataDirFile = (Zotero as any).DataDirectory?.get?.();
    if (dataDirFile?.path) {
      return dataDirFile.path;
    }
  } catch (error) {
    logger.warn(
      "annotation-image",
      `Unable to read Zotero data directory: ${String(error)}`,
    );
  }

  return null;
}

function joinPath(basePath: string, ...parts: string[]) {
  const separator = Zotero.isWin ? "\\" : "/";
  let output = basePath.replace(/[\\/]+$/, "");
  for (const part of parts) {
    output += `${separator}${part.replace(/^[\\/]+/, "")}`;
  }
  return output;
}

function getGroupPath(item: Zotero.Item) {
  try {
    const library = (Zotero as any).Libraries?.get?.(item.libraryID);
    if (library?.libraryType === "group" && library.groupID) {
      return joinPath("groups", String(library.groupID));
    }
  } catch (error) {
    logger.warn(
      "annotation-image",
      `Unable to resolve group cache path: ${String(error)}`,
    );
  }

  return null;
}

function getCacheCandidates(annotationItem: Zotero.Item) {
  const candidates = new Set<string>();
  const annotationKey = annotationItem.key;

  try {
    const apiPath =
      (Zotero as any).Annotations?.getCacheImagePath?.(annotationItem);
    if (typeof apiPath === "string" && apiPath.trim()) {
      candidates.add(apiPath);
    }
  } catch (error) {
    logger.warn(
      "annotation-image",
      `Primary cache image API failed: ${String(error)}`,
    );
  }

  const dataDir = getDataDirectory();
  if (!dataDir) {
    return [...candidates];
  }

  const cacheRoot = joinPath(dataDir, "cache");
  const candidateDirs = [
    joinPath(cacheRoot, "library"),
    joinPath(cacheRoot, "annotations"),
  ];
  const groupPath = getGroupPath(annotationItem);
  if (groupPath) {
    candidateDirs.push(joinPath(cacheRoot, groupPath));
  }

  for (const dir of candidateDirs) {
    for (const ext of ["png", "jpg", "jpeg"]) {
      candidates.add(joinPath(dir, `${annotationKey}.${ext}`));
    }
  }

  return [...candidates];
}

function getPageNumber(annotationItem: Zotero.Item) {
  const rawPosition = (annotationItem as any).annotationPosition;
  if (!rawPosition) {
    return null;
  }

  try {
    const position =
      typeof rawPosition === "string" ? JSON.parse(rawPosition) : rawPosition;

    if (typeof position?.pageIndex === "number") {
      return position.pageIndex + 1;
    }

    if (typeof position?.page === "number") {
      return position.page;
    }
  } catch (error) {
    logger.warn(
      "annotation-image",
      `Unable to parse annotation position: ${String(error)}`,
    );
  }

  return null;
}

export async function waitForAnnotationCachePath(
  annotationItem: Zotero.Item,
  options?: {
    checkIntervalMs?: number;
    maxWaitMs?: number;
    stableMs?: number;
  },
) {
  const maxWaitMs = options?.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const checkIntervalMs = options?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
  const stableMs = options?.stableMs ?? DEFAULT_STABLE_MS;
  const candidates = getCacheCandidates(annotationItem);
  const startedAt = Date.now();
  const lastSizes = new Map<string, number>();
  const stableSince = new Map<string, number>();

  if (!candidates.length) {
    return null;
  }

  while (Date.now() - startedAt < maxWaitMs) {
    for (const candidate of candidates) {
      try {
        const file = Zotero.File.pathToFile(candidate);
        if (!file.exists() || !file.isFile()) {
          continue;
        }

        const size = file.fileSize;
        if (!size) {
          continue;
        }

        const previousSize = lastSizes.get(candidate);
        if (previousSize === size) {
          const firstStableAt = stableSince.get(candidate) ?? Date.now();
          stableSince.set(candidate, firstStableAt);
          if (Date.now() - firstStableAt >= stableMs) {
            return candidate;
          }
          continue;
        }

        lastSizes.set(candidate, size);
        stableSince.set(candidate, Date.now());
      } catch (error) {
        logger.warn(
          "annotation-image",
          `Cache probe failed for ${candidate}: ${String(error)}`,
        );
      }
    }

    await Zotero.Promise.delay(checkIntervalMs);
  }

  return null;
}

export { getPageNumber };
