# 집대리 (Jipdarie) — 계약·데이터 자산화 플랫폼

UPIS 계약관리 시스템을 대체하고, 흩어진 계약 데이터를 **재사용 가능한 데이터 자산(Data Asset)**으로
표준화·통합·관리하는 것을 목표로 하는 서비스입니다.

## 이 저장소가 담는 것

이번 단계 산출물은 세 층으로 구성됩니다.

| 순서 | 산출물 | 위치 |
| --- | --- | --- |
| 1 | 기획서 (개요·목표·범위·로드맵) | [`docs/01-기획서.md`](docs/01-기획서.md) |
| 2 | 데이터 모델 / 스키마 설계 | [`docs/02-데이터모델.md`](docs/02-데이터모델.md), [`prisma/schema.prisma`](prisma/schema.prisma) |
| 3 | UPIS → 신규 시스템 이관 전략 | [`docs/03-이관전략.md`](docs/03-이관전략.md) |
| 4 | 실행 가능한 프로젝트 스캐폴딩 | Next.js(App Router) + TypeScript + Prisma |

## 아키텍처 한눈에 보기

```
UPIS (레거시 DB)
      │  ① 추출 (dump / 직접접속 / CSV)
      ▼
[ Bronze ] 스테이징(stg_*)      ← UPIS 원본을 손실 없이 그대로 적재
      │  ② 정제·표준화
      ▼
[ Silver ] 정규화 코어           ← 계약/거래처/품목/정산 등 표준 엔터티
      │  ③ 자산화
      ▼
[ Gold ]   데이터 자산 카탈로그   ← 데이터셋 메타·계보(lineage)·품질·버전
```

## 로컬 개발

> DB 접속 정보 확보 전까지는 스키마/문서 검토 위주로 진행합니다.

```bash
npm install
cp .env.example .env      # DATABASE_URL 설정
npx prisma generate
npx prisma migrate dev    # DB 준비된 뒤
npm run dev
```

## 현재 상태 / 다음 할 일

- [x] 기획서 초안
- [x] 데이터 모델(3계층) 설계 및 Prisma 스키마
- [x] 이관 전략 문서
- [x] 프로젝트 스캐폴딩
- [ ] **UPIS 실제 스키마 확보** → 스테이징 테이블 매핑 확정
- [ ] 이관 스크립트 구현 및 검증(행수·합계 대사)
- [ ] 자산 카탈로그 UI

자세한 배경과 결정 사항은 [`docs/01-기획서.md`](docs/01-기획서.md)를 참고하세요.
