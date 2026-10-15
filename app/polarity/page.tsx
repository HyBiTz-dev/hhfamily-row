import { EventBoard } from "@/components/events/event-board"
import { pageTitle } from "@/lib/nav"

export const metadata = {
  title: pageTitle("Polarity"),
}

export default function PolarityPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <EventBoard category="polarity" />
    </main>
  )
}