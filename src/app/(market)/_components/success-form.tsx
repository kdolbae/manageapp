"use client";

import { useActionState } from "react";
import type { ActionState } from "@/lib/actions/auth";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** 완료되면 폼 대신 success 노드를 보여주는 폼 (신청 접수 화면처럼 이동 없이 끝나는 경우) */
export function SuccessForm({ action, children, success, className }: { action: Action; children: React.ReactNode; success: React.ReactNode; className?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.ok) return <>{success}</>;
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.error && <p className="notice notice-danger mt-3">{state.error}</p>}
    </form>
  );
}
