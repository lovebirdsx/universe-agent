/**
 * 合并 className 字符串，过滤 falsy 值。
 * 可与 Tailwind CSS 搭配使用。
 */
export function cn(...classes: (string | undefined | false | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
