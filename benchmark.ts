/**
 * Benchmark - Performance measurement
 *
 * Run: npx tsx benchmark.ts
 */
import { defineSheetsDB, MockAdapter } from './src'

// ============================================================================
// Utilities
// ============================================================================

function formatNumber(n: number): string {
  return n.toLocaleString()
}

function formatTime(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`
  if (ms < 1000) return `${ms.toFixed(2)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function benchmark(name: string, fn: () => void, iterations: number = 1000): void {
  // Warmup
  for (let i = 0; i < 10; i++) fn()

  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    fn()
  }
  const end = performance.now()

  const total = end - start
  const perOp = total / iterations
  const opsPerSec = 1000 / perOp

  console.log(`  ${name}`)
  console.log(`    Total: ${formatTime(total)} (${formatNumber(iterations)} iterations)`)
  console.log(`    Per op: ${formatTime(perOp)}`)
  console.log(`    Ops/sec: ${formatNumber(Math.round(opsPerSec))}`)
  console.log()
}

// ============================================================================
// Setup
// ============================================================================

console.log('gas-sheets-query Benchmark\n')
console.log('=' .repeat(60))

// Create DB
const db = defineSheetsDB({
  tables: {
    users: {
      columns: ['id', 'name', 'email', 'age', 'active', 'score'] as const,
      types: { id: 0, name: '', email: '', age: 0, active: true, score: 0 }
    }
  },
  stores: {
    users: new MockAdapter()
  }
})

// ============================================================================
// Insert Benchmark
// ============================================================================

console.log('\nINSERT BENCHMARK')
console.log('-'.repeat(60))

benchmark('Single insert', () => {
  db.from('users').create({
    name: 'Test User',
    email: 'test@example.com',
    age: 25,
    active: true,
    score: 100
  })
}, 1000)

// Reset for next benchmarks
const store = db.getStore('users') as import('./src').MockAdapter<any>
store.reset()

// ============================================================================
// Bulk Insert
// ============================================================================

console.log('BULK INSERT BENCHMARK')
console.log('-'.repeat(60))

const sizes = [100, 1000, 10000]

for (const size of sizes) {
  store.reset()

  const start = performance.now()
  for (let i = 0; i < size; i++) {
    db.from('users').create({
      name: `User ${i}`,
      email: `user${i}@example.com`,
      age: 20 + (i % 50),
      active: i % 2 === 0,
      score: Math.floor(Math.random() * 1000)
    })
  }
  const end = performance.now()

  console.log(`  Insert ${formatNumber(size)} rows: ${formatTime(end - start)}`)
  console.log(`    Per row: ${formatTime((end - start) / size)}`)
  console.log()
}

// ============================================================================
// Read Benchmark (with 10,000 rows)
// ============================================================================

console.log('READ BENCHMARK (10,000 rows)')
console.log('-'.repeat(60))

// Setup 10k rows
store.reset()
for (let i = 0; i < 10000; i++) {
  db.from('users').create({
    name: `User ${i}`,
    email: `user${i}@example.com`,
    age: 20 + (i % 50),
    active: i % 3 === 0,
    score: i % 1000
  })
}

benchmark('findAll()', () => {
  db.from('users').findAll()
}, 100)

benchmark('findById()', () => {
  db.from('users').repo.findByIdOrNull(5000)
}, 1000)

// ============================================================================
// Query Benchmark
// ============================================================================

console.log('QUERY BENCHMARK (10,000 rows)')
console.log('-'.repeat(60))

benchmark('Simple where (=)', () => {
  db.from('users').query().where('active', '=', true).exec()
}, 100)

benchmark('Range where (>, <)', () => {
  db.from('users').query()
    .where('age', '>=', 30)
    .where('age', '<=', 40)
    .exec()
}, 100)

benchmark('Multiple conditions', () => {
  db.from('users').query()
    .where('active', '=', true)
    .where('age', '>', 25)
    .where('score', '>=', 500)
    .exec()
}, 100)

benchmark('With orderBy', () => {
  db.from('users').query()
    .where('active', '=', true)
    .orderBy('age', 'desc')
    .exec()
}, 100)

benchmark('With limit', () => {
  db.from('users').query()
    .where('active', '=', true)
    .orderBy('age', 'desc')
    .limit(10)
    .exec()
}, 100)

benchmark('Pagination (page 50, size 20)', () => {
  db.from('users').query()
    .orderBy('id')
    .page(50, 20)
    .exec()
}, 100)

benchmark('Like search', () => {
  db.from('users').query()
    .whereLike('name', 'User 1%')
    .exec()
}, 100)

benchmark('In operator', () => {
  db.from('users').query()
    .whereIn('age', [25, 30, 35, 40, 45])
    .exec()
}, 100)

// ============================================================================
// Update Benchmark
// ============================================================================

console.log('UPDATE BENCHMARK')
console.log('-'.repeat(60))

benchmark('Single update', () => {
  db.from('users').update(5000, { score: Math.random() * 1000 })
}, 1000)

// ============================================================================
// Delete Benchmark
// ============================================================================

console.log('DELETE BENCHMARK')
console.log('-'.repeat(60))

// Setup fresh data
store.reset()
for (let i = 0; i < 1000; i++) {
  db.from('users').create({
    name: `User ${i}`,
    email: `user${i}@example.com`,
    age: 25,
    active: true,
    score: 100
  })
}

let deleteId = 1
benchmark('Single delete', () => {
  db.from('users').repo.deleteIfExists(deleteId++)
}, 500)

// ============================================================================
// Summary
// ============================================================================

console.log('=' .repeat(60))
console.log('\nSUMMARY')
console.log('-'.repeat(60))
console.log(`
MockAdapter Performance (in-memory):
- Insert: ~tens of μs/row
- findById: ~few μs (linear search)
- Query: proportional to data size
- Query with 10k rows: ~few ms

Note:
- This benchmark uses MockAdapter (in-memory)
- Actual GAS + Google Sheets is much slower (network + API calls)
- Separate benchmark needed after GasAdapter implementation
`)

console.log('\nBenchmark complete!')
