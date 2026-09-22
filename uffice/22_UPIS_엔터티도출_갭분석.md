# 22. UPIS 엔터티 도출 + 신규 설계 갭 분석

> 근거: [21_UPIS_화면구조_전수스캔.md](21_UPIS_화면구조_전수스캔.md) (2026-09-20 실측, PC 전 화면 + 서브앱 4종) + [20_기능스캔_라이브.md](20_기능스캔_라이브.md)
> 대조 대상: [05_신규플랫폼_제안.md](05_신규플랫폼_제안.md) §2.3 도메인 모델 · [07_집대리_플랫폼_전달모델.md](07_집대리_플랫폼_전달모델.md) · [16_페이지구성_섹터계획.md](16_페이지구성_섹터계획.md)
>
> 목적: 화면에서 드러난 엔터티·필드를 빠짐없이 뽑고, 05번 도메인 모델과 대조해 **빠진 테이블·필드**를 확정한다.

---

## 1. 결론 먼저

05번 도메인 모델은 **계약·금액 원장·시공·경비·박람회의 뼈대를 정확히 잡았다.** 이번 실측으로 확인됐다.
다만 실제 운영 화면에는 05번에 **없는 엔터티가 12개** 더 있다. 대부분 "마스터/설정/정산" 계열이라 MVP 설계에서 빠지기 쉬운데,
그중 **일자별 시공 캐파 · 기사 시공비 정산 · 지점 간 이관** 셋은 빠지면 현행 업무가 돌아가지 않는다.

### 추가가 필요한 엔터티 12개

| # | 엔터티 | 근거 화면 | 없으면 생기는 문제 |
|---|---|---|---|
| 1 | **SigongDailyLimit** (일자별 시공 가능 건수) | `/sub/14/` 일정관리설정 | 예약 오버부킹. 현행은 등록 시 `ajax_chk_sigongDailyLimit`로 실시간 차단 중 |
| 2 | **TechnicianPayout** (기사 시공비 정산) | 시공 등록 폼 정산 14필드 + `/sub/30/` 지급명세서 | 기사 급여 정산 불가 |
| 3 | **AgencyTransfer** (지점 간 계약 이관) | `/sub/04/` 이관관리, `act=transAgency` | 지점 간 계약 이동 불가. 멀티테넌트 설계와 직결 |
| 4 | **MaterialOrder** (코팅제/시공용품 발주) | `/sub/41/` | 자재 발주·승인 누락 |
| 5 | **Quote** (견적서) | `/sub/12/` | 계약 전 단계 견적 누락 |
| 6 | **Consultation** (인바운드 상담 로그) | `/_project/board/1017/` | 05번엔 채팅(Thread)만 있고 상담 기록 엔터티가 없음 |
| 7 | **ScheduleMemo** (캘린더 일자 메모) | `/sub/36/`, `/sub/06/` | 휴무·일정마감 표기 불가 |
| 8 | **UserVacation** (직원/기사 휴가) | 사용자 등록 휴가 달력 | 배정 시 휴무 기사 걸러내기 불가 |
| 9 | **CompanyInfo + BankAccount** (회사정보·입금계좌 5) | `/sub/21/` 환경설정 | 계약서·세금계산서 발행 정보 없음 |
| 10 | **MessageTemplate** (SMS 상용구) | `/sub/10/` | 05번의 DocumentTemplate와 별개. 상담원이 직접 편집 |
| 11 | **Attachment** (첨부 공통) | 경비 영수증 15 · 입금 영수증 3 · 박람회 이미지 14 · 기사전달 2 | 파일이 컬럼에 박히면 확장 불가 |
| 12 | **ContractTag** (추가옵션 태그 11종) | `occ`/`option1` 다중선택 | 현행이 **`집대리` 태그로 이미 신규 플랫폼 이관 대상을 표시 중** |

---

## 2. 엔터티별 필드 후보 (화면 실측 기준)

