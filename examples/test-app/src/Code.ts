/**
 * gas-sheets-query 테스트 앱
 * 
 * 이 파일은 GAS 환경에서 실행되는 테스트 함수들을 포함합니다.
 * clasp를 통해 배포 후 Apps Script 에디터에서 실행하세요.
 */

// 생성된 클라이언트 import (gsq generate로 생성)
// import { db } from './generated'

// ============================================================================
// 테스트 유틸리티
// ============================================================================

interface TestResult {
  name: string
  passed: boolean
  error?: string
  duration: number
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assertDeepEqual<T>(actual: T, expected: T, message: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function runTest(name: string, fn: () => void): TestResult {
  const start = Date.now()
  try {
    fn()
    return { name, passed: true, duration: Date.now() - start }
  } catch (e) {
    return { 
      name, 
      passed: false, 
      error: e instanceof Error ? e.message : String(e),
      duration: Date.now() - start 
    }
  }
}

// ============================================================================
// 샘플 데이터
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
  { title: 'Documentation', projectId: 2, assigneeId: 2, status: 'TODO', priority: 'MEDIUM', dueDate: null },
]

const sampleComments = [
  { content: 'Started working on this', taskId: 1, authorId: 2, createdAt: new Date() },
  { content: 'Done!', taskId: 1, authorId: 2, createdAt: new Date() },
  { content: 'Looks good', taskId: 1, authorId: 1, createdAt: new Date() },
]

// ============================================================================
// 테스트 함수들 (DB 초기화 후 사용)
// ============================================================================

/**
 * 데이터베이스 초기화 및 샘플 데이터 삽입
 * 먼저 이 함수를 실행하세요!
 */
function setupTestData(): void {
  Logger.log('🚀 Setting up test data...')
  
  // TODO: gsq generate로 생성된 db 객체 사용
  // db.User.reset([])
  // db.Project.reset([])
  // db.Task.reset([])
  // db.Comment.reset([])
  
  // 샘플 데이터 삽입
  // const users = db.User.batchInsert(sampleUsers)
  // const projects = db.Project.batchInsert(sampleProjects)
  // const tasks = db.Task.batchInsert(sampleTasks)
  // const comments = db.Comment.batchInsert(sampleComments)
  
  Logger.log('✅ Test data setup complete!')
  // Logger.log(`Users: ${users.length}`)
  // Logger.log(`Projects: ${projects.length}`)
  // Logger.log(`Tasks: ${tasks.length}`)
  // Logger.log(`Comments: ${comments.length}`)
}

/**
 * CRUD 테스트
 */
function testCRUD(): TestResult[] {
  const results: TestResult[] = []
  
  results.push(runTest('Create - insert single user', () => {
    // const user = db.User.insert({ email: 'test@example.com', name: 'Test User', role: 'MEMBER' })
    // assert(user.id > 0, 'User should have an ID')
    // assertEqual(user.email, 'test@example.com', 'Email should match')
    Logger.log('CRUD Create test - implement with generated db')
  }))
  
  results.push(runTest('Read - findById', () => {
    // const user = db.User.findById(1)
    // assert(user !== undefined, 'User should exist')
    // assertEqual(user?.id, 1, 'ID should match')
    Logger.log('CRUD Read test - implement with generated db')
  }))
  
  results.push(runTest('Update - update user name', () => {
    // const updated = db.User.update(1, { name: 'Updated Name' })
    // assert(updated !== undefined, 'Update should succeed')
    // assertEqual(updated?.name, 'Updated Name', 'Name should be updated')
    Logger.log('CRUD Update test - implement with generated db')
  }))
  
  results.push(runTest('Delete - delete user', () => {
    // const testUser = db.User.insert({ email: 'delete@example.com', name: 'Delete Me', role: 'GUEST' })
    // const deleted = db.User.delete(testUser.id)
    // assert(deleted === true, 'Delete should succeed')
    // const notFound = db.User.findById(testUser.id)
    // assert(notFound === undefined, 'User should not exist after delete')
    Logger.log('CRUD Delete test - implement with generated db')
  }))
  
  return results
}

/**
 * Batch 작업 테스트
 */
function testBatch(): TestResult[] {
  const results: TestResult[] = []
  
  results.push(runTest('BatchInsert - insert multiple users', () => {
    // const users = db.User.batchInsert([
    //   { email: 'batch1@example.com', name: 'Batch 1', role: 'MEMBER' },
    //   { email: 'batch2@example.com', name: 'Batch 2', role: 'MEMBER' },
    //   { email: 'batch3@example.com', name: 'Batch 3', role: 'MEMBER' },
    // ])
    // assertEqual(users.length, 3, 'Should insert 3 users')
    Logger.log('Batch Insert test - implement with generated db')
  }))
  
  results.push(runTest('BatchUpdate - update multiple tasks', () => {
    // const updated = db.Task.batchUpdate([
    //   { id: 1, data: { status: 'DONE' } },
    //   { id: 2, data: { status: 'DONE' } },
    // ])
    // assertEqual(updated.length, 2, 'Should update 2 tasks')
    Logger.log('Batch Update test - implement with generated db')
  }))
  
  return results
}

/**
 * Query 테스트
 */
function testQuery(): TestResult[] {
  const results: TestResult[] = []
  
  results.push(runTest('Where - filter by role', () => {
    // const members = db.User.query().where('role', '=', 'MEMBER').findMany()
    // assert(members.length > 0, 'Should find members')
    // members.forEach(m => assertEqual(m.role, 'MEMBER', 'Role should be MEMBER'))
    Logger.log('Query Where test - implement with generated db')
  }))
  
  results.push(runTest('OrderBy - sort by name', () => {
    // const users = db.User.query().orderBy('name', 'asc').findMany()
    // for (let i = 1; i < users.length; i++) {
    //   assert(users[i].name >= users[i-1].name, 'Should be sorted')
    // }
    Logger.log('Query OrderBy test - implement with generated db')
  }))
  
  results.push(runTest('Limit & Offset - pagination', () => {
    // const page1 = db.User.query().limit(2).findMany()
    // const page2 = db.User.query().offset(2).limit(2).findMany()
    // assertEqual(page1.length, 2, 'Page 1 should have 2 items')
    // assert(page1[0].id !== page2[0]?.id, 'Pages should have different items')
    Logger.log('Query Limit/Offset test - implement with generated db')
  }))
  
  results.push(runTest('Like - pattern matching', () => {
    // const users = db.User.query().where('email', 'like', '%@example.com').findMany()
    // assert(users.length > 0, 'Should find users with example.com email')
    Logger.log('Query Like test - implement with generated db')
  }))
  
  results.push(runTest('In - multiple values', () => {
    // const users = db.User.query().where('role', 'in', ['ADMIN', 'MEMBER']).findMany()
    // users.forEach(u => assert(['ADMIN', 'MEMBER'].includes(u.role), 'Role should be ADMIN or MEMBER'))
    Logger.log('Query In test - implement with generated db')
  }))
  
  return results
}

/**
 * JOIN 테스트
 */
function testJoin(): TestResult[] {
  const results: TestResult[] = []
  
  results.push(runTest('Inner Join - tasks with projects', () => {
    // const tasksWithProjects = db.join('Task', 'Project')
    //   .on('projectId', 'id')
    //   .select(['Task.title', 'Project.name'])
    //   .findMany()
    // assert(tasksWithProjects.length > 0, 'Should find tasks with projects')
    Logger.log('JOIN test - implement with generated db')
  }))
  
  results.push(runTest('Left Join - tasks with optional assignee', () => {
    // const tasksWithAssignees = db.join('Task', 'User')
    //   .on('assigneeId', 'id')
    //   .leftJoin()
    //   .findMany()
    // const unassigned = tasksWithAssignees.filter(t => t.User === null)
    // assert(unassigned.length > 0, 'Should have unassigned tasks')
    Logger.log('LEFT JOIN test - implement with generated db')
  }))
  
  return results
}

/**
 * Aggregation 테스트
 */
function testAggregation(): TestResult[] {
  const results: TestResult[] = []
  
  results.push(runTest('Count - count tasks', () => {
    // const count = db.Task.query().count()
    // assert(count > 0, 'Should have tasks')
    Logger.log('Aggregation Count test - implement with generated db')
  }))
  
  results.push(runTest('GroupBy - tasks by status', () => {
    // const byStatus = db.Task.query()
    //   .groupBy('status')
    //   .aggregate({ count: { fn: 'count' } })
    // assert(Object.keys(byStatus).length > 0, 'Should have status groups')
    Logger.log('Aggregation GroupBy test - implement with generated db')
  }))
  
  results.push(runTest('GroupBy with Having - status with more than 1 task', () => {
    // const byStatus = db.Task.query()
    //   .groupBy('status')
    //   .having({ fn: 'count', operator: '>', value: 1 })
    //   .findMany()
    Logger.log('Aggregation Having test - implement with generated db')
  }))
  
  return results
}

/**
 * 전체 테스트 실행
 */
function runAllTests(): void {
  Logger.log('========================================')
  Logger.log('🧪 gas-sheets-query Test Suite')
  Logger.log('========================================')
  
  const allResults: TestResult[] = []
  
  Logger.log('\n📝 CRUD Tests')
  allResults.push(...testCRUD())
  
  Logger.log('\n📦 Batch Tests')
  allResults.push(...testBatch())
  
  Logger.log('\n🔍 Query Tests')
  allResults.push(...testQuery())
  
  Logger.log('\n🔗 JOIN Tests')
  allResults.push(...testJoin())
  
  Logger.log('\n📊 Aggregation Tests')
  allResults.push(...testAggregation())
  
  // Summary
  const passed = allResults.filter(r => r.passed).length
  const failed = allResults.filter(r => !r.passed).length
  const totalTime = allResults.reduce((sum, r) => sum + r.duration, 0)
  
  Logger.log('\n========================================')
  Logger.log('📋 Test Results Summary')
  Logger.log('========================================')
  Logger.log(`✅ Passed: ${passed}`)
  Logger.log(`❌ Failed: ${failed}`)
  Logger.log(`⏱️ Total Time: ${totalTime}ms`)
  
  if (failed > 0) {
    Logger.log('\n❌ Failed Tests:')
    allResults.filter(r => !r.passed).forEach(r => {
      Logger.log(`  - ${r.name}: ${r.error}`)
    })
  }
  
  Logger.log('\n========================================')
}

/**
 * 간단한 연결 테스트
 */
function testConnection(): void {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet()
    Logger.log(`✅ Connected to: ${ss.getName()}`)
    Logger.log(`📊 Sheets: ${ss.getSheets().map(s => s.getName()).join(', ')}`)
  } catch (e) {
    Logger.log(`❌ Connection failed: ${e}`)
  }
}

// ============================================================================
// GAS 메뉴 추가 (선택사항)
// ============================================================================

function onOpen(): void {
  const ui = SpreadsheetApp.getUi()
  ui.createMenu('🧪 GSQ Tests')
    .addItem('Setup Test Data', 'setupTestData')
    .addSeparator()
    .addItem('Run All Tests', 'runAllTests')
    .addSeparator()
    .addItem('Test CRUD', 'testCRUD')
    .addItem('Test Batch', 'testBatch')
    .addItem('Test Query', 'testQuery')
    .addItem('Test JOIN', 'testJoin')
    .addItem('Test Aggregation', 'testAggregation')
    .addToUi()
}
