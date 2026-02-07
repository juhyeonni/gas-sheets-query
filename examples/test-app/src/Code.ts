/**
 * GSQuery Test App
 * 
 * Tests all features of @gsquery/core in a real GAS environment.
 * Run setupTestData() first, then runAllTests().
 */

// ============================================================================
// Configuration
// ============================================================================

const SPREADSHEET_ID = '' // Set your spreadsheet ID here

// ============================================================================
// Inline SheetsAdapter (for GAS environment)
// ============================================================================

interface Row { id: number; [key: string]: unknown }
interface QueryOptions<T> {
  where?: Array<{ field: keyof T & string; operator: string; value: unknown }>
  orderBy?: Array<{ field: keyof T & string; direction: 'asc' | 'desc' }>
  limit?: number
  offset?: number
}

class SheetsAdapter<T extends Row> {
  private spreadsheetId: string
  private sheetName: string
  private columns: string[]
  private sheet: GoogleAppsScript.Spreadsheet.Sheet | null = null

  constructor(options: { spreadsheetId: string; sheetName: string; columns: string[] }) {
    this.spreadsheetId = options.spreadsheetId
    this.sheetName = options.sheetName
    this.columns = options.columns
  }

  private getSheet(): GoogleAppsScript.Spreadsheet.Sheet {
    if (!this.sheet) {
      const ss = SpreadsheetApp.openById(this.spreadsheetId)
      let sheet = ss.getSheetByName(this.sheetName)
      if (!sheet) {
        sheet = ss.insertSheet(this.sheetName)
        sheet.getRange(1, 1, 1, this.columns.length).setValues([this.columns])
      }
      this.sheet = sheet
    }
    return this.sheet
  }

  private rowToObject(row: unknown[], headers: string[]): T {
    const obj: Record<string, unknown> = {}
    headers.forEach((h, i) => {
      obj[h] = row[i]
    })
    return obj as T
  }

  private objectToRow(obj: Partial<T>): unknown[] {
    return this.columns.map(col => obj[col as keyof T] ?? '')
  }

  findAll(): T[] {
    const sheet = this.getSheet()
    const data = sheet.getDataRange().getValues()
    if (data.length <= 1) return []
    const headers = data[0] as string[]
    return data.slice(1).map(row => this.rowToObject(row, headers))
  }

  findById(id: number): T | undefined {
    return this.findAll().find(row => row.id === id)
  }

  find(options: QueryOptions<T>): T[] {
    let rows = this.findAll()
    
    if (options.where) {
      for (const cond of options.where) {
        rows = rows.filter(row => {
          const val = row[cond.field]
          switch (cond.operator) {
            case '=': return val === cond.value
            case '!=': return val !== cond.value
            case '>': return (val as number) > (cond.value as number)
            case '>=': return (val as number) >= (cond.value as number)
            case '<': return (val as number) < (cond.value as number)
            case '<=': return (val as number) <= (cond.value as number)
            default: return true
          }
        })
      }
    }

    if (options.orderBy) {
      for (const ord of [...options.orderBy].reverse()) {
        rows.sort((a, b) => {
          const aVal = a[ord.field]
          const bVal = b[ord.field]
          const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
          return ord.direction === 'desc' ? -cmp : cmp
        })
      }
    }

    if (options.offset) rows = rows.slice(options.offset)
    if (options.limit) rows = rows.slice(0, options.limit)

    return rows
  }

  insert(data: Omit<T, 'id'>): T {
    const sheet = this.getSheet()
    const all = this.findAll()
    const maxId = all.reduce((max, row) => Math.max(max, row.id), 0)
    const newRow = { ...data, id: maxId + 1 } as T
    sheet.appendRow(this.objectToRow(newRow))
    return newRow
  }

