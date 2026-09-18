export default function Home() {
  return (
    <main className="container">
      <h1>집대리 — 계약·데이터 자산화 플랫폼</h1>
      <p className="muted">
        UPIS 계약관리 시스템을 대체하고, 흩어진 계약 데이터를 재사용 가능한
        데이터 자산으로 표준화·통합·관리합니다.
      </p>

      <div className="card">
        <h2>데이터 파이프라인 (3계층)</h2>
        <div className="pipeline">
          <div className="stage">
            <h3>Bronze</h3>
            <div className="muted">스테이징 · UPIS 원본 미러링</div>
          </div>
          <span className="arrow">→</span>
          <div className="stage">
            <h3>Silver</h3>
            <div className="muted">표준 계약 도메인 (정규화)</div>
          </div>
          <span className="arrow">→</span>
          <div className="stage">
            <h3>Gold</h3>
            <div className="muted">데이터 자산 카탈로그</div>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>문서</h2>
        <ul>
          <li>기획서 — <code>docs/01-기획서.md</code></li>
          <li>데이터 모델 — <code>docs/02-데이터모델.md</code></li>
          <li>이관 전략 — <code>docs/03-이관전략.md</code></li>
        </ul>
      </div>

      <p className="muted">
        다음 단계: UPIS 실제 스키마를 확보해 스테이징 매핑을 확정합니다.
      </p>
    </main>
  );
}
