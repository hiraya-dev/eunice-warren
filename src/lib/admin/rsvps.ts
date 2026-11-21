import type {
  AdminNavCounts,
  AdminRsvpDetail,
  AdminRsvpList,
  AdminStore,
} from "./store";

export async function loadAdminRsvps(
  storeLoader: () => AdminStore,
  requested: string | null,
) {
  try {
    const store = storeLoader();
    const [data, detail, counts] = await Promise.all([
      store.getRsvpList(),
      requested ? store.getRsvpDetail(requested) : null,
      store.getNavCounts(),
    ]);
    return {
      data,
      detail,
      counts,
      failed: false,
      notFound: Boolean(requested && !detail),
    } satisfies {
      data: AdminRsvpList;
      detail: AdminRsvpDetail | null;
      counts: AdminNavCounts;
      failed: false;
      notFound: boolean;
    };
  } catch {
    return {
      data: null,
      detail: null,
      counts: undefined,
      failed: true,
      notFound: false,
    } satisfies {
      data: null;
      detail: null;
      counts: undefined;
      failed: true;
      notFound: false;
    };
  }
}
