import { CarrySignupBoard } from "@/components/carry/carry-signup-board"
import { pageTitle } from "@/lib/nav"

export const metadata = {
  title: pageTitle("ลงชื่อแบกดัน"),
}

export default function CarrySignupPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <CarrySignupBoard />
    </main>
  )
}
