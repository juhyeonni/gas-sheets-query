/**
 * @gsquery/core/testing
 * Offline, deterministic fakes for Google Sheets/GAS globals. Not re-exported
 * from the main entrypoint — excluded from the main and GAS bundles.
 */
export { FakeSheet, FakeRange } from './fake-sheet.js'
export { FakeSpreadsheet } from './fake-spreadsheet.js'
export { installGasFakes } from './install.js'
export type { InstallGasFakesOptions, GasFakesHandle } from './install.js'
export { fromArrays, fromCsv, fromJson } from './loaders.js'
export type { FromCsvOptions } from './loaders.js'
export { toGrid, toCsv, toJson } from './export.js'
export type { SnapshotEnvelope, SnapshotSheetEntry } from './json.js'
