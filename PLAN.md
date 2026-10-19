# PLAN — งานที่เหลือหลังย้ายปาร์ตี้เป็นตาราง normalized

สถานะ: **เฟส 0 ข้อ 0.1–0.4 เสร็จแล้ว** (เขียน Turso จริงผ่าน + restore hash ตรง ·
ทีมลีก 16 ทีม map เข้าเลนกลาง/กลุ่ม B · `BabyOTteR` ออกจากทีม) เหลือ 0.5 รอทดสอบบนมือถือจริง
**เฟส 1 เสร็จแล้ว** (1.1–1.3 ลบโมเดล label เดิมแล้ว · 1.4 ตัดสินใจข้ามเพราะ `legacy = 0`)
**เฟส 2 เสร็จแล้ว** (2.1–2.4 · ลากการ์ด/แถวและ TouchSensor ผ่าน Chrome headless ·
เหลือ רקการยืนยันบนมือถือจริงใน 0.5)
**เฟส 3 เสร็จแล้ว** (3.1–3.4 · dedupe แถวกล่องซ้ำ + invariant 1 คน 1 ทีมต่ออีเวนต์ +
optimistic lock ด้วย `app_meta.parties_version` · ตรวจด้วย `scripts/phase3-check.mjs`)
**เฟส 4 เสร็จแล้ว** (4.1–4.4 · ลบ seed route/module · export ที่ไม่มีผู้อ่าน ·
ตรวจ index และคอลัมน์ · สคริปต์ใช้ `scripts/fixture.mjs` แทน seed)
**เฟส 5 เสร็จแล้ว** (5.1–5.2 · `npm test` ด้วย `node:test` ไม่ลง dependency ใหม่ ·
39 เทสต์ / 11 suite ครอบ pure function ของ placements/labels/random teams)
ข้อมูลจริงบน Turso ถูกอ่านด้วยโมเดลใหม่ได้ (32 ปาร์ตี้ · 130 สมาชิก · 96 placements · 6 rows)
และ marker `parties_normalized_v1` มีอยู่จริงก่อนลบ migration

คำศัพท์ที่ใช้ในไฟล์นี้:

| คำ | ความหมาย |
| --- | --- |
| ทีม / ปาร์ตี้ | 1 แถวใน `parties` |
| กล่อง / แถว | 1 แถวใน `event_rows` (ทุกอีเวนต์ รวมลีก) |
| placement | 1 แถวใน `party_placements` = ทีมลงอีเวนต์ไหน อยู่กล่องไหน |
| scope | `event` + `division` เช่น `guild-war:''`, `guild-league:upper` |

---

## เฟส 0 — ด่านก่อน deploy (blocker)

- [x] **0.1 เขียนจริงบน Turso 1 รอบ** แล้วตรวจว่าไม่ทำข้อมูลพัง — **ผ่าน 19/19 checks**
  - รันด้วย `node scripts/phase0-write-check.mjs backups/turso-parties-backup-*.json`
    (เปิด `npm run dev` ทิ้งไว้ก่อน) เป็นรอบเดียวที่เดินครบทุกข้อแล้ว **ยิงผ่าน HTTP API จริง**
    → route handler → `parseParties` → `saveParties` → `batch` บน Turso HTTP client
  - เพิ่มกล่อง 1 กล่องที่ `/guild-war` → ยืนยันว่า `event_rows` มีแถวใหม่
  - ลากทีมเข้าถล่อง → ยืนยัน `party_placements.row_id` เปลี่ยน และ `parties.content` ถูก derive ใหม่
  - เปลี่ยนชื่อกล่อง → ยืนยันว่าไม่มีทีมถูกเขียนซ้ำ/หาย
  - เปลี่ยนชื่อทีม + แก้สมาชิก → ยืนยันว่าอีเวนต์อื่นของทีมเดียวกันยังอยู่
  - ลบกล่องที่มีทีม → ยืนยันทีมไป `row_id = NULL` และทีมไม่หาย
  - เก็บ `parties` ฉบับก่อน/หลังมาเทียบ hash — และ restore จาก backup แล้ว hash ตรงเดิมทุกตาราง
  - **พิสูจน์แล้วว่า `batch` บน HTTP client เป็น transaction เดียวจริง**: batch ที่มี
    id ซ้ำล้มเหลวทั้งก้อน ไม่มีแถวค้าง
  - ข้อสังเกต: การเขียนทุกครั้งจะ rewrite `parties.content` ใหม่ตามลำดับอีเวนต์มาตรฐาน
    (Guild War → Guild League → Polarity) — เป็นแค่ display cache ไม่มีข้อมูลหาย
    (สคริปต์เทียบแบบเรียง segment ก่อนเทียบ hash)
- [x] **0.2 สำรองข้อมูลก่อนเขียนรอบแรก**
  - `node scripts/turso-backup.mjs [label]` → `backups/turso-parties-backup-<ts>[-label].json`
    (มี `parties`, `event_rows`, `party_members`, `party_placements`, `app_meta`, `members`, `attendance`)
  - กู้คืนด้วย `node scripts/turso-restore.mjs <file>` (ค่าเริ่มต้นคืนเฉพาะตารางปาร์ตี้ + `app_meta`;
    `--all` ค่อยคืน `members`/`attendance` ด้วย)
  - `backups/` อยู่ใน `.gitignore` แล้ว — dump มีชื่อสมาชิกทั้งกิลด์ ห้าม commit
