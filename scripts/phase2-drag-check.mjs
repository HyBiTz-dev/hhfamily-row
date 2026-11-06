#!/usr/bin/env node
/**
 * Phase 2.4 — drive the lane board's real pointer path in headless Chrome.
 *
 *   PHASE2_DATABASE_URL=file:/tmp/phase2.db \
 *   PHASE2_BASE_URL=http://localhost:3311 \
 *   node scripts/phase2-drag-check.mjs
 *
 * Writes its own fixture into a throwaway database, then uses the dev server on
 * PHASE2_BASE_URL.
 * It logs in over HTTP, copies the session cookies into Chrome, then drags a
 * team card onto another card in the same box and a row handle onto another
 * row. The assertions read `party_placements.position` and `event_rows.position`
 * after the UI has written them.
 *
 * Mouse drags go through CDP input. The touch drag creates a real `TouchEvent`
 * in the page because CDP's touch dispatch does not reach React's delegated
 * `onTouchStart` (see `touchDragCards`).
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

// The phase-4 cleanup removed the seed route; the checks now own their data.
await resetFixture(BASE, client);

let failures = 0;
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ login */

const login = await fetch(`${BASE}/api/admin/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ pin: process.env.GUILD_PIN }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const cookies = login.headers.getSetCookie().map((entry) => {
  const [pair] = entry.split(";");
  const at = pair.indexOf("=");
  return { name: pair.slice(0, at), value: pair.slice(at + 1) };
});

/* ------------------------------------------------------------------- CDP */

const pages = await fetch(`${CDP}/json/list`).then((res) => res.json());
const page = pages.find((entry) => entry.type === "page");
if (!page) throw new Error("no Chrome page target");

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
    if (message.error) waiter?.reject(new Error(JSON.stringify(message.error)));
    else waiter?.resolve(message.result);
    return;
  }
  for (const waiter of events.get(message.method) ?? []) waiter(message.params);
};

function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

function waitEvent(method, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeout);
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
}

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

const loaded = waitEvent("Page.loadEventFired");
await send("Page.navigate", { url: `${BASE}/siege` });
await loaded;

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text ?? "evaluate failed");
  }
  return result.result.value;
}

// Hydration + the admin session probe both land after the load event.
for (let attempt = 0; attempt < 40; attempt++) {
  const ready = await evaluate(
    `Boolean(document.body.innerText.includes("ทีม1") && document.body.innerText.includes("เพิ่มกล่อง"))`
  );
  if (ready) break;
  await sleep(250);
}

/**
 * Both card headers after one scroll, for the same reason as the row pair.
 *
 * The point is on the title, not the card's centre: the middle of the card is
 * a member row, which has its own drag sensor and would pick the player up
 * instead of the team. A real finger grabs the card by its header too.
 */
async function rectsOfCards(names) {
  return evaluate(`(() => {
    const cards = ${JSON.stringify(names)}.map((name) => {
      const title = [...document.querySelectorAll('[data-slot="card-title"]')]
        .find((node) => node.textContent.trim() === name);
      return title?.closest('[data-slot="card"]');
    });
    if (cards.some((card) => !card)) return null;
    cards[0].scrollIntoView({ block: "center" });
    return cards.map((card) => {
      const title = card.querySelector('[data-slot="card-title"]');
      const box = title.getBoundingClientRect();
      // Just inside the title's left edge, away from the action buttons.
      return { x: box.left + Math.min(24, box.width / 2), y: box.top + box.height / 2 };
    });
  })()`);
}

/**
 * Both handles after one scroll. Scrolling to each handle in turn moves the
 * other one, so a pair taken from two separate lookups is not a pair.
 */
async function rectsOfRowHandles(labels) {
  return evaluate(`(() => {
    const handles = ${JSON.stringify(labels)}.map((label) =>
      document.querySelector('[aria-label="ลากเพื่อสลับลำดับ ' + label + '"]')
    );
    if (handles.some((handle) => !handle)) return null;
    handles[0].scrollIntoView({ block: "center" });
    return handles.map((handle) => {
      const box = handle.getBoundingClientRect();
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
  })()`);
}

async function mouseDrag(from, to) {
  // dnd-kit's PointerSensor needs 8px of movement before it activates, so the
  // first move is deliberately small and the rest walks to the target.
  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from.x,
    y: from.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
  });
  await send("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: from.x + 12,
    y: from.y + 12,
    button: "left",
    buttons: 1,
  });
  for (let step = 1; step <= 5; step++) {
    await send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + ((to.x - from.x) * step) / 5,
      y: from.y + ((to.y - from.y) * step) / 5,
      button: "left",
      buttons: 1,
    });
    await sleep(40);
  }
  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to.x,
    y: to.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
  });
  // The write is queued behind a fetch; give it time to land.
  await sleep(1200);
}

/**
 * The TouchSensor path: hold still for its 200ms delay, then move. Moving
 * before the delay is what cancels a drag on a phone, so this deliberately
 * waits first.
 *
 * CDP's `Input.dispatchTouchEvent` reaches native `touchstart` listeners but
 * not React's delegated one (verified against Chrome 155: the document sees
 * the event, the card's `onTouchStart` never runs, and only the pointer sensor
 * reacts). So this dispatches a real `TouchEvent` object through the same DOM
 * node instead. It is the same event shape Chrome produces, and it exercises
 * the delay, the tolerance and the write path end to end.
 *
 * The event target is the card title and the touchmove stays on that same
 * node, because dnd-kit listens on the touchstart target. Returns the live
 * region text seen just before touchend so the caller can prove the card was
 * actually over another card, not just clicked.
 */
async function touchDragCards(fromName, toName) {
  return evaluate(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const find = (name) => [...document.querySelectorAll('[data-slot="card-title"]')]
      .find((node) => node.textContent.trim() === name);
    const fromTitle = find(${JSON.stringify(fromName)});
    const toTitle = find(${JSON.stringify(toName)});
    if (!fromTitle || !toTitle) return null;
    fromTitle.closest('[data-slot="card"]').parentElement.scrollIntoView({ block: "center" });

    const a = fromTitle.getBoundingClientRect();
    const b = toTitle.getBoundingClientRect();
    const from = { x: a.left + Math.min(24, a.width / 2), y: a.top + a.height / 2 };
    const to = { x: b.left + Math.min(24, b.width / 2), y: b.top + b.height / 2 };
    const element = fromTitle;
    const touchAt = (x, y) => new Touch({
      identifier: 1,
      target: element,
      clientX: x,
      clientY: y,
      pageX: x,
      pageY: y,
      screenX: x,
      screenY: y,
    });
    const fire = (type, x, y) => {
      const touch = touchAt(x, y);
      const empty = type === "touchend";
      element.dispatchEvent(new TouchEvent(type, {
        bubbles: true,
        cancelable: true,
        touches: empty ? [] : [touch],
        targetTouches: empty ? [] : [touch],
        changedTouches: [touch],
      }));
    };

    fire("touchstart", from.x, from.y);
    // Longer than the sensor's 200ms delay, so this is the hold a phone needs.
    await sleep(350);
    for (let step = 1; step <= 6; step++) {
      fire(
        "touchmove",
        from.x + ((to.x - from.x) * step) / 6,
        from.y + ((to.y - from.y) * step) / 6
      );
      await sleep(50);
    }
    const live = [...document.querySelectorAll("[aria-live]")]
      .map((node) => node.textContent)
      .join("|");
    fire("touchend", to.x, to.y);
    // The write is queued behind a fetch; give it time to land.
    await sleep(1200);
    return live;
  })()`);
}

/* -------------------------------------------------------- team card drag */

async function firstPairInBox() {
  const rows = await q(
    "SELECT party_id, row_id, position FROM party_placements WHERE event = 'siege' ORDER BY position"
  );
  const byRow = new Map();
  for (const row of rows) {
    if (!row.row_id) continue;
    byRow.set(row.row_id, [...(byRow.get(row.row_id) ?? []), row]);
  }
  for (const [rowId, list] of byRow) {
    if (list.length >= 2) return { rowId, first: list[0], second: list[1] };
  }
  return null;
}

{
  const pair = await firstPairInBox();
  check("two teams in a named box", Boolean(pair));

  if (pair) {
    const { rowId, first, second } = pair;
    const names = await q(
      "SELECT id, name FROM parties WHERE id IN (?, ?)",
      [first.party_id, second.party_id]
    );
    const nameById = new Map(names.map((row) => [row.id, row.name]));
    const before = await evaluate(`(() => {
      return [...document.querySelectorAll('[data-slot="card-title"]')]
        .map((node) => node.textContent.trim());
    })()`);

    const rects = await rectsOfCards([
      nameById.get(first.party_id),
      nameById.get(second.party_id),
    ]);
    check("both card rects found", Boolean(rects));
    if (rects) await mouseDrag(rects[0], rects[1]);

    const after = await q(
      "SELECT party_id, position FROM party_placements WHERE event = 'siege' AND row_id = ? ORDER BY position",
      [rowId]
    );
    check(
      "card drag rewrote the box order",
      after.length > 0 && after[0].party_id !== first.party_id,
      `before: ${before.slice(0, 4).join(" | ")}`
    );
  }
}

/* ---------------------------------------------------------- row drag */

{
  const before = await q(
    "SELECT id, name, position FROM event_rows WHERE event = 'siege' ORDER BY position"
  );
  if (before.length >= 2) {
    const fromLabel = before[0].name;
    const toLabel = before[1].name;
    const rects = await rectsOfRowHandles([fromLabel, toLabel]);
    check("both row handles found", Boolean(rects));
    if (rects) await mouseDrag(rects[0], rects[1]);

    const after = await q(
      "SELECT id, name, position FROM event_rows WHERE event = 'siege' ORDER BY position"
    );
    check(
      "row drag changed the box order",
      after.length === before.length && after[0].id !== before[0].id,
      `before: ${before.map((row) => row.name).join(" | ")} · after: ${after
        .map((row) => row.name)
        .join(" | ")}`
    );
  }
}

/* ------------------------------------------------------- touch card drag */

{
  const pair = await firstPairInBox();
  check("two teams in a named box for touch", Boolean(pair));

  if (pair) {
    const { rowId, first, second } = pair;
    const names = await q(
      "SELECT id, name FROM parties WHERE id IN (?, ?)",
      [first.party_id, second.party_id]
    );
    const nameById = new Map(names.map((row) => [row.id, row.name]));
    const live = await touchDragCards(
      nameById.get(first.party_id),
      nameById.get(second.party_id)
    );
    check("touch drag started and hovered the target card", Boolean(live?.includes("team-card:")));

    const after = await q(
      "SELECT party_id, position FROM party_placements WHERE event = 'siege' AND row_id = ? ORDER BY position",
      [rowId]
    );
    check(
      "touch (300ms hold) card drag rewrote the box order",
      after.length > 0 && after[0].party_id !== first.party_id
    );
  }
}

console.log(failures === 0 ? "\nall checks passed" : `\n${failures} check(s) failed`);
ws.close();
process.exit(failures === 0 ? 0 : 1);
