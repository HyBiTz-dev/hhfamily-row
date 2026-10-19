"use client"

import * as React from "react"
import { Plus, Search, Users, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useConfirm } from "@/components/confirm-dialog"
import { toast } from "sonner"
import { LaneBoard, type TeamInLane } from "@/components/events/league-lanes"
import { TeamCard } from "@/components/events/team-card"
import { NameDialog } from "@/components/events/name-dialog"
import { PartyDialog } from "@/components/events/party-dialog"
import { CheckInDialog } from "@/components/events/check-in-dialog"
import {
  MemberDropDialog,
  type MemberDropRequest,
} from "@/components/events/member-drop-dialog"
import { MemberPlacementProvider } from "@/components/member-placement"
import { useAdminSession } from "@/hooks/use-admin-session"
import {
  divisionHeadcount,
  getDivision,
  getEventCategory,
  partiesForDivision,
  partiesForEvent,
  partyRowId,
  partyRowKey,
  rowsForScope,
  setPartyPlacement,
  sortTeamsForScope,
  UNASSIGNED_ROW,
  type EventCategory,
  type EventCategoryId,
  type LeagueDivision,
  type LeagueDivisionId,
  type LeagueLane,
} from "@/lib/rngw/categories"
import { filterTeamsByQuery, teamMatchesQuery } from "@/lib/rngw/team-search"
import { TEAM_MAX_MEMBERS, foldRowName, swapMemberSeats } from "@/lib/party"
import type {
  EventRow,
  MemberStatus,
  Party,
  PartyPlacement,
  RosterResponse,
} from "@/lib/rngw/types"

/**
 * One screen per guild event, shared by /guild-war and /guild-league.
 *
 * A party plays an event through its placements, and the boxes it can be
 * dropped into are `event_rows` for that scope. The event pages are therefore
 * filters over one parties list and one rows list, not separate copies.
 *
 * Guild League carries a second level: the game fixes how many players each
 * division holds (ลีคหลัก 60, ลีครอง 90), so a division's capacity is a limit we
 * have to respect rather than a number we compute. Events without divisions
 * (Guild War) render the same components with `division` left undefined.
 */
