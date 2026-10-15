"use client";

import * as React from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MemberManager } from "@/components/admin/member-manager";
import { PartyBuilder } from "@/components/admin/party-builder";
import { HistoryTable } from "@/components/admin/history-table";
import { AbsenceWarnings } from "@/components/admin/absence-warnings";
import { absencesFor } from "@/lib/rngw/attendance";
import { setAdminSession, useAdminSession } from "@/hooks/use-admin-session";
import type {
  AttendanceRow,
  Member,
  Party,
  RosterResponse,
} from "@/lib/rngw/types";

/**
 * Admin area.
 *
 * The PIN is entered once per login and kept server-side in an httpOnly,
 * encrypted cookie (see lib/auth.ts). Every write rides that cookie, and
 * `requireAdmin` rejects the request without it — so this client never holds
 * the PIN: the guild master types it once, not once per page.
 */
export function AdminPanel() {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const { authed, configured, ready } = useAdminSession();

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "เข้าสู่ระบบไม่สำเร็จ");
      setPin("");
      // AdminBody mounts on the next render and does its own load, so
      // logging in and refreshing the page take the same path.
      setAdminSession(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <p className="text-muted-foreground py-16 text-center text-sm">
        กำลังตรวจสิทธิ์…
      </p>
    );
  }

  if (!authed) {
    return (
      <Card className="mx-auto max-w-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck /> ผู้ดูแลกิลด์
          </CardTitle>
          <CardDescription>
            {configured
              ? "ใส่รหัสกิลด์เพื่อเข้าโหมดผู้ดูแล"
              : "ยังตั้งค่าไม่เสร็จ — เพิ่ม GUILD_PIN และ SESSION_SECRET ใน .env.local"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={login} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-pin">รหัสกิลด์</Label>
              <Input
                id="admin-pin"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
                disabled={!configured}
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={busy || !pin || !configured}
            >
              <KeyRound /> เข้าสู่ระบบ
            </Button>
            {error && <p className="text-destructive text-sm">{error}</p>}
          </form>
        </CardContent>
      </Card>
    );
  }

  return <AdminBody />;
}

type AdminData = {
  /** The guild-local day the view was rendered for; absences are counted up to it. */
  date: string;
  roster: RosterResponse;
  allMembers: Member[];
  attendance: AttendanceRow[];
  parties: Party[];
};

/**
 * Everything behind the login gate.
 *
 * Separate from AdminPanel so it mounts only once authenticated, and so the
 * data load happens after an await rather than synchronously inside an effect
 * (react-hooks/set-state-in-effect).
 */
function AdminBody() {
  const [data, setData] = React.useState<AdminData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(true);
  const [nonce, setNonce] = React.useState(0);

  // All setState calls land inside the promise callbacks rather than in the
  // effect body, which is what react-hooks/set-state-in-effect allows.
  React.useEffect(() => {
    let cancelled = false;

    fetch("/api/admin/view", { cache: "no-store" })
      .then(async (res) => ({ res, body: await res.json() }))
      .then(({ res, body }) => {
        if (cancelled) return;
        if (!res.ok) throw new Error(body.error ?? "โหลดข้อมูลไม่สำเร็จ");
        setData(body);
        setError(null);
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const refresh = React.useCallback(() => {
    setBusy(true);
    setNonce((n) => n + 1);
  }, []);

  // Counted here, not on the server: the admin view already ships the whole
  // ledger, and a member opening the public board must never be one round trip
  // away from a verdict about somebody else's silence.
  const absences = React.useMemo(
    () =>
      data
        ? absencesFor(data.allMembers, data.attendance, data.date)
        : new Map(),
    [data],
  );
  const warned = [...absences.values()].filter((info) => info.count > 0).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ShieldCheck /> ผู้ดูแลกิลด์
        </h1>
        <span className="text-muted-foreground text-xs">
          ออกจากระบบได้จากปุ่มข้างบน
        </span>
      </div>

      {error && <p className="text-destructive text-sm">{error}</p>}

      {!data ? (
        <p className="text-muted-foreground py-12 text-center text-sm">
          {busy ? "กำลังโหลด…" : "ยังไม่มีข้อมูล"}
        </p>
      ) : (
        <Tabs defaultValue="members">
          <TabsList>
            <TabsTrigger value="members">สมาชิก</TabsTrigger>
            <TabsTrigger value="parties">จัดปาร์ตี้</TabsTrigger>
            <TabsTrigger value="history">ประวัติ</TabsTrigger>
            <TabsTrigger value="absences">
              ไม่มาไม่ลา
              {warned > 0 && (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {warned}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="mt-4">
            <MemberManager
              members={data.allMembers}
              absences={absences}
              attendance={data.attendance}
              onSaved={refresh}
            />
          </TabsContent>

          <TabsContent value="parties" className="mt-4">
            <PartyBuilder
              members={data.roster.roster}
              parties={data.parties}
              // Only the parties tab changes, so the list is updated in place
              // instead of re-reading the whole admin view from the script.
              onChange={(next) =>
                setData((current) => (current ? { ...current, parties: next } : current))
              }
            />
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <HistoryTable
              members={data.allMembers}
              attendance={data.attendance}
              today={data.date}
              timeZone={data.roster.timeZone}
            />
          </TabsContent>

          <TabsContent value="absences" className="mt-4">
            <AbsenceWarnings
              members={data.allMembers}
              absences={absences}
              attendance={data.attendance}
              onSaved={refresh}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
