/**
 * Global shim: installs `SpreadsheetApp`/`LockService` on `globalThis` so
 * `SheetsAdapter` and consumer code run unmodified against fakes in Node.
 */
import { FakeSpreadsheet } from './fake-spreadsheet'

/** Options for {@link installGasFakes}. */
export interface InstallGasFakesOptions {
  /** Fake spreadsheets, keyed by the id `SpreadsheetApp.openById` should resolve. */
  spreadsheets: Record<string, FakeSpreadsheet>
  /** Id (into `spreadsheets`) that `SpreadsheetApp.getActiveSpreadsheet()` returns. */
  activeId?: string
}

/**
 * Handle returned by {@link installGasFakes}.
 *
 * Repeated install/restore cycles are independent: each handle's `restore()`
 * puts back exactly the globals that were present immediately before that
 * `installGasFakes()` call. Nested installs must be restored in reverse
 * order of installation (LIFO) to unwind cleanly.
 */
export interface GasFakesHandle {
  /** Restores the globals this handle overwrote, including true absence. */
  restore(): void
}

interface PropertyBackup {
  key: string
  existed: boolean
  descriptor: PropertyDescriptor | undefined
}

function backupAndSet(key: string, value: unknown): PropertyBackup {
  const target = globalThis as Record<string, unknown>
  const descriptor = Object.getOwnPropertyDescriptor(target, key)
  target[key] = value
  return { key, existed: descriptor !== undefined, descriptor }
}

function restoreProperty(backup: PropertyBackup): void {
  const target = globalThis as Record<string, unknown>
  if (backup.existed && backup.descriptor) {
    Object.defineProperty(target, backup.key, backup.descriptor)
  } else {
    delete target[backup.key]
  }
}

function createNoOpLock() {
  return {
    tryLock: () => true,
    waitLock: () => {},
    releaseLock: () => {},
    hasLock: () => true
  }
}

/**
 * Installs `SpreadsheetApp.{openById,getActiveSpreadsheet}` and an
 * always-available no-op `LockService.getScriptLock()` on `globalThis`.
 */
export function installGasFakes(options: InstallGasFakesOptions): GasFakesHandle {
  const { spreadsheets, activeId } = options

  const spreadsheetApp = {
    openById(id: string): FakeSpreadsheet {
      const spreadsheet = spreadsheets[id]
      if (!spreadsheet) {
        throw new Error(`SpreadsheetApp.openById: no fake spreadsheet registered for id "${id}"`)
      }
      return spreadsheet
    },
    getActiveSpreadsheet(): FakeSpreadsheet {
      if (!activeId || !spreadsheets[activeId]) {
        throw new Error(
          'SpreadsheetApp.getActiveSpreadsheet: no activeId registered — pass `activeId` to installGasFakes()'
        )
      }
      return spreadsheets[activeId]
    }
  }

  const lockService = {
    getScriptLock: createNoOpLock
  }

  const backups = [
    backupAndSet('SpreadsheetApp', spreadsheetApp),
    backupAndSet('LockService', lockService)
  ]

  return {
    restore(): void {
      for (const backup of backups) {
        restoreProperty(backup)
      }
    }
  }
}
