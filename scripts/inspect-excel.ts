/**
 * 엑셀 → DB 구조 분석기 (데이터는 가져오지 않음).
 *
 * UPIS에서 내보낸 엑셀을 읽어 "어떤 테이블(시트)이 있고 어떤 컬럼(헤더)이 있는지"를
 * 분석하고, 테이블 구조만(CREATE TABLE DDL) 생성한다. 실제 행 데이터는 적재하지 않는다.
 *
 * 규칙: 워크시트 1개 = 테이블 1개, 첫 데이터 행(헤더) = 컬럼 목록.
 *
 * 사용:
 *   npx tsx scripts/inspect-excel.ts <파일.xlsx | 디렉터리> [옵션]
 *   옵션:
 *     --schema <name>     대상 스키마명 (기본: upis)
 *     --out-md <path>     구조 카탈로그 markdown 경로 (기본: docs/upis-schema.generated.md)
 *     --out-sql <path>    DDL 경로 (기본: prisma/sql/upis_tables.generated.sql)
 *     --sample <n>        컬럼 샘플값 개수 (기본: 3)
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ExcelJS from "exceljs";

type SqlType = "TEXT" | "BIGINT" | "NUMERIC" | "BOOLEAN" | "DATE" | "TIMESTAMP";

interface ColumnInfo {
  name: string;
  type: SqlType;
  nullable: boolean;
  samples: string[];
}
interface TableInfo {
  sheet: string;
  table: string;
  rowCount: number;
  columns: ColumnInfo[];
}

// ---------- 값 정규화 & 타입 추론 ----------

function cellToRaw(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const v = value as any;
    if (v instanceof Date) return v;
    if ("result" in v) return v.result ?? null; // 수식
    if ("text" in v) return v.text; // 하이퍼링크
    if ("richText" in v) return v.richText.map((r: any) => r.text).join("");
    if ("error" in v) return null;
    return String(v);
  }
  return value;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function detectType(values: unknown[]): SqlType {
  const nonBlank = values.filter((v) => !isBlank(v));
  if (nonBlank.length === 0) return "TEXT";

  let allBool = true,
    allInt = true,
    allNum = true,
    allDate = true,
    anyTime = false;

  for (const v of nonBlank) {
    if (v instanceof Date) {
      allBool = allInt = allNum = false;
      const d = v as Date;
      if (d.getHours() || d.getMinutes() || d.getSeconds()) anyTime = true;
      continue;
    }
    const s = String(v).trim();

    if (!/^(true|false|y|n|yes|no|예|아니오|0|1)$/i.test(s)) allBool = false;

    if (!/^-?\d+$/.test(s.replace(/,/g, ""))) allInt = false;
    if (!/^-?\d+(\.\d+)?$/.test(s.replace(/,/g, ""))) allNum = false;

    // 날짜/일시 문자열
    if (!/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}([ T]\d{1,2}:\d{2}(:\d{2})?)?$/.test(s)) {
      allDate = false;
    } else if (/\d{1,2}:\d{2}/.test(s)) {
      anyTime = true;
    }
  }

  if (allBool && nonBlank.every((v) => !(v instanceof Date))) return "BOOLEAN";
  if (allInt) return "BIGINT";
  if (allNum) return "NUMERIC";
  if (allDate) return anyTime ? "TIMESTAMP" : "DATE";
  return "TEXT";
}

// ---------- 식별자 처리 ----------

/** 원본 이름을 유지하되 Postgres에서 안전하게 쓰도록 큰따옴표로 감싼다. */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function sanitizeTableName(sheet: string): string {
  return sheet.trim().replace(/\s+/g, "_");
}

// ---------- 분석 ----------

async function inspectWorkbook(file: string, sampleN: number): Promise<TableInfo[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const tables: TableInfo[] = [];

  wb.eachSheet((ws) => {
    // 헤더 행 = 값이 하나라도 있는 첫 행
    let headerRowIdx = 0;
    ws.eachRow((row, idx) => {
      if (headerRowIdx) return;
      const hasValue = (row.values as ExcelJS.CellValue[]).some((c) => !isBlank(cellToRaw(c)));
      if (hasValue) headerRowIdx = idx;
    });
    if (!headerRowIdx) return; // 빈 시트

    const headerRow = ws.getRow(headerRowIdx);
    const headers: { col: number; name: string }[] = [];
    headerRow.eachCell((cell, colNumber) => {
      const raw = cellToRaw(cell.value);
      if (!isBlank(raw)) headers.push({ col: colNumber, name: String(raw).trim() });
    });
    if (headers.length === 0) return;

    // 데이터 수집 (구조 추론용, 저장하지 않음)
    const columnValues: Record<number, unknown[]> = {};
    headers.forEach((h) => (columnValues[h.col] = []));
    let rowCount = 0;
    ws.eachRow((row, idx) => {
      if (idx <= headerRowIdx) return;
      const values = row.values as ExcelJS.CellValue[];
      const nonBlank = headers.some((h) => !isBlank(cellToRaw(values[h.col])));
      if (!nonBlank) return;
      rowCount++;
      for (const h of headers) columnValues[h.col].push(cellToRaw(values[h.col]));
    });

    const columns: ColumnInfo[] = headers.map((h) => {
      const vals = columnValues[h.col];
      const samples = vals
        .filter((v) => !isBlank(v))
        .slice(0, sampleN)
        .map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)));
      return {
        name: h.name,
        type: detectType(vals),
        nullable: vals.some((v) => isBlank(v)) || vals.length < rowCount,
        samples,
      };
    });

    tables.push({ sheet: ws.name, table: sanitizeTableName(ws.name), rowCount, columns });
  });

  return tables;
}