동일 개념은 하나로 합쳤다. 필드명은 현행 파라미터명을 괄호로 남긴다.

### 2-1. 조직·계정

**Agency (지점)** — 코드 9개 (`nm00`…`nm99`)
`code` · `name` · (알림톡 템플릿 분기 대상)

**User (직원·기사·영업자 통합)** — `/_user_control/`, `/sub/08/`, `/sub/09/`
```
agency · name · loginId · password(현행 평문) · email · phone · address
buseoCode(부서 8종) · positionCode(직책 12종)
laborCost(인건비) · reportFormat(3.3%|일용직|계산서)
bank1/accountNo1/accountHolder1 · bank2/accountNo2/accountHolder2
residentNo1 · residentNo2 · businessRegNo        ← PII·민감정보
isSalesRep(salesYN) · permissions[](23종)
```
> 기사·영업자·내근직이 **같은 테이블**이다. 구분은 `isSalesRep` 플래그와 권한 조합뿐.
> 신규 설계에서는 `User` + `role` 또는 `TechnicianProfile`/`SalesRepProfile` 분리를 권한다.

**UserVacation** — `userId` · `date` (달력 클릭 마킹)

### 2-2. 마스터

**Customer (계약자)** — `/sub/07/` + **`/tablet/` 계약자등록**
```
agency · type(개인|기업) · name · tel1 · tel2 · email · zipCode · address1 · address2
-- 기업일 때만 (태블릿에만 있음) --
repName(대표자) · businessRegNo(사업자번호) · bizType(업태) · bizItem(종목)
taxInvoiceEmail(전자세금계산서메일)
```
> PC 계약자관리에는 기업 항목이 아예 없다. **법인 계약 데이터는 태블릿으로만 들어온다.**
> 사업자번호 중복체크(`ajax_chk_comnum`)와 전화번호 중복체크(`ajax_chk_phonenum`)가 걸려 있다.

**Apartment / Site (아파트·현장)** — `/sub/13/`
`agency` · `area1`(시도) · `area2`(시군구) · `name`(COURT) · `fairs[]`(박람회 다건 연결)

**Organizer (주관사)** — `/sub/37/`, 42개사
`agency` · `area1` · `area2` · `name` · `businessRegNo` · `contactName` · `contactPosition` · `tel` · `bandUrl`

**Product (상품)** — `/sub/34/`
`agency` · `name`(Site) · `gubun`(패키지|추가시공품목) · `item`(품목) · `type`(타입) ·
`itemDetail`(상세품목) · `freeService`(무료시공내역) · `enabled` · `unitPriceKitchen` · `unitPriceBathroom`

**CompanyInfo** — `/sub/21/`
`companyName` · `businessRegNo` · `ceoName` · `zipCode` · `address1` · `address2` · `tel` · `fax` ·
`bizType`(업태) · `bizItem`(종목) · `homepage` · `email`
**BankAccount** (5슬롯) — `bankName` · `accountNo` · `holder` · `memo` · `displayOrder`

**MessageTemplate (상용구)** — `/sub/10/` : `index` · `content`

**SigongDailyLimit** — `/sub/14/` : `agency` · `date` · `limitCount`

### 2-3. 계약 축 ⭐

**Contract (계약)** — `/sub/01/?act=write`
```
agency · customerId · customerName(등록 후 불변) · cusTel1 · cusTel2
managerId(계약담당) · siteId · dong · ho · type(평형)
contractDate · moveInDate
approvalStatus(승인대기|승인|미승인)
taxInvoiceIssued + taxInvoiceNo
cashReceiptIssued + cashReceiptPhone
memo · displayNo(목록 번호) · deletedAt(휴지통)
```

