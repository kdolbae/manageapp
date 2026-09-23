"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/* ---------------------------------------------------------------------------
 * PWA 런타임: 서비스 워커 등록, 설치 프롬프트 보관, 오프라인 띠.
 * 루트 레이아웃에서 <Pwa /> 를 한 번만 그린다. 설치 버튼은 <InstallButton /> 을 어디서든 쓴다.
 * 상태는 모듈 수준 저장소 + useSyncExternalStore 로 읽는다 (effect 안에서 setState 를 쓰지 않는다).
 * ------------------------------------------------------------------------- */

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};
type NavigatorIos = Navigator & { standalone?: boolean };

// --- 설치 프롬프트 저장소 (Chrome·Edge·삼성 인터넷이 beforeinstallprompt 로 준다) ---
let installEvent: BeforeInstallPromptEvent | null = null;
const installListeners = new Set<() => void>();
function setInstallEvent(next: BeforeInstallPromptEvent | null) {
  installEvent = next;
  installListeners.forEach((listener) => listener());
}
function subscribeInstall(listener: () => void) {
  installListeners.add(listener);
  return () => {
    installListeners.delete(listener);
  };
}
const getInstallEvent = () => installEvent;
const getServerInstallEvent = () => null;

/** 보관해 둔 설치 프롬프트를 띄운다. 프롬프트가 없으면 false. (한 번 쓰면 브라우저가 다시 줄 때까지 비어 있다) */
export async function promptInstall(): Promise<boolean> {
  const event = installEvent;
  if (!event) return false;
  setInstallEvent(null);
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === "accepted";
  } catch {
    return false;
  }
}

// --- 실행 환경: 설치되어 standalone 으로 열렸는지, iOS 인지 ---
type Platform = "unknown" | "standalone" | "ios" | "browser";
const STANDALONE_QUERY = "(display-mode: standalone)";
function subscribePlatform(listener: () => void) {
  const mq = window.matchMedia(STANDALONE_QUERY);
  mq.addEventListener("change", listener);
  return () => mq.removeEventListener("change", listener);
}
function getPlatform(): Platform {
  const nav = navigator as NavigatorIos;
  if (window.matchMedia(STANDALONE_QUERY).matches || nav.standalone === true) return "standalone";
  const ua = navigator.userAgent;
  // iPadOS 는 데스크톱 Safari 처럼 보이므로 터치 지점으로 구분한다
  const iosDevice = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  // navigator.standalone 은 iOS 의 WebKit 브라우저(Safari 등)에서만 정의된다
  if (iosDevice && nav.standalone !== undefined) return "ios";
  return "browser";
}
const getServerPlatform = (): Platform => "unknown";

/** 설치되어 standalone 으로 열렸는지. 서버·하이드레이션 중에는 "unknown". */
export function usePlatform() {
  return useSyncExternalStore(subscribePlatform, getPlatform, getServerPlatform);
}

// --- 온라인 여부 ---
function subscribeOnline(listener: () => void) {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}
const getOnline = () => navigator.onLine;
const getServerOnline = () => true;

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
}

/** 루트 레이아웃에서 한 번: 서비스 워커 등록 + 설치 프롬프트 보관 + 오프라인 띠. */
export function Pwa() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
      } else {
        // 개발 서버에서는 캐시 우선 전략이 HMR 을 방해하므로 남아 있는 워커를 지운다
        navigator.serviceWorker
          .getRegistrations()
          .then((registrations) => registrations.forEach((r) => r.unregister()))
          .catch(() => undefined);
      }
    }
    const onPrompt = (event: Event) => {
      event.preventDefault(); // 브라우저의 기본 안내 대신 우리 버튼으로 띄운다
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstallEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return <OfflineBanner />;
}

/** 연결이 끊기면 나타나는 얇은 띠. */
export function OfflineBanner() {
  const online = useOnline();
  const pathname = usePathname();
  if (online || pathname === "/offline") return null;
  return (
    <div role="status" className="notice rounded-none border-x-0 border-t-0 py-1.5 text-center text-warn font-medium">
      오프라인입니다. 시공 시작·완료는 연결되면 자동으로 전송됩니다.
    </div>
  );
}

/** 설치 버튼. 프롬프트가 있으면 버튼, iOS 면 안내 문구, 이미 설치되어 열렸으면 아무것도 그리지 않는다. */
export function InstallButton({ className = "btn btn-primary" }: { className?: string }) {
  const prompt = useSyncExternalStore(subscribeInstall, getInstallEvent, getServerInstallEvent);
  const platform = usePlatform();
  if (platform === "unknown" || platform === "standalone") return null;
  if (prompt) {
    return (
      <button type="button" className={className} onClick={() => void promptInstall()}>
        홈 화면에 추가
      </button>
    );
  }
  if (platform === "ios") return <p className="text-sm">Safari 공유 버튼 → 홈 화면에 추가</p>;
  return <p className="text-sm text-muted">설치 안내가 뜨지 않으면 브라우저 메뉴의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 누르세요.</p>;
}

/** 설치되어 standalone 으로 열린 상태가 아닐 때만 자식을 그린다 (설치 안내 카드용). */
export function Installable({ children }: { children: ReactNode }) {
  const platform = usePlatform();
  if (platform === "unknown" || platform === "standalone") return null;
  return <>{children}</>;
}
