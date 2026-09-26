"use client";

import { useEffect } from "react";
import { markNoticeRead } from "@/lib/actions/groupware";

/** 공지 상세가 열리면 한 번 읽음으로 표시한다. 화면에는 아무것도 그리지 않는다. */
export function MarkRead({ id }: { id: string }) {
  useEffect(() => {
    void markNoticeRead(id);
  }, [id]);
  return null;
}
