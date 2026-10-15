import { EventBoard } from "@/components/events/event-board"
import { pageTitle } from "@/lib/nav"

export const metadata = {
  title: pageTitle("Guild League"),
}

export default function GuildLeaguePage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <EventBoard category="guild-league" />
    </main>
  )
}