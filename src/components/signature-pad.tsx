"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 손가락·펜·마우스로 서명을 받는 캔버스. 그린 결과를 hidden input 에 PNG data URL 로 넣는다.
 * 폼 안에서 쓰고, 값이 비었는지는 onChange 로 부모가 안다 (제출 버튼 잠금용).
 */
export function SignaturePad({
  name = "signature_data",
  height = 200,
  placeholder = "여기에 서명해 주세요",
  onChange,
}: {
  name?: string;
  height?: number;
  placeholder?: string;
  onChange?: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [value, setValue] = useState("");

  const update = (v: string) => {
    setValue(v);
    onChange?.(v);
  };

  // 캔버스를 부모 폭에 맞추고 화면 배율만큼 키운다. 폭이 바뀌면(회전) 그림이 지워지므로 값도 비운다.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    let lastWidth = 0;
    const fit = () => {
      const w = c.clientWidth;
      if (!w || w === lastWidth) return false;
      lastWidth = w;
      const ratio = window.devicePixelRatio || 1;
      c.width = Math.round(w * ratio);
      c.height = Math.round(height * ratio);
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.scale(ratio, ratio);
        ctx.lineWidth = 2.6;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = "#111827";
        ctx.fillStyle = "#111827";
      }
      return true;
    };
    fit();
    const ro = new ResizeObserver(() => {
      if (fit()) {
        setValue("");
        onChange?.("");
      }
    });
    ro.observe(c);
    return () => ro.disconnect();
    // onChange 는 매 렌더 새 함수일 수 있어 의존성에서 뺀다 (회전 시에만 호출)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    drawing.current = true;
    last.current = p;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.3, 0, Math.PI * 2); // 점만 찍어도 남는다
    ctx.fill();
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };

  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    update(e.currentTarget.toDataURL("image/png"));
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
    update("");
  };

  return (
    <div className="grid gap-2">
      <div className="relative rounded-lg border-2 border-dashed border-border bg-white overflow-hidden" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="block w-full h-full touch-none cursor-crosshair"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          onPointerLeave={up}
          aria-label="서명 입력"
        />
        {!value && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-gray-400">{placeholder}</span>}
      </div>
      <input type="hidden" name={name} value={value} />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{value ? "서명이 입력되었습니다." : "손가락이나 펜으로 서명해 주세요."}</span>
        <button type="button" className="btn btn-sm" onClick={clear}>지우기</button>
      </div>
    </div>
  );
}