- [x] **0.3 ตัดสินใจเรื่องทีมลีกที่ยังไม่มีกล่อง (16 ทีม)** — **map เข้าเลนกลาง/กลุ่ม B แล้ว**
  - หัวหน้ากิลด์เลือกคงตำแหน่งเดิม: ลีคหลัก 4 ทีม → `guild-league:upper:middle`,
    ลีครอง 12 ทีม → `guild-league:lower:b` (เดิมไปโผล่เลนกลาง/กลุ่ม B เพราะเป็น default เก่า)
  - ทำด้วย `node scripts/phase0-league-placement-fix.mjs <backup.json>` (PUT เดียวทั้งลิสต์)
  - ตรวจแล้ว: ไม่มี league placement ไหนเหลือ `row_id = NULL`, จำนวนปาร์ตี้/placement เท่าเดิม
- [x] **0.4 ตรวจสมาชิก 1 ชื่อที่ไม่อยู่ใน roster** (`BabyOTteR` อยู่ในปาร์ตี้ 32) — **เอาออกจากทีมแล้ว**
  - สคริปต์เดียวกับ 0.3 · `party_members` เหลือ 130 seats · ชื่อ "นอกรายชื่อ" 0 คน
- [ ] **0.5 ทดสอบบนมือถือจริง 1 เครื่อง** (Safari iOS) — **ให้คนทำเอง** (ผมเปิด Safari จริงไม่ได้)
  - checklist: ลากทีมข้ามกล่องด้วย `TouchSensor` (กดค้าง 200ms) → ลากชื่อสมาชิกไปวางบนชื่อคนอื่น
    (`member-seat`) → ปุ่ม ↑/↓ เรียงกล่อง และปุ่มดินสอ/ถังขยะในหัวแถว → `CheckInDialog`
    แตะชื่อตัวเองแล้วบันทึก แล้วป้ายสถานะอัปเดต

---

## เฟส 1 — ปิดงานข้อมูล (retire ของเก่า)

- [x] **1.1 หยุดเขียนคอลัมน์เก่า** (`parties.content`, `parties.members`)
  - `partyStatements()` เขียน `content = NULL`, `members = '[]'` แล้ว (และ `lib/seed.ts`)
  - ตัด `derivePartyContent` ออกจากเส้นทางเขียนแล้ว — ตัวอ่านยัง derive จาก placements
    เหมือนเดิม คอลัมน์เก่าจึงไม่ถูกใช้ทั้งอ่านและเขียน
  - เก็บคอลัมน์ไว้ในสคีมาโดยยังไม่ `DROP` (ตรงตามแผน: ไม่ลบพร้อมโค้ดใน deploy เดียว)
- [x] **1.2 ลบ migration ที่ไม่ต้องใช้อีก**
  - ลบ `lib/party-migration.ts`, `migrateParties()`, `readPartyMigrationStatus()`,
    `PARTY_MIGRATION_*` และ `app/api/admin/party-migration/route.ts`
  - ตรวจบน Turso จริงก่อนลบ: มี marker `parties_normalized_v1` +
    `parties_normalized_v1_report` ครบ (สคริปต์ `scripts/turso-inspect.mjs`)
  - `PARTY_SCHEMA` ยังอยู่ใน `SCHEMA` ตารางจึงยังถูกสร้างตอน cold start
  - แถว `app_meta` ของ migration ยังค้างอยู่ ไม่มีโค้ดอ่านแล้ว — ลบทีหลังได้โดยไม่กระทบข้อมูล
- [x] **1.3 ลบ string helper ที่เหลือ**
  - ลบ `matchEventCategory` / `matchEventCategories` / `matchDivision` / `matchLane` /
    `hasExplicitLane` / `eventSuffix` / `contentSegments` / `eventSegment` / `boxRow` /
    `defaultLaneId` / `SEGMENT_SEPARATOR` และ `keywords` ที่ไม่มีใครอ่านแล้ว
  - `derivePartyContent` ยังอยู่ เพราะเป็น display cache ตอนอ่าน; คั่นด้วย `" + "` ตรง ๆ
  - `seed.ts` สร้าง row id เองด้วย compact ในไฟล์นั้น ไม่พึ่ง helper ที่ลบไป
- [x] **1.4 หน้า audit ป้ายลีกเก่า — ตัดสินใจข้าม**
  - Turso จริงมี `legacy = 0` / `unresolved = 0` และ 0.3 map ทีมลีกครบแล้ว
  - การ์ดถาวรเพื่อ audit ครั้งเดียวจึงไม่มีอะไรให้แสดง และจะกลายเป็น UI ตายที่ต้องดูแล
  - ถ้าในอนาคตมีทีมลีกที่ `division = ''` ให้ตรวจด้วย
    `scripts/turso-inspect.mjs` (placement grouped) แล้วแก้ที่แท็บปาร์ตี้

---

## เฟส 2 — ลำดับ (sort/order) ที่ยังค้าง

คอลัมน์มีครบแล้ว แต่เดิมยังไม่มี UI และบางอันยังไม่ถูกใช้ตอนเรนเดอร์ — ปิดครบแล้วในหัวข้อนี้

- [x] **2.1 ลำดับทีมในกล่อง (ต่ออีเวนต์)** — `party_placements.position`
  - **ตัดสินใจ: ลำดับแยกต่ออีเวนต์** (scope = `event` + `division`) ไม่ใช้ลำดับกลางร่วมกัน
    เพราะทีมเดียวลงหลายอีเวนต์และแต่ละหน้าจัดทีมคนละแบบ
  - `sortTeamsForScope()` ใน `lib/rngw/categories.ts` เรียงทีมตาม placement ของ scope นั้น
    ก่อนส่งลงบอร์ด · ทีมที่ยังไม่มี placement ต่อท้ายด้วย `parties.position`
  - placement ใหม่ใช้ `APPEND_POSITION` (`Number.MAX_SAFE_INTEGER`) แล้วถูก normalize
    ให้แน่นเป็น 0..n-1 ตอนเขียน — เพิ่มทีมใหม่จึงต่อท้าย ไม่กระโดดไปหัวกล่อง
  - `partyStatements()` ใน `lib/db.ts` อ่าน position ที่ส่งมาและ normalize **แยกทีละ scope**
    (ไม่ยุบข้ามอีเวนต์/ลีก)
  - UI ครบสองทาง: ลากการ์ดไปวางบนการ์ดอื่นในกล่องเดียวกัน (`onReorderTeam`) และปุ่ม ↑/↓
    บนการ์ด (`onMoveTeamInRow`) · การ์ดเป็น droppable (`team-card:<id>`) และ
    collision detection ยกการ์ดขึ้นก่อนแถว เพื่อไม่ให้การวางบนการ์ดกลายเป็น “ย้ายกล่อง”
