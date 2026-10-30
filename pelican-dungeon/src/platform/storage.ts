/* SPDX-License-Identifier: GPL-3.0-or-later
 * IndexedDB 平台适配：ScarfQian，2026-10-30。
 * 替代 SPD Dungeon 的平台文件保存；不迁移旧横版/波次 localStorage 或 Java 存档。
 * 版本比较和写入在同一个事务内完成；只有 transaction.complete 才表示保存成功。
 */

import version from '../../version.json';
import type { GameState } from '../game/model';
import { decodeSave, SAVE_PROJECT, SAVE_SCHEMA_VERSION } from '../save/codec';

export interface SaveRecord { slot: number; revision: number; savedAt: string; state: GameState }
export interface Storage {
  list(): Promise<SaveRecord[]>;
  load(slot: number): Promise<SaveRecord | null>;
  /** expectedRevision=null 只允许空槽；导入也使用此约定，禁止覆盖已有远征。 */
  save(slot: number, state: GameState, expectedRevision: number | null): Promise<SaveRecord>;
  remove(slot: number, expectedRevision: number): Promise<void>;
  close(): void;
}

const STORE = 'slots';
function checkedSlot(slot: number): void {
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new Error('请选择存档槽1、2或3。');
}
function checkedRevision(revision: number): void {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error('存档版本编号无效，请重新读取存档。');
}
function storageError(error: unknown): Error {
  if (error instanceof Error && !(error instanceof DOMException)) return error;
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'QuotaExceededError') return new Error('浏览器存储空间不足。进度仍可在内存中继续，请导出存档。');
  if (name === 'VersionError') return new Error('此浏览器中的存档数据库来自更新版本，当前版本不会更改它。');
  return new Error('浏览器无法完成存档操作。请保留当前页面，并导出存档后再重试。');
}
function readRecord(value: unknown, expectedSlot?: number): SaveRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('存档记录不完整，原记录已保留。');
  const record = value as Record<string, unknown>;
  if (typeof record.slot !== 'number') throw new Error('存档槽编号缺失，原记录已保留。');
  checkedSlot(record.slot);
  if (expectedSlot !== undefined && record.slot !== expectedSlot) throw new Error('存档槽编号不一致，原记录已保留。');
  if (typeof record.revision !== 'number') throw new Error('存档版本编号缺失，原记录已保留。');
  checkedRevision(record.revision);
  if (typeof record.savedAt !== 'string' || !Number.isFinite(Date.parse(record.savedAt))) throw new Error('存档时间无效，原记录已保留。');
  if (record.state === null || typeof record.state !== 'object' || Array.isArray(record.state)) throw new Error('存档状态不完整，原记录已保留。');
  // 读取原记录的格式，允许旧首层档在内存中迁移；写入仍由原事务负责。
  const schemaVersion = (record.state as Record<string, unknown>).schemaVersion;
  const state = decodeSave({ project: SAVE_PROJECT, schemaVersion, state: record.state });
  return { slot: record.slot, revision: record.revision, savedAt: record.savedAt, state };
}

