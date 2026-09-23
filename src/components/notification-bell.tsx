"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { markNotificationsRead } from "@/lib/actions/inbox";

export type Notice = { id: string; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };

function ago(v: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(v).getTime()) / 60_000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}

/** 헤더의 알림 종. 서버에서 받은 미읽음 목록으로 시작하고, Realtime 으로 새 알림을 바로 받는다. */
export function NotificationBell({ initial, userId, realtime }: { initial: Notice[]; userId: string; realtime: boolean }) {
  const [items, setItems] = useState<Notice[]>(initial);
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    if (!realtime) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`inapp:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "inapp_notification", filter: `profile_id=eq.${userId}` }, (payload) => {
        const n = payload.new as Notice;
        setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 30)));
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          try {
            new Notification(n.title, { body: n.body ?? undefined, tag: n.id });
          } catch {
            /* 브라우저가 막으면 종 배지만 */
          }
        }
        router.refresh();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [realtime, userId, router]);

  function readAll() {
    startTransition(async () => {
      await markNotificationsRead(new FormData());
      setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    });
  }

  function readOne(id: string) {
    const fd = new FormData();
    fd.set("id", id);
    startTransition(async () => {
      await markNotificationsRead(fd);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n)));
    });
    setOpen(false);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} className="btn btn-sm relative" aria-label={`알림 ${unread}건`} aria-expanded={open}>
        <Bell size={15} strokeWidth={1.75} aria-hidden />
        {unread > 0 && <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-danger text-white text-[10.5px] font-bold leading-[18px] text-center">{unread > 99 ? "99+" : unread}</span>}
      </button>
      {open && (
        <>
          <button type="button" className="fixed inset-0 z-20 cursor-default" aria-label="닫기" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-[38px] z-30 w-[320px] max-w-[calc(100vw-24px)] card shadow-lg">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border">
              <b className="text-sm">알림</b>
              {unread > 0 && <button type="button" onClick={readAll} disabled={pending} className="text-xs text-accent">모두 읽음</button>}
            </div>
            <ul className="max-h-[360px] overflow-y-auto divide-y divide-border">
              {items.slice(0, 30).map((n) => (
                <li key={n.id} className={n.read_at ? "opacity-60" : ""}>
                  <Link href={n.link ?? "/inbox"} onClick={() => readOne(n.id)} className="block px-3 py-2.5 no-underline text-text hover:bg-bg">
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-accent shrink-0" />}
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{n.title}</div>
                        {n.body && <div className="text-xs text-muted truncate">{n.body}</div>}
                        <div className="text-[11px] text-muted mt-0.5">{ago(n.created_at)}</div>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              {items.length === 0 && <li className="px-3 py-6 text-center text-xs text-muted">새 알림이 없습니다.</li>}
            </ul>
            {typeof Notification !== "undefined" && Notification.permission === "default" && (
              <button type="button" onClick={() => Notification.requestPermission()} className="w-full text-xs text-accent px-3 py-2 border-t border-border">브라우저 알림 켜기</button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
