/**
 * uffice(UPIS) 화면 구조 크롤러 — 읽기 전용.
 *
 * 로그인 후 같은 도메인의 링크만 GET으로 순회하며 각 화면의
 *   - 메뉴/링크, 테이블 헤더(컬럼), 폼 필드(라벨/name/type/옵션), 버튼 텍스트
 * 를 추출한다. 셀 데이터(행 값)는 저장하지 않는다. 로그인 외 어떤 폼도 제출하지 않고,
 * 버튼도 클릭하지 않으며, 로그아웃/삭제/저장/전송류 URL은 방문하지 않는다.
 *
 * 환경변수(.env): UFFICE_BASE_URL, UFFICE_USER, UFFICE_PASS
 * 사용: npx tsx scripts/crawl-uffice.ts [--max 150] [--delay 700]
 * 산출: docs/uffice-structure.generated.{json,md}, data/uffice-shots/*.png (gitignore)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium, type Page, type Frame } from "playwright";

// ---------- .env 로드 (dotenv 없이) ----------
function loadEnv() {
  const p = path.resolve(".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
loadEnv();

const BASE = (process.env.UFFICE_BASE_URL ?? "").replace(/\/$/, "");
const USER = process.env.UFFICE_USER ?? "";
const PASS = process.env.UFFICE_PASS ?? "";

function opt(flag: string, def: number): number {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : def;
}
const MAX_PAGES = opt("--max", 150);
const DELAY_MS = opt("--delay", 700);

// 방문 금지 URL (쓰기/위험 동작)
const DENY = /logout|logoff|signout|delete|del(?![a-z])|remove|destroy|save|insert|update|modify|send|submit|approve|reject|cancel|kill|reset|download|export|print|upload|file(down|Down)/i;
const SKIP_EXT = /\.(png|jpe?g|gif|svg|ico|css|js|pdf|zip|xlsx?|docx?|hwp|mp4|woff2?)(\?|$)/i;

// ---------- 추출 결과 타입 ----------
interface FieldInfo { label: string; name: string; type: string; options?: string[] }
interface FormInfo { action: string; method: string; fields: FieldInfo[] }
interface TableInfo { caption: string; headers: string[]; rowCount: number }
interface ScreenInfo {
  url: string; title: string; frame?: string;
  links: { text: string; href: string }[];
  tables: TableInfo[]; forms: FormInfo[]; buttons: string[];
}

// ---------- 브라우저 실행 파일 ----------
function chromiumPath(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? "/opt/pw-browsers";
  const candidates = [
    path.join(root, "chromium"),
    ...fs.existsSync(root)
      ? fs.readdirSync(root).filter((d) => /^chromium-\d+$/.test(d))
          .map((d) => path.join(root, d, "chrome-linux", "chrome"))
      : [],
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return c; } catch { /* skip */ }
  }
  return undefined;
}

