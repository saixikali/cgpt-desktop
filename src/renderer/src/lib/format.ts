/** 展示用格式化工具（集中中文本地化）。 */

export function formatTime(unixSeconds: number | null | undefined): string {
  if (!unixSeconds || unixSeconds <= 0) return "";
  const d = new Date(unixSeconds * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n: number) => String(n).padStart(2, "0");
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (sameDay) return hm;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getMonth() + 1}月${d.getDate()}日`
    : `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

/** 把路径压缩成适合侧栏展示的短形式（目录名 + 上级盘符/目录）。 */
export function shortPath(p: string | null | undefined): string {
  if (!p) return "";
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return `${parts[0]}…${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}
