# ตั้งค่า Turso (ฐานข้อมูล)

แอปนี้เก็บข้อมูลทั้งหมด (รายชื่อสมาชิก, attendance, ปาร์ตี้) ไว้ใน **Turso** ซึ่งเป็น SQLite ที่รันเป็นเซิร์ฟเวอร์จริง เข้าถึงผ่าน HTTP

ทั้งชั้นข้อมูลอยู่ในไฟล์เดียวคือ `lib/db.ts` — มีแค่จุดเดียวที่ติดต่อฐานข้อมูล ทุก API route เรียกผ่านฟังก์ชันในไฟล์นั้น และ component ไม่เคยเห็น "แถว" ของฐานข้อมูลเลย (ได้แค่ object ที่ parse เสร็จแล้ว) ถ้าจะเปลี่ยนที่เก็บข้อมูลอีกครั้ง แก้แค่ไฟล์นี้

## ทำไมถึงต้องเป็นเซิร์ฟเวอร์ ไม่ใช่ไฟล์ SQLite

Vercel รันแต่ละ request เป็น serverless function แยกกันบน instance ที่ถูกสร้างใหม่และทำลายทิ้งตลอด
ถ้าเขียนลงไฟล์ `.db` ตรง ๆ ข้อมูลจะมองไม่เห็นจาก request ถัดไป (คนละ instance) และหายเมื่อ instance ถูก recycle
Turso เป็น SQLite จริง ๆ คำสั่ง SQL เดิมใช้ได้ทั้งตอน dev และ production

## สร้างฐานข้อมูล

