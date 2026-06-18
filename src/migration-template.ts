/**
 * foxdb/src/migration-template.ts
 * Generates new migration files with Prisma-style boilerplate.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// --- Template -----------------------------------------------------------------

function migrationTemplate(name: string, date: string): string {
  return `import type { Migration } from "@xwxfox/foxdb";

export default {
  name: "${name}",
  date: "${date}",

  up(db) {
    // Your migration logic here
  },
} satisfies Migration;
`;
}

// --- Public API ---------------------------------------------------------------

/** @category Migration */
export function createMigration(name: string, migrationsDir: string): string {
  if (!existsSync(migrationsDir)) {
    mkdirSync(migrationsDir, { recursive: true });
  }

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const timestamp = `${y}${m}${d}_${hh}${mm}${ss}`;
  const fileName = `${timestamp}_${name}.ts`;
  const filePath = resolve(join(migrationsDir, fileName));

  const isoDate = now.toISOString();
  const content = migrationTemplate(name, isoDate);

  writeFileSync(filePath, content, "utf-8");
  return filePath;
}
