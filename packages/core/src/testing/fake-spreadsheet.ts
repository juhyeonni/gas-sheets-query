/**
 * FakeSpreadsheet — named-sheet container mirroring GAS `Spreadsheet`'s
 * allowlisted surface (`getSheetByName`, `insertSheet`, `getSheets`, `getName`).
 */
import { FakeSheet } from './fake-sheet'

export class FakeSpreadsheet {
  private readonly sheets = new Map<string, FakeSheet>()

  constructor(private readonly name: string, initialSheets: FakeSheet[] = []) {
    for (const sheet of initialSheets) {
      this.sheets.set(sheet.getName(), sheet)
    }
  }

  getName(): string {
    return this.name
  }

  /** Returns `null` (never throws) when no sheet with that name exists. */
  getSheetByName(name: string): FakeSheet | null {
    return this.sheets.get(name) ?? null
  }

  /** Creates and returns an empty sheet. Throws if the name is already taken (GAS parity). */
  insertSheet(name: string): FakeSheet {
    if (this.sheets.has(name)) {
      throw new Error(`insertSheet: a sheet named "${name}" already exists`)
    }
    const sheet = new FakeSheet(name)
    this.sheets.set(name, sheet)
    return sheet
  }

  /** Sheets in insertion order. */
  getSheets(): FakeSheet[] {
    return [...this.sheets.values()]
  }
}
