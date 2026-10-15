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
import { MemberPlacementProvider } from "@/components/member-placement"
import { useAdminSession } from "@/hooks/use-admin-session"
import {
  boxRow,
  divisionHeadcount,
  getDivision,
  getEventCategory,
  hasExplicitLane,
  laneContentLabel,
  matchRow,
  partiesForDivision,
  partiesForEvent,
  replaceDivisionParties,
  replaceEventParties,
  rowContentLabel,
  rowsForScope,
  setEventSegment,
  UNASSIGNED_ROW,
  type EventCategory,
  type EventCategoryId,
  type LeagueDivision,
  type LeagueDivisionId,
  type LeagueLane,
} from "@/lib/rngw/categories"
import { filterTeamsByQuery, teamMatchesQuery } from "@/lib/rngw/team-search"
import { stripCustomLabels } from "@/lib/party"
import type { MemberStatus, Party, RosterResponse } from "@/lib/rngw/types"

/**
 * One screen per guild event, shared by /guild-war and /guild-league.
 *
 * There is no per-event data on the database: both pages are filters over the
 * same parties tab, told apart by `Party.content` (see lib/rngw/categories.ts).
 * That is also why the editor has to send back every other party's row — see
 * `replaceEventParties`.
 *
 * Guild League carries a second level: the game fixes how many players each
 * division holds (ลีคหลัก 60, ลีครอง 90), so a division's capacity is a limit we
 * have to respect rather than a number we compute. Events without divisions
 * (Guild War) render the same components with `division` left undefined.
 */
