/**
 * Index Store - 컬럼 인덱스 관리
 * 
 * Issue #7: 스키마 기반 자동 인덱스 생성 및 쿼리 활용
 * 
 * 구조:
 *   - 단일 컬럼: "status" → Map<value, Set<rowIndex>>
 *   - 복합 컬럼: "field1|field2" → Map<JSON([val1, val2]), Set<rowIndex>>
 */

import type { Row } from './types'

/** 인덱스 정의 */
export interface IndexDefinition {
  /** 인덱스 대상 필드 (순서 중요) */
  fields: string[]
  /** 유니크 제약 여부 */
  unique?: boolean
}

/** 인덱스 키 생성 (복합 인덱스용) */
export function createIndexKey(fields: string[]): string {
  return fields.join('|')
}

/** 복합 값 직렬화 */
export function serializeValues(values: unknown[]): string {
  return JSON.stringify(values)
}

/**
 * IndexStore - 테이블별 인덱스 관리
 * 
 * @example
 * ```ts
 * const store = new IndexStore<User>([
 *   { fields: ['status'] },
 *   { fields: ['email'], unique: true },
 *   { fields: ['role', 'status'] }  // 복합 인덱스
 * ])
 * 
 * // 데이터 로드 시 인덱스 구축
 * store.rebuild(users)
 * 
 * // 조회: status='active'인 row indices
 * const indices = store.lookup(['status'], ['active'])
 * ```
 */
export class IndexStore<T extends Row> {
  /** 인덱스 정의 목록 */
  private definitions: IndexDefinition[]
  
  /** 
   * 인덱스 저장소
   * key: "field1|field2|..." (인덱스 키)
   * value: Map<serializedValue, Set<rowIndex>>
   */
  private indexes: Map<string, Map<string, Set<number>>> = new Map()
  
  constructor(definitions: IndexDefinition[] = []) {
    this.definitions = definitions
    this.initializeIndexes()
  }
  
  /** 인덱스 구조 초기화 */
  private initializeIndexes(): void {
    this.indexes.clear()
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      this.indexes.set(key, new Map())
    }
  }
  
  /** 인덱스 정의 조회 */
  getDefinitions(): IndexDefinition[] {
    return [...this.definitions]
  }
  
  /** 특정 필드 조합에 대한 인덱스 존재 여부 */
  hasIndex(fields: string[]): boolean {
    const key = createIndexKey(fields)
    return this.indexes.has(key)
  }
  
  /** 
   * row에서 특정 필드들의 값 추출 
   */
  private extractValues(row: T, fields: string[]): unknown[] {
    return fields.map(f => row[f])
  }
  
  /**
   * 단일 row를 인덱스에 추가
   */
  addToIndex(rowIndex: number, row: T): void {
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      const index = this.indexes.get(key)
      if (!index) continue
      
      const values = this.extractValues(row, def.fields)
      const serialized = serializeValues(values)
      
      let rowSet = index.get(serialized)
      if (!rowSet) {
        rowSet = new Set()
        index.set(serialized, rowSet)
      }
      rowSet.add(rowIndex)
    }
  }
  
  /**
   * 단일 row를 인덱스에서 제거
   */
  removeFromIndex(rowIndex: number, row: T): void {
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      const index = this.indexes.get(key)
      if (!index) continue
      
      const values = this.extractValues(row, def.fields)
      const serialized = serializeValues(values)
      
      const rowSet = index.get(serialized)
      if (rowSet) {
        rowSet.delete(rowIndex)
        if (rowSet.size === 0) {
          index.delete(serialized)
        }
      }
    }
  }
  
  /**
   * row 업데이트 시 인덱스 갱신
   */
  updateIndex(rowIndex: number, oldRow: T, newRow: T): void {
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      const index = this.indexes.get(key)
      if (!index) continue
      
      const oldValues = this.extractValues(oldRow, def.fields)
      const newValues = this.extractValues(newRow, def.fields)
      const oldSerialized = serializeValues(oldValues)
      const newSerialized = serializeValues(newValues)
      
      // 값이 변경된 경우만 인덱스 갱신
      if (oldSerialized !== newSerialized) {
        // 기존 값에서 제거
        const oldSet = index.get(oldSerialized)
        if (oldSet) {
          oldSet.delete(rowIndex)
          if (oldSet.size === 0) {
            index.delete(oldSerialized)
          }
        }
        
        // 새 값에 추가
        let newSet = index.get(newSerialized)
        if (!newSet) {
          newSet = new Set()
          index.set(newSerialized, newSet)
        }
        newSet.add(rowIndex)
      }
    }
  }
  
  /**
   * 전체 데이터로 인덱스 재구축
   */
  rebuild(data: T[]): void {
    this.initializeIndexes()
    
    for (let i = 0; i < data.length; i++) {
      this.addToIndex(i, data[i])
    }
  }
  
  /**
   * 특정 필드 조합으로 row indices 조회
   * 
   * @param fields - 검색할 필드 배열 (인덱스 정의와 순서 일치해야 함)
   * @param values - 검색할 값 배열 (fields와 동일 순서)
   * @returns 매칭되는 row indices, 인덱스 없으면 undefined
   */
  lookup(fields: string[], values: unknown[]): Set<number> | undefined {
    const key = createIndexKey(fields)
    const index = this.indexes.get(key)
    
    if (!index) {
      return undefined // 인덱스 없음 - full scan 필요
    }
    
    const serialized = serializeValues(values)
    return index.get(serialized) // Set 또는 undefined
  }
  
  /**
   * 특정 필드로 시작하는 인덱스 찾기 (부분 매칭)
   * 복합 인덱스에서 prefix 매칭 시 사용
   */
  findIndexByPrefix(fields: string[]): IndexDefinition | undefined {
    const prefix = fields.join('|')
    
    for (const def of this.definitions) {
      const key = createIndexKey(def.fields)
      if (key === prefix || key.startsWith(prefix + '|')) {
        return def
      }
    }
    
    return undefined
  }
  
  /**
   * delete 후 row index 재정렬
   * splice로 인해 뒤쪽 row들의 index가 변경됨
   */
  reindexAfterDelete(deletedIndex: number): void {
    for (const [, index] of this.indexes) {
      for (const [, rowSet] of index) {
        const updated = new Set<number>()
        for (const idx of rowSet) {
          if (idx < deletedIndex) {
            updated.add(idx)
          } else if (idx > deletedIndex) {
            updated.add(idx - 1) // shift down
          }
          // idx === deletedIndex는 이미 제거됨
        }
        rowSet.clear()
        for (const idx of updated) {
          rowSet.add(idx)
        }
      }
    }
  }
  
  /** 인덱스 초기화 */
  clear(): void {
    this.initializeIndexes()
  }
  
  /** 디버그용: 인덱스 상태 출력 */
  debugDump(): Record<string, Record<string, number[]>> {
    const result: Record<string, Record<string, number[]>> = {}
    
    for (const [key, index] of this.indexes) {
      result[key] = {}
      for (const [serialized, rowSet] of index) {
        result[key][serialized] = Array.from(rowSet)
      }
    }
    
    return result
  }
}
