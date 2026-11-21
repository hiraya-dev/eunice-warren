import type { AdminRsvpDetail, AdminRsvpList, AdminStore } from "./store";

export async function loadAdminRsvps(
  storeLoader: () => AdminStore,
  requested: string | null,
) {
  try {
    const store = storeLoader();
    const data = await store.getRsvpList();
    const detail = requested ? await store.getRsvpDetail(requested) : null;
    return {
      data,
      detail,
      failed: false,
      notFound: Boolean(requested && !detail),
    } satisfies {
      data: AdminRsvpList;
      detail: AdminRsvpDetail | null;
      failed: false;
      notFound: boolean;
    };
  } catch {
    return {
      data: null,
      detail: null,
      failed: true,
      notFound: false,
    } satisfies {
      data: null;
      detail: null;
      failed: true;
      notFound: false;
    };
  }
}
