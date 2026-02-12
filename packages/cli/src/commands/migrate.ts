/**
 * Migrate command - run pending migrations
 *
 * Issue #12
 */

import { Command } from "commander";
import { existsSync, readdirSync } from "fs";
import { resolve, join } from "path";
import { pathToFileURL } from "url";
import { loadConfig } from "./init.js";
import { toError } from "../utils/errors.js";

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
// Utilities
// =============================================================================

/**
 * Schema builder interface (local definition to avoid import issues)
 */
interface SchemaBuilder {
  addColumn<T = unknown>(
    table: string,
    column: string,
    options?: { default?: T; type?: string },
  ): void;
  removeColumn(table: string, column: string): void;
  renameColumn(table: string, oldName: string, newName: string): void;
}

/**
 * Migration definition (local)
 */
interface MigrationDef {
  version: number;
  name: string;
  up: (db: SchemaBuilder) => void | Promise<void>;
  down: (db: SchemaBuilder) => void | Promise<void>;
}

/**
 * Load migration files from directory
 */
async function loadMigrations(migrationsDir: string): Promise<MigrationDef[]> {
  if (!existsSync(migrationsDir)) {
    return [];
  }

  const files = readdirSync(migrationsDir)
    .filter((f) => f.match(/^\d+_.*\.ts$/))
    .sort();

  const migrations = [];

  for (const file of files) {
    const filePath = join(migrationsDir, file);
    const fileUrl = pathToFileURL(resolve(filePath)).href;

    try {
      // Dynamic import (ESM)
      const module = await import(fileUrl);
      const migration = module.migration || module.default;

      if (
        migration &&
        typeof migration.up === "function" &&
        typeof migration.down === "function"
      ) {
        // Validate version and name types
        if (typeof migration.version !== "number") {
          throw new Error(
            `Invalid migration: version must be a number, got ${typeof migration.version}`,
          );
        }
        if (typeof migration.name !== "string") {
          throw new Error(
            `Invalid migration: name must be a string, got ${typeof migration.name}`,
          );
        }

        migrations.push({
          version: migration.version,
          name: migration.name,
          up: migration.up,
          down: migration.down,
        });
      }
    } catch (err) {
      console.warn(
        `Warning: Could not load migration ${file}: ${toError(err).message}`,
      );
    }
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Mock schema builder for dry-run
 */
function createMockSchemaBuilder(): {
  builder: SchemaBuilder;
  operations: string[];
} {
  const operations: string[] = [];

  const builder: SchemaBuilder = {
    addColumn(
      table: string,
      column: string,
      options?: { default?: unknown; type?: string },
    ) {
      operations.push(
        `addColumn: ${table}.${column}${options?.default !== undefined ? ` (default: ${options.default})` : ""}`,
      );
    },
    removeColumn(table: string, column: string) {
      operations.push(`removeColumn: ${table}.${column}`);
    },
    renameColumn(table: string, oldName: string, newName: string) {
      operations.push(`renameColumn: ${table}.${oldName} → ${newName}`);
    },
  };

  return { builder, operations };
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
  const migrations = await loadMigrations(migrationsDir);

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
