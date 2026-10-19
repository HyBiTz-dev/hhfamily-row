#!/usr/bin/env node
/**
 * Phase 7.4 — the pencil on a team card after a label change.
 *
 *   PHASE7_DATABASE_URL=file:/tmp/phase7.db \
 *   PHASE7_BASE_URL=http://localhost:3311 \
 *   node scripts/phase7-ui-check.mjs
 *
 * Opens the team edit dialog for a ลีคหลัก team, moves its league chip to
 * ลีครอง and saves. Then checks, in the real UI and in the database, that the
 * dialog closed, the team left the ลีคหลัก tab, and it now appears in ลีครอง
 * with `row_id = NULL` (the box of the old division does not carry over).
 *
 * Writes the party tab, so it refuses anything but a throwaway `file:`
 * database. Chrome must already be running with `--remote-debugging-port=9223`.
 */

import { createClient } from "@libsql/client";
import process from "node:process";
import { resetFixture } from "./fixture.mjs";
process.loadEnvFile(".env.local");

const BASE = process.env.PHASE7_BASE_URL ?? "http://localhost:3311";
const CDP = process.env.PHASE7_CDP_URL ?? "http://localhost:9223";
const url = process.env.PHASE7_DATABASE_URL;
if (!url || !url.startsWith("file:")) {
  console.error("PHASE7_DATABASE_URL must be a file: URL (throwaway database)");
  process.exit(2);
}

const client = createClient({ url });
const q = async (sql, args = []) => (await client.execute({ sql, args })).rows;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await resetFixture(BASE, client);

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ pin: process.env.GUILD_PIN }),
});
check("admin login", login.ok, String(login.status));

const cookies = login.headers.getSetCookie().map((entry) => {
  const [pair] = entry.split(";");
  const at = pair.indexOf("=");
  return { name: pair.slice(0, at), value: pair.slice(at + 1) };
});

const pages = await fetch(`${CDP}/json/list`).then((res) => res.json());
const page = pages.find((entry) => entry.type === "page");
if (!page) {
  console.error("no Chrome page found at " + CDP);
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

let nextId = 0;
const pending = new Map();
const events = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    message.error
      ? waiter?.reject(new Error(JSON.stringify(message.error)))
      : waiter?.resolve(message.result);
    return;
  }
  for (const waiter of events.get(message.method) ?? []) waiter(message.params);
};
const send = (method, params = {}) => {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
};
const waitEvent = (method, timeout = 15000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(method)), timeout);
    const waiter = (params) => {
      clearTimeout(timer);
      events.set(
        method,
        (events.get(method) ?? []).filter((entry) => entry !== waiter)
      );
      resolve(params);
    };
    events.set(method, [...(events.get(method) ?? []), waiter]);
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
for (const cookie of cookies) {
  await send("Network.setCookie", {
    ...cookie,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  });
}

const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
};
async function navigate(target) {
  const loaded = waitEvent("Page.loadEventFired");
  await send("Page.navigate", { url: target });
  await loaded;
  await sleep(2500);
}
async function waitFor(expression, tries = 40) {
  for (let index = 0; index < tries; index++) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  return false;
}
async function clickPoint(point) {
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await sleep(50);
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  await sleep(400);
}
const center = (selectorCode) =>
  evaluate(`(() => {
    const el = ${selectorCode};
    if (!el) return null;
    el.scrollIntoView({ block: "center" });
    const box = el.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);

const cardTitle = `[...document.querySelectorAll('[data-slot=card-title]')].find((n) => n.textContent.trim() === "ทีม1")`;
const chip = (label) =>
  `[...document.querySelectorAll('[role=dialog] button')].find((n) => n.textContent.trim() === ${JSON.stringify(label)})`;

await navigate(`${BASE}/guild-league`);
check(
  "ลีคหลัก tab shows ทีม1 first",
  await waitFor(`Boolean(${cardTitle})`)
);

/* ---------------------------------------------------------- open the pencil */
const pencil = await center(`document.querySelector('[aria-label="แก้ไขทีม ทีม1"]')`);
check("pencil button found", Boolean(pencil));
if (pencil) await clickPoint(pencil);
check("edit dialog opened", await waitFor(`Boolean(document.querySelector('[role=dialog]'))`));

check(
  "dialog starts with ลีคหลัก active and ลีครอง off",
  await evaluate(
    `(() => {
      const upper = ${chip("ลีคหลัก")};
      const lower = ${chip("ลีครอง")};
      return upper?.getAttribute("aria-pressed") === "true" &&
        lower?.getAttribute("aria-pressed") === "false";
    })()`
  )
);

/* --------------------------------------------------- move the league chip */
const upper = await center(chip("ลีคหลัก"));
if (upper) await clickPoint(upper);
const lower = await center(chip("ลีครอง"));
if (lower) await clickPoint(lower);
check(
  "chips swapped to ลีครอง",
  await evaluate(
    `(() => {
      const upper = ${chip("ลีคหลัก")};
      const lower = ${chip("ลีครอง")};
      return upper?.getAttribute("aria-pressed") === "false" &&
        lower?.getAttribute("aria-pressed") === "true";
    })()`
  )
);

const save = await center(chip("บันทึก"));
check("save button found", Boolean(save));
if (save) await clickPoint(save);

check(
  "dialog closes after save",
  await waitFor(`!document.querySelector('[role=dialog]')`)
);
check(
  "team leaves the ลีคหลัก tab",
  await waitFor(`!(${cardTitle})`)
);

const placementAfter = async () =>
  q(
    `SELECT division, row_id FROM party_placements
      WHERE party_id = 'fx-party-1' AND event = 'guild-league'`
  );
let placement = await placementAfter();
for (let attempt = 0; attempt < 20 && !(placement.length === 1 && placement[0].division === "lower"); attempt++) {
  await sleep(250);
  placement = await placementAfter();
}
check(
  "database moved the placement to ลีครอง with no box",
  placement.length === 1 && placement[0].division === "lower" && placement[0].row_id === null,
  JSON.stringify(placement[0] ?? null)
);

/* --------------------------------------------------- appears in ลีครอง tab */
const lowerTab = await center(
  `[...document.querySelectorAll('[role=tab]')].find((n) => n.textContent.includes("ลีครอง"))`
);
check("ลีครอง tab found", Boolean(lowerTab));
if (lowerTab) await clickPoint(lowerTab);
check(
  "team now appears in ลีครอง",
  await waitFor(`Boolean(${cardTitle})`)
);

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