export function EventBoard({ category }: { category: EventCategoryId }) {
  const meta = getEventCategory(category)

  const [parties, setParties] = React.useState<Party[]>([])
  const [eventRows, setEventRows] = React.useState<EventRow[]>([])
  const [members, setMembers] = React.useState<MemberStatus[]>([])
  // The guild-local day the statuses belong to, as the API reported it. Shown in
  // the check-in dialog so nobody reports the wrong day by accident.
  const [date, setDate] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Unsaved edits live here rather than in a state synced by an effect: until
  // the admin presses save, the database stays the truth and this page follows it.
  // Keyed by division id so switching tabs never loses work on the other one.
  const [drafts, setDrafts] = React.useState<Partial<Record<string, Party[]>>>({})

  // One box for the whole page: the guild master is looking for one name, and
  // typing it again after switching tabs would be the wrong default.
  const [query, setQuery] = React.useState("")

  const { authed, ready } = useAdminSession()

  /**
   * The parties snapshot version this page last saw. Every writer on the page —
   * the board's and the party dialog's — shares this one ref, so a write from
   * either keeps the other in step and none of them overwrites a newer save from
   * another tab. A ref, not state: a queued write must send what the previous
   * write in the queue produced, not the value from the render that queued it.
   */
  const partyVersion = React.useRef<number | null>(null)

  // One writer for the whole page: dropping a team into another lane saves on
  // the spot, and the tab editor saves on a button — same route, same PIN.
  // Declared with the other hooks because the early return below is conditional.
  const writer = usePartyWriter(setParties, partyVersion)

  React.useEffect(() => {
    let cancelled = false

    // Two independent reads; the roster is only used for icons and statuses,
    // so a failure there should not hide the teams.
    Promise.all([
      fetch("/api/parties", { cache: "no-store" }).then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "โหลดปาร์ตี้ไม่สำเร็จ")
        return {
          parties: Array.isArray(body.parties) ? (body.parties as Party[]) : [],
          eventRows: Array.isArray(body.eventRows)
            ? (body.eventRows as EventRow[])
            : [],
          version: typeof body.version === "number" ? body.version : 0,
        }
      }),
      fetch("/api/attendance", { cache: "no-store" }).then(async (res) => {
        const body = (await res.json()) as RosterResponse
        if (!res.ok) return { roster: [], date: undefined }
        return {
          roster: Array.isArray(body.roster) ? body.roster : [],
          date: body.date,
        }
      }),
    ])
      .then(([loaded, attendance]) => {
        if (cancelled) return
        setParties(loaded.parties)
        setEventRows(loaded.eventRows)
        partyVersion.current = loaded.version
        setMembers(attendance.roster)
        setDate(attendance.date)
        setError(null)
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  /**
   * Re-reads today's statuses after someone checks in from this page.
   *
   * The board draws every member's badge and the "มาวันนี้" counts from this
   * list, so a write that is not followed by a read leaves the person staring at
   * their own old status right after the toast said it was saved. Only the
   * roster is refetched: the teams did not change.
   *
   * A failed refresh is swallowed on purpose — the status *was* written, and
   * blanking the board over a flaky second request would look like the write
   * failed. The member can pull to refresh; the home page shows the same data.
   */
  const refreshRoster = React.useCallback(async () => {
    try {
      const res = await fetch("/api/attendance", { cache: "no-store" })
      const body = (await res.json()) as RosterResponse
      if (!res.ok || !Array.isArray(body.roster)) return
      setMembers(body.roster)
      setDate(body.date)
    } catch {
      // See above: the board stays on the last good copy.
    }
  }, [])

  // All hooks are above, so this early return is safe.
  if (!meta) return null

  const divisions = meta.divisions ?? []
  // Everyone already placed in this event, whatever division — used to keep the
  // two league tabs from handing the same player to both teams.
  const leagueTeams = partiesForEvent(parties, category)

  const scope = (key: string, teams: Party[]) => (
    <EventScope
      meta={meta}
      division={divisions.length > 0 ? getDivision(category, key as LeagueDivisionId) : undefined}
      teams={teams}
      all={parties}
      eventRows={eventRows}
      leagueTeams={leagueTeams}
      members={members}
      loading={loading}
      error={error}
      canEdit={ready && authed}
      writer={writer}
      query={query}
      date={date}
      versionRef={partyVersion}
      onStatusSaved={refreshRoster}
      onResetDrafts={() => setDrafts({})}
      onReplaceAll={setParties}
      onEventRowsChange={setEventRows}
    />
  )

  const searchBox = (
    <MemberSearchBox
      query={query}
      onChange={setQuery}
      // How many teams on this page still hold that name, so the box can say
      // whether the search found anything at all.
      found={leagueTeams.filter((team) =>
        teamMatchesQuery(team, query)
      ).length}
    />
  )

  if (divisions.length === 0) {
    const teams = drafts[category] ?? partiesForEvent(parties, category)
    return (
      <div className="space-y-4">
        {/*
          The same heading the league branch shows — without it the plain event
          page opened straight into the search box with no title at all.
        */}
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
          <p className="text-muted-foreground text-sm">{meta.description}</p>
        </div>

        {searchBox}
        {scope(category, teams)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{meta.title}</h1>
        <p className="text-muted-foreground text-sm">
          เกมแยกผู้เล่นเป็น {divisions.length} ลีก — จำนวนคนของแต่ละลีกถูกกำหนดมา ไม่ใช่ที่เว็บคำนวณ
        </p>
      </div>

      {searchBox}

      {/*
        A team labelled "Guild League" but no division is in neither tab, and
        there is no card for it any more: the guild master sets every team's
        division from the party builder, so surfacing half-assigned teams here
        only added a second place to fix the same label.
      */}

      <Tabs defaultValue={divisions[0].id} className="gap-4">
        <TabsList className="w-full max-w-sm">
          {divisions.map((division) => (
            <TabsTrigger key={division.id} value={division.id}>
              {division.label}
              <span className="text-muted-foreground tabular-nums">{division.capacity}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {divisions.map((division) => {
          const teams =
            drafts[division.id] ?? partiesForDivision(parties, category, division.id)
          return (
            <TabsContent key={division.id} value={division.id} className="space-y-4">
              {scope(division.id, teams)}
            </TabsContent>
          )
        })}
      </Tabs>
    </div>
  )
}

/**
 * "Which team am I in?" is the one thing every member opens this page for, so
 * it gets a box of its own above the tabs. It filters the cards down to the
 * teams holding that name, and says how many were found — a box that silently
 * hides everything is indistinguishable from a box that is broken.
 */
function MemberSearchBox({
  query,
  found,
  onChange,
}: {
  query: string
  /** Teams on this page holding the name; 0 when the query is empty. */
  found: number
  onChange: (next: string) => void
}) {
  const searching = query.trim().length > 0
  const inputId = "event-member-search"

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-1.5 sm:max-w-sm">
          <Label htmlFor={inputId}>ค้นหาชื่อของฉัน</Label>
          <InputGroup>
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
            <InputGroupInput
              id={inputId}
              value={query}
              // Members type their own name on a phone, so no autocorrect and
              // no autocapitalise to fight with.
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              placeholder="พิมพ์ชื่อตัวละคร"
              onChange={(event) => onChange(event.target.value)}
            />
            {searching && (
              <InputGroupAddon align="inline-end">
                {/*
                  The clear button goes inside the field, not next to it: on a
                  phone that is the reachable thumb position, and it has to
                  grow past 24px to be a comfortable tap.
                */}
                <InputGroupButton
                  variant="ghost"
                  size="icon-sm"
                  className="size-8 touch-manipulation"
                  aria-label="ล้างคำค้นหา"
                  onClick={() => onChange("")}
                >
                  <X />
                </InputGroupButton>
              </InputGroupAddon>
            )}
          </InputGroup>
        </div>

        {searching && (
          <p role="status" className="text-muted-foreground pb-2 text-sm">
            {found > 0 ? `พบ ${found} ทีมที่มีชื่อนี้` : "ไม่พบชื่อนี้ในทีมของอีเวนต์นี้"}
          </p>
        )}
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- one scope */

/**
 * One tab's worth of board: heading, team cards, and — for the guild master —
 * the editor. Shared by plain events and by each league division.
 */
function EventScope({
  meta,
  division,
  teams,
  all,
  eventRows,
  leagueTeams,
  members,
  loading,
  error,
  canEdit,
  writer,
  query,
  date,
  versionRef,
  onStatusSaved,
  onReplaceAll,
  onResetDrafts,
  onEventRowsChange,
}: {
  meta: EventCategory
  division: LeagueDivision | undefined
  teams: Party[]
  all: Party[]
  /** The boxes/rows of every scope, from the rows table. */
  eventRows: EventRow[]
  /** Every team of the event, used to spot players already placed elsewhere. */
  leagueTeams: Party[]
  members: MemberStatus[]
  loading: boolean
  error: string | null
  canEdit: boolean
  writer: PartyWriter
  /** What the member typed into "ค้นหาชื่อของฉัน". */
  query: string
  /** Guild-local day the check-in dialog reports for. */
  date?: string
  /**
   * Shared optimistic-lock token. The board's writer owns it; the party dialog
   * writes through the same ref so the two writers never knock each other into
   * a false 409.
   */
  versionRef: React.RefObject<number | null>
  /** Re-reads today's statuses after a member checks in from a card. */
  onStatusSaved: () => void
  /**
   * Replaces the whole parties tab on this page. The party dialog edits every
   * party at once, so its result cannot be folded into one scope's draft.
   */
  onReplaceAll: (next: Party[]) => void
  /**
   * Drops every tab's draft without re-reading. A member edit can touch a team
   * in another division, so the write goes to the whole tab and every draft has
   * to give way to the fresh base — but there is no reason to refetch what we
   * just wrote.
   */
  onResetDrafts: () => void
  /** Replaces the whole rows list after a box add/rename/delete/reorder. */
  onEventRowsChange: (next: EventRow[]) => void
}) {
  const byName = new Map(members.map((member) => [member.name, member]))
  const { confirm, dialog: confirmDialog } = useConfirm()

  /*
    Who is checking in, if anyone. A name rather than the member object so the
    dialog always reads the freshly refetched roster (the write replaces every
    `MemberStatus`), and so closing the dialog is one assignment.
  */
  const [checkInName, setCheckInName] = React.useState<string | null>(null)
  const checkInMember = checkInName ? byName.get(checkInName) ?? null : null

  /*
    A player dropped onto another player's row. The board only knows the two
    seats; this page asks whether that means "swap" or "add to this team".
  */
  const [memberDrop, setMemberDrop] = React.useState<MemberDropRequest | null>(
    null
  )

  /**
   * Writes the whole tab and, when the edit touched boxes, the whole rows list.
   *
   * Both are replaced rather than diffed, so a failed write must put both back.
   * Only the newest edit may roll back: writes queue, so an older failure can
   * land after a newer edit is already on screen.
   */
  const writeSeq = React.useRef(0)
  const save = async (
    next: Party[],
    successText: string,
    rows?: EventRow[]
  ): Promise<boolean> => {
    const previousParties = all
    const previousRows = eventRows
    const ticket = (writeSeq.current += 1)

    onReplaceAll(next)
    onResetDrafts()
    if (rows) onEventRowsChange(rows)

    const ok = await writer.write(next, successText, rows)
    if (!ok && writeSeq.current === ticket) {
      onReplaceAll(previousParties)
      if (rows) onEventRowsChange(previousRows)
      onResetDrafts()
    }
    return ok
  }

  const inThisScope = new Set(teams.flatMap((team) => team.memberNames))
  const inEvent = new Set(leagueTeams.flatMap((team) => team.memberNames))
  const presentInTeams = teams
    .flatMap((team) => team.memberNames)
    .filter((name) => byName.get(name)?.status === "present").length

  const headcount = divisionHeadcount(teams)
  const rosterSize = members.length
  // Nobody is "outside" a league division until we run out of people: the game
  // hands us two fixed numbers, so a full pair of divisions is a correct state.
  const unassigned = division ? Math.max(0, rosterSize - inEvent.size) : rosterSize - inThisScope.size
  const over = division ? Math.max(0, headcount - division.capacity) : 0
  const searching = query.trim().length > 0
  /*
    Team order is per event: the board reads each placement's `position` for
    this scope. The parties list still supplies the fallback order for rows
    written before per-scope positions existed.
  */
  const orderedTeams = React.useMemo(
    () => sortTeamsForScope(teams, meta.id),
    [teams, meta.id]
  )
  // Only the cards shrink; every number above stays about the whole division,
  // because a member searching for their name is still asking how big it is.
  const visibleTeams = filterTeamsByQuery(orderedTeams, query)

  /*
    The rows of this scope come straight from `event_rows`, including boxes that
    have no team in them. `rowsForScope` appends the virtual parking row ("ว่าง")
    last; it is a drop target, never a stored row.
  */
  const lanes: LeagueLane[] = rowsForScope(
    eventRows,
    meta.id,
    division?.id ?? null
  )
  /** The named boxes only — "ว่าง" is a parking spot, never reordered. */
  const namedRows = lanes.filter((row) => row.id !== UNASSIGNED_ROW.id)
  const laneTeams: TeamInLane[] = visibleTeams.map((team) => ({
    ...team,
    lane: partyRowKey(team, meta.id),
  }))
  const unparked = division
    ? orderedTeams.filter((team) => partyRowId(team, meta.id) === null).length
    : 0

  /**
   * Dropping a card changes only this event's placement. Other events and the
   * roster are untouched, so a shared team keeps its place on the other boards.
   */
  const moveTeamToRow = async (teamId: string, row: LeagueLane) => {
    const team = all.find((entry) => entry.id === teamId)
    if (!team) return

    const now = new Date().toISOString()
    const next = all.map((entry) =>
      entry.id === teamId
        ? {
            ...setPartyPlacement(
              entry,
              meta.id,
              division?.id ?? "",
              row.id === UNASSIGNED_ROW.id ? null : row.id
            ),
            updatedAt: now,
          }
        : entry
    )

    await save(next, `ย้าย ${team.name} ไป${row.label}แล้ว`)
  }

  /**
   * The teams of this scope in board order: one box after another, and within
   * each box the order stored in `party_placements.position`.
   *
   * Reordering works on the whole scope rather than on one box's slice, because
   * `position` is dense per event. Writing the flattened list keeps every other
   * box's relative order while giving the moved card a new dense position.
   */
  const teamOrderForScope = (): Party[] => {
    const byLane = new Map<string, Party[]>()
    for (const team of orderedTeams) {
      const lane = partyRowKey(team, meta.id)
      const list = byLane.get(lane) ?? []
      list.push(team)
      byLane.set(lane, list)
    }
    return lanes.flatMap((lane) => byLane.get(lane.id) ?? [])
  }

  /**
   * Saves a new per-event order. Only this event's placements move: the same
   * team on another board, and the parties tab's own order, are untouched.
   */
  const applyTeamOrder = async (ordered: Party[], successText: string) => {
    const order = new Map(ordered.map((team, index) => [team.id, index]))
    const now = new Date().toISOString()
    const next = all.map((party) => {
      const position = order.get(party.id)
      if (position === undefined) return party
      return {
        ...party,
        placements: party.placements.map((placement) =>
          placement.event === meta.id ? { ...placement, position } : placement
        ),
        updatedAt: now,
      }
    })
    await save(next, successText)
  }

  /** The keyboard path: swap a card with its neighbour inside the same box. */
  const moveTeamInRow = (teamId: string, delta: -1 | 1) => {
    const ordered = teamOrderForScope()
    const team = ordered.find((entry) => entry.id === teamId)
    if (!team) return

    const lane = partyRowKey(team, meta.id)
    const inRow = ordered.filter((entry) => partyRowKey(entry, meta.id) === lane)
    const at = inRow.findIndex((entry) => entry.id === teamId)
    const target = inRow[at + delta]
    if (!target) return

    const from = ordered.findIndex((entry) => entry.id === teamId)
    const to = ordered.findIndex((entry) => entry.id === target.id)
    ;[ordered[from], ordered[to]] = [ordered[to], ordered[from]]
    void applyTeamOrder(
      ordered,
      `เลื่อน ${target.name} ${delta < 0 ? "ขึ้น" : "ลง"} แล้ว`
    )
  }

  /** The drag path: put one card where another card sits in the same box. */
  const reorderTeam = async (fromId: string, toId: string) => {
    const ordered = teamOrderForScope()
    const from = ordered.findIndex((entry) => entry.id === fromId)
    const to = ordered.findIndex((entry) => entry.id === toId)
    if (from < 0 || to < 0 || from === to) return

    const [moved] = ordered.splice(from, 1)
    if (!moved) return
    ordered.splice(to, 0, moved)
    await applyTeamOrder(ordered, `สลับลำดับ ${moved.name} แล้ว`)
  }

  /**
   * Deletes a box, not the teams inside it.
   *
   * The teams lose the row id and appear in "ว่าง"; their rosters, names and
   * other events stay exactly as they were. An empty box is deleted without a
   * confirmation because there is nothing to lose.
   */
  const clearBox = async (row: LeagueLane) => {
    const inBox = teams.filter((team) => partyRowKey(team, meta.id) === row.id)

    if (inBox.length > 0) {
      const yes = await confirm({
        title: `ลบกล่อง “${row.label}”?`,
        description:
          `ทีมในกล่องนี้ ${inBox.length} ทีมจะย้ายไปกล่อง “${UNASSIGNED_ROW.label}” ` +
          "คนในทีมไม่หาย",
        confirmLabel: "ลบกล่อง",
        tone: "danger",
      })
      if (!yes) return
    }

    const now = new Date().toISOString()
    const next = all.map((party) => {
      if (!party.placements.some((p) => p.event === meta.id && p.rowId === row.id)) {
        return party
      }
      return {
        ...party,
        placements: party.placements.map((placement) =>
          placement.event === meta.id && placement.rowId === row.id
            ? { ...placement, rowId: null }
            : placement
        ),
        updatedAt: now,
      }
    })

    await save(
      next,
      `ลบกล่อง ${row.label} แล้ว`,
      eventRows.filter((entry) => entry.id !== row.id)
    )
  }

  /**
   * Adds an empty box. It is stored immediately, so it survives a refresh and
   * is visible from every device before a team has been dropped into it.
   */
  const addBox = (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error("ตั้งชื่อกล่องด้วยตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว")
      return
    }

    const scope = division?.id ?? ""
    const key = foldRowName(trimmed)
    if (
      eventRows.some(
        (row) =>
          row.event === meta.id &&
          row.division === scope &&
          foldRowName(row.name) === key
      )
    ) {
      toast.info(`มีกล่อง “${trimmed}” อยู่แล้ว`)
      return
    }

    const rowsInScope = eventRows.filter(
      (row) => row.event === meta.id && row.division === scope
    )
    const nextRows: EventRow[] = [
      ...eventRows,
      {
        id: crypto.randomUUID(),
        event: meta.id,
        division: scope,
        name: trimmed,
        position: rowsInScope.length,
      },
    ]

    void save(all, `เพิ่มกล่อง “${trimmed}” แล้ว — ลากทีมใส่ได้เลย`, nextRows)
  }

  /** A box rename is one row update; no team or placement is touched. */
  const renameBox = async (row: LeagueLane, nextName: string) => {
    const trimmed = nextName.trim()
    if (!trimmed) {
      toast.error("ตั้งชื่อกล่องด้วยตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว")
      return
    }
    if (trimmed === row.label) return

    const scope = division?.id ?? ""
    const key = foldRowName(trimmed)
    if (
      eventRows.some(
        (entry) =>
          entry.id !== row.id &&
          entry.event === meta.id &&
          entry.division === scope &&
          foldRowName(entry.name) === key
      )
    ) {
      toast.info(`มีกล่อง “${trimmed}” อยู่แล้ว`)
      return
    }

    const nextRows = eventRows.map((entry) =>
      entry.id === row.id ? { ...entry, name: trimmed } : entry
    )
    await save(all, `เปลี่ยนชื่อกล่องเป็น ${trimmed} แล้ว`, nextRows)
  }

  /**
   * Renames one team and replaces its event placements.
   *
   * The dialog may remove the event this board is showing, or switch a league
   * division. The whole parties tab is written, so the team lands exactly once
   * on the board it now names.
   */
  const renameTeam = async (
    teamId: string,
    nextName: string,
    nextPlacements: PartyPlacement[]
  ) => {
    const team = all.find((entry) => entry.id === teamId)
    if (!team) return
    const trimmed = nextName.trim()
    if (!trimmed) return

    const now = new Date().toISOString()
    const next = all.map((entry) =>
      entry.id === teamId
        ? { ...entry, name: trimmed, placements: nextPlacements, updatedAt: now }
        : entry
    )
    await save(
      next,
      trimmed === team.name
        ? "เปลี่ยนป้ายทีมแล้ว"
        : `เปลี่ยนชื่อทีมเป็น ${trimmed} แล้ว`
    )
  }

  /**
   * Rewrites the given teams' member lists in the whole parties tab.
   *
   * Member edits are not scoped to one tab: moving a player can take them off a
   * team in the other league division, and both teams have to land in the same
   * PUT or the board ends up half-changed. So the write is built from `all`
   * rather than this scope's slice, and every draft is then dropped — the tab
   * that lost the player keeps its own draft otherwise, and would keep showing
   * them there.
   */
  const writeMembers = async (changed: Party[], successText: string) => {
    const byId = new Map(changed.map((team) => [team.id, team.memberNames]))
    const now = new Date().toISOString()
    const nextAll = all.map((party) =>
      byId.has(party.id)
        ? { ...party, memberNames: byId.get(party.id)!, updatedAt: now }
        : party
    )
    const ok = await writer.write(nextAll, successText)
    if (ok) onResetDrafts()
    return ok
  }

  /**
   * Takes one member off a team. No confirmation: it is one tap to undo (add
   * them back) and the guild master removes people far more often than they add
   * a whole team, so a dialog on every tap would be noise.
   */
  const removeMember = async (teamId: string, name: string) => {
    const team = all.find((entry) => entry.id === teamId)
    if (!team || !team.memberNames.includes(name)) return

    await writeMembers(
      [{ ...team, memberNames: team.memberNames.filter((member) => member !== name) }],
      `เอา ${name} ออกจาก ${team.name} แล้ว`
    )
  }

  /**
   * Puts one member on a team.
   *
   * A player belongs to a single team, so when the name is already on another
   * team of this event — this division or the other one — the only write that
   * leaves the board consistent is a move, and a move must be confirmed because
   * the team they come from loses them. Both teams travel in the same PUT, so
   * the swap can never half-apply.
   */
  const addMember = async (teamId: string, name: string) => {
    const target = all.find((entry) => entry.id === teamId)
    if (!target || target.memberNames.includes(name)) return

    // The whole event, not just this tab: a player is in one team of one event.
    const others = leagueTeams.filter(
      (entry) => entry.id !== teamId && entry.memberNames.includes(name)
    )
    if (others.length > 0) {
      const from = others.map((entry) => entry.name).join(", ")
      const yes = await confirm({
        title: `${name} อยู่ทีม “${from}” อยู่แล้ว`,
        description: `ยืนยันย้าย ${name} มาที่ ${target.name}? ระบบจะเอาออกจาก ${from} ให้`,
        confirmLabel: "ย้ายมาทีมนี้",
        // A move takes them off another team — the same "removing something"
        // the danger tone is for.
        tone: "danger",
      })
      if (!yes) return
    }

    await writeMembers(
      [
        { ...target, memberNames: [...target.memberNames, name] },
        ...others.map((entry) => ({
          ...entry,
          memberNames: entry.memberNames.filter((member) => member !== name),
        })),
      ],
      others.length > 0
        ? `ย้าย ${name} มา ${target.name} แล้ว`
        : `เพิ่ม ${name} เข้า ${target.name} แล้ว`
    )
  }

  /**
   * The "เพิ่มเข้าทีม" half of a player-on-player drop.
   *
   * The dialog already confirmed it, so this writes straight away instead of
   * asking a second time. The dragged name is still taken off any other team of
   * the event, because a player sits on one team and a drop is a move.
   */
  const applyMemberAdd = async (teamId: string, name: string) => {
    const target = all.find((entry) => entry.id === teamId)
    if (!target || target.memberNames.includes(name)) return
    if (target.memberNames.length >= TEAM_MAX_MEMBERS) {
      toast.info(`${target.name} มีครบ ${TEAM_MAX_MEMBERS} คนแล้ว`)
      return
    }

    const others = leagueTeams.filter(
      (entry) => entry.id !== teamId && entry.memberNames.includes(name)
    )
    await writeMembers(
      [
        { ...target, memberNames: [...target.memberNames, name] },
        ...others.map((entry) => ({
          ...entry,
          memberNames: entry.memberNames.filter((member) => member !== name),
        })),
      ],
      `ย้าย ${name} มา ${target.name} แล้ว`
    )
  }

  /**
   * Swaps two players' seats on the same team — the board's reorder gesture.
   *
   * A name dropped onto another name *in the same card* changes the order the
   * team lists them in; nothing leaves the team, so it needs no dialog. The
   * array order is `party_members.slot`, and the cards always show that order,
   * so the swap is visible as soon as the write lands.
   */
  const reorderMember = async (
    teamId: string,
    name: string,
    targetName: string
  ) => {
    const team = all.find((entry) => entry.id === teamId)
    if (!team) return
    const memberNames = swapMemberSeats(team.memberNames, name, targetName)
    // Identity means the helper refused: a stale name or a drop on itself.
    if (memberNames === team.memberNames) return

    await writeMembers(
      [{ ...team, memberNames }],
      `สลับลำดับ ${name} กับ ${targetName} ใน ${team.name} แล้ว`
    )
  }

  /**
   * The "สลับที่นั่ง" half: the two names exchange teams, and both teams keep
   * their headcount. Both rows travel in the same PUT through `writeMembers`.
   */
  const applyMemberSwap = async (
    fromTeamId: string,
    name: string,
    targetTeamId: string,
    targetName: string
  ) => {
    const source = all.find((entry) => entry.id === fromTeamId)
    const target = all.find((entry) => entry.id === targetTeamId)
    if (!source || !target || source.id === target.id) return
    if (
      !source.memberNames.includes(name) ||
      !target.memberNames.includes(targetName)
    ) {
      return
    }

    await writeMembers(
      [
        {
          ...source,
          memberNames: source.memberNames.map((member) =>
            member === name ? targetName : member
          ),
        },
        {
          ...target,
          memberNames: target.memberNames.map((member) =>
            member === targetName ? name : member
          ),
        },
      ],
      `สลับ ${name} กับ ${targetName} แล้ว`
    )
  }

  /**
   * Saves a new order for the named boxes by updating their own positions.
   *
   * Team order is untouched: a box is a stored container now, not a side effect
   * of which team happens to be listed first.
   */
  const applyRowOrder = async (reordered: LeagueLane[], successText: string) => {
    const order = new Map(reordered.map((row, index) => [row.id, index]))
    const nextRows = eventRows.map((row) =>
      order.has(row.id) ? { ...row, position: order.get(row.id)! } : row
    )
    await save(all, successText, nextRows)
  }

  /** Drops box `fromId` where box `toId` sits — the drag path. */
  const moveRowTo = async (fromId: string, toId: string) => {
    const from = namedRows.findIndex((row) => row.id === fromId)
    const to = namedRows.findIndex((row) => row.id === toId)
    if (from < 0 || to < 0 || from === to) return
    const reordered = [...namedRows]
    const [moved] = reordered.splice(from, 1)
    if (!moved) return
    reordered.splice(to, 0, moved)
    await applyRowOrder(reordered, `ย้ายกล่อง ${moved.label} ไปอันดับ ${to + 1} แล้ว`)
  }

  /** The keyboard path for the same move: swap one box with its neighbour. */
  const moveRowBy = (rowId: string, delta: -1 | 1) => {
    const from = namedRows.findIndex((row) => row.id === rowId)
    const to = from + delta
    if (from < 0 || to < 0 || to >= namedRows.length) return
    const reordered = [...namedRows]
    ;[reordered[from], reordered[to]] = [reordered[to], reordered[from]]
    void applyRowOrder(reordered, `เลื่อนกล่อง ${reordered[to].label} แล้ว`)
  }

  const summary = division
    ? `${teams.length} ทีม · ${headcount}/${division.capacity} คน · มาวันนี้ ${presentInTeams} คน${
        unassigned > 0 ? ` · ยังไม่ได้เข้าลีก ${unassigned} คน` : ""
      }`
    : `${teams.length} ทีม · ${presentInTeams} คนมาวันนี้ · นอกทีม ${unassigned} คน`

  // While searching, the totals above still describe the whole division, so the
  // line has to say how much of it is actually on screen.
  const filteredNote = searching ? `แสดง ${visibleTeams.length} จาก ${teams.length} ทีม` : ""

  const body = (() => {
    if (loading) {
      return <p className="text-muted-foreground py-16 text-center text-sm">กำลังโหลดทีม…</p>
    }
    if (error) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>ยังโหลดไม่ได้</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      )
    }
    if (teams.length === 0) {
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Users />
            </EmptyMedia>
            <EmptyTitle>ยังไม่มีทีม {division ? division.title : meta.title}</EmptyTitle>
            <EmptyDescription>
              {division
                ? `ยังไม่มีทีมใน${division.title} — จัดทีมได้ที่แท็บ “ปาร์ตี้” ในหน้าผู้ดูแล โดยติ๊กชิป “${division.label}” ในป้ายกำกับ`
                : `ยังไม่มีทีมของ ${meta.title} — จัดทีมได้ที่แท็บ “ปาร์ตี้” ในหน้าผู้ดูแล โดยติ๊กชิป “${meta.label}” ในป้ายกำกับ`}
              {namedRows.length === 0 && (
                <span className="mt-1 block">
                  {canEdit
                    ? "ลีกนี้ยังไม่มีกล่องเลย — กด “เพิ่มกล่อง” ด้านบนเพื่อสร้างกล่องแรก"
                    : "ลีกนี้ยังไม่มีกล่อง — หัวหน้ากิลด์จะเพิ่มให้"}
                </span>
              )}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    if (searching && visibleTeams.length === 0) {
      // A different message from "no teams": the board is full, the name just
      // isn't in this division. Members are usually looking in the wrong tab.
      return (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Search />
            </EmptyMedia>
            <EmptyTitle>ไม่พบชื่อนี้ใน{division ? division.title : meta.title}</EmptyTitle>
            <EmptyDescription>
              {division
                ? `ลองดูอีกแท็บ — ชื่อของคุณอาจอยู่ใน${
                    (meta.divisions ?? [])
                      .filter((entry) => entry.id !== division.id)
                      .map((entry) => entry.title)
                      .join(" หรือ ") || "ลีกอื่น"
                  }`
                : "ลองพิมพ์เฉพาะบางส่วนของชื่อ หรือเช็คว่าหัวหน้ากิลด์ใส่ชื่อคุณไว้แล้วหรือยัง"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    // Members read the board, so they get the plain rows — dragging is the
    // guild master's job and needs a signed-in session to mean anything.
    if (lanes.length > 0 && canEdit) {
      return (
        <LaneBoard
          lanes={lanes}
          teams={laneTeams}
          byName={byName}
          members={members}
          unparked={unparked}
          query={query}
          onMoveTeam={moveTeamToRow}
          // Every row is the guild master's: league boxes are not game lanes.
          onReorderRow={moveRowTo}
          onMoveRow={moveRowBy}
          onReorderTeam={reorderTeam}
          onMoveTeamInRow={moveTeamInRow}
          onRenameRow={renameBox}
          onRenameTeam={renameTeam}
          onRemoveMember={removeMember}
          onAddMember={addMember}
          onMemberDrop={setMemberDrop}
          onReorderMember={reorderMember}
          onDeleteRow={clearBox}
          onCheckIn={setCheckInName}
        />
      )
    }
    if (lanes.length > 0) {
      return (
        <div className="space-y-3">
          {lanes.map((lane) => (
            <LaneRowReadonly
              key={lane.id}
              label={lane.label}
              teams={laneTeams.filter((team) => team.lane === lane.id)}
              byName={byName}
              query={query}
              onCheckIn={setCheckInName}
            />
          ))}
        </div>
      )
    }
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {visibleTeams.map((team) => (
          <TeamCard
            key={team.id}
            team={team}
            byName={byName}
            query={query}
            onCheckIn={setCheckInName}
          />
        ))}
      </div>
    )
  })()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {division ? (
            <>
              <h2 className="text-xl font-semibold tracking-tight">
                {division.title}
                <span className="text-muted-foreground ml-2 text-sm font-normal">
                  {headcount}/{division.capacity} คน
                </span>
              </h2>
              {over > 0 && (
                <p className="text-destructive text-sm">
                  เกินที่เกมกำหนด {over} คน — ต้องเอาออกให้เหลือ {division.capacity} คนก่อนแข่ง
                </p>
              )}
            </>
          ) : null}
          <p className="text-muted-foreground text-sm">{summary}</p>
          {filteredNote && (
            <p className="text-sm font-medium">{filteredNote}</p>
          )}
          {members.length > 0 && teams.length > 0 && (
            <p className="text-muted-foreground text-sm">
              แตะชื่อของตัวเองบนการ์ดเพื่อแจ้ง “มา” หรือ “ลา” ของวันนี้
            </p>
          )}
        </div>
        <Badge variant="outline" className="shrink-0">
          อัปเดต {latestUpdate(teams)}
        </Badge>
      </div>

      {/*
        Admin controls, right above the board they act on. The party dialog is
        the only place teams are built now that the inline editor is gone, so it
        is offered on every event page; "เพิ่มกล่อง" is offered on every page
        too, because league boxes are the guild master's now, not the game's.
      */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <PartyDialog
            members={members}
            parties={all}
            eventRows={eventRows}
            versionRef={versionRef}
            // The dialog rewrites the whole tab, so the page takes its result
            // and drops every scope's draft — a draft that still held the old
            // teams would otherwise shadow the fresh base.
            onChange={(next) => {
              onReplaceAll(next)
              onResetDrafts()
            }}
          />
          <NameDialog
            trigger={
              <Button variant="outline" className="touch-manipulation">
                <Plus /> เพิ่มกล่อง
              </Button>
            }
            title="เพิ่มกล่อง"
            description="พิมพ์ชื่อกล่อง เช่น กล่อง A, ทีมห้องหิน แล้วลากทีมจากกล่อง “ว่าง” ใส่ได้เลย — กล่องว่างจะอยู่ต่อแม้ยังไม่มีทีม"
            fieldLabel="ชื่อกล่อง"
            placeholder="เช่น กล่อง A"
            submitLabel="เพิ่มกล่อง"
            onSubmit={addBox}
          />
        </div>
      )}

      {/*
        The add-member dropdown inside the board reads which parties each player
        is already on (for its order and its "อยู่ปาร์ตี้ …" note) from context,
        so the whole teams tab is provided here rather than threaded down.
      */}
      <MemberPlacementProvider parties={all}>{body}</MemberPlacementProvider>

      {canEdit && confirmDialog}

      {canEdit && memberDrop && (
        <MemberDropDialog
          request={memberDrop}
          parties={all}
          onCancel={() => setMemberDrop(null)}
          onSwap={() => {
            const request = memberDrop
            setMemberDrop(null)
            void applyMemberSwap(
              request.fromTeamId,
              request.name,
              request.targetTeamId,
              request.targetName
            )
          }}
          onAdd={() => {
            const request = memberDrop
            setMemberDrop(null)
            void applyMemberAdd(request.targetTeamId, request.name)
          }}
        />
      )}

      {/*
        Rendered only while a name is picked: mounting fresh per person means the
        dialog's selected status starts from that member's status on record,
        without an effect resetting state when the roster refetches.
      */}
      {checkInMember && (
        <CheckInDialog
          member={checkInMember}
          date={date}
          onClose={() => setCheckInName(null)}
          onSaved={onStatusSaved}
        />
      )}
    </div>
  )
}

function LaneRowReadonly({
  label,
  teams,
  byName,
  query,
  onCheckIn,
}: {
  label: string
  teams: TeamInLane[]
  byName: Map<string, MemberStatus>
  query: string
  onCheckIn?: (name: string) => void
}) {
  const players = teams.reduce((total, team) => total + team.memberNames.length, 0)
  const searching = query.trim().length > 0

  return (
    <div className="bg-muted/30 flex flex-col gap-2 rounded-xl border border-dashed p-2">
      <div className="flex flex-wrap items-baseline gap-2 px-1">
        <p className="text-base font-semibold">{label}</p>
        <p className="text-muted-foreground text-xs tabular-nums">
          {searching ? `พบ ${teams.length} ทีม` : `${teams.length} ทีม · ${players} คน`}
        </p>
      </div>
      {teams.length === 0 ? (
        <p className="text-muted-foreground px-1 py-6 text-center text-xs">
          {searching ? "ไม่มีทีมที่ตรงกับชื่อที่ค้นหา" : "ยังไม่มีทีม"}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {teams.map((team) => (
            // Same width as the guild master's board: the two views are the
            // same rows of teams, and a narrower card fit one extra per line
            // (5 vs 4) while clipping long names the wider card holds.
            <div key={team.id} className="w-full max-w-72">
              <TeamCard
                team={team}
                byName={byName}
                query={query}
                onCheckIn={onCheckIn}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** Newest edit across the teams, so the page says how fresh it is. */
function latestUpdate(teams: Party[]): string {
  const newest = teams.reduce(
    (latest, team) => (team.updatedAt > latest ? team.updatedAt : latest),
    ""
  )
  if (!newest) return "—"
  const parsed = new Date(newest)
  if (Number.isNaN(parsed.getTime())) return "—"
  return parsed.toLocaleString("th-TH", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/* ----------------------------------------------------------------- admin */

/**
 * The one place that talks to PUT /api/admin/parties.
 *
 * The route replaces the whole parties tab, so every party that is not part of
 * this edit has to travel in the body or it disappears from the database — which
 * is why callers hand it a fully merged list rather than just their own teams.
 *
 * Success and failure both go to a toast rather than to a line of text in the
 * card: the guild master drags a team, scrolls on and closes the tab, and a
 * message pinned halfway up the editor is gone before they read it. A write
 * that failed has to survive a scroll.
 */
function usePartyWriter(
  onSaved: (next: Party[]) => void,
  versionRef: React.RefObject<number | null>
) {
  const [busy, setBusy] = React.useState(false)

  /**
   * Writes go one at a time, in the order they were made.
   *
   * PUT replaces the whole list, so two writes in flight could finish in either
   * order and the slower one would win with a stale snapshot — a team dragged
   * twice would land back where it started.
   *
   * This replaces an `if (busy) return false` guard. That guard dropped the
   * second edit of any two quick taps on the floor without a word to the guild
   * master — the card sprang back and nothing explained why. Queueing costs the
   * same wall time as refusing, minus the lost edit.
   */
  const queue = React.useRef<Promise<unknown>>(Promise.resolve())
  /** Counts queued writes; only the newest one may clear `busy`. */
  const seq = React.useRef(0)

  /**
   * Resolves true when the database took it; false after showing the error.
   *
   * `rows` is passed only by box edits. Member/team edits leave the rows table
   * alone, so omitting it keeps those writes as small as they were.
   */
  function write(
    merged: Party[],
    successText: string,
    rows?: EventRow[]
  ): Promise<boolean> {
    setBusy(true)
    const ticket = (seq.current += 1)

    const result = queue.current.then(async () => {
      try {
        const payload: Record<string, unknown> = { parties: merged }
        if (rows) payload.eventRows = rows
        // The token this tab read with the list. Left out while it is unknown
        // (the first load failed), which falls back to a plain replace.
        if (versionRef.current !== null) payload.version = versionRef.current

        const res = await fetch("/api/admin/parties", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // No PIN in the body: the encrypted session cookie carries it, and the
          // route hands it to the script that re-checks it.
          body: JSON.stringify(payload),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "บันทึกไม่สำเร็จ")
        // The next queued write must send the version this one produced, or it
        // would 409 against a snapshot that is already on screen.
        if (typeof body.version === "number") versionRef.current = body.version

        onSaved(merged)
        toast.success(successText)
        return true
      } catch (cause) {
        toast.error((cause as Error).message)
        return false
      } finally {
        // An older write finishing must not report "idle" while a newer one is
        // still on its way to the database.
        if (seq.current === ticket) setBusy(false)
      }
    })

    // A rejected link would stall every write queued behind it; `result` never
    // rejects anyway, since the catch above turns failures into `false`.
    queue.current = result.catch(() => undefined)
    return result
  }

  return { busy, write }
}

/** What `usePartyWriter` hands to the lane board. */
export type PartyWriter = ReturnType<typeof usePartyWriter>;
