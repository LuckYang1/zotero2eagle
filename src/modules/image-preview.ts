import { getString } from "../utils/locale";

export interface PreviewReference {
  title: string;
  open: () => void;
}

const activePreviews = new WeakMap<Window, () => void>();

export function closeImagePreview(win: Window) {
  activePreviews.get(win)?.();
}

export function showImagePreview(
  win: Window,
  options: {
    title: string;
    imageURI: string | null;
    details: string[];
    references?: PreviewReference[];
    open: () => void;
  },
) {
  closeImagePreview(win);
  const element = (tag: string) =>
    win.document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      tag,
    ) as HTMLElement;
  const backdrop = element("div");
  backdrop.className = "figure-preview-backdrop";
  const dialog = element("section");
  dialog.className = "figure-preview-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", options.title);
  const header = element("header");
  header.className = "figure-preview-header";
  const title = element("strong");
  title.textContent = options.title;
  const open = element("button") as HTMLButtonElement;
  open.textContent = getString("overview-open");
  open.addEventListener("click", options.open);
  const close = element("button") as HTMLButtonElement;
  close.textContent = "×";
  close.setAttribute("aria-label", getString("overview-close"));
  const dismiss = () => {
    backdrop.remove();
    win.removeEventListener("keydown", onKey);
    activePreviews.delete(win);
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") dismiss();
  };
  close.addEventListener("click", dismiss);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) dismiss();
  });
  win.addEventListener("keydown", onKey);
  activePreviews.set(win, dismiss);
  header.append(title, open, close);
  const content = element("div");
  content.className = "figure-preview-content";
  const imageArea = element("div");
  imageArea.className = "figure-preview-image";
  if (options.imageURI) {
    const image = element("img") as HTMLImageElement;
    image.src = options.imageURI;
    image.alt = options.title;
    imageArea.append(image);
  } else {
    imageArea.textContent = getString("overview-image-missing");
  }
  const info = element("aside");
  info.className = "figure-preview-info";
  for (const detail of options.details) {
    const line = element("p");
    line.textContent = detail;
    info.append(line);
  }
  if (options.references) {
    const heading = element("h2");
    heading.textContent = getString("note-references");
    info.append(heading);
    for (const reference of options.references) {
      const button = element("button") as HTMLButtonElement;
      button.textContent = reference.title;
      button.addEventListener("click", reference.open);
      info.append(button);
    }
  }
  content.append(imageArea, info);
  dialog.append(header, content);
  backdrop.append(dialog);
  win.document.documentElement?.append(backdrop);
  close.focus();
}
