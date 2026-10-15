import { AdminPanel } from "@/components/admin/admin-panel"
import { pageTitle } from "@/lib/nav"

export const metadata = {
  title: pageTitle("ผู้ดูแลกิลด์"),
}

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8">
      <AdminPanel />
    </main>
  )
}
