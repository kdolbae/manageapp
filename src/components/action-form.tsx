"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { ActionState } from "@/lib/actions/auth";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/** 서버 액션 결과(오류/완료 메시지)를 폼 아래에 보여주는 폼. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className} aria-busy={pending}>
      {children}
      {state.error && <p className="notice notice-danger mt-3">{state.error}</p>}
      {state.ok && <p className="notice notice-success mt-3">{state.ok}</p>}
    </form>
  );
}

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText = "처리 중…",
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
