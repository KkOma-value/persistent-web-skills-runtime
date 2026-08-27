import type { WebSkill } from "../shared/types";
import { urlMatchesPattern } from "../shared/url";

const DEFAULT_DB_NAME = "persistent-web-skills-runtime";
const CURRENT_STORE = "skills";
const VERSION_STORE = "skillVersions";

interface StoredSkillVersion extends WebSkill {
  versionKey: string;
}

export interface SkillStore {
  save(skill: WebSkill): Promise<WebSkill>;
  get(id: string): Promise<WebSkill | undefined>;
  list(): Promise<WebSkill[]>;
  findMatching(url: string, name?: string): Promise<WebSkill | undefined>;
  recordOutcome(id: string, success: boolean): Promise<WebSkill | undefined>;
  getVersions(id: string): Promise<WebSkill[]>;
  clear(): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export class SkillRegistry implements SkillStore {
  private dbPromise?: Promise<IDBDatabase>;

  constructor(private readonly dbName = DEFAULT_DB_NAME) {}

  async save(skill: WebSkill): Promise<WebSkill> {
    const db = await this.open();
    const transaction = db.transaction([CURRENT_STORE, VERSION_STORE], "readwrite");
    transaction.objectStore(CURRENT_STORE).put(structuredClone(skill));
    const version: StoredSkillVersion = {
      ...structuredClone(skill),
      versionKey: `${skill.id}@${skill.version}`,
    };
    transaction.objectStore(VERSION_STORE).put(version);
    await transactionComplete(transaction);
    return skill;
  }

  async get(id: string): Promise<WebSkill | undefined> {
    const db = await this.open();
    const transaction = db.transaction(CURRENT_STORE, "readonly");
    return requestResult(transaction.objectStore(CURRENT_STORE).get(id));
  }

  async list(): Promise<WebSkill[]> {
    const db = await this.open();
    const transaction = db.transaction(CURRENT_STORE, "readonly");
    const skills = await requestResult<WebSkill[]>(
      transaction.objectStore(CURRENT_STORE).getAll(),
    );
    return skills.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async findMatching(url: string, name?: string): Promise<WebSkill | undefined> {
    const parsed = new URL(url);
    const skills = await this.list();
    return skills
      .filter((skill) => skill.domain === parsed.hostname)
      .filter((skill) => !name || skill.name === name)
      .filter((skill) => urlMatchesPattern(url, skill.urlPattern))
      .sort((left, right) => {
        if (right.successRate !== left.successRate) {
          return right.successRate - left.successRate;
        }
        return right.version - left.version;
      })[0];
  }

  async recordOutcome(id: string, success: boolean): Promise<WebSkill | undefined> {
    const skill = await this.get(id);
    if (!skill) return undefined;

    const runCount = skill.runCount + 1;
    const successCount = skill.successCount + (success ? 1 : 0);
    const updated: WebSkill = {
      ...skill,
      runCount,
      successCount,
      successRate: successCount / runCount,
      lastVerifiedAt: success ? Date.now() : skill.lastVerifiedAt,
      updatedAt: Date.now(),
    };
    await this.save(updated);
    return updated;
  }

  async getVersions(id: string): Promise<WebSkill[]> {
    const db = await this.open();
    const transaction = db.transaction(VERSION_STORE, "readonly");
    const index = transaction.objectStore(VERSION_STORE).index("skillId");
    const rows = await requestResult<StoredSkillVersion[]>(index.getAll(id));
    return rows
      .map(({ versionKey: _versionKey, ...skill }) => skill)
      .sort((left, right) => left.version - right.version);
  }

  async clear(): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction([CURRENT_STORE, VERSION_STORE], "readwrite");
    transaction.objectStore(CURRENT_STORE).clear();
    transaction.objectStore(VERSION_STORE).clear();
    await transactionComplete(transaction);
  }

  close(): void {
    if (!this.dbPromise) return;
    void this.dbPromise.then((db) => db.close());
    this.dbPromise = undefined;
  }

  private open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(CURRENT_STORE)) {
          const store = db.createObjectStore(CURRENT_STORE, { keyPath: "id" });
          store.createIndex("domain", "domain");
          store.createIndex("name", "name");
          store.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(VERSION_STORE)) {
          const versions = db.createObjectStore(VERSION_STORE, {
            keyPath: "versionKey",
          });
          versions.createIndex("skillId", "id");
          versions.createIndex("version", "version");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("Unable to open the Skill Registry"));
      request.onblocked = () => reject(new Error("Skill Registry upgrade is blocked"));
    });
    return this.dbPromise;
  }
}

export class MemorySkillRegistry implements SkillStore {
  private readonly current = new Map<string, WebSkill>();
  private readonly versions = new Map<string, Map<number, WebSkill>>();

  async save(skill: WebSkill): Promise<WebSkill> {
    this.current.set(skill.id, structuredClone(skill));
    const versions = this.versions.get(skill.id) ?? new Map<number, WebSkill>();
    versions.set(skill.version, structuredClone(skill));
    this.versions.set(skill.id, versions);
    return skill;
  }

  async get(id: string): Promise<WebSkill | undefined> {
    const skill = this.current.get(id);
    return skill ? structuredClone(skill) : undefined;
  }

  async list(): Promise<WebSkill[]> {
    return [...this.current.values()]
      .map((skill) => structuredClone(skill))
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async findMatching(url: string, name?: string): Promise<WebSkill | undefined> {
    const parsed = new URL(url);
    return (await this.list())
      .filter((skill) => skill.domain === parsed.hostname)
      .filter((skill) => !name || skill.name === name)
      .filter((skill) => urlMatchesPattern(url, skill.urlPattern))
      .sort((left, right) => right.successRate - left.successRate)[0];
  }

  async recordOutcome(id: string, success: boolean): Promise<WebSkill | undefined> {
    const skill = await this.get(id);
    if (!skill) return undefined;
    const runCount = skill.runCount + 1;
    const successCount = skill.successCount + (success ? 1 : 0);
    const updated = {
      ...skill,
      runCount,
      successCount,
      successRate: successCount / runCount,
      updatedAt: Date.now(),
      lastVerifiedAt: success ? Date.now() : skill.lastVerifiedAt,
    };
    await this.save(updated);
    return updated;
  }

  async getVersions(id: string): Promise<WebSkill[]> {
    return [...(this.versions.get(id)?.values() ?? [])]
      .map((skill) => structuredClone(skill))
      .sort((left, right) => left.version - right.version);
  }

  async clear(): Promise<void> {
    this.current.clear();
    this.versions.clear();
  }
}
