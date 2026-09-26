"use client";

import { useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { registerMedia } from "@/lib/actions/media";
import { MEDIA_BUCKET, MEDIA_KIND, UPLOAD_KINDS, mediaPath } from "@/lib/media";

type Status = "wait" | "uploading" | "done" | "error";
type Item = { key: string; name: string; status: Status; message?: string };
type Prepared = { blob: Blob; mime: string; ext: string; width: number | null; height: number | null };

const STATUS_LABEL: Record<Status, string> = { wait: "대기", uploading: "올리는 중", done: "완료", error: "실패" };
const STATUS_CLASS: Record<Status, string> = { wait: "text-muted", uploading: "text-accent", done: "text-success", error: "text-danger" };
const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;

/** 이미지 디코딩: createImageBitmap(EXIF 회전 반영) → 옵션 없이 → <img> 순으로 시도한다. */
async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // 옵션을 모르는 브라우저
    }
    try {
      return await createImageBitmap(file);
    } catch {
      // 형식 미지원(HEIC 등) → <img> 로
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function sizeOf(src: ImageBitmap | HTMLImageElement) {
  return src instanceof HTMLImageElement ? { w: src.naturalWidth, h: src.naturalHeight } : { w: src.width, h: src.height };
}

/** 긴 변 1600px 로 줄여 JPEG(0.85) 로 다시 인코딩한다. 디코딩이 안 되면 원본 파일 그대로. */
async function prepare(file: File): Promise<Prepared> {
  try {
    const src = await decode(file);
    const { w, h } = sizeOf(src);
    if (!w || !h) throw new Error("빈 이미지");
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * scale));
    const th = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.drawImage(src, 0, 0, tw, th);
    if ("close" in src) src.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("encode");
    return { blob, mime: "image/jpeg", ext: "jpg", width: tw, height: th };
  } catch {
    const ext = (file.name.split(".").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    return { blob: file, mime: file.type || "application/octet-stream", ext, width: null, height: null };
  }
}

/**
 * 기사 휴대폰용 사진 업로더. 파일마다: 줄이기 → Storage 직접 업로드 → registerMedia(서버 액션) 순서.
 * 전부 끝나면 router.refresh() 로 서버 컴포넌트를 다시 그린다.
 */
export function PhotoUploader({ tenantId, jobId, contractId, defaultKind = "after" }: { tenantId: string; jobId?: string | null; contractId?: string | null; defaultKind?: string }) {
  const router = useRouter();
  const [kind, setKind] = useState(UPLOAD_KINDS.includes(defaultKind) ? defaultKind : "after");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    const supabase = createClient();
    const queue: Item[] = files.map((f) => ({ key: crypto.randomUUID(), name: f.name || "사진", status: "wait" }));
    setItems((prev) => [...prev.filter((p) => p.status === "error"), ...queue]);
    setBusy(true);
    const patch = (key: string, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...p } : it)));
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const key = queue[i].key;
      patch(key, { status: "uploading", message: "이미지 줄이는 중" });
      let path: string | null = null;
      try {
        const prepared = await prepare(file);
        path = mediaPath(tenantId, prepared.ext);
        patch(key, { message: "올리는 중" });
        const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(path, prepared.blob, { contentType: prepared.mime, upsert: false });
        if (upErr) throw new Error(upErr.message);
        patch(key, { message: "등록하는 중" });
        const fd = new FormData();
        fd.set("path", path);
        fd.set("mime", prepared.mime);
        fd.set("bytes", String(prepared.blob.size));
        if (prepared.width) fd.set("width", String(prepared.width));
        if (prepared.height) fd.set("height", String(prepared.height));
        fd.set("kind", kind);
        if (jobId) fd.set("job_id", jobId);
        if (contractId) fd.set("contract_id", contractId);
        if (file.lastModified) fd.set("taken_at", new Date(file.lastModified).toISOString());
        const res = await registerMedia({}, fd);
        if (res.error) {
          // 행을 못 만들면 올린 원본도 치운다(최선 노력)
          await supabase.storage.from(MEDIA_BUCKET).remove([path]);
          throw new Error(res.error);
        }
        patch(key, { status: "done", message: undefined });
      } catch (e) {
        patch(key, { status: "error", message: e instanceof Error ? e.message : String(e) });
      }
    }
    setBusy(false);
    router.refresh();
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []).filter((f) => f.size > 0);
    e.currentTarget.value = "";
    void upload(files);
  }

  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;
  const shown = items.slice(-30);

  return (
    <section className="card">
      <div className="panel-head">
        <h2>사진 올리기 {busy && <span className="sub">{done}/{items.length}</span>}</h2>
      </div>
      <div className="p-3.5 grid gap-3">
        <div>
          <label className="label" htmlFor="photo-kind">사진 종류</label>
          <select id="photo-kind" value={kind} onChange={(e) => setKind(e.target.value)} className="field h-11 text-[15px]" disabled={busy}>
            {UPLOAD_KINDS.map((k) => (
              <option key={k} value={k}>
                {MEDIA_KIND[k]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className={`btn btn-primary h-[52px] text-[15px] cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
            카메라로 찍기
            <input type="file" accept="image/*" capture="environment" multiple className="sr-only" onChange={onPick} disabled={busy} />
          </label>
          <label className={`btn h-[52px] text-[15px] cursor-pointer ${busy ? "opacity-50 pointer-events-none" : ""}`}>
            앨범에서 고르기
            <input type="file" accept="image/*" multiple className="sr-only" onChange={onPick} disabled={busy} />
          </label>
        </div>
        <p className="text-xs text-muted">여러 장을 한 번에 고를 수 있습니다. 긴 변 {MAX_SIDE}px 로 줄여 JPEG 로 올리고, 줄이지 못하는 형식은 원본 그대로 올립니다.</p>
        {shown.length > 0 && (
          <ul className="grid gap-1 text-sm border-t border-border pt-2">
            {shown.map((it) => (
              <li key={it.key} className="flex items-center justify-between gap-3 py-1">
                <span className="truncate min-w-0">{it.name}</span>
                <span className={`shrink-0 text-xs ${STATUS_CLASS[it.status]}`}>
                  {STATUS_LABEL[it.status]}
                  {it.message ? ` · ${it.message}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
        {!busy && items.length > 0 && (
          <p className="text-xs text-muted">
            {done}장 완료{failed ? `, ${failed}장 실패 — 다시 골라서 올려 주세요.` : "."}
          </p>
        )}
      </div>
    </section>
  );
}
