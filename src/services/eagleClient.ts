import { getPref } from "../utils/prefs";
import { logger } from "../utils/logger";

export interface MetadataSummary {
  annotationKey: string;
  attachmentKey: string;
  page: number | null;
  title: string;
  authors: string[];
  year: string | null;
}

export interface EagleAddFromPathOptions {
  annotation?: string;
  folderId?: string;
  name?: string;
  tags?: string[];
  website?: string;
}

export interface ExportResult {
  annotationKey: string;
  itemId?: string;
  message: string;
  mode: "auto" | "manual";
  success: boolean;
}

function sanitizeNameSegment(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function buildEagleFilename(metadata: MetadataSummary) {
  const titlePart = sanitizeNameSegment(metadata.title || "Untitled") || "Untitled";
  const pagePart = metadata.page ? `p${metadata.page}` : "pNA";
  return `${titlePart}_${metadata.attachmentKey}_${pagePart}.png`;
}

export function buildEagleTags(metadata: MetadataSummary) {
  const tags = ["Zotero"];

  const firstAuthor = metadata.authors[0]?.trim();
  if (firstAuthor) {
    const lastWord = firstAuthor.split(/\s+/).filter(Boolean).pop();
    if (lastWord) {
      tags.push(lastWord);
    }
  }

  return tags;
}

export function buildEagleAnnotation(metadata: MetadataSummary) {
  const parts = [
    `Title: ${metadata.title || "Untitled"}`,
    metadata.authors.length ? `Authors: ${metadata.authors.join(", ")}` : null,
    metadata.year ? `Year: ${metadata.year}` : null,
    metadata.page ? `Page: ${metadata.page}` : null,
    `Attachment Key: ${metadata.attachmentKey}`,
    `Annotation Key: ${metadata.annotationKey}`,
  ];

  return parts.filter(Boolean).join(" | ");
}

function normalizeBaseUrl(rawUrl?: string) {
  const baseUrl = (rawUrl || getPref("eagleApiUrl") || "http://localhost:41595").trim();
  return baseUrl.replace(/\/+$/, "");
}

function getToken() {
  return (getPref("eagleApiToken") || "").trim();
}

function buildFolderId(folderId?: string | null) {
  const value = (folderId || getPref("eagleFolderId") || "").trim();
  return value || undefined;
}

async function request<TResponse>(
  method: string,
  path: string,
  body?: Record<string, unknown>,
  options?: { apiUrl?: string; token?: string },
) {
  const apiUrl = normalizeBaseUrl(options?.apiUrl);
  const token = options?.token ?? getToken();
  const requestUrl =
    method === "GET" && token
      ? `${apiUrl}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
      : `${apiUrl}${path}`;
  const requestBody =
    method === "GET"
      ? undefined
      : JSON.stringify(token ? { ...body, token } : body ?? {});

  const response = await Zotero.HTTP.request(method, requestUrl, {
    body: requestBody,
    headers: {
      "Content-Type": "application/json",
    },
    responseType: "json",
    timeout: 10_000,
  });

  return response.response as TResponse;
}

export async function testEagleConnection(apiUrl?: string, token?: string) {
  try {
    const response = await request<{ status?: string; message?: string }>(
      "GET",
      "/api/application/info",
      undefined,
      { apiUrl, token },
    );

    if (response?.status === "success" || response?.status === undefined) {
      return {
        message: "OK",
        success: true,
      };
    }

    return {
      message: response.message || "Unknown response from Eagle",
      success: false,
    };
  } catch (error) {
    logger.error("eagle-client", "Eagle connection test failed", error);
    return {
      message: String(error),
      success: false,
    };
  }
}

export async function addItemFromPath(
  path: string,
  options: EagleAddFromPathOptions,
  requestOptions?: { apiUrl?: string; token?: string },
) {
  try {
    const response = await request<{ data?: { id?: string }; itemId?: string; message?: string; status?: string }>(
      "POST",
      "/api/item/addFromPath",
      {
        path,
        ...options,
      },
      requestOptions,
    );

    if (response?.status && response.status !== "success") {
      return {
        message: response.message || "Eagle rejected the import request",
        success: false,
      };
    }

    return {
      itemId: response?.itemId || response?.data?.id,
      message: "Imported into Eagle",
      success: true,
    };
  } catch (error) {
    logger.error("eagle-client", "Eagle import failed", error);
    return {
      message: String(error),
      success: false,
    };
  }
}

export function buildEagleOptions(
  metadata: MetadataSummary,
  website: string,
  folderId?: string | null,
): EagleAddFromPathOptions {
  return {
    annotation: buildEagleAnnotation(metadata),
    folderId: buildFolderId(folderId),
    name: buildEagleFilename(metadata),
    tags: buildEagleTags(metadata),
    website,
  };
}
