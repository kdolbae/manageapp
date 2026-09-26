"use client";

import { useFormStatus } from "react-dom";

/** 한 폼에 버튼이 여럿일 때(임시 저장·상신, 승인·반려) 누른 버튼의 name/value 를 같이 보내는 제출 버튼. */
export function FormButton({
  name,
  value,
  className = "btn",
  pendingText = "처리 중…",
  children,
}: {
  name: string;
  value: string;
  className?: string;
  pendingText?: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
