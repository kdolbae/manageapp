"use client";

import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/actions/auth";
import { CONSENT_ITEMS } from "@/lib/signing";
import { SignaturePad } from "@/components/signature-pad";

type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

/**
 * 약관 → 동의 → 이름(·휴대폰 뒷자리) → 서명 → 제출. 현장 기기와 고객 링크가 같은 폼을 쓴다.
 * 필수 동의와 서명이 다 있어야 제출 버튼이 열린다 (서버·DB 에서도 같은 조건을 다시 확인).
 */
export function SignForm({
  action,
  hidden,
  terms,
  defaultName = "",
  askPhoneTail = false,
  submitLabel = "서명 완료",
  intro,
}: {
  action: Action;
  hidden: Record<string, string>;
  terms: string;
  defaultName?: string;
  askPhoneTail?: boolean;
  submitLabel?: string;
  intro?: React.ReactNode;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [signature, setSignature] = useState("");
  const [agreed, setAgreed] = useState<Record<string, boolean>>({});
  const ready = signature !== "" && CONSENT_ITEMS.every((c) => !c.required || agreed[c.key]);

  return (
    <form action={formAction} className="grid gap-4" aria-busy={pending}>
      {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {intro}

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">계약 약관</h3>
        <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed max-h-[220px] overflow-y-auto rounded-lg border border-border bg-bg p-3">{terms}</pre>
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">동의</h3>
        {CONSENT_ITEMS.map((c) => (
          <label key={c.key} className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              name={`consent_${c.key}`}
              className="mt-1 h-4 w-4"
              checked={Boolean(agreed[c.key])}
              onChange={(e) => setAgreed((a) => ({ ...a, [c.key]: e.target.checked }))}
            />
            <span>{c.label}{c.required && <span className="req"> *</span>}</span>
          </label>
        ))}
      </section>

      <section className={`grid gap-3 ${askPhoneTail ? "sm:grid-cols-2" : ""}`}>
        <div className="form-row">
          <label className="label" htmlFor="signer_name">서명자 이름<span className="req">*</span></label>
          <input id="signer_name" name="signer_name" defaultValue={defaultName} required maxLength={60} className="field" autoComplete="name" />
        </div>
        {askPhoneTail && (
          <div className="form-row">
            <label className="label" htmlFor="phone_tail">휴대폰 번호 뒷 4자리<span className="req">*</span></label>
            <input id="phone_tail" name="phone_tail" required inputMode="numeric" pattern="\d{4}" maxLength={4} className="field mono" placeholder="본인 확인용" />
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">서명</h3>
        <SignaturePad onChange={setSignature} />
      </section>

      {state.error && <p className="notice notice-danger">{state.error}</p>}
      {state.ok && <p className="notice notice-success">{state.ok}</p>}
      <button type="submit" className="btn btn-primary btn-lg" disabled={!ready || pending}>
        {pending ? "저장 중…" : submitLabel}
      </button>
      {!ready && <p className="text-xs text-muted -mt-2">필수 동의에 체크하고 서명하면 버튼이 열립니다.</p>}
    </form>
  );
}
