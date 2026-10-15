/**
 * Single place where game asset paths are resolved.
 *
 * The art files live in this repo under `public/icons/jobs/` — nothing here
 * points at a third-party CDN, so the roster renders offline and a dead
 * upstream host can't break it. Refresh or add a class with
 * `node scripts/fetch-game-icons.mjs`, which is the only thing in the project
 * that touches the network for assets.
 *
 * NOTE ON LICENSING: the art belongs to the game publisher, not to us. That is
 * acceptable for a private, non-commercial guild roster; do not publish or sell
 * this project without replacing these files.
 *
 * Paths, not URLs — the file layout under `public/icons/` matches what
 * `jobs.ts` stores, and the fetch script writes exactly these paths.
 */

import type { Job } from "./jobs";

/** Class icon, e.g. `/icons/jobs/icon_jsxq_big_213.webp` */
export function jobIconUrl(job: Pick<Job, "iconKey">): string {
  return `/icons/jobs/${job.iconKey}.webp`;
}