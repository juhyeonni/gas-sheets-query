# Query Builder Example

gas-sheets-query QueryBuilder를 활용한 다양한 쿼리 예제입니다.

## 실행

```bash
npx tsx examples/query-builder/index.ts
```

## 주요 내용

### 1. WHERE 조건

```typescript
// 같음
products.query().where('category', '=', 'Electronics')

// 비교
products.query().where('price', '>=', 100)

// IN
products.query().where('category', 'in', ['Clothing', 'Footwear'])

// LIKE
products.query().where('name', 'like', 'S%')
```

### 2. 다중 조건 (AND)

```typescript
products.query()
  .where('active', '=', true)
  .where('price', '>', 50)
  .exec()
```

### 3. 정렬

```typescript
// 단일 정렬
products.query().orderBy('price', 'desc')

// 다중 정렬
products.query()
  .orderBy('category', 'asc')
  .orderBy('price', 'desc')
```

### 4. 페이지네이션

```typescript
// limit/offset
products.query().limit(10).offset(20)

// page 메서드
products.query().page(2, 10)  // 2페이지, 10개씩
```

### 5. 결과 메서드

```typescript
query.exec()      // 전체 결과
query.first()     // 첫 번째 결과
query.count()     // 개수
query.exists()    // 존재 여부
```

### 6. 집계

```typescript
// 단일 집계
query.sum('amount')
query.avg('price')
query.min('price')
query.max('price')

// 그룹별 집계
products.query()
  .groupBy('category')
  .agg({
    count: 'count',
    totalStock: 'sum:stock',
    avgPrice: 'avg:price'
  })
```

## 출력 예시

```
=== WHERE Conditions ===
Electronics: Laptop, Keyboard, Mouse
Not cancelled orders: 7
Price >= 100: Laptop, Keyboard, Sneakers

=== Aggregation ===
Total revenue (PAID): 4075
Average order amount: 558.13
Price range: 25 ~ 1200

=== GROUP BY ===
Category Stats:
  Electronics:
    - Products: 3
    - Total Stock: 550
    - Avg Price: $450.00
    ...
```