  update(id: number, data: Partial<T>): T | undefined {
    const sheet = this.getSheet()
    const allData = sheet.getDataRange().getValues()
    const headers = allData[0] as string[]
    const idCol = headers.indexOf('id')
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][idCol] === id) {
        const current = this.rowToObject(allData[i], headers)
        const updated = { ...current, ...data }
        sheet.getRange(i + 1, 1, 1, this.columns.length).setValues([this.objectToRow(updated)])
        return updated
      }
    }
    return undefined
  }

  delete(id: number): boolean {
    const sheet = this.getSheet()
    const allData = sheet.getDataRange().getValues()
    const headers = allData[0] as string[]
    const idCol = headers.indexOf('id')
    
    for (let i = 1; i < allData.length; i++) {
      if (allData[i][idCol] === id) {
        sheet.deleteRow(i + 1)
        return true
      }
    }
    return false
  }

  batchInsert(items: Omit<T, 'id'>[]): T[] {
    const sheet = this.getSheet()
    const all = this.findAll()
    let maxId = all.reduce((max, row) => Math.max(max, row.id), 0)
    
    const newRows: T[] = items.map(item => {
      maxId++
      return { ...item, id: maxId } as T
    })
    
    const values = newRows.map(row => this.objectToRow(row))
    const lastRow = sheet.getLastRow()
    sheet.getRange(lastRow + 1, 1, values.length, this.columns.length).setValues(values)
    
    return newRows
  }

  reset(data: T[] = []): void {
    const sheet = this.getSheet()
    sheet.clear()
    sheet.getRange(1, 1, 1, this.columns.length).setValues([this.columns])
    if (data.length > 0) {
      const values = data.map(row => this.objectToRow(row))
      sheet.getRange(2, 1, values.length, this.columns.length).setValues(values)
    }
  }
}

// ============================================================================
// Types (generated by gsquery)
// ============================================================================

interface User { id: number; email: string; name: string; role: string }
interface Project { id: number; name: string; ownerId: number; status: string }
interface Task { id: number; title: string; projectId: number; assigneeId: number | null; status: string; priority: string; dueDate: Date | null }
interface Comment { id: number; content: string; taskId: number; authorId: number; createdAt: Date }

// ============================================================================
// Database Setup
// ============================================================================

function getDB() {
  if (!SPREADSHEET_ID) {
    throw new Error('Please set SPREADSHEET_ID at the top of Code.ts')
  }
  
  return {
    User: new SheetsAdapter<User>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: 'User',
      columns: ['id', 'email', 'name', 'role']
    }),
    Project: new SheetsAdapter<Project>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: 'Project',
      columns: ['id', 'name', 'ownerId', 'status']
    }),
    Task: new SheetsAdapter<Task>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: 'Task',
      columns: ['id', 'title', 'projectId', 'assigneeId', 'status', 'priority', 'dueDate']
    }),
    Comment: new SheetsAdapter<Comment>({
      spreadsheetId: SPREADSHEET_ID,
      sheetName: 'Comment',
      columns: ['id', 'content', 'taskId', 'authorId', 'createdAt']
    })
  }
}

// ============================================================================
// Test Utilities
// ============================================================================

interface TestResult { name: string; passed: boolean; error?: string }

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`)
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`)
  }
}

function runTest(name: string, fn: () => void): TestResult {
  try {
    fn()
    return { name, passed: true }
  } catch (e) {
    return { name, passed: false, error: e instanceof Error ? e.message : String(e) }
  }
}

// ============================================================================
// Sample Data
// ============================================================================

const sampleUsers = [
  { email: 'admin@example.com', name: 'Admin User', role: 'ADMIN' },
  { email: 'alice@example.com', name: 'Alice', role: 'MEMBER' },
  { email: 'bob@example.com', name: 'Bob', role: 'MEMBER' },
  { email: 'charlie@example.com', name: 'Charlie', role: 'GUEST' },
]

const sampleProjects = [
  { name: 'Project Alpha', ownerId: 1, status: 'ACTIVE' },
  { name: 'Project Beta', ownerId: 2, status: 'ACTIVE' },
  { name: 'Project Gamma', ownerId: 1, status: 'ARCHIVED' },
]

const sampleTasks = [
  { title: 'Setup environment', projectId: 1, assigneeId: 2, status: 'DONE', priority: 'HIGH', dueDate: null },
  { title: 'Design database', projectId: 1, assigneeId: 2, status: 'IN_PROGRESS', priority: 'HIGH', dueDate: null },
  { title: 'Implement API', projectId: 1, assigneeId: 3, status: 'TODO', priority: 'MEDIUM', dueDate: null },
  { title: 'Write tests', projectId: 1, assigneeId: null, status: 'TODO', priority: 'LOW', dueDate: null },
]

const sampleComments = [
  { content: 'Started working on this', taskId: 1, authorId: 2, createdAt: new Date() },
  { content: 'Done!', taskId: 1, authorId: 2, createdAt: new Date() },
]

// ============================================================================
// Test Functions (Global - callable from GAS)
// ============================================================================

/**
 * Setup test data - run this first!
 */
