import * as React from "react"
import { jobIconUrl } from "@/lib/rngw/icons"
import { getJob } from "@/lib/rngw/jobs"
import { cn } from "cn"

/**
 * Class icon with a graceful fallback.
 *
 * The path comes from lib/rngw/icons.ts, so swapping the asset source later
 * (e.g. to an openly licensed icon set) is a one-file change.
 *
 * Takes the class NAME (`Member.job`). A name jobs.ts doesn't know — a class
 * renamed out from under the data, or one typed by hand in the database — falls
 * back to initials taken from the stored string rather than to "?", so the
 * roster still shows which class was recorded.
 *
 * Plain <img> rather than next/image on purpose: these are already-optimised
 * 32px .webp files served straight out of `public/`, so the optimiser would
 * add nothing — and we need onError to swap in initials if a path is ever
 * renamed without re-running `scripts/fetch-game-icons.mjs`.
 */
export function GameIcon({
  job,
  className,
}: {
  job: string
  className?: string
}) {
  const [failed, setFailed] = React.useState(false)
  const entry = getJob(job)

  if (!entry || failed) {
    return (
      <span
        aria-hidden
        className={cn(
          "bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md text-[10px] font-semibold",
          className
        )}
      >
        {initials(job)}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={jobIconUrl(entry)}
      alt={job}
      title={job}
      loading="lazy"
      onError={() => setFailed(true)}
      className={cn("size-8 shrink-0 rounded-md object-contain", className)}
    />
  )
}

/** "Paladin" → "PA", "Lord Knight" → "LO". Empty falls back to "?". */
function initials(job: string): string {
  return job.trim().slice(0, 2).toUpperCase() || "?"
}