import { redirect } from "next/navigation"

/**
 * The party builder moved into the admin area: arranging parties is
 * admin-only work. This route stays as a redirect so old links and
 * bookmarks do not dead-end on a 404.
 */
export default function LegacyPartyPage() {
  redirect("/admin")
}