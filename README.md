# 집대리 (Jipdarie) — 계약·데이터 자산화 플랫폼

UPIS 계약관리 시스템을 대체하는 **통합 관리 프로그램**입니다. 계약 업무를 처리하는 동시에,
흩어진 계약 데이터를 **재사용 가능한 데이터 자산(Data Asset)**으로 표준화·통합·관리합니다.

## 기능

| 영역 | 내용 |
| --- | --- |
| **대시보드** | 전체/활성 계약, 30일 내 만료, 연체 정산 지표 · 만료 임박 목록 · 미수 정산 · 최근 활동 |
| **계약 관리** | 목록(검색·상태 필터), 상세, 생성/수정, **생애주기 상태 전환**, 품목·문서·정산·활동 이력, **변경계약(개정)** |
| **거래처 관리** | 목록(검색), 상세, 생성/수정, 담당자 관리, 식별번호 마스킹 |
| **정산 관리** | 청구/수납/지급, 마감·연체 관리, 완료 처리, 연체 일괄 반영, 미수 합계 |
| **데이터 자산 카탈로그** | 자산 목록, 데이터 사전(필드·PII), 계보(Lineage), 품질 검증(차원별 통과율) |
| **사용자/권한** | 사용자 등록, 권한(관리자/일반/조회) 관리 |

## 아키텍처 — 3계층(메달리온) 데이터 파이프라인

```
UPIS (레거시 DB)
      │  ① 추출 (dump / 직접접속 / CSV)
      ▼
[ Bronze ] 스테이징(stg)        ← UPIS 원본을 손실 없이 그대로 적재
      │  ② 정제·표준화
      ▼
[ Silver ] 정규화 코어(core)     ← 계약/거래처/품목/정산 등 표준 엔터티 (서비스가 사용)
      │  ③ 자산화
      ▼
[ Gold ]   데이터 자산 카탈로그(asset)  ← 데이터셋 메타·계보·품질·소유자
```

기술 스택: **Next.js(App Router) + TypeScript + Prisma + PostgreSQL**

## 로컬 실행

```bash
# 1) 의존성
npm install

# 2) 로컬 Postgres (Docker)
docker compose up -d
cp .env.example .env          # 기본값이 로컬 DB에 맞춰져 있음

# 3) 스키마 생성 + 데모 데이터
npx prisma migrate dev --name init
npm run db:seed

# 4) 개발 서버
npm run dev                   # http://localhost:3000
```

> Docker가 없으면 `.env`의 `DATABASE_URL`을 원하는 Postgres로 지정하면 됩니다.

### 주요 스크립트

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run db:seed` | 데모 데이터 + 자산 카탈로그 시드 |
| `npm run ingest` | UPIS → Bronze 적재 (스키마 확보 후 어댑터 구현) |

## 저장소 구성

```
app/                 화면 (대시보드/계약/거래처/정산/자산/사용자) + 서버 액션
components/           공용 UI (Badge 등)
lib/                  prisma 클라이언트 · 포맷/라벨 유틸
prisma/schema.prisma  3계층 데이터 모델 (stg/core/asset)
prisma/seed.ts        데모 데이터 + 자산 카탈로그 시드
scripts/ingest-upis.ts  UPIS → Bronze 적재 스켈레톤
docs/                 기획서 · 데이터 모델 · 이관 전략
docker-compose.yml    로컬 Postgres
```

## 다음 단계 (UPIS 이관)

문서 [`docs/03-이관전략.md`](docs/03-이관전략.md) 참고. 실제 이관은 **UPIS 스키마 확보** 후 진행합니다.

- [ ] UPIS 접근 경로 확정(덤프/직접접속/CSV) 및 스키마 공유
- [ ] `scripts/ingest-upis.ts`의 `readSource()` 어댑터 구현 → Bronze 적재
- [ ] Bronze → Silver 표준화(transform) 매핑 확정
- [ ] 대사(reconciliation) 리포트로 이관 검증
