"use client";

import { useEffect } from "react";
import Link from "next/link";
import { flushJobQueue, useJobQueueCount } from "@/components/job-status-buttons";

/** 오프라인 페이지의 버튼·대기 건수. 연결이 돌아오면 큐를 보낸 뒤 원래 주소를 다시 연다. */
export function OfflineActions() {
  const waiting = useJobQueueCount();
  useEffect(() => {
    const onOnline = () => {
      void flushJobQueue().finally(() => window.location.reload());
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);
  return (
    <>
      {waiting > 0 && <p className="notice">전송 대기 중인 시공 시작·완료 {waiting}건</p>}
      {/* 스크립트가 못 뜬 상태에서도 동작하도록 링크로 두고, 스크립트가 있으면 원래 주소를 다시 연다 */}
      <Link
        href="/"
        prefetch={false}
        className="btn btn-primary w-full"
        onClick={(event) => {
          event.preventDefault();
          window.location.reload();
        }}
      >
        다시 시도
      </Link>
    </>
  );
}