ต้องมี [Turso CLI](https://docs.turso.tech/cli/installation) (`npm i -g @turso/cli`)

```bash
turso login
turso db create guild          # ชื่ออะไรก็ได้
turso db tokens create -w      # -w = write token
```

จะได้ค่าสองตัว เอาไปใส่ใน `.env.local` (ดู `.env.example`)

```bash
TURSO_DATABASE_URL=libsql://guild-xxxx.turso.io
TURSO_AUTH_TOKEN=<token ที่ได้>
```

**อย่าลืมใส่ token ที่มีสิทธิ์ write** — token แบบ read-only จะอ่านได้แต่บันทึกไม่ได้
token คือความลับของเซิร์ฟเวอร์ทั้งหมด ห้าม commit ลง git และห้ามใส่ในโค้ดฝั่ง browser

## ตาราง

ไม่ต้องรัน migration เอง — `lib/db.ts` สร้างตารางให้เองตอนที่ query แรกไปเจอว่ายังไม่มี (`CREATE TABLE IF NOT EXISTS`)

| ตาราง | เก็บอะไร |
| --- | --- |
| `members` | รายชื่อ · **คลาส (ชื่อ เช่น `Paladin`)** · level · note · position |
| `attendance` | บันทึกการส่งสถานะ **append-only** มี `seq` เป็นลำดับการส่ง |
| `parties` | หัวทีม · ชื่อ · `locked` · `position` (ลำดับการ์ดในแท็บปาร์ตี้) |
| `party_members` | สมาชิกในทีม · `slot` = ลำดับคนในทีม · PK `(party_id, member_name)` |
| `event_rows` | กล่องของทุกอีเวนต์ (`event` + `division` + `name` + `position`) |
| `party_placements` | ทีมลงอีเวนต์ไหน อยู่กล่องไหน (`row_id`) และลำดับการ์ดต่อ scope (`position`) |
| `app_meta` | key/value เล็ก ๆ — ตอนนี้เก็บ `parties_version` สำหรับ optimistic lock |

**ที่มาของป้ายทีม:** `parties.content` กับ `parties.members` เป็นคอลัมน์รุ่นเก่า
ที่ยังอยู่ในสคีมาแต่ **ไม่ถูกอ่านและไม่ถูกเขียนแล้ว** (`saveParties` เขียน `NULL` / `'[]'`
ทุกครั้ง) ป้ายที่เห็นบนจอ derive จาก `party_placements` + ชื่อใน `event_rows`
ด้วย `derivePartyContent()` และรายชื่อมาจาก `party_members` เท่านั้น

**ลำดับ 4 ตัวใช้คนละเรื่อง:** `parties.position` = ลำดับการ์ดในแท็บปาร์ตี้ ·
`party_placements.position` = ลำดับการ์ดต่อ scope (`event` + `division`) ·
`event_rows.position` = ลำดับกล่องต่อ scope · `party_members.slot` = ลำดับคนในทีม

## ตรวจว่าข้อมูลย้ายมารุ่น normalized แล้ว

migration แบบ one-time ถูกลบออกจากโค้ดแล้ว (เฟส 1) แต่ marker ยังอยู่ใน `app_meta`
ใช้ตรวจย้อนหลังได้ด้วยสคริปต์อ่านอย่างเดียว:

```bash
node scripts/turso-inspect.mjs
```

ต้องเห็น `parties_normalized_v1` และ `parties_normalized_v1_report` ครบ
และจำนวน `parties` / `party_placements` / `party_members` / `event_rows` ไม่เป็นศูนย์
ถ้ามีทีมที่ยังไม่มีกล่อง (placement `row_id IS NULL`) สคริปต์จะแสดงให้เห็น —
แก้ได้จากหน้าเวิร์กบอร์ดหรือแท็บ “ปาร์ตี้” ไม่ต้องรัน migration

## คอลัมน์ที่ไม่ได้ใช้แล้ว

- `parties.content` / `parties.members` — display cache รุ่นเก่า เขียน `NULL` / `'[]'` เสมอ
- `members.active` — ถูกล้างแถว `active = 0` ทิ้งหนึ่งครั้งตอน cold start
  (`dropBenchedMembers`) แล้วไม่มีโค้ดอ่านอีก

## คลาสเก็บเป็นชื่อ ไม่ใช่เลข

`members.job` เก็บ `"Paladin"` ไม่ใช่ `222` เพื่อให้อ่านรู้เรื่องตอนเปิดดูข้อมูล

**แลกกับอะไร:** ชื่อคลาสคือ foreign key ที่เป็นข้อความ ถ้าไปแก้ชื่อใน `lib/rngw/jobs.ts`
ทีหลัง สมาชิกที่บันทึกด้วยชื่อเดิมจะกลายเป็นคลาสที่ไม่รู้จัก — ย้อนแก้ไม่ได้ เพราะชื่อเดิม
หายไปจากโค้ดแล้ว อาการคือ **ไอคอนกลายเป็นตัวอักษรย่อ** และคลาสนั้นจะไม่ถูกนับเป็น
บัฟ/แทงก์ในการสุ่มปาร์ตี้ แต่**ชื่อที่พิมพ์ไว้ยังแสดงอยู่** ไม่หายเงียบ ๆ

ถ้าจำเป็นต้องเปลี่ยนชื่อจริง ๆ ให้แก้ข้อมูลในฐานข้อมูลก่อน:

```sql
UPDATE members SET job = 'ชื่อใหม่' WHERE job = 'ชื่อเดิม';
```

ทำก่อนแก้ `jobs.ts` เสมอ

## ข้อมูลทดสอบสำหรับสคริปต์

แอปไม่มี seed route แล้ว (`lib/seed.ts` และ `POST /api/admin/seed` ถูกลบตอนเฟส 4)
สคริปต์ตรวจงาน (`scripts/phase2-*`, `scripts/phase3-check.mjs`) สร้างข้อมูลเองผ่าน
`scripts/fixture.mjs` — รับเฉพาะ `file:` URL เพราะมันลบปาร์ตี้/สมาชิกทั้งหมดก่อนเขียน

```bash
npm run dev   # คนละ terminal กับฐานข้อมูลชั่วคราว
PHASE2_BASE_URL=http://localhost:3311 \
  node scripts/fixture.mjs file:/tmp/phase2.db
```

**ห้ามชี้ไปที่ Turso จริง** — fixture ลบข้อมูลทั้งชุด

## ดูข้อมูล

```bash
turso db shell guild          # เปิด sqlite shell
```

หรือหน้าเว็บ https://turso.tech → database ของคุณ → Browse

## สำรองข้อมูล

```bash
node scripts/turso-backup.mjs [label]
```

เขียน `backups/turso-parties-backup-<ts>[-label].json` (ตารางปาร์ตี้ทั้งหมด +
`members` / `attendance`) · กู้คืนด้วย

```bash
node scripts/turso-restore.mjs backups/turso-parties-backup-....json
```

ค่าเริ่มต้นคืนเฉพาะตารางปาร์ตี้ + `app_meta`; ใส่ `--all` ถ้าต้องการ `members` /
`attendance` ด้วย · `backups/` อยู่ใน `.gitignore` เพราะมีชื่อสมาชิกทั้งกิลด์
**ห้าม commit**

หรือใช้ CLI ดิบ:

```bash
turso db shell guild .dump > backup.sql
```

## เปลี่ยนแบบ local (ไม่ต้องต่อ Turso)

ใส่ URL เป็นไฟล์ใน `.env.local` แล้วแอปจะรันบน SQLite ไฟล์ในเครื่อง ไม่ต้องใช้ token

```bash
TURSO_DATABASE_URL=file:./local.db
```

อย่าลืมใส่ `local.db` ใน `.gitignore`