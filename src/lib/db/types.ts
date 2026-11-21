export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T extends readonly D1PreparedStatement[]>(statements: T): Promise<unknown[]>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta?: Record<string, unknown> }>;
  raw<T extends unknown[] = unknown[]>(): Promise<T[]>;
  run(): Promise<{ success: boolean; meta?: Record<string, unknown> }>;
}
