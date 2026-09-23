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
  - `20260923000100_foundation` 사업체·지점·구성원·역할×범위 권한·감사 로그
  - `20260924000200_parties_products` 고객·현장·단지·시공자·협력업체·상품·옵션·패키지·가격 규칙·기사 단가
  - `20260925000300_contracts` 계약·품목·시공 건·배정 이력, 계약번호·상태 계산, `create_contract()`
  - `20260926000400_ledger` 수납·할인·환불 원장(무효 처리만, 삭제 없음), `contract_summary`·`job_summary` 뷰
  - `20260927000500_assignment` 일별 배정 한도·시공자 휴무
  - `20260929000700_inquiry_notify` 문의·상담 기록·알림 아웃박스·앱 내 알림·연동 설정, `ingest_web_inquiry()`
- `supabase/tests/local_stub.sql` — Supabase 없이 로컬 Postgres 에서 검증할 때만 쓰는 스텁(auth 스키마·역할). 실제 프로젝트에 적용 금지.
- `supabase/tests/rls_*.sql` — 사업체 간 격리·권한 상승 차단·범위(own/branch) 테스트. 마이그레이션 순서대로 적용한 뒤 실행한다.

로컬 검증 예시(Postgres 16, 데이터베이스 새로 만들어서):

```bash
for f in supabase/tests/local_stub.sql supabase/migrations/*.sql supabase/tests/rls_*.sql; do
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$f"
done
```

## 알림·연동

- 홈페이지 문의: `POST /api/public/inquiry` (헤더 `x-api-key`). 키는 `/settings/integrations` 에서 발급하며 해시만 저장한다.
- Teams: 워크플로 웹훅 주소를 `/settings/integrations` 에 저장하면 새 문의마다 카드가 간다. 발송은 문의 인입 직후와 시간마다(`/api/internal/deliver`, Vercel cron, `CRON_SECRET`).
- 앱 내 알림: 헤더의 종. Supabase Realtime 으로 새 알림이 바로 뜬다.

## 구조

- `src/app/(auth)` 로그인·계정 만들기, `src/app/onboarding` 첫 사업체 만들기, `src/app/invite/[token]` 초대 수락
- `src/app/(app)` 로그인 후 화면. `layout.tsx` 가 사이드바(데스크톱)·하단 탭(모바일) 셸. 화면: `contracts`(계약) `assign`(배정 보드) `jobs`(일정·오늘 시공) `ledger`(수납) `people`(고객·시공자·협력업체) `products`(상품·단가) `inbox`(문의) `settings`
- `src/lib/actions/*.ts` 서버 액션(zod 검증 → Supabase → revalidatePath). 화면은 서버 컴포넌트, 폼은 `components/action-form.tsx`
- `src/lib/notify/` Teams 카드 발송과 아웃박스 처리, `src/lib/supabase/admin.ts` 서비스 키 클라이언트(서버 전용)
- `src/lib/auth/session.ts` 로그인 사용자·현재 사업체·권한 (`session.can("contract.write")`)
- `src/lib/nav.ts` 메뉴와 필요한 권한
- `src/proxy.ts` 세션 갱신과 로그인 리다이렉트
- `src/app/globals.css` 디자인 토큰(A안 "작업대") 과 공통 컴포넌트 클래스

## 권한 모델

역할(role) × 범위(scope: own / branch / tenant / group). 기본 역할 7개(대표·지점장·사무상담·시공기사·영업자·협력업체·조회)는 모든 사업체가 공용으로 쓰고, 권한은 화면 메뉴와 데이터베이스 RLS 양쪽에서 강제된다. 자세한 것은 `supabase/migrations/20260923000100_foundation.sql` 의 주석과 `/settings/roles` 화면.
