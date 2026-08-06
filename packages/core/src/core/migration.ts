/**
 * Schema Migration System for gas-sheets-query
 * 
 * Provides version-controlled schema changes with up/down migrations.
 */
import type { Row, RowWithId, DataStore } from './types'
import { SheetsQueryError } from './errors'
import { withScriptLockAsync } from './script-lock'

// ============================================================================
// Migration Types
// ============================================================================

/**
 * Column options for addColumn
 */
export interface ColumnOptions<T = unknown> {
  /** Default value for existing rows */
  default?: T
  /** Column type hint (for documentation) */
  type?: 'string' | 'number' | 'boolean' | 'date'
}

/**
 * Schema operations available in migrations
 */
export interface SchemaBuilder {
  /**
   * Add a new column to a table
   * @param table - Table name
   * @param column - Column name
   * @param options - Column options (default value, etc.)
   */
  addColumn<T = unknown>(table: string, column: string, options?: ColumnOptions<T>): void
  
  /**
   * Remove a column from a table
   * @param table - Table name
   * @param column - Column name
   */
  removeColumn(table: string, column: string): void
  
  /**
   * Rename a column in a table
   * @param table - Table name
   * @param oldName - Current column name
   * @param newName - New column name
   */
  renameColumn(table: string, oldName: string, newName: string): void
}

/**
 * Migration definition
 */
export interface Migration {
  /** Unique version number (must be positive integer) */
  version: number
  /** Human-readable migration name */
  name: string
  /** Apply the migration */
  up: (db: SchemaBuilder) => void | Promise<void>
  /** Revert the migration */
  down: (db: SchemaBuilder) => void | Promise<void>
}

/**
 * Migration record stored in the migrations table
 */
export interface MigrationRecord extends Row {
  id: number
  version: number
  name: string
  appliedAt: string
}

/**
 * Schema operation types
 */
export type SchemaOperationType = 'addColumn' | 'removeColumn' | 'renameColumn'

/**
 * Recorded schema operation
 */
export interface SchemaOperation {
  type: SchemaOperationType
  table: string
  column?: string
  oldColumn?: string
  newColumn?: string
  options?: ColumnOptions
}

// ============================================================================
// Migration Errors
// ============================================================================

/**
 * Thrown when migration version is invalid
 */
export class MigrationVersionError extends SheetsQueryError {
  constructor(
    public readonly version: number,
    reason: string
  ) {
    super(`Invalid migration version ${version}: ${reason}`, 'MIGRATION_VERSION_ERROR')
    this.name = 'MigrationVersionError'
  }
}

/**
 * Thrown when migration execution fails
 */
export class MigrationExecutionError extends SheetsQueryError {
  constructor(
    public readonly version: number,
    public readonly migrationName: string,
    public readonly cause: Error
  ) {
    super(
      `Migration ${version} (${migrationName}) failed: ${cause.message}`,
      'MIGRATION_EXECUTION_ERROR'
    )
    this.name = 'MigrationExecutionError'
  }
}

/**
 * Thrown when no migrations to rollback
 */
export class NoMigrationsToRollbackError extends SheetsQueryError {
  constructor() {
    super('No migrations to rollback', 'NO_MIGRATIONS_TO_ROLLBACK')
    this.name = 'NoMigrationsToRollbackError'
  }
}

// ============================================================================
// Schema Builder Implementation
// ============================================================================

/**
 * Whether a column value counts as "not set" for schema operations.
 *
 * `undefined` is not storable in a Sheets cell — SheetsAdapter writes it as
 * `''` and reads it back as `''` — so guards that test only for `undefined`
 * hold in memory but silently no-op against a real sheet (#112). Treating
 * empty-string as empty is the only definition implementable identically
 * across MockAdapter, LocalAdapter and SheetsAdapter.
 */
