export interface CollectionTreeNode {
  key: string;
  label: string;
  children: CollectionTreeNode[];
}

export interface CollectionTreeSection {
  key: string;
  label: string;
  children: CollectionTreeNode[];
}

export interface CollectionTreeState {
  expandedCollectionKeys: Set<string>;
}

export function createCollapsedCollectionTreeState(): CollectionTreeState {
  return {
    expandedCollectionKeys: new Set(),
  };
}

export function expandAllCollectionNodes(
  sections: CollectionTreeSection[],
): CollectionTreeState {
  return {
    expandedCollectionKeys: new Set(getExpandableCollectionKeys(sections)),
  };
}

export function getExpandableCollectionKeys(sections: CollectionTreeSection[]) {
  return sections.flatMap((section) =>
    section.children.flatMap((node) => getExpandableNodeKeys(node)),
  );
}

export function getDescendantKeys(node: CollectionTreeNode): string[] {
  return node.children.flatMap((child) => [
    child.key,
    ...getDescendantKeys(child),
  ]);
}

export function sortCollectionTreeNodes<
  T extends Pick<CollectionTreeNode, "key" | "label">,
>(nodes: readonly T[]): T[] {
  return [...nodes].sort(compareCollectionTreeNodes);
}

function compareCollectionTreeNodes<
  T extends Pick<CollectionTreeNode, "key" | "label">,
>(left: T, right: T) {
  const labelOrder = compareCollectionLabels(left.label, right.label);
  if (labelOrder) {
    return labelOrder;
  }

  return left.key.localeCompare(right.key);
}

function compareCollectionLabels(left: string, right: string) {
  const runtimeZotero = (
    globalThis as typeof globalThis & {
      Zotero?: { localeCompare?: (a: string, b: string) => number };
    }
  ).Zotero;

  if (runtimeZotero?.localeCompare) {
    return runtimeZotero.localeCompare(left, right);
  }

  return getFallbackCollator().compare(left, right);
}

let fallbackCollator: Intl.Collator | null = null;

function getFallbackCollator() {
  fallbackCollator ??= new Intl.Collator(undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return fallbackCollator;
}

function getExpandableNodeKeys(node: CollectionTreeNode): string[] {
  if (!node.children.length) {
    return [];
  }

  return [
    node.key,
    ...node.children.flatMap((child) => getExpandableNodeKeys(child)),
  ];
}
