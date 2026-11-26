import { createHash } from "node:crypto";
import { mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const adminLock = join(
  tmpdir(),
  `eunice-warren-admin-editor-${createHash("sha1").update(process.cwd()).digest("hex").slice(0, 12)}`,
);

export const withAdminLock = async (run: () => Promise<void>) => {
  for (;;) {
    try {
      mkdirSync(adminLock);
      break;
    } catch {
      try {
        if (Date.now() - statSync(adminLock).mtimeMs > 60_000)
          rmSync(adminLock, { recursive: true, force: true });
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try {
    await run();
  } finally {
    rmSync(adminLock, { recursive: true, force: true });
  }
};
