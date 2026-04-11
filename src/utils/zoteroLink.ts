export interface OpenPdfLinkOptions {
  annotationKey: string;
  attachmentKey: string;
  page: number | null;
}

export function buildOpenPdfLink({
  annotationKey,
  attachmentKey,
  page,
}: OpenPdfLinkOptions) {
  const params = new URLSearchParams();
  if (page && page > 0) {
    params.set("page", String(page));
  }
  params.set("annotation", annotationKey);

  return `zotero://open-pdf/library/items/${attachmentKey}?${params.toString()}`;
}
