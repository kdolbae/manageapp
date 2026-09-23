import Link from "next/link";

/** 아직 만들어지지 않은 화면의 자리. 예정일과 무엇이 들어올지 적는다. */
export function Soon({ title, day, items }: { title: string; day: number; items: string[] }) {
  return (
    <div>
      <div className="panel-head">
        <h1>
          {title} <span className="sub">D{day} 예정</span>
        </h1>
      </div>
      <div className="p-4 max-w-[640px]">
        <div className="card p-4">
          <p className="text-sm mb-3">이 화면은 {day}일째에 들어옵니다. 들어올 내용:</p>
          <ul className="list-disc pl-5 text-sm text-muted grid gap-1">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
          <p className="text-xs text-muted mt-4">
            지금 쓸 수 있는 것: <Link href="/settings">설정</Link>에서 사업체·지점·구성원·권한.
          </p>
        </div>
      </div>
    </div>
  );
}