function setupTestData(): void {
  Logger.log('🚀 Setting up test data...')
  const db = getDB()
  
  // Clear existing data
  db.User.reset()
  db.Project.reset()
  db.Task.reset()
  db.Comment.reset()
  
  // Insert sample data
  const users = db.User.batchInsert(sampleUsers)
  const projects = db.Project.batchInsert(sampleProjects)
  const tasks = db.Task.batchInsert(sampleTasks)
  const comments = db.Comment.batchInsert(sampleComments)
  
  Logger.log(`✅ Setup complete!`)
  Logger.log(`   Users: ${users.length}`)
  Logger.log(`   Projects: ${projects.length}`)
  Logger.log(`   Tasks: ${tasks.length}`)
  Logger.log(`   Comments: ${comments.length}`)
}

/**
 * Test CRUD operations
 */
function testCRUD(): void {
  Logger.log('🧪 Testing CRUD...')
  const db = getDB()
  const results: TestResult[] = []
  
  results.push(runTest('Create - insert user', () => {
    const user = db.User.insert({ email: 'test@example.com', name: 'Test User', role: 'MEMBER' })
    assert(user.id > 0, 'User should have an ID')
    assertEqual(user.email, 'test@example.com', 'Email should match')
  }))
  
  results.push(runTest('Read - findAll', () => {
    const users = db.User.findAll()
    assert(users.length > 0, 'Should have users')
  }))
  
  results.push(runTest('Read - findById', () => {
    const user = db.User.findById(1)
    assert(user !== undefined, 'User should exist')
    assertEqual(user!.id, 1, 'ID should match')
  }))
  
  results.push(runTest('Update - update user', () => {
    const updated = db.User.update(1, { name: 'Updated Admin' })
    assert(updated !== undefined, 'Update should succeed')
    assertEqual(updated!.name, 'Updated Admin', 'Name should be updated')
  }))
  
  results.push(runTest('Delete - delete user', () => {
    const testUser = db.User.insert({ email: 'delete@example.com', name: 'Delete Me', role: 'GUEST' })
    const deleted = db.User.delete(testUser.id)
    assert(deleted === true, 'Delete should succeed')
  }))
  
  logResults('CRUD', results)
}

/**
 * Test Batch operations
 */
function testBatch(): void {
  Logger.log('🧪 Testing Batch...')
  const db = getDB()
  const results: TestResult[] = []
  
  results.push(runTest('BatchInsert - insert multiple', () => {
    const users = db.User.batchInsert([
      { email: 'batch1@example.com', name: 'Batch 1', role: 'MEMBER' },
      { email: 'batch2@example.com', name: 'Batch 2', role: 'MEMBER' },
    ])
    assertEqual(users.length, 2, 'Should insert 2 users')
  }))
  
  logResults('Batch', results)
}

/**
 * Test Query operations
 */
function testQuery(): void {
  Logger.log('🧪 Testing Query...')
  const db = getDB()
  const results: TestResult[] = []
  
  results.push(runTest('Query - where equals', () => {
    const admins = db.User.find({ where: [{ field: 'role', operator: '=', value: 'ADMIN' }] })
    assert(admins.length > 0, 'Should find admins')
  }))
  
  results.push(runTest('Query - orderBy', () => {
    const users = db.User.find({ orderBy: [{ field: 'name', direction: 'asc' }] })
    assert(users.length > 0, 'Should have users')
  }))
  
  results.push(runTest('Query - limit', () => {
    const users = db.User.find({ limit: 2 })
    assert(users.length <= 2, 'Should limit to 2')
  }))
  
  logResults('Query', results)
}

/**
 * Run all tests
 */
function runAllTests(): void {
  Logger.log('=' .repeat(50))
  Logger.log('🚀 Running all tests...')
  Logger.log('=' .repeat(50))
  
  testCRUD()
  testBatch()
  testQuery()
  
  Logger.log('=' .repeat(50))
  Logger.log('✅ All tests completed!')
  Logger.log('=' .repeat(50))
}

/**
 * Log test results
 */
function logResults(suite: string, results: TestResult[]): void {
  const passed = results.filter(r => r.passed).length
  const failed = results.filter(r => !r.passed).length
  
  Logger.log(`\n📊 ${suite}: ${passed} passed, ${failed} failed`)
  
  for (const r of results) {
    if (r.passed) {
      Logger.log(`  ✅ ${r.name}`)
    } else {
      Logger.log(`  ❌ ${r.name}: ${r.error}`)
    }
  }
}

/**
 * Add menu to spreadsheet
 */
function onOpen(): void {
  SpreadsheetApp.getUi()
    .createMenu('🧪 GSQuery Tests')
    .addItem('Setup Test Data', 'setupTestData')
    .addSeparator()
    .addItem('Test CRUD', 'testCRUD')
    .addItem('Test Batch', 'testBatch')
    .addItem('Test Query', 'testQuery')
    .addSeparator()
    .addItem('Run All Tests', 'runAllTests')
    .addToUi()
}