// ---------- 페이지/프레임에서 구조 추출 (브라우저 내 실행) ----------
async function extract(ctx: Page | Frame): Promise<Omit<ScreenInfo, "url" | "title" | "frame">> {
  return ctx.evaluate(() => {
    const txt = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
    const links = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => ({ text: txt(a).slice(0, 60), href: (a as HTMLAnchorElement).href }))
      .filter((l) => l.href && !l.href.startsWith("javascript:"));
    // onclick 으로 이동하는 메뉴도 수집 (location.href='...' 패턴)
    for (const el of Array.from(document.querySelectorAll("[onclick]"))) {
      const m = (el.getAttribute("onclick") ?? "").match(/(?:href|location)\s*=\s*['"]([^'"]+)['"]/);
      if (m) links.push({ text: txt(el).slice(0, 60), href: new URL(m[1], location.href).href });
    }
    const tables = Array.from(document.querySelectorAll("table")).map((t) => {
      let headers = Array.from(t.querySelectorAll("thead th, thead td")).map(txt).filter(Boolean);
      if (!headers.length) headers = Array.from(t.querySelectorAll("tr:first-child th")).map(txt).filter(Boolean);
      if (!headers.length) headers = Array.from(t.querySelectorAll("th")).map(txt).filter(Boolean);
      const rowCount = t.querySelectorAll("tbody tr, tr").length;
      return { caption: txt(t.querySelector("caption")), headers, rowCount };
    }).filter((t) => t.headers.length >= 2);
    const labelFor = (el: Element): string => {
      const id = el.getAttribute("id");
      if (id) { const l = document.querySelector(`label[for="${CSS.escape(id)}"]`); if (l) return txt(l); }
      const wrap = el.closest("label"); if (wrap) return txt(wrap);
      const cell = el.closest("td"); const th = cell?.previousElementSibling;
      if (th && th.tagName === "TH") return txt(th);
      return el.getAttribute("placeholder") ?? el.getAttribute("title") ?? "";
    };
    const forms = Array.from(document.querySelectorAll("form")).map((f) => ({
      action: (f as HTMLFormElement).action ?? "",
      method: ((f as HTMLFormElement).method ?? "get").toUpperCase(),
      fields: Array.from(f.querySelectorAll("input, select, textarea"))
        .filter((el) => !/^(hidden|submit|button|image|reset)$/i.test((el as HTMLInputElement).type ?? ""))
        .map((el) => {
          const e = el as HTMLInputElement | HTMLSelectElement;
          const info: { label: string; name: string; type: string; options?: string[] } = {
            label: labelFor(el).slice(0, 60),
            name: e.name || e.id || "",
            type: el.tagName === "SELECT" ? "select" : el.tagName === "TEXTAREA" ? "textarea" : (e as HTMLInputElement).type,
          };
          if (el.tagName === "SELECT") info.options = Array.from((el as HTMLSelectElement).options).map((o) => txt(o)).slice(0, 30);
          return info;
        }),
    })).filter((f) => f.fields.length);
    const buttons = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], a.btn, [role=button]"))
      .map((b) => txt(b) || (b as HTMLInputElement).value || "").filter(Boolean).slice(0, 40);
    return { links, tables, forms, buttons };
  });
}

// ---------- 로그인 ----------
async function login(page: Page): Promise<boolean> {
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1000);
  // 로그인 폼이 iframe 안에 있을 수도 있음
  const scopes: (Page | Frame)[] = [page, ...page.frames()];
  for (const s of scopes) {
    const pw = s.locator("input[type=password]").first();
    if (!(await pw.count())) continue;
    const idInput = s.locator("input[type=text], input[type=email], input:not([type])").first();
    await idInput.fill(USER);
    await pw.fill(PASS);
    await Promise.all([
      page.waitForLoadState("domcontentloaded").catch(() => {}),
      pw.press("Enter"),
    ]);
    await page.waitForTimeout(2500);
    const stillLogin = await page.locator("input[type=password]").count();
    return stillLogin === 0;
  }
  console.log("[login] 비밀번호 입력란을 찾지 못함 — 이미 로그인 상태이거나 폼 구조가 다름");
  return true;
}

