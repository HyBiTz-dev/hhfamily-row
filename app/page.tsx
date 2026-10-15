import { LeaveBoard } from "@/components/leave/leave-board"
import { pageTitle } from "@/lib/nav"

export const metadata = {
  title: pageTitle("เช็คชื่อ"),
}

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <LeaveBoard />
    </main>
  )
}