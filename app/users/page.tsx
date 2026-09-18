import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/Badge";
import { userRoleLabel } from "@/lib/labels";
import { formatDate } from "@/lib/format";
import { createUser, deleteUser } from "./actions";

export const dynamic = "force-dynamic";

const roleTone: Record<string, string> = { ADMIN: "red", MEMBER: "blue", VIEWER: "gray" };

export default async function UsersPage() {
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div>
      <div className="page-head">
        <h1>사용자</h1>
      </div>

      <div className="card">
        <h2>사용자 추가 / 권한 변경</h2>
        <form action={createUser} className="inline-form">
          <input name="email" type="email" placeholder="이메일" required />
          <input name="name" placeholder="이름" />
          <select name="role" defaultValue="MEMBER">
            <option value="ADMIN">관리자</option>
            <option value="MEMBER">일반</option>
            <option value="VIEWER">조회</option>
          </select>
          <button className="btn sm primary" type="submit">
            저장
          </button>
        </form>
      </div>

      <div className="card">
        {users.length === 0 ? (
          <p className="muted">사용자가 없습니다.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>이름</th>
                <th>이메일</th>
                <th>권한</th>
                <th>등록일</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="muted">{u.email}</td>
                  <td>
                    <Badge tone={roleTone[u.role] ?? "gray"}>{userRoleLabel[u.role]}</Badge>
                  </td>
                  <td className="muted">{formatDate(u.createdAt)}</td>
                  <td className="right">
                    <form action={deleteUser.bind(null, u.id)}>
                      <button className="btn sm danger" type="submit">
                        삭제
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