- [x] **2.2 ลำดับการ์ดปาร์ตี้ในแท็บ “จัดปาร์ตี้”** — `parties.position`
  - ปุ่ม ↑/↓ บนการ์ดทุกใบ (`moveParty`) สลับในอาร์เรย์แล้วเขียนทั้งลิสต์ทันที
  - `partyStatements` เขียน `position` = index ของอาร์เรย์ จึงไม่ต้องมีฟิลด์ position
    ฝั่ง client และการเรียง UI = การเรียงจริงในฐานข้อมูล
- [x] **2.3 ลำดับสมาชิกในทีม** — `party_members.slot`
  - **ตัดสินใจ: (ข) มีโหมดเรียงให้เลือก** — dropdown “ลำดับสมาชิกในทีม” บนบอร์ดอีเวนต์
    · ค่าเริ่มต้น `status` (มา → ลา → รอเช็ค) เหมือนเดิม
    · เลือก `slot` = เรียงตามลำดับที่จัดไว้ในทีม
  - เป็นการแสดงผลอย่างเดียว ไม่เขียนฐานข้อมูล และไม่เปลี่ยนค่าเริ่มต้นของคนที่เพิ่งเปิดหน้า
- [x] **2.4 ยืนยันการลากกล่อง (drag)** — `moveRowTo` ใน `event-board.tsx`
  - เมาส์: ลากการ์ดในกล่องเดียวกัน และลากแถวด้วย grip ผ่าน Chrome headless
    (`scripts/phase2-drag-check.mjs`) — `party_placements.position` / `event_rows.position`
    เปลี่ยนจริงหลัง UI เขียน
  - สัมผัส: เส้นทาง `TouchSensor` (hold 200ms แล้วลาก) ผ่าน `TouchEvent` จริงที่ยิงเข้า
    การ์ดเดียวกับที่ผู้ใช้แตะ — **หมายเหตุ**: `Input.dispatchTouchEvent` ของ CDP ถึง
    native listener แต่ไม่ถึง delegated `onTouchStart` ของ React ใน Chrome 155
    สคริปต์จึงสร้าง `TouchEvent` เองเพื่อทดสอบ delay/tolerance/write path
  - **ยังคงต้องยืนยันบนมือถือจริง** ใน 0.5 (Safari iOS) เพราะสคริปต์ไม่ได้พิสูจน์
    พฤติกรรม scroll/gesture ของเบราว์เซอร์จริง

---

## เฟส 3 — ความทนทาน (กันข้อมูลพัง)

- [x] **3.1 กัน request ที่ส่ง event_rows ซ้ำ** (บั๊กจริง ถ้าโดนจะได้ 502)
  - `dedupeEventRows()` ใน `lib/party.ts` ตัด id ซ้ำ และตัดชื่อกล่องที่ fold แล้วซ้ำกัน
    (ทั้งคู่เก็บตัวแรกไว้) — เรียกจาก `normalizeEventRows()` ซึ่งเป็นด่านสุดท้ายก่อน batch
  - **ไม่ dedupe ที่ `parseEventRows`** เพราะ `remap` (id ที่ถูกตัด → id ที่รอด) ต้องรอดไปถึง
    ตอน resolve placements ไม่งั้นทีมที่จอดอยู่ในกล่องที่ถูกตัดจะตกไป "ว่าง" แทนที่จะตามไปกล่องที่รอด
  - ถ้าไม่ตัดเลย request นั้นจะล้มทั้งก้อนด้วย PRIMARY KEY / UNIQUE → ผู้ใช้เห็น 502
- [x] **3.2 ชื่อกล่องซ้ำแบบ case-insensitive**
  - `foldRowName()` (`trim` + `toLowerCase` แบบไม่ผูก locale) ใช้ทั้ง client (`event-board.tsx`)
    และ server (ผ่าน `rowScopeKey` ใน `dedupeEventRows`) จึงเห็นตรงกัน — ไม่เพิ่ม index `COLLATE NOCASE`
    (ซึ่งจะพัง cold start ถ้ามีข้อมูลซ้ำอยู่ก่อน)
- [x] **3.3 optimistic locking / version**
  - เวอร์ชันเดียวของทั้งลิสต์ เก็บที่ `app_meta` key `parties_version` (ไม่มีแถว = 0)
  - `GET /api/parties` คืน `version` · `GET /api/admin/view` คืน `partyVersion`
  - `PUT /api/admin/parties` รับ `version`; `saveParties` เทียบกับค่าปัจจุบันแล้ว **409**
    ถ้าไม่ตรง (`PartyConflictError`) แล้ว bump `version + 1` ใน batch เดียวกับข้อมูล
  - client เก็บ token ไว้ใน ref ตัวเดียวต่อหน้า — `usePartyWriter` (บอร์ด) และ `PartyBuilder`
    (แท็บปาร์ตี้/ไดอะล็อก) ใช้ ref เดียวกัน จึงไม่ 409 กันเอง และอัปเดตจาก `body.version` ทุกครั้ง
  - ไม่ส่ง `version` เลย = พฤติกรรมเดิม (last-write-wins) เพื่อให้สคริปต์/เครื่องมือเก่ายังใช้ได้
  - **เหลือช่องแคบ ๆ**: อ่าน version กับเขียน batch ไม่ใช่ atomic step เดียวกัน สองคำขอที่ยิง
    พร้อมกันใน round trip เดียวกันจึงยังแข่งกันได้ (ไม่แย่กว่าเดิม และปิดเคสจริงคือ 2 แท็บ)
