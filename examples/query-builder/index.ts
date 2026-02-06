/**
 * Query Builder Example
 * 
 * gas-sheets-query QueryBuilder를 활용한 다양한 쿼리 예제
 */
import { defineSheetsDB, MockAdapter } from 'gas-sheets-query'

// =============================================================================
// 1. 타입 및 DB 설정
// =============================================================================

interface Product {
  id: number
  name: string
  category: string
  price: number
  stock: number
  active: boolean
  createdAt: Date
}

interface Order {
  id: number
  productId: number
  customerId: number
  quantity: number
  amount: number
  status: 'PENDING' | 'PAID' | 'SHIPPED' | 'CANCELLED'
  createdAt: Date
}

const productStore = new MockAdapter<Product>()
const orderStore = new MockAdapter<Order>()

const db = defineSheetsDB({
  tables: {
    products: {
      columns: ['id', 'name', 'category', 'price', 'stock', 'active', 'createdAt'] as const,
      types: { id: 0, name: '', category: '', price: 0, stock: 0, active: true, createdAt: new Date() }
    },
    orders: {
      columns: ['id', 'productId', 'customerId', 'quantity', 'amount', 'status', 'createdAt'] as const,
      types: { id: 0, productId: 0, customerId: 0, quantity: 0, amount: 0, status: 'PENDING' as const, createdAt: new Date() }
    }
  },
  stores: { products: productStore, orders: orderStore }
})

// =============================================================================
// 2. 테스트 데이터 생성
// =============================================================================

const products = db.from('products')
const orders = db.from('orders')

// 상품 데이터
products.batchInsert([
  { name: 'Laptop', category: 'Electronics', price: 1200, stock: 50, active: true, createdAt: new Date() },
  { name: 'Keyboard', category: 'Electronics', price: 100, stock: 200, active: true, createdAt: new Date() },
  { name: 'Mouse', category: 'Electronics', price: 50, stock: 300, active: true, createdAt: new Date() },
  { name: 'T-Shirt', category: 'Clothing', price: 25, stock: 500, active: true, createdAt: new Date() },
  { name: 'Jeans', category: 'Clothing', price: 60, stock: 300, active: true, createdAt: new Date() },
  { name: 'Sneakers', category: 'Footwear', price: 120, stock: 150, active: true, createdAt: new Date() },
  { name: 'Sandals', category: 'Footwear', price: 40, stock: 100, active: false, createdAt: new Date() },
])

// 주문 데이터
orders.batchInsert([
  { productId: 1, customerId: 1, quantity: 2, amount: 2400, status: 'PAID', createdAt: new Date() },
  { productId: 2, customerId: 1, quantity: 1, amount: 100, status: 'PAID', createdAt: new Date() },
  { productId: 3, customerId: 2, quantity: 3, amount: 150, status: 'SHIPPED', createdAt: new Date() },
  { productId: 4, customerId: 2, quantity: 5, amount: 125, status: 'PAID', createdAt: new Date() },
  { productId: 5, customerId: 3, quantity: 2, amount: 120, status: 'PENDING', createdAt: new Date() },
  { productId: 6, customerId: 3, quantity: 1, amount: 120, status: 'CANCELLED', createdAt: new Date() },
  { productId: 1, customerId: 4, quantity: 1, amount: 1200, status: 'PAID', createdAt: new Date() },
  { productId: 4, customerId: 4, quantity: 10, amount: 250, status: 'PAID', createdAt: new Date() },
])

console.log('Test data created:', products.findAll().length, 'products,', orders.findAll().length, 'orders')

// =============================================================================
// 3. 기본 조건 쿼리
// =============================================================================

console.log('\n=== WHERE Conditions ===')

// 같음 (=)
const electronics = products.query()
  .where('category', '=', 'Electronics')
  .exec()
console.log('Electronics:', electronics.map(p => p.name).join(', '))

// 다름 (!=)
const notCancelled = orders.query()
  .where('status', '!=', 'CANCELLED')
  .exec()
console.log('Not cancelled orders:', notCancelled.length)

// 비교 (>, <, >=, <=)
const expensive = products.query()
  .where('price', '>=', 100)
  .exec()
console.log('Price >= 100:', expensive.map(p => p.name).join(', '))

// IN
const clothingOrFootwear = products.query()
  .where('category', 'in', ['Clothing', 'Footwear'])
  .exec()
console.log('Clothing/Footwear:', clothingOrFootwear.map(p => p.name).join(', '))

// LIKE
const withS = products.query()
  .where('name', 'like', 'S%')
  .exec()
console.log('Name starts with S:', withS.map(p => p.name).join(', '))

// =============================================================================
// 4. 다중 조건 (AND)
// =============================================================================

console.log('\n=== Multiple Conditions (AND) ===')

const activeExpensive = products.query()
  .where('active', '=', true)
  .where('price', '>', 50)
  .exec()
console.log('Active & price > 50:', activeExpensive.map(p => `${p.name}($${p.price})`).join(', '))

const paidLargeOrders = orders.query()
  .where('status', '=', 'PAID')
  .where('amount', '>', 200)
  .exec()
console.log('Paid orders > $200:', paidLargeOrders.length)

// =============================================================================
// 5. 정렬 (ORDER BY)
// =============================================================================

console.log('\n=== ORDER BY ===')