// ---------- 메인 ----------
async function main() {
  if (!BASE || !USER || !PASS) {
    console.error(".env 에 UFFICE_BASE_URL / UFFICE_USER / UFFICE_PASS 가 필요합니다.");
    process.exitCode = 1; return;
  }
  const shotDir = "data/uffice-shots"; fs.mkdirSync(shotDir, { recursive: true });
  const exe = chromiumPath();
  const browser = await chromium.launch({ headless: true, executablePath: exe });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "ko-KR" });
  const page = await context.newPage();
  page.on("dialog", (d) => d.dismiss().catch(() => {})); // confirm/alert 은 항상 취소

  console.log(`[login] ${BASE} (chromium: ${exe ?? "bundled"})`);
  const ok = await login(page);
  if (!ok) { console.error("[login] 실패 — 계정 또는 폼 구조 확인 필요"); await page.screenshot({ path: `${shotDir}/login-failed.png` }); await browser.close(); process.exitCode = 1; return; }
  console.log("[login] 성공:", page.url());

  const origin = new URL(BASE).origin;
  const queue: string[] = [page.url()];
  const seen = new Set<string>();
  const screens: ScreenInfo[] = [];
  const norm = (u: string) => { try { const x = new URL(u); x.hash = ""; return x.href; } catch { return ""; } };
  const allowed = (u: string) => u.startsWith(origin) && !DENY.test(u) && !SKIP_EXT.test(u);

  while (queue.length && screens.length < MAX_PAGES) {
    const url = norm(queue.shift()!);
    if (!url || seen.has(url) || !allowed(url)) continue;
    seen.add(url);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(DELAY_MS);
      if (await page.locator("input[type=password]").count()) { console.log("[warn] 세션 만료? 재로그인"); await login(page); continue; }

      const scopes: { s: Page | Frame; name?: string }[] = [{ s: page }, ...page.frames().filter((f) => f !== page.mainFrame()).map((f) => ({ s: f, name: f.name() || f.url() }))];
      for (const { s, name } of scopes) {
        let ex; try { ex = await extract(s); } catch { continue; }
        if (!ex.links.length && !ex.tables.length && !ex.forms.length) continue;
        screens.push({ url: name ? (s as Frame).url() : url, title: await page.title(), frame: name, ...ex });
        for (const l of ex.links) if (allowed(l.href) && !seen.has(norm(l.href))) queue.push(l.href);
      }
      const idx = String(screens.length).padStart(3, "0");
      await page.screenshot({ path: `${shotDir}/${idx}.png`, fullPage: false }).catch(() => {});
      console.log(`[${idx}] ${url}`);
    } catch (e) {
      console.log(`[skip] ${url}: ${(e as Error).message.split("\n")[0]}`);
    }
  }
  await browser.close();

  fs.mkdirSync("docs", { recursive: true });
  fs.writeFileSync("docs/uffice-structure.generated.json", JSON.stringify(screens, null, 2));
  fs.writeFileSync("docs/uffice-structure.generated.md", toMarkdown(screens));
  console.log(`\n화면 ${screens.length}개 수집 → docs/uffice-structure.generated.{json,md}, 스크린샷 ${shotDir}/`);
}

function toMarkdown(screens: ScreenInfo[]): string {
  const L: string[] = ["# uffice(UPIS) 화면 구조 (자동 수집, 구조만·데이터 없음)", "", `- 수집 화면: ${screens.length}개`, ""];
  for (const s of screens) {
    L.push(`## ${s.title || "(제목 없음)"}${s.frame ? ` · frame:${s.frame}` : ""}`, "", `- URL: \`${s.url}\``, "");
    if (s.tables.length) {
      L.push("### 테이블(목록) 컬럼");
      for (const t of s.tables) L.push(`- ${t.caption ? `**${t.caption}** ` : ""}[${t.headers.join(" | ")}] (행 ${t.rowCount})`);
      L.push("");
    }
    if (s.forms.length) {
      L.push("### 입력 폼 필드", "", "| 라벨 | name | type | 옵션 |", "| --- | --- | --- | --- |");
      for (const f of s.forms) for (const x of f.fields)
        L.push(`| ${x.label || "-"} | ${x.name || "-"} | ${x.type} | ${x.options?.length ? x.options.join(", ") : "-"} |`);
      L.push("");
    }
    if (s.buttons.length) L.push(`- 버튼: ${s.buttons.join(" · ")}`, "");
    const menu = s.links.filter((l) => l.text).slice(0, 60);
    if (menu.length) L.push(`- 링크/메뉴: ${menu.map((l) => l.text).join(" · ")}`, "");
  }
  return L.join("\n");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