**Sigong / WorkOrder (시공, 계약당 N건)** — `/sub/02/?act=sigongwrite` ⭐ 도메인 핵심
```
contractId · agency
gubun1(사업구분=나노코팅) · gubun2(시공종류 4종) · type1(접수형태 11종)
tags[](추가옵션 11종)

-- 주방 --                        -- 욕실 --
scheduledDateKitchen              scheduledDateBathroom
timeSlotKitchen(무관|오전|오후)    timeSlotBathroom
technicianKitchen                 technicianBathroom

grade2(상판: 상품별시공비|주방UV|주방나노)
packageProductId(site_item) · itemDetail · freeService · unitPrice · unitPriceB
extraProductId(site_item2) · itemDetail2

amountContract(pre_amt) · amountWork(amt_etc) · discount(discount1) · voucher(discount2)

status(미정|예정|배정|시공완료|시공연기|취소|미정-옵션)
finishedDate · cancelReason · canceledDate

memoToTechnician(memo1) + file1,file2 · memoConsult(memo2) · memoEtc(memo3)
mobileMemoKitchen · mobileMemoBathroom   ← 기사앱에서 기사가 남기는 메모
```

**TechnicianPayout (시공비 정산, 주방/욕실 각 1건)**
```
sigongId · part(KITCHEN|BATHROOM) · technicianId
unitPrice · supplyAmount(con_supply) · preTaxSupply · ratio(기사 배분율)
subtotal(sumcost) · additionalPay(add_pay, 교통비 등) · payoutAmount
approved(payyn) · approvedAt · approvedBy
```
> 현행은 이 14개 필드가 시공 레코드 안에 컬럼으로 박혀 있다. **주방/욕실 2행으로 정규화**해야 한다.
> `/sub/30/` 기사별통계가 이 값을 모아 지급명세서를 만든다.

**LedgerEntry / Charging (입금·금액 이벤트)** — 계약 상세 ④
```
contractId · sigongId(SigongIdx — 시공 라인 단위 귀속)
chargingDate · gubun(계약금|중도금|잔금|환불금액|매출취소)
method(카드|계좌이체|현금) · amount
payerName · approvalNo · cardOrBankName · cardNo   ← 민감
receipts[](파일 3) · memo
```
> 05번 §D1의 LedgerEntry 설계가 현행과 정확히 일치한다. `type`에 `SALES_CANCEL`(매출취소)까지 포함한 것이 맞다.
> 다만 현행은 **입금이 `SigongIdx`(시공 라인)에 귀속**된다. 설계의 `workOrderId?` 옵션을 **필수에 가깝게** 다뤄야 한다.

**WorkTask (주방/욕실 작업 단위)** — `/m/sigong/?act=view` 에서 기사가 직접 입력
```
sigongId · part(KITCHEN|BATHROOM)
scheduledDate · timeSlot(무관|오전|오후)          ← PC 관리자가 지정
startTime(8:00~17:30, 30분 단위, 12:00 제외)      ← 기사가 앱에서 지정
technicianId · technicianMemo(나의 메모, 500자)   ← 기사가 앱에서 작성
```
> 예약 시간이 **관리자(오전/오후)와 기사(정확한 시각)** 두 단계로 정해진다.

**CompletionReport (시공완료·후기)** — `/sub/11/?act=sigongphotoview` + `/m/sigong/?act=write1|write2`
```
sigongId · completionStatus(시공완료|일부미시공|시공취소|시공연기)  ← 기사가 앱에서 선택
photoRegDate · photos[](완료이미지) · completionMemo
reviewRegDate · reviewImages[] · reviewUrl(후기 URL, 블로그·카페 링크)
allowanceAmount(charge, 수당지급)                                ← 관리자가 PC에서 입력
customerNotifiedAt(시공완료 알림톡 발송)                          ← 기사가 앱에서 발송
```

**AgencyTransfer (이관)** — `/sub/04/`
`contractId` · `fromAgency` · `toAgency` · `requestedBy` · `requestedAt` · `status`
> 목록에 `대구(이관)` 같은 표기가 실제로 보인다. 이관된 계약은 원 지점 표기를 유지한다.

