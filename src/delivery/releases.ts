import type { ReleaseListEntry, ReleasePage } from "../api/tenkai.gen";

const MAX_PAGES = 100;

/** Follow `next_cursor` until the catalog is exhausted or `MAX_PAGES`. */
export const collectReleasePages = async (
  fetchPage: (cursor: string | undefined) => Promise<ReleasePage>,
): Promise<ReleasePage> => {
  const items: ReleaseListEntry[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const batch = await fetchPage(cursor);
    items.push(...batch.items);
    if (!batch.next_cursor) {
      return { items };
    }
    cursor = batch.next_cursor;
  }
  throw new Error("v1/releases: catalog exceeds 100 pages");
};
