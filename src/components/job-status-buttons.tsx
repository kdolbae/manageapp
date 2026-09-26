"use client";

import { useEffect, useState, useSyncExternalStore, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { setJobStatus } from "@/lib/actions/jobs";
import type { ActionState } from "@/lib/actions/auth";

/* ---------------------------------------------------------------------------
 * 기사 화면(오늘 시공)의 시작·완료 버튼 + 오프라인 큐.
 *
 * 온라인: 서버 액션 setJobStatus 를 바로 부르고 router.refresh().
 * 오프라인(navigator.onLine 이 false 이거나 호출이 네트워크 오류로 실패): localStorage 의
 * jip.jobQueue 에 { jobId, status, at } 로 쌓고 버튼은 "전송 대기". 큐는 <JobQueueSync />(루트
 * 레이아웃)가 페이지 로드 때와 online 이벤트 때 앞에서부터 다시 보내고, 성공한 항목을 지운다.
 * 시작을 쌓아 둔 건은 완료 버튼을 이어서 누를 수 있다 (둘 다 순서대로 전송).
 * ------------------------------------------------------------------------- */

export type QueuedStatus = "in_progress" | "done";
export type QueuedJob = { jobId: string; status: QueuedStatus; at: string };
/** sent: 서버가 받았고 화면 새로고침만 남은 항목 (저장하지 않고 메모리에만 둔다) */
type Entry = QueuedJob & { sent?: boolean };
type State = { entries: readonly Entry[]; failed: Readonly<Record<string, string>> };

const KEY = "jip.jobQueue";
const EMPTY_STATE: State = { entries: [], failed: {} };
let state: State | null = null;
const listeners = new Set<() => void>();
let storageBound = false;

function isQueuedJob(value: unknown): value is QueuedJob {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return typeof o.jobId === "string" && (o.status === "in_progress" || o.status === "done") && typeof o.at === "string";
}

function load(): Entry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isQueuedJob) : [];
  } catch {
    return [];
  }
}

function persist(entries: readonly Entry[]) {
  const unsent: QueuedJob[] = entries.filter((e) => !e.sent).map(({ jobId, status, at }) => ({ jobId, status, at }));
  try {
    if (unsent.length) localStorage.setItem(KEY, JSON.stringify(unsent));
    else localStorage.removeItem(KEY);
  } catch {
    /* 저장이 막혀 있으면(시크릿 모드 등) 메모리 큐로만 동작한다 */
  }
}

function emit() {
  listeners.forEach((listener) => listener());
}

function getState(): State {
  if (state === null) state = { entries: load(), failed: {} };
  return state;
}
const getServerState = () => EMPTY_STATE;

function update(next: Partial<State>) {
  state = { ...getState(), ...next };
  if (next.entries) persist(next.entries);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!storageBound) {
    storageBound = true;
    // 다른 탭이 큐를 바꾸면 다시 읽는다
    window.addEventListener("storage", (event) => {
      if (event.key !== null && event.key !== KEY) return;
      state = { entries: load(), failed: getState().failed };
      emit();
    });
  }
  return () => {
    listeners.delete(listener);
  };
}

const same = (a: QueuedJob, b: QueuedJob) => a.jobId === b.jobId && a.status === b.status && a.at === b.at;

function enqueue(jobId: string, status: QueuedStatus) {
  const { entries, failed } = getState();
  const rest = { ...failed };
  delete rest[jobId];
  update({ entries: [...entries, { jobId, status, at: new Date().toISOString() }], failed: rest });
}

/** 서버가 받은 항목(sent)을 메모리에서 지운다. 새로고침이 끝난 뒤에 불러야 버튼이 깜빡이지 않는다. */
function settleSent() {
  const { entries } = getState();
  if (entries.some((e) => e.sent)) update({ entries: entries.filter((e) => !e.sent) });
}

let flushing: Promise<number> | null = null;