**ContractTag** — 태그 11종. `집대리` 포함.

### 2-4. 박람회 축

**Fair (박람회)** — `/sub/42/` : `agency` · `name`

**FairSchedule (박람회 일정)** — `/sub/39/?act=write`
```
agency · title · fairId · gubun(6종) · round(1~3차)
startDate · endDate · organizerId · siteId · area1 · area2
households(세대수) · hits(조회수) · venue(행사장소)
memo · cafeUrl · cafePostDates · bandUrl · images[](7)
installSchedule · cargoInfo · gift(경품)
memoToSales(영업자전달정보) · salesImages[](7)
```
**FairStaff (영업자 배정, 슬롯 7)** — `fairScheduleId` · `salesRepId` · `onDuty` · `dutyDays`
**FairCost (박람회비 라인 N건)** — `fairScheduleId` · `type`(종류) · `amount` · `paidDate` · `withdrawAccount` · `taxInvoiceIssued`(예|아니오)

### 2-5. 경영·ERP 축

**Expense (경비지출)** — `/sub/38/?act=write`
```
agency · team(부서 6종) · spendDate
method(법인카드|계좌이체|개인카드|현금|개인지출) · corporateCard(8슬롯)
siteId(아파트) · managerId(담당자) · fairScheduleId(박람회) · salesRepId(영업자)
category(지출내역 22종) 
mileage · workDay · workDayCalc · supply(공급가) · vat(부가세) · ildang(일당) · totalAmount
memo · receipts[](파일 15 + 각 설명)
status(청구|검토완료|반려|지급완료|지급승인) · statusMemo · rejectReason
```

**MaterialProduct (발주 제품)** — `/m/sigong/gisa_profile.asp?act=write`
```
legacyId(2~24) · name · category(코팅제|시공용품) · spec(500ml|250ml|1L|100ml|set(36)|set(4)|ea)
priceUnit(병단위 가격) · pricePrepaid(선결제 가격) · enabled
```
> **가격이 2단이다.** 병단위와 선결제 가격이 다르고, 선결제가 싸다. PC 발주 목록에는 이 구조가 안 보인다.

**MaterialOrder (발주)** — `/sub/41/`(승인) + `/m/`(기사 신청)
`requesterId` · `productId` · `priceType`(병단위|선결제) · `unitPrice` · `quantity` · `amount` · `tel` · `requestedAt` · `approved`

**Quote (견적서)** — `/sub/12/`
`customerId` · `tel` · `siteId`/`dong`/`ho`/`type` · `grade2`(인조대리석|엔지니어드스톤) ·
`items[]`(대분류/중분류/수량/기타) · `gifts[]` · `memo` · `totalAmount` · `offeredAmount`
> **현행은 저장하지 않고 엑셀만 출력한다.** 신규에서는 저장 + 계약 전환 연결이 필요하다.

**Consultation (상담)** — `/_project/board/1017/`
`agency` · `customerType`(기존고객|일반) · `customerId` · `customerName` · `customerTel` ·
`contractId` · `category`(7종) · `internetInterest`(4종) · `memo` · `files[](3)` · `managerId` · `createdAt`

**ScheduleMemo** — `agency` · `yyyymm` · `dd` · `content`

---

## 3. 05번 도메인 모델 대조표