// ---------- 출력 ----------

function toDDL(tables: TableInfo[], schema: string): string {
  const lines: string[] = [
    `-- 자동 생성 DDL (구조만, 데이터 미포함)`,
    `-- 원본: UPIS 엑셀 → 시트=테이블, 헤더=컬럼`,
    `CREATE SCHEMA IF NOT EXISTS ${quoteIdent(schema)};`,
    ``,
  ];
  for (const t of tables) {
    lines.push(`-- 시트 "${t.sheet}" · 데이터 행 ${t.rowCount}개(참고용, 미적재)`);
    lines.push(`CREATE TABLE ${quoteIdent(schema)}.${quoteIdent(t.table)} (`);
    const cols = t.columns.map(
      (c) => `  ${quoteIdent(c.name)} ${c.type}${c.nullable ? "" : " NOT NULL"}`
    );
    lines.push(cols.join(",\n"));
    lines.push(`);`, ``);
  }
  return lines.join("\n");
}

function toMarkdown(tables: TableInfo[], schema: string): string {
  const lines: string[] = [
    `# UPIS 엑셀 구조 분석 (자동 생성)`,
    ``,
    `- 스키마: \`${schema}\``,
    `- 테이블(시트) 수: ${tables.length}`,
    `- ⚠️ 구조만 분석했습니다. 데이터는 적재하지 않았습니다.`,
    ``,
  ];
  for (const t of tables) {
    lines.push(`## ${t.sheet}  →  \`${schema}.${t.table}\``);
    lines.push(``, `- 데이터 행: ${t.rowCount}개 · 컬럼: ${t.columns.length}개`, ``);
    lines.push(`| 컬럼 | 타입 | NULL | 샘플 |`);
    lines.push(`| --- | --- | --- | --- |`);
    for (const c of t.columns) {
      const samples = c.samples.length ? c.samples.join(", ").replace(/\|/g, "\\|") : "-";
      lines.push(`| ${c.name} | ${c.type} | ${c.nullable ? "Y" : "N"} | ${samples} |`);
    }
    lines.push(``);
  }
  return lines.join("\n");
}

// ---------- 진입점 ----------

function listExcelFiles(target: string): string[] {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    return fs
      .readdirSync(target)
      .filter((f) => /\.(xlsx|xlsm)$/i.test(f) && !f.startsWith("~$"))
      .map((f) => path.join(target, f));
  }
  return [target];
}

function getOpt(argv: string[], flag: string, def: string): string {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

async function main() {
  const argv = process.argv.slice(2);
  const target = argv.find((a) => !a.startsWith("--"));
  if (!target) {
    console.error("사용법: npx tsx scripts/inspect-excel.ts <파일.xlsx | 디렉터리> [옵션]");
    process.exitCode = 1;
    return;
  }
  const schema = getOpt(argv, "--schema", "upis");
  const outMd = getOpt(argv, "--out-md", "docs/upis-schema.generated.md");
  const outSql = getOpt(argv, "--out-sql", "prisma/sql/upis_tables.generated.sql");
  const sampleN = parseInt(getOpt(argv, "--sample", "3"), 10);

  const files = listExcelFiles(target);
  if (files.length === 0) {
    console.error("엑셀 파일을 찾지 못했습니다:", target);
    process.exitCode = 1;
    return;
  }

  const allTables: TableInfo[] = [];
  for (const f of files) {
    console.log(`[분석] ${f}`);
    const tables = await inspectWorkbook(f, sampleN);
    allTables.push(...tables);
  }

  // 콘솔 요약
  console.log(`\n발견한 테이블 ${allTables.length}개:`);
  for (const t of allTables) {
    console.log(`  - ${t.table}  (컬럼 ${t.columns.length}, 행 ${t.rowCount})`);
  }

  fs.mkdirSync(path.dirname(outMd), { recursive: true });
  fs.mkdirSync(path.dirname(outSql), { recursive: true });
  fs.writeFileSync(outMd, toMarkdown(allTables, schema));
  fs.writeFileSync(outSql, toDDL(allTables, schema));
  console.log(`\n생성됨:\n  - 구조 카탈로그: ${outMd}\n  - DDL: ${outSql}`);
  console.log(`\n적용(선택): psql "$DATABASE_URL" -f ${outSql}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
