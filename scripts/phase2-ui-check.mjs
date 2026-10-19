#!/usr/bin/env node
/**
 * Phase 2 — the two display/order controls in the real UI.
 *
 *   PHASE2_DATABASE_URL=file:/tmp/phase2.db \
 *   PHASE2_BASE_URL=http://localhost:3311 \
 *   node scripts/phase2-ui-check.mjs
 *
 * Drives Chrome over CDP: switches the event board's member order to `slot`
 * and checks a card against `party_members.slot`, then presses ↓ on the first
 * party card and checks `parties.position` followed the array. It writes the
 * party order, so it refuses anything but a throwaway `file:` database.
 */

import { createClient } from "@libsql/client";
import process from "node:process";
import { resetFixture } from "./fixture.mjs";
process.loadEnvFile(".env.local");
const BASE = process.env.PHASE2_BASE_URL ?? "http://localhost:3000";
const CDP = process.env.PHASE2_CDP_URL ?? "http://localhost:9223";
const url = process.env.PHASE2_DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("PHASE2_DATABASE_URL must be a file: URL (throwaway database)");
  process.exit(2);
}
const client = createClient({ url });
const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The phase-4 cleanup removed the seed route; the checks now own their data.
await resetFixture(BASE, client);
let failures = 0;
function check(name, ok, detail = "") { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) failures++; }
const login = await fetch(`${BASE}/api/admin/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: process.env.GUILD_PIN }) });
const cookies = login.headers.getSetCookie().map((e) => { const [p] = e.split(";"); const i = p.indexOf("="); return { name: p.slice(0, i), value: p.slice(i + 1) }; });
const pages = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = pages.find((e) => e.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 0; const pending = new Map(); const events = new Map();
ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id) { const w = pending.get(m.id); pending.delete(m.id); m.error ? w?.reject(new Error(JSON.stringify(m.error))) : w?.resolve(m.result); return; } for (const w of events.get(m.method) ?? []) w(m.params); };
const send = (method, params = {}) => { const id = ++nextId; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { resolve: res, reject: rej })); };
const waitEvent = (method, timeout = 15000) => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(method)), timeout); const w = (p) => { clearTimeout(t); events.set(method, (events.get(method) ?? []).filter((x) => x !== w)); res(p); }; events.set(method, [...(events.get(method) ?? []), w]); });
await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
for (const c of cookies) await send("Network.setCookie", { ...c, domain: "localhost", path: "/", httpOnly: true });
const evaluate = async (expression) => { const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
async function navigate(url) { const loaded = waitEvent("Page.loadEventFired"); await send("Page.navigate", { url }); await loaded; await sleep(2500); }
async function waitFor(expression, tries = 40) { for (let i = 0; i < tries; i++) { if (await evaluate(expression)) return true; await sleep(250); } return false; }
async function clickPoint(point) {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
  await sleep(50);
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(400);
}
const center = (selectorCode) => evaluate(`(() => { const el = ${selectorCode}; if (!el) return null; el.scrollIntoView({ block: "center" }); const b = el.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);

/* ------------------------------------------------- member order select */
await navigate(`${BASE}/guild-war`);
check("board ready", await waitFor(`Boolean(document.body.innerText.includes("ลำดับสมาชิกในทีม"))`));
const trigger = await center(`document.querySelector('[role="combobox"]')`);
check("member-order select found", Boolean(trigger));
if (trigger) {
  await clickPoint(trigger);
  const option = await center(`[...document.querySelectorAll('[role="option"]')].find((n) => n.textContent.trim() === "ตามลำดับที่จัดไว้")`);
  check("slot option found", Boolean(option));
  if (option) await clickPoint(option);
  await sleep(500);
}
const selectValue = await evaluate(`document.querySelector('[role="combobox"]')?.textContent?.trim()`);
check("select kept the slot mode", selectValue === "ตามลำดับที่จัดไว้", selectValue);

// A card should now list its members in party_members.slot order. Find the
// team with the most members and compare the DOM rows against the DB.
const most = (await q("SELECT p.id, p.name FROM parties p JOIN party_members m ON m.party_id = p.id JOIN party_placements pl ON pl.party_id = p.id WHERE pl.event = 'guild-war' GROUP BY p.id ORDER BY COUNT(*) DESC LIMIT 1"))[0];
const slotRows = await q("SELECT member_name FROM party_members WHERE party_id = ? ORDER BY slot", [most.id]);
const domRows = await evaluate(`(() => {
  const title = [...document.querySelectorAll('[data-slot=card-title]')].find((n) => n.textContent.trim() === ${JSON.stringify(most.name)});
  const card = title?.closest('[data-slot=card]');
  if (!card) return null;
  return [...card.querySelectorAll('li')].map((li) => li.textContent.trim());
})()`);
check(
  "card members follow party_members.slot",
  Array.isArray(domRows) && domRows.length === slotRows.length && slotRows.every((row, index) => domRows[index].startsWith(row.member_name)),
  `${most.name}: ${domRows?.slice(0, 3).join(" | ")}`
);

/* --------------------------------------------------- party builder order */
await navigate(`${BASE}/admin`);
check("admin ready", await waitFor(`Boolean(document.body.innerText.includes("จัดปาร์ตี้"))`));
const tab = await center(`[...document.querySelectorAll('[role="tab"]')].find((n) => n.textContent.trim() === "จัดปาร์ตี้")`);
check("party tab found", Boolean(tab));
if (tab) await clickPoint(tab);
await sleep(1500);
const orderBefore = (await q("SELECT name FROM parties ORDER BY position")).map((r) => r.name);
const firstName = orderBefore[0];
const down = await center(`document.querySelector('[aria-label="เลื่อน ${firstName} ลง"]')`);
check("party down button found", Boolean(down));
if (down) await clickPoint(down);
await sleep(1500);
const orderAfter = (await q("SELECT name FROM parties ORDER BY position")).map((r) => r.name);
check("party builder ↑/↓ writes parties.position", orderAfter[0] === orderBefore[1] && orderAfter[1] === orderBefore[0], `${orderBefore.slice(0, 3).join(" | ")} → ${orderAfter.slice(0, 3).join(" | ")}`);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
ws.close(); process.exit(failures === 0 ? 0 : 1);