| 05번 모델 | 현행 확인 | 판정 | 비고 |
|---|---|---|---|
| Tenant | 지점(agency) 9개 | **이름만 다름** | 지점 = 테넌트 후보. 상품·아파트·주관사가 모두 지점 귀속 |
| Branch | — | 일치 | 지점과 동일 개념. Tenant/Branch 2단 유지 여부 재검토 필요 |
| User ↔ Role | `adminArea` 23종 플랫 | **불일치** | 현행은 Role이 없고 화면 단위 체크박스. Role 설계는 신규 도입 |
| Technician ↔ PayoutRule | 시공 레코드 내 정산 14필드 | **보강 필요** | → `TechnicianPayout` 신설 (주방/욕실 2행) |
| SalesRep | `salesYN` 플래그 | 일치 | 박람회 참여일수·인건비는 `FairStaff`로 분리 |
| Microsite ↔ PriceBook | 현행 없음 | 신규 기능 | 유지 |
| Customer | `/sub/07/` | 일치 | `type`(개인/법인) 추가 |
| Site ↔ TenantSiteAlias | `/sub/13/` | 일치 | 현행도 아파트가 지점 귀속 → 중복 생성 문제 실재 확인 |
| Product ↔ ProductVariant ↔ PriceRule | `/sub/34/` | **단순화 가능** | 현행은 상품 1행에 주방/욕실 단가 2컬럼. Variant 불필요할 수 있음 |
| TechnicianCost | 상품의 주방/욕실 시공비 | 일치 | |
| Contract ↔ displayNo | `seq` + 목록 번호 | 일치 | |
| ContractItem | 시공 라인의 `site_item`/`site_item2` | 일치 | 현행은 패키지 1 + 추가품목 1 슬롯. **N개로 확장 필요** |
| WorkOrder ↔ Task(kitchen/bathroom) | 시공 레코드의 주방/욕실 필드쌍 | **정확히 일치** | 설계가 맞다 |
| Assignment | `gisa_kitchen`/`gisa_bathroom` | 일치 | |
| CompletionReport | `/sub/11/` 상세 | 일치 | `allowanceAmount`(수당) 추가 |
| StatusHistory | 현행 없음 | 신규 | 유지. 현행은 상태 변경 이력이 없다 |
| LedgerEntry | 입금 테이블 | **정확히 일치** | `sigongId` 귀속을 명시할 것 |
| Expense ↔ ApprovalStep | `/sub/38/` | 일치 | 상태 5종 확인 (청구→검토완료→지급승인→지급완료 / 반려) |
| Fair ↔ FairRound ↔ FairSchedule | `/sub/39/`, `/sub/40/`, `/sub/42/` | 일치 | 차수=FairRound, 유형 6종 추가 |
| FairCost | 박람회비 라인 | 일치 | 계산서발급 여부 필드 추가 |
| Organizer | `/sub/37/` | 일치 | 사업자번호·담당자·직책·밴드 추가 |
| Thread ↔ Message | 현행 없음 | 신규 | 유지 |
| Notification ↔ Template ↔ DeliveryLog | 알림톡·SMS | 일치 | 지점별 템플릿 분기(호텔감성) 반영 필요 |
| AuditLog | 현행 없음 | 신규 | 유지 |
| DocumentTemplate | 계약서 PDF(`fnPdfdown`) | 일치 | 현행도 PDF 생성 존재 |

### 05번에 없어 추가해야 하는 것

```
SigongDailyLimit    UserVacation       ScheduleMemo
TechnicianPayout    AgencyTransfer     MaterialOrder
Quote               Consultation       CompanyInfo + BankAccount
MessageTemplate     Attachment(공통)    ContractTag
```

### 05번에 있으나 현행에 없는 것 (유지 판단)

| 항목 | 판단 | 근거 |
|---|---|---|
| Microsite · PriceBook | **유지** | 신규 플랫폼의 공개 소개 페이지. 현행에 없는 게 정상 |
| Thread · Message (채팅) | **유지** | 14·15번 문서의 인앱 채팅 전략 |
| StatusHistory · AuditLog | **유지, 우선순위 상향** | 현행에 상태 이력이 전혀 없어 분쟁 추적이 불가능하다. 이게 현행의 가장 큰 구조적 결함 |
| PayoutRule (규칙 기반) | **유지하되 단순화** | 현행은 시공 건별 수기 입력 + 배분율. 규칙 테이블은 나중 |
| ProductVariant | **보류** | 현행 상품 구조가 단순해 과설계 위험 |