- [x] **3.4 invariant: สมาชิก 1 คน อยู่ทีมเดียวต่ออีเวนต์**
  - `assertOneTeamPerEvent()` ใน `lib/db.ts` ตรวจจาก placements ที่ normalize แล้ว (ต่ออีเวนต์
    ไม่แยก division) ก่อนสร้าง statement ใด ๆ → โยน `PartyInvariantError` → route ตอบ **400**
  - client บังคับด้วย `addMember` + confirm อยู่แล้ว ด่านนี้กันข้อมูลเสียจากการยิง API ตรง
  - ตรวจกับ Turso จริงแล้วว่า**ไม่มี** violation อยู่ก่อน (group by event, member) จึงไม่ทำให้
    การบันทึกครั้งถัดไปล้ม
- [ ] **3.5 ลดขนาด write**
  - ทุกการแก้ = `DELETE FROM parties/party_members/party_placements` + INSERT ใหม่ทั้งชุด
  - ถ้าข้อมูลโต (หลายร้อยทีม) ให้เปลี่ยนเป็น endpoint เจาะจง:
    `PUT /api/admin/parties/:id`, `PUT .../members`, `PUT .../placements`,
    `POST/PATCH/DELETE /api/admin/event-rows`
  - ยังไม่จำเป็นตอนนี้ (32 ทีม) — บันทึกเป็นงานอนาคต
- **เอกสาร `AGENTS.md` ของเฟสนี้เขียนแล้วใน 6.1** — หัวข้อปาร์ตี้ใหม่ทั้งหัวข้อ ครอบ dedupe
  แถวกล่องซ้ำ + ชื่อกล่อง fold · invariant 1 คน 1 ทีมต่ออีเวนต์ (400) · optimistic lock
  `app_meta.parties_version` (409) และกติกา “ไม่ส่ง version = last-write-wins” พร้อมช่องแคบ ๆ
  ที่ยังเหลือ (comment ใน `saveParties`)

## เฟส 4 — เก็บกวาด

- [x] **4.1 ลบ `app/api/admin/seed/` + `lib/seed.ts`** หลังใส่รายชื่อจริงแล้ว
  - ลบ route, `lib/seed.ts` และ `seededRandom` ทั้งไฟล์
  - สคริปต์ตรวจงานไม่พึ่ง seed route แล้ว: `scripts/fixture.mjs` เขียนข้อมูลชุดเล็ก
    (3 ปาร์ตี้ · 5 กล่อง · 6 สมาชิก) ลงฐานข้อมูล `file:` ที่กำหนด และสคริปต์
    `phase2-order` / `phase2-drag` / `phase2-ui` / `phase3-check` เรียกก่อนตรวจ
  - อัปเดต `AGENTS.md` และ `docs/turso-setup.md` ไม่ให้สั่งใช้ route ที่ไม่มีแล้ว
- [x] **4.2 ลบ export ที่ไม่ใช้**
  - `readParties()` — ลบ (ใช้แค่ใน seed)
  - `readEventRows()` — ทำเป็น private เพราะมีแค่ `saveParties` เรียก
  - `readAttendance()` / `writeBatch()` — กลายเป็น export ที่ไม่มีใครเรียกหลังลบ seed
    จึงลบไปด้วย (attendance ยังอ่านผ่าน `readAll`)
  - `placementByMember` / `unlockedParties` / `lockedParties` — ยังใช้ปกติ ไม่แตะ
  - `EventCategory.lanes` + `RAW_UPPER_LANES` / `RAW_LOWER_LANES` — ลบ เพราะเป็น
    คำศัพท์ของ seed ที่ไม่มีผู้อ่านแล้ว (กล่องมาจาก `event_rows` เท่านั้น)
- [x] **4.3 ตรวจ index ให้ตรงกับ query จริง**
  - `event_rows_by_scope(event, division, position)` — `EXPLAIN QUERY PLAN` เลือกใช้
    index นี้และเหลือ sort เฉพาะ `id` ที่ใช้ตัดสินกรณี position เท่ากัน
  - `party_members_by_name(member_name)` — ใช้จริงโดย `deleteMember` / `syncMembers`
    (`SEARCH … USING INDEX`)
  - `party_placements_by_row(event, division, row_id)` — ไม่ได้อยู่ในเส้นทางอ่านของ
    บอร์ด (อ่าน snapshot ทั้งชุด) แต่ใช้โดยสคริปต์ drag/order และการอ่านตามกล่องในอนาคต;
    คงไว้พร้อมหมายเหตุใน schema
  - หมายเหตุ: `parties` ยัง sorts ด้วย temp B-tree ตาม `ORDER BY position, id` และ
    `party_members` ยัง sort `slot` — ทั้งสองตารางมีไม่กี่สิบ/ร้อยแถว จึงไม่เพิ่ม index
    ที่ต้องดูแลเพิ่ม
- [x] **4.4 ทบทวน `PARTY_SCHEMA` ว่าไม่มีคอลัมน์ตาย**
  - ทุกคอลัมน์ถูกอ่าน/เขียนจริง · `party_placements.position` **ไม่ใช่ของตายแล้ว**
    เพราะ 2.1 ใช้เรียงการ์ดต่อ scope (มีหมายเหตุใน schema)

---

## เฟส 5 — เทสต์

ไม่มี test runner ในโปรเจกต์มาก่อน — เพิ่มโดยไม่กระทบ runtime และไม่ลง dependency ใหม่

