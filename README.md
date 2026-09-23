# 집대리 (Jipdaeri)

입주 시공 협력업체용 시공·계약·결제 관리 SaaS. 설계 문서는 `uffice/`, 앱 코드는 `src/`, 데이터베이스는 `supabase/`.

## 개발

```bash
npm install
cp .env.example .env.local   # Supabase 값 채우기
npm run dev                  # http://localhost:3000
npm run lint && npx tsc --noEmit && npm run build
```

## 데이터베이스

- `supabase/migrations/*.sql` — 순서대로 적용하는 스키마. Supabase 프로젝트에는 MCP/CLI 로 적용한다.
- `supabase/tests/local_stub.sql` — Supabase 없이 로컬 Postgres 에서 검증할 때만 쓰는 스텁(auth 스키마·역할). 실제 프로젝트에 적용 금지.
- `supabase/tests/rls_foundation.sql` — 사업체 간 격리·권한 상승 차단·초대 흐름 테스트.

로컬 검증 예시(Postgres 16, 데이터베이스 새로 만들어서):

```bash
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/local_stub.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/migrations/20260923000100_foundation.sql
psql "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/rls_foundation.sql
```

## 구조

- `src/app/(auth)` 로그인·계정 만들기, `src/app/onboarding` 첫 사업체 만들기, `src/app/invite/[token]` 초대 수락
- `src/app/(app)` 로그인 후 화면. `layout.tsx` 가 사이드바(데스크톱)·하단 탭(모바일) 셸
- `src/lib/auth/session.ts` 로그인 사용자·현재 사업체·권한 (`session.can("contract.write")`)
- `src/lib/nav.ts` 메뉴와 필요한 권한
- `src/proxy.ts` 세션 갱신과 로그인 리다이렉트
- `src/app/globals.css` 디자인 토큰(A안 "작업대") 과 공통 컴포넌트 클래스

## 권한 모델

역할(role) × 범위(scope: own / branch / tenant / group). 기본 역할 7개(대표·지점장·사무상담·시공기사·영업자·협력업체·조회)는 모든 사업체가 공용으로 쓰고, 권한은 화면 메뉴와 데이터베이스 RLS 양쪽에서 강제된다. 자세한 것은 `supabase/migrations/20260923000100_foundation.sql` 의 주석과 `/settings/roles` 화면.
