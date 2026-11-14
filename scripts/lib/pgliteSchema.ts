import { createRequire } from "node:module";
import * as schema from "../../shared/schema";

// CREATE statements for every table/index/enum in shared/schema.ts, diffed from an empty
// snapshot — the same source of truth the cloud DB is pushed from.
// drizzle-kit's ESM build (api.mjs) does a dynamic require("fs") that throws under Node's ESM
// loader, so load its CommonJS build (api.js) instead.
export async function schemaStatements(): Promise<string[]> {
  const require = createRequire(import.meta.url);
  const { generateDrizzleJson, generateMigration } = require("drizzle-kit/api");
  const empty = generateDrizzleJson({});
  const target = generateDrizzleJson(schema as Record<string, unknown>);
  return generateMigration(empty, target);
}