- [x] **5.1 เพิ่ม `node:test` + `npm run test`** (ไม่ต้องลง dependency ใหม่)
  - `tests/*.test.mts` รันด้วย type stripping ของ Node เอง (`--experimental-strip-types`)
  - `tests/register.mjs` เป็น hook เดียวที่เติม `.ts` ให้ import แบบไม่มีนามสกุล และแก้ alias `@/`
    เพราะ Next/Turbopack resolve ให้ตอน build แต่ Node ไม่ได้ทำ
  - `npm test` = `node … --test "tests/**/*.test.mts"` — ไม่มี watch mode และไม่แตะ Turso
- [x] **5.2 เทสต์ pure function ที่ควรมี** — 39 เทสต์ / 11 suite
  - ~~`planPartyMigration`~~ — ถูกลบไปแล้วใน 1.2 พร้อม migration; เคส “label → placements”
    ถูกแทนด้วย `parseParties` + `normalizePlacements` + `derivePartyContent` ที่เป็นทางเข้า/ออกจริง
  - `derivePartyContent` — ลำดับอีเวนต์, กล่องถูกลบ, ลีกไม่ระบุกล่อง/ลีกแปลก, อีเวนต์ที่ไม่รู้จัก
  - `togglePartyLabel` — เพิ่ม/ถอด/สลับลีกโดยไม่แตะกล่องของอีเวนต์อื่น
  - `parseParties` / `parseEventRows` — ปฏิเสธ event/division แปลก, placement ซ้ำ, ค่า junk,
    และยืนยันว่า `parseEventRows` **ไม่** dedupe (ด่านอยู่ที่ `dedupeEventRows`)
  - `dedupeEventRows` — id ซ้ำ, ชื่อ fold ซ้ำใน scope เดียว, ชื่อเดียวกันต่าง scope อยู่ได้
  - `normalizePlacements` — rowId ชี้ผิดอีเวนต์ → null, ตาม remap ต่อเนื่อง, ทิ้งลีกแปลก
  - `planRandomParties` — ไม่ใช้คนที่มีทีมแล้ว, ทีมละ ≤5, จัดคนมาวันนี้ก่อน, core job,
    เหลือคนเดียวไม่ตั้งทีม, และรายชื่อทีมต่อจากของเดิม
  - เพิ่มเทสต์ของลำดับ/การย้ายที่ผูกกับ 2.1–2.3: `sortTeamsForScope`, `rowsForScope`,
    `setPartyPlacement`, `withoutPartyPlacement`, `partiesForDivision`
  - **หมายเหตุ:** `normalizePlacements` ย้ายจาก `lib/db.ts` ไป `lib/party.ts` เพื่อให้ทดสอบได้
    โดยไม่ import `server-only`; ตัวเขียนยังเรียกผ่าน `saveParties` เหมือนเดิม

---

## เฟส 6 — เอกสาร

- [x] **6.1 อัปเดต `AGENTS.md`**
  - หัวข้อปาร์ตี้ยังบรรยายโมเดล string label (`Party.content` เป็นตัวตัดสิน) ซึ่ง **ไม่จริงแล้ว**
  - ต้องเขียนใหม่: `placements` + `event_rows`, กล่องทุกอีเวนต์แก้ได้, `row_id NULL` = ว่าง,
    ลีกไม่ใช่เลนเกมตายตัว, `content` เป็น display cache
  - เพิ่มหัวข้อ “คอลัมน์ลำดับ” ทั้ง 4 ตัวว่าอันไหนใช้ อันไหนยังไม่ใช้
  - เพิ่มของเฟส 3: dedupe แถวกล่อง/ชื่อกล่อง fold · invariant 1 คน 1 ทีมต่ออีเวนต์ · `parties_version` 409
- [x] **6.2 `docs/turso-setup.md`** — เพิ่มตารางใหม่ + วิธีตรวจ migration
- [x] **6.3 อัปเดต comment ที่ยังอ้าง Google Sheets / “ชีต”**
  - grep `sheet|ชีต` ใน `lib/` แล้วแก้ให้ตรงความจริง

---

## เฟส 7 — UI polish (เก็บตก)

- [x] **7.1 คำเรียก “ทีมใหญ่” กับ “กล่อง” ให้ตรงกัน**
  - ตอนนี้ปุ่มเขียน “เพิ่มกล่อง” แต่ dialog ยังมี `fieldLabel="ชื่อทีมใหญ่"` และ placeholder “เช่น ทีมใหญ่ 1”
    ใน `league-lanes.tsx` / `event-board.tsx`
- [x] **7.2 ข้อความหัวแถว “ว่าง”**
  - ลีกตอนนี้ขึ้น “รวม N ทีมที่ยังไม่ได้ระบุว่าอยู่แถวไหน” ซึ่งยังใช้ได้ แต่ควรทบทวนถ้อยคำให้ตรงกับ
    “ทีมที่ยังไม่ถูกจัดเข้ากล่อง”
- [x] **7.3 empty state ของลีกที่ยังไม่มีกล่องเลย**
  - ปัจจุบันลีก seed กล่องมาให้ครบ ถ้าลบกล่องหมดจะเหลือแค่ “ว่าง” — ตรวจว่ายังมีทาง “เพิ่มกล่อง”
- [x] **7.4 ตรวจ `TeamEditDialog` หลังแก้ป้ายแล้วทีมย้ายลีก**
  - เทสต์แล้วว่า placements ถูกต้อง แต่ยังไม่ได้ทดสอบว่า dialog ปิดและทีมหายจากแท็บเดิมถูกต้องบน UI จริง

---

## ภาคผนวก A — ตารางและ endpoint ปัจจุบัน

ตาราง:

