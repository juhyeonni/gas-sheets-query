/**
 * FakeSpreadsheet — named-sheet container mirroring GAS `Spreadsheet`'s
 * allowlisted surface (`getSheetByName`, `insertSheet`, `deleteSheet`,
 * `getSheets`, `getName`).
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

  /**
   * Removes a sheet. Throws when the sheet is not part of this spreadsheet or
   * when it is the last remaining sheet (GAS parity — a spreadsheet always
   * keeps at least one sheet).
   */
  deleteSheet(sheet: FakeSheet): void {
    const name = sheet.getName()
    if (this.sheets.get(name) !== sheet) {
      throw new Error(`deleteSheet: sheet "${name}" does not belong to this spreadsheet`)
    }
    if (this.sheets.size === 1) {
      throw new Error('deleteSheet: a spreadsheet must contain at least one sheet')
    }
    this.sheets.delete(name)
  }

  /** Sheets in insertion order. */
  getSheets(): FakeSheet[] {
    return [...this.sheets.values()]
  }
}
