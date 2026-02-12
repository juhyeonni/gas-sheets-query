/**
 * Migrate command - run pending migrations
 *
 * Issue #12
 */

import { Command } from "commander";
import { resolve } from "path";
import { loadConfig } from "./init.js";
import { loadMigrations, createMockSchemaBuilder } from "./migration-utils.js";

// =============================================================================
// Types
// =============================================================================

export interface MigrateOptions {
  dir?: string;
  to?: number;
}

export interface MigrateResult {
  success: boolean;
  applied: { version: number; name: string }[];
  currentVersion: number;
  error?: string;
}

// =============================================================================
// Migrate Logic
// =============================================================================

/**
 * Run the migrate command
 */
export async function runMigrate(
  options: MigrateOptions,
): Promise<MigrateResult> {
  // Get migrations directory
  const config = loadConfig();
  const migrationsDir = resolve(
    process.cwd(),
    options.dir || config?.migrationsDir || "migrations",
  );

  // Load migrations
  const migrations = await loadMigrations(migrationsDir, "asc");

  if (migrations.length === 0) {
    return {
      success: true,
      applied: [],
      currentVersion: 0,
      error: "No migrations found.",
    };
  }

  // CLI can only preview migrations (no access to actual Google Sheets).
  // Actual migration execution happens in GAS runtime (see #26).
  const applied: { version: number; name: string }[] = [];
  let currentVersion = 0;

  for (const migration of migrations) {
    // Stop if we've reached the target version
    if (options.to !== undefined && migration.version > options.to) {
      break;
    }

    const { builder, operations } = createMockSchemaBuilder();
    await migration.up(builder);

    console.log(`   [${migration.version}] ${migration.name}`);
    for (const op of operations) {
      console.log(`       - ${op}`);
    }

    applied.push({ version: migration.version, name: migration.name });
    currentVersion = migration.version;
  }

  return {
    success: true,
    applied,
    currentVersion,
  };
}

// =============================================================================
// CLI Command
// =============================================================================

export const migrateCommand = new Command("migrate")
  .description(
    "Preview pending migrations (actual execution happens in GAS runtime)",
  )
  .option(
    "-d, --dir <path>",
    'Migrations directory (default: from config or "migrations")',
  )
  .option("-t, --to <version>", "Migrate to specific version", (val) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid version number: '${val}'. Expected a number.`);
    }
    return num;
  })
  .action(async (options: MigrateOptions) => {
    console.log("[PREVIEW] Scanning migrations...");
    console.log("");

    const result = await runMigrate(options);

    if (!result.success) {
      console.error(`Error: ${result.error}`);
      process.exit(1);
    }

    if (result.applied.length === 0) {
      console.log("No pending migrations.");
      return;
    }

    console.log("");
    console.log(`Current version: ${result.currentVersion}`);
    console.log(`Total: ${result.applied.length} migration(s)`);
    console.log("");
    console.log(
      "Note: CLI only previews migrations. Actual execution happens in GAS runtime.",
    );
  });