/** 큐를 앞에서부터 서버로 보낸다. 보낸 건수를 돌려준다. 네트워크 오류면 멈추고 다음 online 때 다시 시도한다. */
export function flushJobQueue(): Promise<number> {
  if (flushing) return flushing;
  flushing = (async () => {
    let sent = 0;
    for (let guard = 0; guard < 200; guard++) {
      if (!navigator.onLine) break;
      const next = getState().entries.find((e) => !e.sent);
      if (!next) break;
      const fd = new FormData();
      fd.set("id", next.jobId);
      fd.set("status", next.status);
      let result: ActionState | undefined;
      try {
        result = await setJobStatus({}, fd);
      } catch {
        break; // 네트워크 오류 등: 큐에 남겨 두고 다음에 다시
      }
      if (!result) break; // 로그인이 풀려 리다이렉트된 경우 등: 그대로 둔다
      const { entries, failed } = getState();
      if (result.error) {
        // 서버가 거부(권한·없는 건): 다시 보내도 같으니 버리고 이유를 남긴다
        update({ entries: entries.filter((e) => !same(e, next)), failed: { ...failed, [next.jobId]: result.error } });
      } else {
        update({ entries: entries.map((e) => (same(e, next) ? { ...e, sent: true } : e)) });
        sent += 1;
      }
    }
    return sent;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

const getWaitingCount = () => getState().entries.filter((e) => !e.sent).length;
const getServerWaitingCount = () => 0;

/** 아직 서버에 못 보낸 건수. */
export function useJobQueueCount() {
  return useSyncExternalStore(subscribe, getWaitingCount, getServerWaitingCount);
}

/** 루트 레이아웃에서 한 번: 페이지 로드 때와 연결이 돌아올 때 큐를 보내고 화면을 새로고침한다. */
export function JobQueueSync() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let alive = true;
    const run = () => {
      void flushJobQueue().then((sent) => {
        if (alive && sent > 0) startTransition(() => router.refresh());
      });
    };
    run();
    window.addEventListener("online", run);
    return () => {
      alive = false;
      window.removeEventListener("online", run);
    };
  }, [router, startTransition]);
  useEffect(() => {
    if (!pending) settleSent();
  }, [pending]);
  return null;
}

/** 오늘 시공 카드의 시작·완료 버튼 (그리드 한 칸). status 는 서버가 준 현재 상태. */
export function JobStatusButtons({ jobId, status }: { jobId: string; status: string }) {
  const router = useRouter();
  const { entries, failed } = useSyncExternalStore(subscribe, getState, getServerState);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<ActionState>({});
  const mine = entries.filter((e) => e.jobId === jobId);
  const last = mine.length ? mine[mine.length - 1] : null;
  const effective = last ? last.status : status; // 큐에 쌓인 것까지 반영한 상태
  const waiting = mine.some((e) => !e.sent);
  const error = result.error ?? failed[jobId];

  function send(next: QueuedStatus) {
    setResult({});
    if (!navigator.onLine) {
      enqueue(jobId, next);
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("id", jobId);
      fd.set("status", next);
      let res: ActionState | undefined;
      try {
        res = await setJobStatus({}, fd);
      } catch {
        enqueue(jobId, next); // 네트워크 오류: 큐에 넣고 연결되면 보낸다
        return;
      }
      if (!res) return;
      setResult(res);
      if (!res.error) startTransition(() => router.refresh());
    });
  }

  let control: ReactNode;
  if (effective === "done") {
    control =
      last && !last.sent ? (
        <button type="button" className="btn w-full" disabled>
          전송 대기
        </button>
      ) : (
        <div className="btn w-full text-success">완료됨</div>
      );
  } else if (effective === "in_progress") {
    control = (
      <button type="button" onClick={() => send("done")} disabled={pending} className="btn btn-primary w-full">
        {pending ? "처리 중…" : "시공 완료"}
      </button>
    );
  } else {
    control = (
      <button type="button" onClick={() => send("in_progress")} disabled={pending} className="btn btn-primary w-full">
        {pending ? "처리 중…" : "시공 시작"}
      </button>
    );
  }
  return (
    <div className="min-w-0">
      {control}
      {waiting && effective === "in_progress" && <p className="text-xs text-muted mt-1">시작 전송 대기 · 연결되면 자동 전송</p>}
      {error && <p className="notice notice-danger mt-2">{error}</p>}
      {!error && result.ok && <p className="notice notice-success mt-2">{result.ok}</p>}
    </div>
  );
}