```text
members(name PK, job, level, note, position)
attendance(seq PK, name, date, status, note, submitted_at)
parties(id PK, name, content*, members*, updated_at, locked, position)   * = legacy, เขียน NULL/'[]' เสมอ
event_rows(id PK, event, division, name, position)
party_members(party_id, member_name, slot)      PK(party_id, member_name)
party_placements(party_id, event, division, row_id, position)  PK(party_id, event)
app_meta(key PK, value)
```

endpoint:

```text
GET  /api/parties                 → { parties, eventRows, version }
PUT  /api/admin/parties           → { parties, eventRows?, version }  * ส่ง version ที่อ่านมากลับไป (ไม่ส่ง = last-write-wins)
GET  /api/admin/view              → { ..., parties, eventRows, partyVersion }
POST /api/admin/members/import    → syncMembers (ลบเฉพาะ party_members)
POST /api/admin/members/purge     → deleteMember (ลบเฉพาะ party_members)
```

## ภาคผนวก B — สิ่งที่ตรวจผ่านแล้ว (ไม่ต้องทำซ้ำ)

- [x] `npx tsc --noEmit` ผ่าน
- [x] `npx eslint lib app components` ผ่าน
- [x] `npm run build` ผ่าน
- [x] อ่าน Turso จริงด้วยโมเดลใหม่ (32 ปาร์ตี้ / 131 สมาชิก / 96 placements / 6 rows)
- [x] migrate บน Turso จริง โดย `parties` เดิมไม่ถูกแก้ (hash ตรงกัน)
- [x] เพิ่มกล่อง / เปลี่ยนชื่อกล่อง / ลบกล่องเปล่า / ลบกล่องที่มีทีม (มี confirm) บน UI จริง
- [x] เรียงกล่องด้วยปุ่ม ↑/↓ แล้ว `event_rows.position` เปลี่ยนถูก
- [x] ย้ายทีมด้วยปุ่ม “ย้าย” แล้ว placement เปลี่ยนเฉพาะอีเวนต์นั้น
- [x] กล่องในลีกมีปุ่มเปลี่ยนชื่อ/ลบ/เรียงครบ (เดิมไม่มี)
- [x] purge สมาชิกคนสุดท้ายของทีม → ทีมยังอยู่ roster ว่างจริง
- [x] import CSV → ถอดชื่อออกจากทีมและนับ `cleanedParties` ถูก
- [x] seed 150 คน / 14 ปาร์ตี้ / 11 กล่อง
- [x] จอ 320px และ 390px ไม่มี horizontal overflow (แก้ `TabsList` ของ `/admin` ให้ wrap)
- [x] เขียน Turso จริง 1 รอบ ครบ 5 สถานการณ์ + `batch` เป็น transaction เดียว — แล้ว restore hash ตรงทุกตาราง (0.1)
- [x] one-time 0.3 + 0.4 บน Turso จริง — 16 ทีมลีกเข้าเลนกลาง/กลุ่ม B, `BabyOTteR` ออก, ไม่มีชื่อหลุด roster
- [x] เฟส 1: `partyStatements` / seed เขียน `content = NULL`, `members = '[]'`; ไม่มี helper label เดิมเหลือ
- [x] เฟส 1: ลบ migration + route แล้ว และตรวจ marker `parties_normalized_v1` บน Turso ก่อนลบ
- [x] เฟส 1: `npx tsc --noEmit` / `npx eslint lib app components` / `npm run build` ผ่าน
- [x] เฟส 1: ทดสอบกับ SQLite ไฟล์ชั่วคราว (`file:`) ผ่าน HTTP API จริง — seed 150 คน /
  14 ปาร์ตี้ / 11 กล่อง แล้ว PUT ทั้งลิสต์: `content` ยังเป็น `NULL`, `members` เป็น `'[]'`
  และ `/api/parties` ยัง derive ป้ายจาก placements ได้ครบ
- [x] เฟส 2: `scripts/phase2-order-check.mjs` ผ่าน — สลับลำดับการ์ดในกล่องเดียวแล้ว
  `party_placements.position` กลับด้าน · position แน่นต่อ scope · ทีมเดียวกันในอีเวนต์อื่น
  ไม่ขยับ · ลำดับอาร์เรย์ปาร์ตี้เขียนลง `parties.position` · `memberNames` อ่านตาม slot
- [x] เฟส 2: `scripts/phase2-drag-check.mjs` ผ่าน — ลากการ์ดด้วยเมาส์, ลากแถวด้วยเมาส์,
  และ TouchSensor (hold 350ms) เขียนลำดับจริงในฐานข้อมูล
- [x] เฟส 2: `scripts/phase2-ui-check.mjs` ผ่าน — dropdown “ลำดับสมาชิกในทีม” สลับเป็น
  `slot` แล้วการ์ดเรียงตาม `party_members.slot` · ปุ่ม ↓ ในการ์ดปาร์ตี้เขียน
  `parties.position` ตามอาร์เรย์ใหม่
- [x] เฟส 3: `scripts/phase3-check.mjs` ผ่าน 19/19 — สมาชิกคนเดียวอยู่สองทีมของอีเวนต์เดียวถูกปฏิเสธ (400)
  โดยไม่แก้อะไร · `event_rows` id ซ้ำถูกทิ้งแทนที่จะทำให้เขียนพัง · ชื่อกล่องที่ fold กันเหลือกล่องเดียว
  (case-insensitive) · ทีมที่ค้างอยู่ในกล่องซ้ำย้ายตามไปกล่องที่รอดชีวิต · เวอร์ชันที่ล้าสมัยถูกปฏิเสธ (409)
  แล้วเวอร์ชันปัจจุบันสำเร็จ
- [x] เฟส 3: `npx tsc --noEmit` / `npx eslint lib app components` / `npm run build` ผ่าน
- [x] เฟส 3: `phase2-order-check` / `phase2-drag-check` / `phase2-ui-check` ยังผ่าน (writer ทั้งสองตัว
  ส่ง `version` ผ่าน ref เดียวกันที่หน้าถือไว้)