export function EventBoard({ category }: { category: EventCategoryId }) {
  const meta = getEventCategory(category)

  const [parties, setParties] = React.useState<Party[]>([])
  const [members, setMembers] = React.useState<MemberStatus[]>([])
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

  // One writer for the whole page: dropping a team into another lane saves on
  // the spot, and the tab editor saves on a button — same route, same PIN.
  // Declared with the other hooks because the early return below is conditional.
  const writer = usePartyWriter(setParties)

  React.useEffect(() => {
    let cancelled = false

    // Two independent reads; the roster is only used for icons and statuses,
    // so a failure there should not hide the teams.
    Promise.all([
      fetch("/api/parties", { cache: "no-store" }).then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "โหลดปาร์ตี้ไม่สำเร็จ")
        return Array.isArray(body.parties) ? (body.parties as Party[]) : []
      }),
      fetch("/api/attendance", { cache: "no-store" }).then(async (res) => {
        const body = (await res.json()) as RosterResponse
        if (!res.ok) return []
        return Array.isArray(body.roster) ? body.roster : []
      }),
    ])
      .then(([loadedParties, loadedMembers]) => {
        if (cancelled) return
        setParties(loadedParties)
        setMembers(loadedMembers)
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

  // All hooks are above, so this early return is safe.
  if (!meta) return null

  const divisions = meta.divisions ?? []
  // Everyone already placed in this event, whatever division — used to keep the
  // two league tabs from handing the same player to both teams.
  const leagueTeams = partiesForEvent(parties, category)

  const setDraft = (key: string, next: Party[]) =>
    setDrafts((current) => ({ ...current, [key]: next }))

  const scope = (key: string, teams: Party[]) => (
    <EventScope
      meta={meta}
      division={divisions.length > 0 ? getDivision(category, key as LeagueDivisionId) : undefined}
      teams={teams}
      all={parties}
      leagueTeams={leagueTeams}
      members={members}
      loading={loading}
      error={error}
      canEdit={ready && authed}
      writer={writer}
      query={query}
      onChange={(next) => setDraft(key, next)}
      onResetDrafts={() => setDrafts({})}
      onReplaceAll={setParties}
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
  leagueTeams,
  members,
  loading,
  error,
  canEdit,
  writer,
  query,
  onChange,
  onReplaceAll,
  onResetDrafts,
}: {
  meta: EventCategory
  division: LeagueDivision | undefined
  teams: Party[]
  all: Party[]
  /** Every team of the event, used to spot players already placed elsewhere. */
  leagueTeams: Party[]
  members: MemberStatus[]
  loading: boolean
  error: string | null
  canEdit: boolean
  writer: PartyWriter
  /** What the member typed into "ค้นหาชื่อของฉัน". */
  query: string
  onChange: (next: Party[]) => void
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
}) {
  const byName = new Map(members.map((member) => [member.name, member]))
  const { confirm, dialog: confirmDialog } = useConfirm()

  /*
    Boxes the guild master just added but that no team carries yet.

    Nothing stores the list of Guild War boxes — a box exists only as a suffix on
    its teams' `content` — so a brand-new empty box has nowhere to live but this
    component. Once a team is dragged in, the write below puts the name on the
    team and `rowsForScope` returns the box itself; the local copy is then
    deduped by id and stops mattering. Deleting the box drops it either way.
  */
  const [extraBoxes, setExtraBoxes] = React.useState<LeagueLane[]>([])

  /**
   * Writes this scope's optimistic change and rolls it back if the database says no.
   *
   * `previous` is what the scope held before the edit. Only the newest edit may
   * roll back: writes queue, so an older one can fail after a newer one has
   * already put a different list on screen, and reverting then would show a
   * state that no successful write ever produced.
   */
  const writeSeq = React.useRef(0)
  const commit = async (merged: Party[], successText: string, previous: Party[]) => {
    const ticket = (writeSeq.current += 1)
    const ok = await writer.write(merged, successText)
    if (!ok && writeSeq.current === ticket) onChange(previous)
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
  // Only the cards shrink; every number above stays about the whole division,
  // because a member searching for their name is still asking how big it is.
  const visibleTeams = filterTeamsByQuery(teams, query)

  /*
    The rows of this scope: a division's lanes are fixed by the game, while
    Guild War's boxes are whatever the teams currently say — see
    `rowsForScope`. An event with neither (nothing matched, or a category
    without rows) falls through to the plain grid below.

    `rowsForScope` already ends with the parking row ("ว่าง"); brand-new boxes
    that no team carries yet are slotted in just above it, so a box the guild
    master just added always lands among the named boxes, not under the parking.
  */
  const derivedRows = !division && Boolean(meta.derivedRows)
  const baseRows: LeagueLane[] = division
    ? [...(division.lanes ?? [])]
    : rowsForScope(teams, meta.id, null)
  const lanes: LeagueLane[] = derivedRows ? withExtraBoxes(baseRows, extraBoxes) : baseRows
  /** The named boxes only — "ว่าง" is a parking spot, never reordered. */
  const namedRows = lanes.filter((row) => row.suffix !== "")
  const laneTeams: TeamInLane[] =
    lanes.length
      ? filterTeamsByQuery(teams, query).map((team) => ({
          ...team,
          lane: matchRow(team.content, meta.id, division?.id ?? null) ?? "",
        }))
      : []
  const unparked = division
    ? laneTeams.filter((team) => !hasExplicitLane(team.content, meta.id, division.id)).length
    : 0

  /** Swaps this scope's teams inside the whole parties tab. */
  const merge = (next: Party[]) =>
    division
      ? replaceDivisionParties(all, meta.id, division.id, next)
      : replaceEventParties(all, meta.id, next)

  /**
   * Dropping a card saves straight away, so the board has to move first and
   * then tell the truth: the draft shows the new row while the database write is
   * still in flight, and goes back where it was if the write fails.
   */
  const moveTeamToRow = async (teamId: string, row: LeagueLane) => {
    const team = teams.find((entry) => entry.id === teamId)
    if (!team) return

    const next = teams.map((entry) =>
      entry.id === teamId
        ? {
            ...entry,
            // Only *this* event's segment is rewritten: the label may also name
            // other events, and a shared team must not drop off their pages.
            // The label is derived from this scope, so a team can never end up
            // with the other league's lane or another box's name.
            content: setEventSegment(
              entry.content,
              meta.id,
              division ? laneContentLabel(division, row) : rowContentLabel(meta.id, row)
            ),
            updatedAt: new Date().toISOString(),
          }
        : entry
    )
    onChange(next)

    await commit(merge(next), `ย้าย ${team.name} ไป${row.label}แล้ว`, teams)
  }

  /**
   * Removes a Guild War box by taking the box name off its teams, not by
   * deleting them.
   *
   * Nothing stores the list of boxes, so a box exists exactly as long as a team
   * carries its name — the only way to make it go is to rewrite those labels,
   * which drops the teams into `UNASSIGNED_ROW`. Deleting them instead would
   * throw away the rosters of every team that happened to be in the box, for a
   * mistake that is one button press away.
   */
  const clearBox = async (row: LeagueLane) => {
    // A box the guild master just added has no teams to relabel yet — dropping
    // it from local state is the whole delete, and nothing is lost.
    setExtraBoxes((current) => current.filter((box) => box.id !== row.id))

    const inBox = teams.filter(
      (team) => matchRow(team.content, meta.id, division?.id ?? null) === row.id
    )
    if (inBox.length === 0) return

    const yes = await confirm({
      title: `ลบกล่อง “${row.label}”?`,
      description:
        `ชื่อกล่องจะถูกถอดออกจากทีมในกล่องนี้ ${inBox.length} ทีม ` +
        `ทีมทั้งหมดจะย้ายไปกล่อง “${UNASSIGNED_ROW.label}” คนในทีมไม่หาย`,
      confirmLabel: "ถอดชื่อกล่อง",
      tone: "danger",
    })
    if (!yes) return

    const now = new Date().toISOString()
    const next = teams.map((team) =>
      inBox.includes(team)
        ? {
            ...team,
            content: setEventSegment(
              team.content,
              meta.id,
              rowContentLabel(meta.id, UNASSIGNED_ROW)
            ),
            updatedAt: now,
          }
        : team
    )
    onChange(next)
    await commit(merge(next), `ลบกล่อง ${row.label} แล้ว`, teams)
  }

  /**
   * Adds an empty Guild War box so teams can be dragged into it.
   *
   * The box is only a drop target until a team lands in it: `moveTeamToRow`
   * writes the name onto that team and the box becomes real on the database. A
   * name that already exists is refused, so two rows never claim one box.
   */
  const addBox = (name: string) => {
    const box = boxRow(name)
    if (!box.id) {
      toast.error("ตั้งชื่อกล่องด้วยตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว")
      return
    }
    if (lanes.some((row) => row.id === box.id)) {
      toast.info(`มีกล่อง “${box.label}” อยู่แล้ว`)
      return
    }
    setExtraBoxes((current) => [...current, box])
    toast.success(`เพิ่มทีมใหญ่ “${box.label}” แล้ว — ลากทีมใส่ได้เลย`)
  }

  /**
   * Renames a Guild War box by rewriting the label on the teams inside it.
   *
   * A box has no row of its own anywhere — it exists only as the suffix on its
   * teams' `content` — so renaming one is the same write as moving a team: put
   * the new box on every team that was in the old one. Team order is left
   * alone, and `rowsForScope` derives boxes in first-appearance order, so the
   * box keeps its place in the list and nobody changes box on the way.
   */
  const renameBox = async (row: LeagueLane, nextName: string) => {
    const next = boxRow(nextName)
    if (!next.id) {
      toast.error("ตั้งชื่อกล่องด้วยตัวอักษรหรือตัวเลขอย่างน้อย 1 ตัว")
      return
    }
    if (next.id === row.id) return
    if (next.id === UNASSIGNED_ROW.id || lanes.some((entry) => entry.id === next.id)) {
      toast.info(`มีกล่อง “${next.label}” อยู่แล้ว`)
      return
    }

    // A box that is still empty lives only in local state — renaming it is
    // local too, nothing to write.
    setExtraBoxes((current) => current.map((box) => (box.id === row.id ? next : box)))

    const inBox = teams.filter(
      (team) => matchRow(team.content, meta.id, division?.id ?? null) === row.id
    )
    if (inBox.length === 0) {
      toast.success(`เปลี่ยนชื่อกล่องเป็น ${next.label} แล้ว`)
      return
    }

    const now = new Date().toISOString()
    const relabelled = teams.map((team) =>
      inBox.includes(team)
        ? {
            ...team,
            content: setEventSegment(team.content, meta.id, rowContentLabel(meta.id, next)),
            updatedAt: now,
          }
        : team
    )
    onChange(relabelled)
    await commit(merge(relabelled), `เปลี่ยนชื่อกล่องเป็น ${next.label} แล้ว`, teams)
  }

  /**
   * Renames one team (ทีมย่อย), and relabels it if the dialog changed the label.
   *
   * The members, the id and — unless the label itself changes — the box stay
   * where they are, so nothing shifts on the board beyond the edit. The label is
   * the one field that can move a team off this page: unticking this event sends
   * it to the "ว่าง" row of every page, ticking another one adds it there. The
   * write goes out as the whole parties tab either way (`merge`), so a team that
   * just changed division is in the list once, under the division it now names.
   */
  const renameTeam = async (teamId: string, nextName: string, nextContent: string) => {
    const team = teams.find((entry) => entry.id === teamId)
    if (!team) return
    const trimmed = nextName.trim()
    const labelled = stripCustomLabels(nextContent)
    if (!trimmed) return
    if (trimmed === team.name && labelled === team.content) return

    const now = new Date().toISOString()
    const next = teams.map((entry) =>
      entry.id === teamId ? { ...entry, name: trimmed, content: labelled, updatedAt: now } : entry
    )
    onChange(next)
    await commit(
      merge(next),
      trimmed === team.name ? "เปลี่ยนป้ายทีมแล้ว" : `เปลี่ยนชื่อทีมเป็น ${trimmed} แล้ว`,
      teams
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
   * Saves a new order for the named boxes.
   *
   * There is nowhere to store a box order — a box is only a label on its teams
   * — so the one way to say "ทีมใหญ่ 2 มาก่อน ทีมใหญ่ 1" is to reorder the teams
   * themselves and write the tab back. Grouping them into the new order is what
   * makes `rowsForScope` derive the boxes that way on the next load.
   */
  const applyRowOrder = async (reordered: LeagueLane[], successText: string) => {
    const boxOf = (team: Party) => matchRow(team.content, meta.id, null)
    const grouped = reordered.flatMap((row) => teams.filter((team) => boxOf(team) === row.id))
    // Teams sitting in no named box (the parking row) keep their order at the end.
    const rest = teams.filter((team) => !reordered.some((row) => row.id === boxOf(team)))
    const next = [...grouped, ...rest]

    // Empty boxes exist only in local state, so their order has to move here too.
    setExtraBoxes((current) =>
      reordered.filter((row) => current.some((box) => box.id === row.id))
    )

    onChange(next)
    await commit(merge(next), successText, teams)
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
                ? `ยังไม่มีทีมใน${division.title} — จัดทีมได้ที่แท็บ “ปาร์ตี้” ในหน้าผู้ดูแล โดยใส่ป้าย “${division.contentLabel}” ให้ทีม`
                : `ยังไม่มีทีมของ ${meta.title} — จัดทีมได้ที่แท็บ “ปาร์ตี้” ในหน้าผู้ดูแล โดยใส่ “${meta.label}” ในช่องป้ายกำกับ`}
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
          // Only Guild War: a league lane belongs to the game, not to the admin.
          onReorderRow={derivedRows ? moveRowTo : undefined}
          onMoveRow={derivedRows ? moveRowBy : undefined}
          onRenameRow={derivedRows ? renameBox : undefined}
          onRenameTeam={renameTeam}
          onRemoveMember={removeMember}
          onAddMember={addMember}
          onDeleteRow={division ? undefined : clearBox}
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
            />
          ))}
        </div>
      )
    }
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        {visibleTeams.map((team) => (
          <TeamCard key={team.id} team={team} byName={byName} query={query} />
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
        </div>
        <Badge variant="outline" className="shrink-0">
          อัปเดต {latestUpdate(teams)}
        </Badge>
      </div>

      {/*
        Admin controls, right above the board they act on. The party dialog is
        the only place teams are built now that the inline editor is gone, so it
        is offered on every event page; "เพิ่มทีมใหญ่" is Guild War only,
        because a league lane is the game's, not the guild master's.
      */}
      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <PartyDialog
            members={members}
            parties={all}
            // The dialog rewrites the whole tab, so the page takes its result
            // and drops every scope's draft — a draft that still held the old
            // teams would otherwise shadow the fresh base.
            onChange={(next) => {
              onReplaceAll(next)
              onResetDrafts()
            }}
          />
          {derivedRows && (
            <NameDialog
              trigger={
                <Button variant="outline" className="touch-manipulation">
                  <Plus /> เพิ่มทีมใหญ่
                </Button>
              }
              title="เพิ่มทีมใหญ่"
              description="พิมพ์ชื่อทีมใหญ่ เช่น ทีมใหญ่ 1, ทีมห้องหิน แล้วลากทีมจากกล่อง “ว่าง” ใส่ได้เลย — กล่องจะถูกบันทึกก็ต่อเมื่อมีทีมอยู่ข้างใน"
              fieldLabel="ชื่อทีมใหญ่"
              placeholder="เช่น ทีมใหญ่ 1"
              submitLabel="เพิ่มทีมใหญ่"
              onSubmit={addBox}
            />
          )}
        </div>
      )}

      {/*
        The add-member dropdown inside the board reads which parties each player
        is already on (for its order and its "อยู่ปาร์ตี้ …" note) from context,
        so the whole teams tab is provided here rather than threaded down.
      */}
      <MemberPlacementProvider parties={all}>{body}</MemberPlacementProvider>

      {canEdit && confirmDialog}
    </div>
  )
}

