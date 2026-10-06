// Ambient declarations for the Node builtins used only by test code (src/test-d1.ts).
//
// This project's tsconfig pins `types: ["@cloudflare/workers-types"]` and installs no `@types/node`,
// so `node:sqlite` / `node:fs` have no declarations. This file is a global script (no imports/exports),
// so `declare module` *declares* the modules for the whole program rather than augmenting them.
declare module "node:sqlite" {
  interface StatementSync {
    get(...params: unknown[]): Record<string, unknown> | undefined;
    all(...params: unknown[]): Record<string, unknown>[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}

declare module "node:fs" {
  export function readFileSync(path: string | URL, encoding: string): string;
}