---

## 4. 설계에 반드시 반영할 5가지 (실측 근거)

### ① 입금은 계약이 아니라 **시공 라인**에 붙는다
현행 입금 폼은 `ContractSeq` + `SigongIdx`를 함께 받는다. 계약 상세의 "시공별 계약금액" 표가
시공 라인마다 계약금액/매출취소/실계약금/입금/환불/남은금액을 따로 계산한다.
→ `LedgerEntry.workOrderId`를 선택이 아니라 **기본 축**으로 설계할 것.

### ② 주방·욕실은 끝까지 갈라진다
예정일·시간대·담당기사·시공비·승인·완료·기사메모가 전부 2벌이다.
목록 정렬 옵션에도 "주방시공예정일 / 욕실시공예정일"이 따로 있다.
→ 05번의 `Task(kitchen|bathroom)` 분리가 옳다. **한 컬럼에 합치려는 유혹을 버릴 것.**

### ③ 일자별 시공 캐파가 예약을 막는다
`/sub/14/`에서 지점별·날짜별 `limit` 건수를 설정하고, 시공 등록 시
`ajax_chk_sigongDailyLimit.asp`가 초과를 실시간 차단한다. 일정 엔진의 핵심 제약이다.

### ④ 지점 간 이관이 실제로 일어난다
계약 목록에 `대구(이관)` 표기가 존재한다. 멀티테넌트 RLS를 설계할 때
**테넌트 경계를 넘는 이동 경로**를 처음부터 정의해야 한다. 나중에 붙이면 RLS가 깨진다.

### ⑤ 현행이 이미 `집대리` 태그를 쓰고 있다
추가옵션 11종 중 `집대리`가 있다. 신규 플랫폼으로 넘길 계약을 현행에서 표시 중이라는 뜻이다.
→ 마이그레이션 시 이 태그가 **1차 이관 대상 필터**가 된다.

---

## 5. 보안·품질 이슈 (신규 설계 필수 반영)

| 이슈 | 현행 | 신규 요구 |
|---|---|---|
| 비밀번호 평문 | 사용자관리 목록에 **비밀번호 컬럼 노출**, 등록 폼도 평문 입력 | 해시 저장 + 관리자도 조회 불가 |
| 고객 인증 | `/c/` 고객페이지가 **이름 + 휴대폰번호**로 로그인 | 일회용 링크·OTP·본인확인 토큰 |
| 주민번호 | 사용자 등록에 주민번호 2개 평문 컬럼 | 별도 암호화 저장 + 접근 감사. 가능하면 미보관 |
| 카드번호 | 입금 테이블에 카드번호 컬럼, 결제내역 목록에 노출 | 마스킹 저장(말4자리) + PG 토큰 참조 |
| 권한 | 화면 단위 체크박스 23종, 읽기/쓰기 구분 없음, 지점 격리가 URL 파라미터 의존 | Role + RLS(`tenant_id`) |
| 삭제 이력 | 휴지통(soft delete)은 있으나 **상태 변경 이력 없음** | `StatusHistory` + `AuditLog` 필수 |
| PG 도메인 | 운영에 `agenttest.payjoa.co.kr`(test) 연결 | 운영 도메인 분리 |
| 코드 테이블 불일치 | 경비 지출내역이 검색 19종 / 등록 22종 | 단일 코드 테이블 |

---

## 6. 스키마 초안

`uffice/schema.draft.prisma` 에 **추가 대상 12개 엔터티 + 핵심 축**을 Prisma 문법으로 작성해 두었다.
이 파일은 **초안**이며, `claude/upis-contract-management-info-ewsq1o` 브랜치의 기존 `prisma/schema.prisma`와
**병합해서 쓸 것** — 기존 모델을 덮어쓰지 말 것.

