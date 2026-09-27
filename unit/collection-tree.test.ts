import assert from "node:assert/strict";
import test from "node:test";
import {
  createCollapsedCollectionTreeState,
  expandAllCollectionNodes,
  getExpandableCollectionKeys,
  sortCollectionTreeNodes,
  type CollectionTreeSection,
} from "../src/modules/collection-tree";

const sections: CollectionTreeSection[] = [
  {
    key: "library:1",
    label: "My Library",
    children: [
      {
        key: "collection:1",
        label: "A",
        children: [
          { key: "collection:2", label: "A.1", children: [] },
          {
            key: "collection:3",
            label: "A.2",
            children: [{ key: "collection:4", label: "A.2.a", children: [] }],
          },
        ],
      },
      { key: "collection:5", label: "B", children: [] },
    ],
  },
];

test("collection tree starts collapsed", () => {
  const state = createCollapsedCollectionTreeState();

  assert.deepEqual([...state.expandedCollectionKeys], []);
});

test("expand all only expands nodes with children", () => {
  assert.deepEqual(getExpandableCollectionKeys(sections), [
    "collection:1",
    "collection:3",
  ]);

  const state = expandAllCollectionNodes(sections);
  assert.deepEqual(
    [...state.expandedCollectionKeys],
    ["collection:1", "collection:3"],
  );
});

test("collection nodes sort in Zotero main tree order", () => {
  const nodes = [
    { key: "collection:8", label: "8-Other", children: [] },
    { key: "collection:1", label: "1-Transmit", children: [] },
    { key: "collection:5", label: "5-Mode", children: [] },
    { key: "collection:6", label: "6-Clinic", children: [] },
    { key: "collection:4", label: "4-Processing", children: [] },
    { key: "collection:7", label: "7-Safety", children: [] },
    { key: "collection:3", label: "3-Beamforming", children: [] },
    { key: "collection:2", label: "2-Synthetic Aperture", children: [] },
  ];

  assert.deepEqual(
    sortCollectionTreeNodes(nodes).map((node) => node.label),
    [
      "1-Transmit",
      "2-Synthetic Aperture",
      "3-Beamforming",
      "4-Processing",
      "5-Mode",
      "6-Clinic",
      "7-Safety",
      "8-Other",
    ],
  );
});
