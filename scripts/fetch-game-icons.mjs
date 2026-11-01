/**
 * One-off: mirror the game class icons into `public/icons/jobs/`.
 *
 * Run `node scripts/fetch-game-icons.mjs` when a path in `lib/rngw/jobs.ts`
 * changes or a new class is added. It skips files that already exist — pass
 * `--force` to re-download everything. Normal builds never hit the network:
 * the app only reads the copies in `public/icons/`.
 *
 * The list below mirrors `JOBS` in lib/rngw/jobs.ts. Only the icon keys are
 * duplicated — portraits were dropped because nothing rendered them.
 *
 * NOTE ON LICENSING: these art assets belong to the publisher, not to us.
 * Keeping them in the repo is fine for a private, non-commercial guild
 * roster; do not publish or sell this project without replacing them.
 */

import { mkdir, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"

const SOURCE_BASE = "https://roworlddb.com/media/images/"
const OUT_ROOT = path.join(import.meta.dirname, "..", "public", "icons", "jobs")

const ICON_KEYS = [
  "icon_jsxq_big_213",
  "icon_jsxq_big_223",
  "icon_jsxq_big_313",
  "icon_jsxq_big_323",
  "icon_jsxq_big_413",
  "icon_jsxq_big_423",
  "icon_jsxq_big_433",
  "icon_jsxq_big_513",
  "icon_jsxq_big_523",
  "icon_jsxq_big_613",
  "icon_jsxq_big_623",
  "icon_jsxq_big_713",
  "icon_jsxq_big_723",
  "icon_jsxq_big_813",
  "icon_jsxq_big_913",
]

const force = process.argv.includes("--force")

for (const iconKey of ICON_KEYS) {
  const local = path.join(OUT_ROOT, `${iconKey}.webp`)
  if (!force && existsSync(local)) {
    console.log(`skip   ${iconKey}.webp (already local)`)
    continue
  }
  const response = await fetch(`${SOURCE_BASE}job/${iconKey}.webp`)
  if (!response.ok) {
    console.error(`FAIL   job/${iconKey}.webp -> ${response.status}`)
    process.exitCode = 1
    continue
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  await mkdir(OUT_ROOT, { recursive: true })
  await writeFile(local, bytes)
  console.log(`ok     ${iconKey}.webp (${(bytes.length / 1024).toFixed(1)} kB)`)
}