/**
 * Site navigation and page titles.
 *
 * Adding a page means one entry here plus its `app/.../page.tsx`. The title
 * is exposed through `pageTitle()` because Next does not apply
 * `metadata.title.template` to a page sitting in the same segment as the
 * layout that declares it — that would leave `/` with a different title
 * format from every other page.
 */

export const SITE_NAME = "กิลด์";

/**
 * Public pages, rendered in the main nav.
 *
 * The admin area is deliberately NOT in this list — it has its own
 * always-visible entry in the header (see components/site-header.tsx),
 * because a link that only appears when already logged in leaves the guild
 * master with no way to sign back in after signing out or switching devices.
 *
 * Adding a page = one entry here plus its app/<path>/page.tsx.
 */
export const NAV_ITEMS = [
  { href: "/", label: "เช็คชื่อ", title: "เช็คชื่อ" },
  { href: "/carry-signup", label: "ลงชื่อแบกดัน", title: "ลงชื่อแบกดัน" },
  { href: "/siege", label: "Siege", title: "Siege" },
  { href: "/guild-league", label: "Guild League", title: "Guild League" },
] as const;

/** Not in NAV_ITEMS: the admin gate renders its own button. */
export const ADMIN_HREF = "/admin" as const;

export type NavHref = (typeof NAV_ITEMS)[number]["href"];

/** "จัดปาร์ตี้ · กิลด์" — same format on every page, including the home page. */
export function pageTitle(title: string): string {
  return `${title} · ${SITE_NAME}`;
}