병합 절차:
1. 브랜치의 `prisma/schema.prisma`를 연다
2. 초안에서 **기존에 없는 model만** 골라 추가한다
3. 기존 model에는 **필드만 추가**하고 삭제·변경하지 않는다
4. `npx prisma validate` → `npx prisma generate` → `npx tsc --noEmit` 통과 확인

---

## 6-1. 서브앱 스캔으로 추가된 사항 (2026-09-20 2차)

4개 서브앱(`/m` 기사 · `/m2` 영업 · `/tablet` 접수 · `/c` 고객)을 모두 로그인해 수집했다.
상세는 [21_UPIS_화면구조_전수스캔.md](21_UPIS_화면구조_전수스캔.md) 10~11장.

### 추가로 필요한 엔터티·필드

| 항목 | 내용 |
|---|---|
| **Customer 기업 필드** | 대표자 · 사업자번호 · 업태 · 종목 · 전자세금계산서메일 — 태블릿에만 존재 |
| **WorkTask.startTime** | 기사가 앱에서 30분 단위 정확한 시각을 지정 (8:00~17:30). 관리자의 오전/오후와 2단 구조 |
| **WorkTask.technicianMemo** | 기사의 "나의 메모" 500자, 주방/욕실 각각 |
| **CompletionReport.completionStatus** | 시공완료·일부미시공·시공취소·시공연기 — 기사가 앱에서 선택 |
| **CompletionReport.reviewUrl** | 후기 URL(블로그·카페 링크)을 기사가 수집 |
| **MaterialProduct** | 규격(spec) + **병단위/선결제 2단 가격** |
| **Attachment.approvalNo** | 영업자앱 경비 영수증은 장마다 승인번호를 받는다 |
| **BusinessLine** | 태블릿 `ctGubun`: **유피스 · 홈케어** — PC 어디에도 없는 사업 라인 코드 |
| **UserVacation** | 기사·영업자가 **본인이 직접** 앱에서 휴무를 찍는다 (관리자 대행 아님) |
| **Notification 발신 주체** | 시공완료 알림톡을 **기사가** 직접 보낸다. 발신자 기록 필요 |

### 현업 확인으로 정정된 사항 (2026-09-20, 담당자 확인)

세 가지는 결함이 아니라 **의도된 설계**였다. 신규 설계에서 그대로 유지한다.

| 관찰 | 정정 |
|---|---|
| 예약 시간이 관리자/기사 2단으로 갈림 | ✅ 의도. 계약 시점엔 확정 불가 → 관리자가 오전/오후로 러프하게, **현장을 아는 시공자가 정확한 시각 확정** |
| 기사가 고객 연락처·계약금액·입금정보를 봄 | ✅ 의도. **기사가 현장에서 잔금 수납을 직접 담당**한다. 조회 권한과 수납 권한을 한 역할로 묶을 것 |
| 발주 선결제가 더 저렴 | ✅ 단순 할인이 아니라 **예치금(선충전) 방식의 어드밴티지**. 기사별 **예치금 잔액 원장**이 필요하다 |

### 이번에 확인된 신규 요구사항

| # | 요구 | 배경 |
|---|---|---|
| 1 | **법인 계약서를 웹에서 쉽게 작성** | 현재 법인 계약은 태블릿에서만 접수되고 개발이 어려워진 상태. 신규 플랫폼에서 웹 기반 법인 계약 작성 흐름을 1급 기능으로 설계할 것 |
| 2 | **코팅제 관리 프로그램과 발주 연동** | 사내에서 별도 개발 중인 코팅제 관리 프로그램과 UPIS 발주를 연동. 재고·출고·기사 예치금을 한 축으로 |