function isEmptyCell(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

/**
 * SchemaBuilder that records operations
 */
class RecordingSchemaBuilder implements SchemaBuilder {
  public readonly operations: SchemaOperation[] = []
  
  addColumn<T = unknown>(table: string, column: string, options?: ColumnOptions<T>): void {
    this.operations.push({
      type: 'addColumn',
      table,
      column,
      options: options as ColumnOptions
    })
  }
  
  removeColumn(table: string, column: string): void {
    this.operations.push({
      type: 'removeColumn',
      table,
      column
    })
  }
  
  renameColumn(table: string, oldName: string, newName: string): void {
    this.operations.push({
      type: 'renameColumn',
      table,
      oldColumn: oldName,
      newColumn: newName
    })
  }
}

// ============================================================================
// Migration Runner
// ============================================================================

/**
 * Resolver to get DataStore for a table.
 * Defined once in join-query-builder; imported and re-exported here to keep
 * this module's public surface (and the MigrationStoreResolver alias in index.ts).
 */
import type { StoreResolver } from './join-query-builder'
export type { StoreResolver }

/**
 * Migration runner configuration
 */
export interface MigrationRunnerConfig {
  /** Data store for the migrations metadata table */
  migrationsStore: DataStore<MigrationRecord>
  /** Resolver to get stores for other tables */
  storeResolver: StoreResolver
  /** All available migrations */
  migrations: Migration[]
}

/**
 * Result of running migrations
 */
export interface MigrationResult {
  /** Migrations that were applied */
  applied: { version: number; name: string }[]
  /** Current version after running */
  currentVersion: number
}

/**
 * Result of rollback
 */
export interface RollbackResult {
  /** Migration that was rolled back */
  rolledBack: { version: number; name: string }
  /** Current version after rollback */
  currentVersion: number
}

/**
 * MigrationRunner - Executes and tracks schema migrations
 */
export class MigrationRunner {
  private readonly migrationsStore: DataStore<MigrationRecord>
  private readonly storeResolver: StoreResolver
  private readonly migrations: Map<number, Migration>
  
  constructor(config: MigrationRunnerConfig) {
    this.migrationsStore = config.migrationsStore
    this.storeResolver = config.storeResolver
    this.migrations = new Map()
    
    // Validate and index migrations
    for (const migration of config.migrations) {
      this.validateMigration(migration)
      
      if (this.migrations.has(migration.version)) {
        throw new MigrationVersionError(
          migration.version,
          `Duplicate version (conflicts with "${this.migrations.get(migration.version)!.name}")`
        )
      }
      
      this.migrations.set(migration.version, migration)
    }
  }
  
  /**
   * Validate a migration definition
   */
  private validateMigration(migration: Migration): void {
    if (!Number.isInteger(migration.version) || migration.version < 1) {
      throw new MigrationVersionError(migration.version, 'Version must be a positive integer')
    }
    
    if (!migration.name || typeof migration.name !== 'string') {
      throw new MigrationVersionError(migration.version, 'Migration must have a name')
    }
    
    if (typeof migration.up !== 'function') {
      throw new MigrationVersionError(migration.version, 'Migration must have an up function')
    }
    
    if (typeof migration.down !== 'function') {
      throw new MigrationVersionError(migration.version, 'Migration must have a down function')
    }
  }
  
  /**
   * Get the current schema version
   */
  getCurrentVersion(): number {
    const records = this.migrationsStore.findAll()
    if (records.length === 0) return 0
    
    return Math.max(...records.map(r => r.version))
  }
  
  /**
   * Get list of applied migrations
   */
  getAppliedMigrations(): MigrationRecord[] {
    return this.migrationsStore.findAll().sort((a, b) => a.version - b.version)
  }
  
  /**
   * Get pending migrations that haven't been applied yet
   */
  getPendingMigrations(): Migration[] {
    const applied = new Set(this.getAppliedMigrations().map(r => r.version))
    
    return Array.from(this.migrations.values())
      .filter(m => !applied.has(m.version))
      .sort((a, b) => a.version - b.version)
  }
  
  /**
   * Apply a schema operation to the data
   */
  private applyOperation(operation: SchemaOperation): void {
    const store = this.storeResolver<RowWithId>(operation.table)
    const rows = store.findAll()
    
    switch (operation.type) {
      case 'addColumn': {
        const defaultValue = operation.options?.default
        for (const row of rows) {
          // Treat an empty cell as "needs default" so a default is re-applied
          // after a prior removeColumn cleared the value (#99, #112).
          if (isEmptyCell((row as Record<string, unknown>)[operation.column!])) {
            store.update(row.id as string | number, {
              [operation.column!]: defaultValue
            })
          }
        }
        break
      }
      
      case 'removeColumn': {
        // Clears the column's value (in-memory: key left undefined; Sheets: cell
        // cleared). This is a value operation — it does not drop the column from
        // the sheet header. addColumn's empty-cell guard (#99) lets a later
        // re-add re-apply its default over the cleared value.
        for (const row of rows) {
          if (!isEmptyCell((row as Record<string, unknown>)[operation.column!])) {
            store.update(row.id as string | number, {
              [operation.column!]: undefined
            })
          }
        }
        break
      }

      case 'renameColumn': {
        for (const row of rows) {
          const r = row as Record<string, unknown>
          // Rename when the source has a value and the target is empty
          // (missing, or cleared by a prior op) — an emptiness test rather than
          // `in`, consistent with the addColumn guard (#99). Using `in` here
          // would wrongly skip the rename when the target key lingers from an
          // earlier removeColumn/rename.
          if (!isEmptyCell(r[operation.oldColumn!]) && isEmptyCell(r[operation.newColumn!])) {
            store.update(row.id as string | number, {
              [operation.oldColumn!]: undefined,
              [operation.newColumn!]: r[operation.oldColumn!]
            })
          }
        }
        break
      }
    }
  }
  
  /**
   * Run all pending migrations
   * @param options - Optional: specify target version
   *
   * Holds the script lock for the whole run so two concurrent GAS executions
   * cannot apply the same migration twice. The pending list is read *after*
   * the lock is acquired, because another execution may have applied
   * migrations while this one was waiting (#128).
   */
  async migrate(options?: { to?: number }): Promise<MigrationResult> {
    return withScriptLockAsync(() => this.runMigrations(options))
  }

  private async runMigrations(options?: { to?: number }): Promise<MigrationResult> {
    const pending = this.getPendingMigrations()
    const applied: { version: number; name: string }[] = []

    for (const migration of pending) {
      // Stop if we've reached the target version
      if (options?.to !== undefined && migration.version > options.to) {
        break
      }
      
      try {
        // Execute the up migration
        const builder = new RecordingSchemaBuilder()
        await migration.up(builder)
        
        // Apply all recorded operations
        for (const op of builder.operations) {
          this.applyOperation(op)
        }
        
        // Record the migration
        this.migrationsStore.insert({
          version: migration.version,
          name: migration.name,
          appliedAt: new Date().toISOString()
        })
        
        applied.push({ version: migration.version, name: migration.name })
      } catch (error) {
        throw new MigrationExecutionError(
          migration.version,
          migration.name,
          error instanceof Error ? error : new Error(String(error))
        )
      }
    }
    
    return {
      applied,
      currentVersion: this.getCurrentVersion()
    }
  }
  
  /**
   * Rollback the last applied migration
   *
   * Locked for the same reason as migrate(): the applied list is re-read after
   * the lock is acquired so a migration another execution already rolled back
   * is not rolled back twice (#128).
   */
  async rollback(): Promise<RollbackResult> {
    return withScriptLockAsync(() => this.runRollback())
  }

  private async runRollback(): Promise<RollbackResult> {
    const applied = this.getAppliedMigrations()

    if (applied.length === 0) {
      throw new NoMigrationsToRollbackError()
    }
    
    // Get the last applied migration
    const lastRecord = applied[applied.length - 1]
    const migration = this.migrations.get(lastRecord.version)
    
    if (!migration) {
      throw new MigrationVersionError(
        lastRecord.version,
        'Migration definition not found (was it removed?)'
      )
    }
    
    try {
      // Execute the down migration
      const builder = new RecordingSchemaBuilder()
      await migration.down(builder)
      
      // Apply all recorded operations
      for (const op of builder.operations) {
        this.applyOperation(op)
      }
      
      // Remove the migration record
      this.migrationsStore.delete(lastRecord.id)
      
      return {
        rolledBack: { version: migration.version, name: migration.name },
        currentVersion: this.getCurrentVersion()
      }
    } catch (error) {
      throw new MigrationExecutionError(
        migration.version,
        migration.name,
        error instanceof Error ? error : new Error(String(error))
      )
    }
  }
  
  /**
   * Rollback all migrations (reset to version 0)
   */
  async rollbackAll(): Promise<{ rolledBack: { version: number; name: string }[]; currentVersion: number }> {
    // One lock for the whole sequence (the per-rollback lock is re-entrant), so
    // the schema is never observed half-rolled-back by another execution.
    return withScriptLockAsync(async () => {
      const rolledBack: { version: number; name: string }[] = []

      while (this.getCurrentVersion() > 0) {
        const result = await this.rollback()
        rolledBack.push(result.rolledBack)
      }

      return {
        rolledBack,
        currentVersion: 0
      }
    })
  }
  
  /**
   * Get migration status
   */
  getStatus(): {
    currentVersion: number
    applied: MigrationRecord[]
    pending: Migration[]
  } {
    return {
      currentVersion: this.getCurrentVersion(),
      applied: this.getAppliedMigrations(),
      pending: this.getPendingMigrations()
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a MigrationRunner instance
 */
export function createMigrationRunner(config: MigrationRunnerConfig): MigrationRunner {
  return new MigrationRunner(config)
}
