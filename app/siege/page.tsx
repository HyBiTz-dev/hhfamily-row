import { EventBoard } from "@/components/events/event-board"
import { pageTitle } from "@/lib/nav"

export const metadata = {
  title: pageTitle("Siege"),
}

export default function SiegePage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <EventBoard category="siege" />
    </main>
  )
}
