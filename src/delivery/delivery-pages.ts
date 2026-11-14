import { useInfiniteQuery } from "@tanstack/react-query";
import type { DeliveryPage, Load, WebhookDelivery } from "./owners";

// Paged webhook delivery lists (Tenkai #1327), newest first. The console shows
// the first page of each list and fetches the next one only when asked: no
// list is crawled to its end on its own, and a list with a cursor left is
// never presented as complete.

/** The page of one list a round asks for; no cursor is the first page. */
export type PageAsk = { key: string; cursor: string | undefined };

/** One list's answer in a round. */
export type PageFetch = PageAsk & { load: Load<DeliveryPage> };

export type DeliveryList = {
  key: string;
  /** The first page's outcome, holding every delivery shown so far once ok. */
  load: Load<WebhookDelivery[]>;
  /** Cursor of the next page; undefined once the list is complete. */
  next: string | undefined;
  /** The last next-page read failed; what was shown stays and the cursor is kept. */
  moreFailed: boolean;
};

/**
 * Folds the rounds fetched so far into one state per list. Later pages append
 * deliveries not shown yet (by id); a failed later page keeps the list and its
 * cursor so the same page can be asked again.
 */
export const deliveryLists = (rounds: PageFetch[][]): DeliveryList[] => {
  const lists = new Map<string, DeliveryList>();
  for (const { key, load } of rounds.flat()) {
    const list = lists.get(key);
    if (list === undefined) {
      lists.set(
        key,
        load.kind === "ok"
          ? {
              key,
              load: { kind: "ok", value: unique([], load.value.items) },
              next: load.value.next,
              moreFailed: false,
            }
          : { key, load, next: undefined, moreFailed: false },
      );
    } else if (list.load.kind === "ok") {
      lists.set(
        key,
        load.kind === "ok"
          ? {
              key,
              load: { kind: "ok", value: unique(list.load.value, load.value.items) },
              next: load.value.next,
              moreFailed: false,
            }
          : { ...list, moreFailed: true },
      );
    }
  }
  return [...lists.values()];
};

const unique = (shown: WebhookDelivery[], page: WebhookDelivery[]): WebhookDelivery[] => {
  const byId = new Map(shown.map((delivery) => [delivery.id, delivery]));
  for (const delivery of page) {
    if (!byId.has(delivery.id)) {
      byId.set(delivery.id, delivery);
    }
  }
  return [...byId.values()];
};

/** The next round: every list that still has a cursor, or undefined when none has. */
export const nextRound = (rounds: PageFetch[][]): PageAsk[] | undefined => {
  const due = deliveryLists(rounds).flatMap(({ key, next }) =>
    next === undefined ? [] : [{ key, cursor: next }],
  );
  return due.length === 0 ? undefined : due;
};

/**
 * The delivery lists named by `keys`, first pages up front and further pages
 * through `more`. A round never throws: a list that fails reads in its state.
 */
export const useDeliveryLists = (
  queryKey: readonly unknown[],
  keys: string[],
  read: (key: string, cursor: string | undefined) => Promise<Load<DeliveryPage>>,
) => {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) =>
      Promise.all(
        pageParam.map(async (ask): Promise<PageFetch> => ({
          ...ask,
          load: await read(ask.key, ask.cursor),
        })),
      ),
    initialPageParam: keys.map((key): PageAsk => ({ key, cursor: undefined })),
    getNextPageParam: (_last, rounds) => nextRound(rounds),
    retry: false,
  });
  return {
    /** Undefined until the first pages answer. */
    lists: query.data ? deliveryLists(query.data.pages) : undefined,
    more: () => void query.fetchNextPage(),
    loadingMore: query.isFetchingNextPage,
  };
};
