export function Badge({
  tone = "gray",
  children,
}: {
  tone?: string;
  children: React.ReactNode;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
