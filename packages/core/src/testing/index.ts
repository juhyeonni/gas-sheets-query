/**
 * @gsquery/core/testing
 * Offline, deterministic fakes for Google Sheets/GAS globals. Not re-exported
 * from the main entrypoint — excluded from the main and GAS bundles.
 */
export { FakeSheet, FakeRange } from './fake-sheet'
export { FakeSpreadsheet } from './fake-spreadsheet'
export { installGasFakes } from './install'
export type { InstallGasFakesOptions, GasFakesHandle } from './install'
export { fromArrays, fromCsv, fromJson } from './loaders'
export type { FromCsvOptions } from './loaders'
export { toGrid, toCsv, toJson } from './export'
export type { SnapshotEnvelope, SnapshotSheetEntry } from './json'