function LaneRowReadonly({
  label,
  teams,
  byName,
  query,
}: {
  label: string
  teams: TeamInLane[]
  byName: Map<string, MemberStatus>
  query: string
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
            <div key={team.id} className="w-full max-w-56">
              <TeamCard team={team} byName={byName} query={query} />
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

/**
 * Slots locally-added empty boxes in above the parking row.
 *
 * `rowsForScope` derives boxes from teams and puts "ว่าง" (empty suffix) last;
 * a box that was just added carries no team yet, so it is appended to this
 * component's `extraBoxes` and merged in here — before the parking row, never
 * after it. Deduped by id, so a box that has since gained a team (and is now
 * derived by `rowsForScope`) is not shown twice.
 */
function withExtraBoxes(rows: LeagueLane[], extras: LeagueLane[]): LeagueLane[] {
  const named = rows.filter((row) => row.suffix !== "")
  const parking = rows.filter((row) => row.suffix === "")
  const seen = new Set(named.map((row) => row.id))
  return [...named, ...extras.filter((box) => !seen.has(box.id)), ...parking]
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
function usePartyWriter(onSaved: (next: Party[]) => void) {
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

  /** Resolves true when the database took it; false after showing the error. */
  function write(merged: Party[], successText: string): Promise<boolean> {
    setBusy(true)
    const ticket = (seq.current += 1)

    const result = queue.current.then(async () => {
      try {
        const res = await fetch("/api/admin/parties", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // No PIN in the body: the encrypted session cookie carries it, and the
          // route hands it to the script that re-checks it.
          body: JSON.stringify({ parties: merged }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? "บันทึกไม่สำเร็จ")

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
