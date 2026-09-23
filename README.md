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
  - `20260928000600_media_content` 시공 사진(Storage 버킷 media)·후기·콘텐츠·푸시 구독
  - `20260930000800_finance` 경비·기사 정산(`build_payout()`)·경비 분류 기본값
  - `20261001000900_inventory` 창고·품목·단가(별도 테이블)·입출고·금액(별도 테이블)·재고 뷰
  - `20261003001100_groupware` 공지·결재(다단계)·휴가·연차 잔여 뷰
  - `20261004001200_customer_page` 계약 비밀 링크(public_token)와 고객 페이지 함수 `customer_page()`·`customer_submit_review()`·`customer_inquiry()`
  - `20261005001300_campaign` 캠페인(UTM 정규화). 유입 링크는 `/sales/campaigns` 에서 만든다
  - `20261007001500_platform` 집대리 플랫폼 층: 운영사 지정(`claim_platform_operator()`), 협력업체 신청·승인(`approve_vendor()` → 사업체·대표 초대), 업체 소개·노출(`vendor_profile`, `vendor_card` 뷰), 고객 요청·견적·대화(`service_request`·`quote`·`request_message`, 업체용 뷰 `market_request` 는 이름 가림·연락처 비노출), 수수료·정산(`platform_fee`, `build_platform_settlement()`), 상단 노출 광고(`vendor_promotion`)
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
- 고객 페이지: `/c/<사업체 slug>` 브랜드 페이지(승인된 후기·마케팅 사용 사진·문의 폼), `/c/<slug>/<계약 토큰>` 고객용 계약 페이지(일정·기사·사진·잔액·후기). 서비스 키로만 DB 를 읽으므로 `SUPABASE_SECRET_KEY` 가 있어야 열린다.
- PWA: `public/manifest.webmanifest` + `public/sw.js`. 배포마다 `sw.js` 의 VERSION 을 올린다. 시공 시작/완료는 오프라인이면 큐에 쌓였다가 연결되면 전송된다.

## 집대리 마켓(플랫폼 층)

- 공개 페이지(로그인 없음, 서비스 키로만 DB 접근): `/apply` 협력업체 신청, `/vendors` 업체 디렉터리(분류·지역 검색, 상단 노출 광고 먼저), `/vendors/<slug>` 업체 소개, `/request` 고객 견적 요청, `/r/<token>` 고객 요청 페이지(견적 비교·선택·업체와 대화·전화번호 공개 토글).
- 업체 화면(`/market`, 권한 market.read/write/settle): 요청 목록·견적 제출·대화·업체 소개 편집·정산서·상단 노출 신청. 업체에는 고객 이름 일부와 단지까지만 보이고, 전화번호는 고객이 그 업체를 선택하고 공개를 켠 뒤에만 보인다.
- 운영자 화면(`/platform`, 운영사 사업체로 접속한 platform.manage 권한자): 신청 심사·승인(사업체 자동 생성 + 대표 초대 링크), 업체 노출 켜기, 업체별 수수료(건당 정액 / 계약금액 %, 월말·건별), 기간 정산서 만들기·발행·입금 확인, 광고 승인·금액, 서비스 분류.
- 운영사 지정: 운영사 사업체(예: '집대리')의 대표가 `/platform` 에서 한 번 지정한다. 나노마스터 등 기존 사업체는 `/market/profile` 에서 업체 소개를 만들고 운영자가 노출을 켜면 협력업체로 나온다.

## 구조

- `src/app/(auth)` 로그인·계정 만들기, `src/app/onboarding` 첫 사업체 만들기, `src/app/invite/[token]` 초대 수락
- `src/app/(app)` 로그인 후 화면. `layout.tsx` 가 사이드바(데스크톱)·하단 탭(모바일) 셸. 화면: `contracts`(계약) `assign`(배정 보드) `jobs`(일정·오늘 시공) `ledger`(수납) `people`(고객·시공자·협력업체) `products`(상품·단가) `inbox`(문의) `content`(사진·후기·콘텐츠) `finance`(경비·정산·손익) `inventory`(자재·창고) `groupware`(공지·조직·결재·휴가) `settings`. 고객용은 `src/app/c/[slug]`
- `src/lib/actions/*.ts` 서버 액션(zod 검증 → Supabase → revalidatePath). 화면은 서버 컴포넌트, 폼은 `components/action-form.tsx`
- `src/lib/notify/` Teams 카드 발송과 아웃박스 처리, `src/lib/supabase/admin.ts` 서비스 키 클라이언트(서버 전용)
- `src/lib/auth/session.ts` 로그인 사용자·현재 사업체·권한 (`session.can("contract.write")`)
- `src/lib/nav.ts` 메뉴와 필요한 권한
- `src/proxy.ts` 세션 갱신과 로그인 리다이렉트
- `src/app/globals.css` 디자인 토큰(A안 "작업대") 과 공통 컴포넌트 클래스

## 권한 모델

역할(role) × 범위(scope: own / branch / tenant / group). 기본 역할 7개(대표·지점장·사무상담·시공기사·영업자·협력업체·조회)는 모든 사업체가 공용으로 쓰고, 권한은 화면 메뉴와 데이터베이스 RLS 양쪽에서 강제된다. 자세한 것은 `supabase/migrations/20260923000100_foundation.sql` 의 주석과 `/settings/roles` 화면.