#### 1. 법인 계약서 웹 작성 — 설계 메모
필요한 것은 이미 태블릿 계약자등록에 다 있다. 웹으로 옮기면서 더해야 할 것:
```
Customer.kind = 기업
  repName · businessRegNo · bizType · bizItem · taxInvoiceEmail · zipCode/address
Contract
  taxInvoiceIssued + taxInvoiceNo        ← 법인은 사실상 필수
  DocumentTemplate(법인 계약서 양식)      ← 개인 양식과 분리
  전자서명 / 날인 흐름                    ← 현행에 없음. 신규 추가 검토
```
법인은 **사업자번호 중복체크**와 **전자세금계산서 메일 분리**가 이미 현행 규칙이다.

#### 2. 코팅제 관리 프로그램 연동 — 설계 메모
```
MaterialProduct   품목 · 규격 · 병단위가 · 선결제가        ← UPIS 발주 화면에서 확보
MaterialOrder     기사 발주 신청 → 관리자 승인
TechnicianDeposit 기사별 예치금 원장  ← 신규. 충전(선결제) / 차감(출고) 이벤트
InventoryMovement 입고 · 출고 · 재고   ← 코팅제 관리 프로그램 쪽
```
연동 지점: 발주 승인 시점에 **출고 + 예치금 차감**이 동시에 일어나야 한다.
금액 원장과 같은 원칙(이벤트 적립, 잔액은 계산값)을 예치금에도 적용할 것.

### 권한 설계에 직결되는 관찰

- **기사 앱이 고객 연락처·계약금액·입금정보·본인 시공비·승인여부를 모두 본다.** 수납 담당이라 필요한 범위다. 역할로 묶어 정의한다.
- **영업자 앱의 비용청구 집계**가 총 지급액·인건비·경비(승인)·경비(미승인) 4종이다. 영업자 본인 정산 대시보드가 이미 존재한다.
- **고객 페이지는 조회 전용**이다. 후기 작성 기능이 없다. 후기는 기사가 URL로 수집한다.

### 코드값 불일치 — 실데이터 확인 필요 ⚠️

| # | 문제 | 영향 |
|---|---|---|
| 1 | 경비 지출내역 **코드 14**가 PC에선 `화물내역`, 영업자앱에선 `기타` | 영업자 기타 경비가 화물내역으로 집계됨 |
| 2 | 경비 승인상태 라벨이 PC(청구·검토완료)와 앱(청구됨·검토중)에서 다름 | 저장값 동일 여부 확인 필요 |
| 3 | 접수형태 PC 11종 / 태블릿 5종, 추가옵션 PC 11종 다중 / 태블릿 3종 단일 | 현장 계약 유형 제한 |
| 4 | 시공 추가품목 목록이 PC 8종 / 태블릿 9종으로 서로 다름 | 상품 마스터 분기 가능성 |

> 신규 설계는 **코드 테이블을 단일 소스로** 두고 화면별 노출 범위만 필터로 제어해야 한다.

---

## 7. 남은 확인 과제

| # | 확인할 것 | 방법 |
|---|---|---|
| 1 | `/c/` 고객 계약 상세 필드 | 계약이 있는 고객 계정으로 재확인 |
| 2 | 경비 코드 14번 실데이터 | `exp_detail=14` 건의 유입 경로별 분리 집계 |
| 3 | 기사·영업자 지급명세서 항목 | `/sub/30/popup.asp`, `/sub/32/popup2.asp` — PII 회피 후 필드만 |
| 4 | 공지사항·자료실·SMS현황 URL | 권한 목록에는 있으나 URL 미확인 |
| 5 | 상품 ↔ 시공품목의 실제 연결 구조 | `ajax_setSigongItem.asp` 요청/응답 형태 |
| 6 | 기사 배분율(`gisa_bath_ratio`) 산출 규칙 | 화면에서 계산식 미노출 — 담당자 확인 필요 |
| 7 | 지점(agency)을 테넌트로 볼지, 전사 1테넌트 + 부서로 볼지 | **사업 판단 필요** — RLS 설계가 여기서 갈린다 |
