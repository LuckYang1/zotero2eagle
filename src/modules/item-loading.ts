export function getContentLibraries() {
  return Zotero.Libraries.getAll().filter(
    (library) => library.libraryType !== "feed",
  );
}

export function uniqueIDs(ids: Array<number | false | null | undefined>) {
  return [...new Set(ids.filter((id): id is number => typeof id === "number"))];
}

// getAsync() 用一次查询加载缺少的主数据，loadDataTypes() 按文库批量补齐尚未加载的
// 数据类型；Item.loadAllData() 不检查已加载状态，逐条目调用会对每个条目重复查询全部数据类型
export async function loadItemsWithData(ids: number[], dataTypes: string[]) {
  const items = (await Zotero.Items.getAsync(ids)) as Zotero.Item[];
  await Zotero.Items.loadDataTypes(items, dataTypes);
  return items;
}