- [x] เฟส 3: อ่าน Turso จริงอย่างเดียว — 32 ปาร์ตี้ / 6 rows ไม่มี id ซ้ำ ไม่มีชื่อกล่องซ้ำแบบ case-fold
  และไม่มีสมาชิกอยู่หลายทีมของอีเวนต์เดียว · `app_meta` ยังไม่มี `parties_version` (เริ่มนับที่ 0)
- [x] เฟส 4: `app/api/admin/seed/` + `lib/seed.ts` ถูกลบ และ build ไม่มี route นั้นแล้ว
- [x] เฟส 4: `npx tsc --noEmit` / `npx eslint lib app components` / `npm run build` ผ่าน
- [x] เฟส 4: `scripts/fixture.mjs` + `phase3-check` ผ่าน 19/19 บน SQLite ชั่วคราว;
  `phase2-order-check` ผ่าน 8/8
- [x] เฟส 4: `phase2-ui-check` และ `phase2-drag-check` ยังผ่านกับ Chrome headless
  (fixture เดียวกัน ไม่ต้องพึ่ง seed route)
- [x] เฟส 4: `EXPLAIN QUERY PLAN` ยืนยันว่า `event_rows_by_scope` และ
  `party_members_by_name` ถูกใช้จริง; `parties` / `party_members` ยังมี sort เล็ก ๆ
  ตามขนาดตาราง (บันทึกไว้ใน 4.3)
- [x] เฟส 5: `npm test` ผ่าน 39 เทสต์ / 11 suite ด้วย `node:test` + type stripping
  ของ Node — ไม่มี dependency เพิ่มและไม่แตะฐานข้อมูล
- [x] เฟส 5: `npx tsc --noEmit` / `npx eslint lib app components tests` / `npm run build`
  ผ่านหลังย้าย `normalizePlacements` ไป `lib/party.ts`
- [x] เฟส 5: เทสต์ครอบ `parseParties` / `parseEventRows` / `dedupeEventRows` /
  `normalizePlacements` / `derivePartyContent` / `togglePartyLabel` / `planRandomParties`
  และตัวช่วยลำดับ `sortTeamsForScope` / `rowsForScope` / `setPartyPlacement`
- [x] เฟส 5: ไม่มีเทสต์ที่ต้องรันเซิร์ฟเวอร์หรือ Turso — สคริปต์ `phase*` ยังแยกหน้าที่
  ตรวจ integration บนฐานข้อมูล `file:` เหมือนเดิม
- [x] เฟส 6: `AGENTS.md` เขียนหัวข้อปาร์ตี้ใหม่ทั้งก้อน — `party_placements` + `event_rows`
  เป็นความจริง, `Party.content` เป็น display cache, กล่องทุกอีเวนต์แก้ได้, คอลัมน์ลำดับ 4 ตัว,
  dedupe แถว/ชื่อกล่อง, invariant 1 คน 1 ทีมต่ออีเวนต์ และ `parties_version` → 409
- [x] เฟส 6: `docs/turso-setup.md` เพิ่มตาราง `event_rows` / `party_members` / `party_placements` /
  `app_meta`, คอลัมน์ legacy, การตรวจ marker และคำสั่ง backup/restore ด้วยสคริปต์ในโปรเจกต์
- [x] เฟส 6: comment ที่อ้าง Google Sheets/“ชีต” ใน `lib/` และ route ที่เกี่ยวข้องถูกแก้แล้ว
  (`grep -RIn "sheet\|ชีต" lib app` ไม่เหลือคำอ้างถึงที่ผิด)
- [x] เฟส 7.1: dialog เพิ่ม/เปลี่ยนชื่อกล่องใช้ “ชื่อกล่อง” และ placeholder “เช่น กล่อง A”
  ทั้ง `league-lanes.tsx` และ `event-board.tsx`
- [x] เฟส 7.2: แถว “ว่าง” เปลี่ยนเป็น “รวม N ทีมที่ยังไม่ถูกจัดเข้ากล่อง — ลากไปกล่องไหนก็ได้”
- [x] เฟส 7.3: ลีกที่ลบกล่องออกหมดแล้วยังเห็นปุ่ม “เพิ่มกล่อง” (ตรวจในเบราว์เซอร์จริง) และข้อความ
  empty state เปลี่ยนจาก “ช่องป้ายกำกับ” เป็น “ติ๊กชิป …” พร้อมชี้ไปที่ “เพิ่มกล่อง”
- [x] เฟส 7.4: `scripts/phase7-ui-check.mjs` ผ่าน 12/12 บน production build + Chrome headless —
  เปิดดินสอของทีมในลีคหลัก, สลับชิปเป็นลีครอง, กดบันทึก แล้ว dialog ปิด, ทีมหายจากแท็บเดิม,
  ฐานข้อมูลได้ `division=lower, row_id=NULL` และทีมโผล่ในแท็บลีครอง
- [x] เฟส 6–7: `npx tsc --noEmit` / `npx eslint lib app components tests` / `npm test`
  (39 เทสต์ / 11 suite) / `npm run build` ผ่าน

## ภาคผนวก C — ความเสี่ยงที่ยังเปิดอยู่

