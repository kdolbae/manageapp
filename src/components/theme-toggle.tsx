"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-m"] });
  return () => observer.disconnect();
}
const getMode = () => (document.documentElement.getAttribute("data-m") === "dark" ? "dark" : "light");
const getServerMode = () => "light" as const;

export function ThemeToggle() {
  const mode = useSyncExternalStore(subscribe, getMode, getServerMode);
  function toggle() {
    const next = mode === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-m", next);
    try {
      localStorage.setItem("jip.theme", next);
    } catch {}
  }
  return (
    <button type="button" onClick={toggle} className="btn btn-sm" aria-label="화면 모드 전환" title="화면 모드 전환">
      {mode === "dark" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
      <span className="hidden sm:inline">{mode === "dark" ? "밝게" : "어둡게"}</span>
    </button>
  );
}
