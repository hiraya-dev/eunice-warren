let count = 0;

export function uid(prefix: string): string {
  return `${prefix}-${++count}`;
}
