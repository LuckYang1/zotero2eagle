import { config } from "../../package.json";
import { getString } from "../utils/locale";

export interface ImageSortState {
  field: string;
  order: string;
}

export function initImageSortControls(
  doc: Document,
  prefix: string,
  sort: ImageSortState,
  onChange: () => void,
) {
  const element = <T extends HTMLElement>(name: string) => {
    const found = doc.getElementById(`${prefix}-${name}`);
    if (!found) throw new Error(`Missing sort control: ${prefix}-${name}`);
    return found as T;
  };
  const fieldButton = element<HTMLButtonElement>("sort-field");
  const menu = element<HTMLElement>("sort-menu");
  const orderButton = element<HTMLButtonElement>("sort-order");

  const updateFieldMenu = () => {
    for (const option of menu.querySelectorAll<HTMLButtonElement>(
      "[data-sort-field]",
    )) {
      option.setAttribute(
        "aria-checked",
        String(option.dataset.sortField === sort.field),
      );
    }
  };
  const updateOrderButton = () => {
    const order = sort.order === "asc" ? "asc" : "desc";
    const label = getString(`overview-sort-${order}`);
    const icon = orderButton.querySelector<HTMLImageElement>("img");
    if (icon) {
      icon.src = `chrome://${config.addonRef}/content/icons/arrow-${order === "asc" ? "up" : "down"}.svg`;
    }
    orderButton.dataset.order = order;
    orderButton.setAttribute("aria-label", label);
    element<HTMLElement>("sort-order-tooltip").textContent = label;
  };
  const hideMenu = () => {
    menu.hidden = true;
    fieldButton.setAttribute("aria-expanded", "false");
  };

  const fieldLabel = getString("overview-sort-field");
  fieldButton.setAttribute("aria-label", fieldLabel);
  element<HTMLElement>("sort-field-tooltip").textContent = fieldLabel;
  updateFieldMenu();
  updateOrderButton();

  fieldButton.addEventListener("click", (event) => {
    event.stopPropagation();
    menu.hidden = !menu.hidden;
    fieldButton.setAttribute("aria-expanded", String(!menu.hidden));
    if (!menu.hidden) {
      menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    }
  });
  for (const option of menu.querySelectorAll<HTMLButtonElement>(
    "[data-sort-field]",
  )) {
    option.addEventListener("click", (event: Event) => {
      event.stopPropagation();
      sort.field = option.dataset.sortField || "dateModified";
      updateFieldMenu();
      hideMenu();
      fieldButton.focus();
      onChange();
    });
  }
  orderButton.addEventListener("click", () => {
    sort.order = sort.order === "asc" ? "desc" : "asc";
    updateOrderButton();
    onChange();
  });

  return { hideMenu };
}