| ความเสี่ยง | ผลถ้าไม่แก้ | งานที่เกี่ยวข้อง |
| --- | --- | --- |
| ~~ยังไม่เคยเขียน Turso จริง~~ (แก้แล้ว: 0.1/0.2) | batch บน HTTP client เป็น transaction เดียวจริง — พิสูจน์แล้ว | 0.1, 0.2 |
| ~~16 ทีมลีกย้ายไป “ว่าง”~~ (แก้แล้ว: 0.3) | map เข้าเลนกลาง/กลุ่ม B แล้ว | 0.3 |
| ~~request ซ้ำทำ 502~~ (แก้แล้ว: 3.1) | เขียน id ซ้ำได้แล้ว ไม่ล้มทั้ง request | 3.1 |
| ~~2 แท็บทับกัน~~ (แก้แล้ว: 3.3) | PUT ที่ล้าสมัยได้ 409 แทนการทับงานที่เพิ่งบันทึก | 3.3 |
| ~~ทีมเดียวอยู่หลายทีมของอีเวนต์เดียว~~ (แก้แล้ว: 3.4) | ปฏิเสธก่อนเขียน (400) ไม่มีข้อมูลครึ่ง ๆ | 3.4 |
| race ใน round-trip เดียวกัน (ส่วนที่ 3.3 เหลือไว้) | สองคำขอที่อ่านเวอร์ชันพร้อมกันก่อนเขียนยังทับกันได้ — ไม่แย่กว่า last-write-wins เดิม | 3.3 |
| ~~ลำดับ placement ไม่ถูกใช้ตอนเรนเดอร์~~ (แก้แล้ว: 2.1) | บอร์ดเรียงตาม placement ของ scope นั้นแล้ว | 2.1 |
| ~~AGENTS.md ผิด~~ (แก้แล้ว: 6.1) | เขียนใหม่ตาม placement/event_rows แล้ว | 6.1 |

## ภาคผนวก D — สคริปต์ช่วยงาน (ไม่ใช่ runtime)

ทั้งหมดอยู่ใน `scripts/` เป็น `.mjs` ล้วน (ไม่ถูก `tsc`/`eslint` ตรวจ) อ่าน `.env.local`
ด้วย `process.loadEnvFile` เอง — อย่ารันในโปรดักชัน ให้รันบนเครื่องที่ชี้ Turso เดียวกับแอป
**ยกเว้น `phase2-*`, `phase3-check` และ `phase7-ui-check`** ที่ต้องชี้ฐานข้อมูลชั่วคราวเท่านั้น
(ดูหมายเหตุใต้รายการ)

```text
scripts/turso-backup.mjs             สำรองทุกตารางปาร์ตี้ + members/attendance → backups/*.json
scripts/turso-restore.mjs            คืนจาก dump (ค่าเริ่มต้นเฉพาะตารางปาร์ตี้ + app_meta; --all = ทั้งหมด)
scripts/turso-inspect.mjs            อ่านอย่างเดียว: rows / placements / ชื่อที่หลุด roster
scripts/turso-migration-report.mjs   พิมพ์ report ของ migration + ทีมที่ยังไม่มีกล่อง
scripts/fixture.mjs                  เขียนข้อมูลทดสอบชุดเล็ก (3 ปาร์ตี้/5 กล่อง/6 คน) — `file:` เท่านั้น
scripts/phase0-write-check.mjs       เดินครบ 5 สถานการณ์เขียน (ต้องมี `npm run dev` เปิดอยู่) แล้ว restore
scripts/phase0-league-placement-fix.mjs  one-time 0.3 + 0.4 (PUT เดียว)
scripts/phase2-order-check.mjs       ตรวจลำดับ placement/parties.position/slot ผ่าน HTTP API
scripts/phase2-drag-check.mjs        ลากการ์ด/แถวด้วยเมาส์ + TouchSensor ใน Chrome headless
scripts/phase2-ui-check.mjs          ตรวจ dropdown ลำดับสมาชิก + ปุ่ม ↑/↓ ของการ์ดปาร์ตี้
scripts/phase3-check.mjs             ตรวจ dedupe / ชื่อกล่อง case-insensitive / one-team-per-event / optimistic lock (ต้องมี dev server)
scripts/phase7-ui-check.mjs          ตรวจ dialog แก้ทีมหลังสลับชิปแล้วทีมย้ายลีก + `row_id` ถูกล้าง
```

`phase2-*` ทั้งสามตัวเขียน fixture เองตอนเริ่ม (ต้องมี dev server ที่ชี้ฐานข้อมูล
`file:` เดียวกัน) จึงไม่ต้อง seed ล่วงหน้า · ต้องชี้ฐานข้อมูลชั่วคราว
(`PHASE2_DATABASE_URL=file:...`) และ
มี dev server (`PHASE2_BASE_URL`) · ตัว drag/ui ยังต้องเปิด Chrome แบบ
`--remote-debugging-port=9223` (`PHASE2_CDP_URL`) และล็อกอินด้วย `GUILD_PIN`
จาก `.env.local` · ห้ามชี้ Turso จริงเพราะสคริปต์เขียนลำดับลงฐานข้อมูล

`phase3-check.mjs` ต้องชี้ฐานข้อมูลชั่วคราวเหมือนกัน (`PHASE3_DATABASE_URL=file:...` · `PHASE3_BASE_URL`)
เพราะมันส่ง id ซ้ำ / ชื่อกล่องซ้ำ / เวอร์ชันล้าสมัยเข้าไป**โดยเจตนา** และสคริปต์ปฏิเสธทันทีถ้าไม่ใช่ `file:`
— ห้ามตั้ง `PHASE3_DATABASE_URL` เป็น Turso จริง

`phase7-ui-check.mjs` ใช้รูปแบบเดียวกับ `phase3-check` (`PHASE7_DATABASE_URL=file:...` ·
`PHASE7_BASE_URL` · `PHASE7_CDP_URL`) เพราะเขียนป้ายของทีมในฐานข้อมูล ต้องมี Chrome เปิด
`--remote-debugging-port=9223` และควรรันกับ `npm run build && npm start` เพื่อไม่ให้ HMR
รบกวนระหว่างการวัด DOM

`backups/` อยู่ใน `.gitignore` — dump มีชื่อสมาชิกทั้งกิลด์ ห้าม commit
