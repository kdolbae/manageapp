import type { CodeValue } from "@/lib/codes";
import { won } from "@/lib/format";
import { APP_SERVICES } from "@/lib/app-link";

export const KIND_LABEL: Record<string, string> = { single: "단품", package: "패키지", service: "서비스" };
const KIND_BADGE: Record<string, string> = { single: "badge-wait", package: "badge-run", service: "badge-wait" };

export function KindBadge({ kind }: { kind: string }) {
  return <span className={"badge " + (KIND_BADGE[kind] ?? "badge-wait")}>{KIND_LABEL[kind] ?? kind}</span>;
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return <span className={"badge " + (active ? "badge-done" : "badge-wait")}>{active ? "판매중" : "중지"}</span>;
}

/** 작업 단위 표식: 색(wa1/wa2) + 첫 글자 + 형태(네모/동그라미) 3중 단서. */
export function WorkAreaMark({ code, codes }: { code: string | null; codes: CodeValue[] }) {
  if (!code) return <span className="text-muted">—</span>;
  const cv = codes.find((c) => c.code === code);
  const label = cv?.label ?? code;
  const color = cv?.color === "wa1" || cv?.color === "wa2" ? ` mark-${cv.color}` : "";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={"mark" + color} aria-hidden="true">
        {label.charAt(0)}
      </span>
      {label}
    </span>
  );
}

/** 가감액 표시: +5,000 / -3,000 / 0 */
export function signed(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return "0";
  return n > 0 ? `+${won(n)}` : won(n);
}

export type CategoryOption = { id: string; name: string; deleted_at?: string | null };

export type ProductValues = {
  code: string;
  name: string;
  kind: string;
  category_id: string | null;
  work_area_code: string | null;
  unit: string;
  price: number | string;
  technician_rate: number | string;
  duration_min: number | null;
  description: string | null;
  app_service_id?: string | null;
  status?: string;
};

/** 상품 등록·수정 폼의 입력 칸. ActionForm(또는 읽기 전용 fieldset) 안에서 쓴다. */
export function ProductFields({
  product,
  categories,
  workAreas,
  withStatus = false,
  showRate = true,
}: {
  product?: ProductValues;
  categories: CategoryOption[];
  workAreas: CodeValue[];
  withStatus?: boolean;
  showRate?: boolean;
}) {
  return (
    <div className="grid gap-x-4 sm:grid-cols-2">
      <div className="form-row">
        <label className="label" htmlFor="p-code">
          상품 코드<span className="req">*</span>
        </label>
        <input
          id="p-code"
          name="code"
          required
          defaultValue={product?.code ?? ""}
          pattern="[A-Za-z0-9_.\-]{1,30}"
          placeholder="예: CLN-01"
          className="field mono"
        />
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-name">
          상품명<span className="req">*</span>
        </label>
        <input id="p-name" name="name" required maxLength={80} defaultValue={product?.name ?? ""} placeholder="예: 입주 청소 (기본)" className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-kind">
          종류
        </label>
        <select id="p-kind" name="kind" defaultValue={product?.kind ?? "single"} className="field">
          <option value="single">단품</option>
          <option value="package">패키지 (여러 상품 묶음)</option>
          <option value="service">서비스</option>
        </select>
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-category">
          카테고리
        </label>
        <select id="p-category" name="category_id" defaultValue={product?.category_id ?? ""} className="field">
          <option value="">없음</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
              {c.deleted_at ? " (보관)" : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-work-area">
          작업 단위
        </label>
        <select id="p-work-area" name="work_area_code" defaultValue={product?.work_area_code ?? ""} className="field">
          <option value="">없음</option>
          {workAreas.map((w) => (
            <option key={w.code} value={w.code}>
              {w.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-app-service">
          집대리 앱 공종
        </label>
        <select id="p-app-service" name="app_service_id" defaultValue={product?.app_service_id ?? ""} className="field">
          <option value="">연결 안 함</option>
          {APP_SERVICES.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-unit">
          단위
        </label>
        <input id="p-unit" name="unit" maxLength={10} defaultValue={product?.unit ?? "식"} placeholder="식 · 개 · 평" className="field" />
      </div>
      <div className="form-row">
        <label className="label" htmlFor="p-price">
          판매가 (부가세 포함, 원)
        </label>
        <input id="p-price" name="price" inputMode="numeric" defaultValue={product ? won(product.price) : ""} placeholder="0" className="field num" />
      </div>
      {showRate && (
        <div className="form-row">
          <label className="label" htmlFor="p-rate">
            기본 기사 시공비 (원)
          </label>
          <input
            id="p-rate"
            name="technician_rate"
            inputMode="numeric"
            defaultValue={product ? won(product.technician_rate) : ""}
            placeholder="0"
            className="field num"
          />
        </div>
      )}
      <div className="form-row">
        <label className="label" htmlFor="p-duration">
          시공 소요 (분)
        </label>
        <input id="p-duration" name="duration_min" type="number" min={0} step={1} defaultValue={product?.duration_min ?? ""} className="field num" />
      </div>
      {withStatus && (
        <div className="form-row">
          <label className="label" htmlFor="p-status">
            상태
          </label>
          <select id="p-status" name="status" defaultValue={product?.status ?? "active"} className="field">
            <option value="active">판매중</option>
            <option value="inactive">중지</option>
          </select>
        </div>
      )}
      <div className="form-row sm:col-span-2">
        <label className="label" htmlFor="p-description">
          설명
        </label>
        <textarea id="p-description" name="description" maxLength={2000} defaultValue={product?.description ?? ""} className="field" rows={3} />
      </div>
    </div>
  );
}