// 단일 정렬
const byPrice = products.query()
  .orderBy('price', 'desc')
  .exec()
console.log('By price (desc):', byPrice.map(p => `${p.name}($${p.price})`).join(' > '))

// 다중 정렬
const byCategoryAndPrice = products.query()
  .orderBy('category', 'asc')
  .orderBy('price', 'desc')
  .exec()
console.log('\nBy category, then price:')
byCategoryAndPrice.forEach(p => console.log(`  ${p.category}: ${p.name} ($${p.price})`))

// =============================================================================
// 6. 페이지네이션
// =============================================================================

console.log('\n=== Pagination ===')

// limit/offset
const first3 = products.query()
  .orderBy('name', 'asc')
  .limit(3)
  .exec()
console.log('First 3:', first3.map(p => p.name).join(', '))

const next3 = products.query()
  .orderBy('name', 'asc')
  .offset(3)
  .limit(3)
  .exec()
console.log('Next 3:', next3.map(p => p.name).join(', '))

// page 메서드
const page1 = products.query().orderBy('name').page(1, 3).exec()
const page2 = products.query().orderBy('name').page(2, 3).exec()
console.log('Page 1:', page1.map(p => p.name).join(', '))
console.log('Page 2:', page2.map(p => p.name).join(', '))

// =============================================================================
// 7. 결과 메서드
// =============================================================================

console.log('\n=== Result Methods ===')

// first()
const cheapest = products.query()
  .orderBy('price', 'asc')
  .first()
console.log('Cheapest:', cheapest?.name, `($${cheapest?.price})`)

// exists()
const hasShipped = orders.query()
  .where('status', '=', 'SHIPPED')
  .exists()
console.log('Has shipped orders:', hasShipped)

// count()
const activeCount = products.query()
  .where('active', '=', true)
  .count()
console.log('Active products count:', activeCount)

// =============================================================================
// 8. 집계 함수
// =============================================================================

console.log('\n=== Aggregation ===')

// 단일 집계
const totalRevenue = orders.query()
  .where('status', '=', 'PAID')
  .sum('amount')
console.log('Total revenue (PAID):', totalRevenue)

const avgOrderAmount = orders.query()
  .avg('amount')
console.log('Average order amount:', avgOrderAmount.toFixed(2))

const minPrice = products.query().min('price')
const maxPrice = products.query().max('price')
console.log('Price range:', minPrice, '~', maxPrice)

// 그룹별 집계
console.log('\n=== GROUP BY ===')

const categoryStats = products.query()
  .groupBy('category')
  .agg({
    count: 'count',
    totalStock: 'sum:stock',
    avgPrice: 'avg:price',
    minPrice: 'min:price',
    maxPrice: 'max:price'
  })

console.log('Category Stats:')
categoryStats.forEach(stat => {
  console.log(`  ${stat.category}:`)
  console.log(`    - Products: ${stat.count}`)
  console.log(`    - Total Stock: ${stat.totalStock}`)
  console.log(`    - Avg Price: $${(stat.avgPrice as number).toFixed(2)}`)
  console.log(`    - Price Range: $${stat.minPrice} ~ $${stat.maxPrice}`)
})

// 주문 상태별 통계
const orderStats = orders.query()
  .groupBy('status')
  .agg({
    count: 'count',
    totalAmount: 'sum:amount'
  })

console.log('\nOrder Stats by Status:')
orderStats.forEach(stat => {
  console.log(`  ${stat.status}: ${stat.count} orders, $${stat.totalAmount} total`)
})

// =============================================================================
// 9. 편의 메서드
// =============================================================================

console.log('\n=== Shorthand Methods ===')

// whereEq
const laptops = products.query().whereEq('name', 'Laptop').exec()
console.log('whereEq:', laptops[0]?.name)

// whereIn
const paidOrShipped = orders.query()
  .whereIn('status', ['PAID', 'SHIPPED'])
  .exec()
console.log('whereIn (PAID/SHIPPED):', paidOrShipped.length, 'orders')

// whereLike
const sProducts = products.query()
  .whereLike('name', 'S%')
  .exec()
console.log('whereLike (S%):', sProducts.map(p => p.name).join(', '))

// =============================================================================
// 10. 복합 쿼리 예제
// =============================================================================

console.log('\n=== Complex Queries ===')

// 활성 상품 중 재고 100개 이상, 가격순 상위 3개
const topProducts = products.query()
  .where('active', '=', true)
  .where('stock', '>=', 100)
  .orderBy('price', 'desc')
  .limit(3)
  .exec()

console.log('Top 3 active products with stock >= 100:')
topProducts.forEach((p, i) => {
  console.log(`  ${i + 1}. ${p.name} - $${p.price} (${p.stock} in stock)`)
})

// 고객별 총 주문 금액 (PAID 주문만)
const customerSpending = orders.query()
  .where('status', '=', 'PAID')
  .groupBy('customerId')
  .agg({
    orderCount: 'count',
    totalSpent: 'sum:amount',
    avgOrder: 'avg:amount'
  })

console.log('\nCustomer Spending (PAID orders):')
customerSpending.forEach(c => {
  console.log(`  Customer ${c.customerId}: ${c.orderCount} orders, $${c.totalSpent} total (avg: $${(c.avgOrder as number).toFixed(2)})`)
})