class IndexedStorage implements Storage {
  private closed = false;
  constructor(private readonly database: IDBDatabase) {
    database.onversionchange = () => this.close();
  }
  close(): void { this.closed = true; this.database.close(); }
  private transaction(mode: IDBTransactionMode): IDBTransaction {
    if (this.closed) throw new Error('存档连接已关闭，请重新打开存档面板。');
    try { return this.database.transaction(STORE, mode); }
    catch (error) { throw storageError(error); }
  }
  private read<T>(requestData: (store: IDBObjectStore) => IDBRequest, decode: (value: unknown) => T): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let result: T, failure: Error | undefined;
      const transaction = this.transaction('readonly');
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? storageError(transaction.error));
      const request = requestData(transaction.objectStore(STORE));
      request.onerror = () => { failure = storageError(request.error); };
      request.onsuccess = () => {
        try { result = decode(request.result); }
        catch (error) { failure = storageError(error); transaction.abort(); }
      };
    });
  }
  list(): Promise<SaveRecord[]> {
    return this.read(store => store.getAll(), value => {
      if (!Array.isArray(value)) throw new Error('无法读取存档列表，原记录已保留。');
      // 不把无法解析的槽隐藏为空槽，否则随后导入可能覆盖未知格式。
      return value.map(entry => readRecord(entry)).sort((a, b) => a.slot - b.slot);
    });
  }
  load(slot: number): Promise<SaveRecord | null> {
    checkedSlot(slot);
    return this.read(store => store.get(slot), value => value === undefined ? null : readRecord(value, slot));
  }
  save(slot: number, state: GameState, expectedRevision: number | null): Promise<SaveRecord> {
    checkedSlot(slot);
    if (expectedRevision !== null) checkedRevision(expectedRevision);
    // 先验证并复制：等待事务期间玩家继续行动不会改变本次提交的数据。
    const snapshot = decodeSave({ project: SAVE_PROJECT, schemaVersion: SAVE_SCHEMA_VERSION, state });
    return new Promise<SaveRecord>((resolve, reject) => {
      let result: SaveRecord, failure: Error | undefined;
      const transaction = this.transaction('readwrite');
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(failure ?? storageError(transaction.error));
      const store = transaction.objectStore(STORE), request = store.get(slot);
      request.onerror = () => { failure = storageError(request.error); };
      request.onsuccess = () => {
        try {
          const current = request.result === undefined ? null : readRecord(request.result, slot);
          if ((current?.revision ?? null) !== expectedRevision) {
            throw new Error(expectedRevision === null
              ? '这个存档槽已有远征，请选择空槽。原存档未被覆盖。'
              : '存档已在其他页面更新，请重新读取后再保存。原存档未被覆盖。');
          }
          const revision = (current?.revision ?? 0) + 1;
          checkedRevision(revision);
          result = { slot, revision, savedAt: new Date().toISOString(), state: snapshot };
          const write = store.put(result);
          write.onerror = () => { failure = storageError(write.error); };
          // 不在 put.onsuccess 返回成功：配额或其他事务错误仍可能随后使写入回滚。
        } catch (error) { failure = storageError(error); transaction.abort(); }
      };
    });
  }
  remove(slot: number, expectedRevision: number): Promise<void> {
    checkedSlot(slot); checkedRevision(expectedRevision);
    return new Promise<void>((resolve, reject) => {
      let failure: Error | undefined;
      const transaction = this.transaction('readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(failure ?? storageError(transaction.error));
      const store = transaction.objectStore(STORE), request = store.get(slot);
      request.onerror = () => { failure = storageError(request.error); };
      request.onsuccess = () => {
        try {
          const current = request.result === undefined ? null : readRecord(request.result, slot);
          if (current?.revision !== expectedRevision) throw new Error('存档已改变，请重新读取并确认删除。原存档未被删除。');
          const removal = store.delete(slot);
          removal.onerror = () => { failure = storageError(removal.error); };
        } catch (error) { failure = storageError(error); transaction.abort(); }
      };
    });
  }
}

export function openStorage(): Promise<Storage> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('此浏览器未提供本地存档，请使用导出存档保留进度。'));
  return new Promise<Storage>((resolve, reject) => {
    let settled = false;
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(version.saveNamespace, 1); }
    catch (error) { reject(storageError(error)); return; }
    request.onupgradeneeded = () => {
      if (settled) { request.transaction?.abort(); return; }
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'slot' });
    };
    request.onerror = () => { if (!settled) { settled = true; reject(storageError(request.error)); } };
    request.onblocked = () => {
      if (!settled) {
        settled = true;
        reject(new Error('其他页面正占用存档数据库，请关闭旧游戏页面后重试。当前进度仍可导出。'));
      }
    };
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      settled = true;
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.close(); reject(new Error('存档数据库结构尚未支持，原数据库未被修改。')); return;
      }
      resolve(new IndexedStorage(request.result));
    };
  });
}
