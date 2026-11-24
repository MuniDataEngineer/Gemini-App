import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export const DATA_DIR = path.resolve(process.cwd(), 'data');
export const DB_PATH = path.join(DATA_DIR, 'finance.db');

export const DEFAULT_CATEGORIES = [
  'Rent',
  'Food',
  'Groceries',
  'Fuel',
  'Vehicle Maintenance',
  'Shopping',
  'Electricity',
  'Internet',
  'Medical',
  'Travel',
  'Family',
  'House Savings',
  'Emergency Savings',
  'Personal',
  'Other',
];

export function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derivedBuf = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derivedBuf.length) return false;
  return crypto.timingSafeEqual(keyBuf, derivedBuf);
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

let dbInstance: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!dbInstance) {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    dbInstance = new Database(DB_PATH);
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('foreign_keys = ON');
    initializeSchema(dbInstance);
  }
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === column);
}

export function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      display_name TEXT DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_token ON user_sessions(token_hash);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
  `);

  const bankTableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bank_accounts'`)
    .get();

  if (bankTableExists && !hasColumn(db, 'bank_accounts', 'user_id')) {
    // Migrate existing single-user schema cleanly to multi-user schema
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(`
        ALTER TABLE bank_accounts ADD COLUMN user_id INTEGER;
        ALTER TABLE income_transactions ADD COLUMN user_id INTEGER;
        ALTER TABLE expense_transactions ADD COLUMN user_id INTEGER;
        ALTER TABLE transaction_ledger ADD COLUMN user_id INTEGER;
        ALTER TABLE audit_logs ADD COLUMN user_id INTEGER;

        CREATE TABLE categories_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          is_default INTEGER NOT NULL DEFAULT 0,
          notes TEXT DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE(user_id, name)
        );
        INSERT INTO categories_new (id, user_id, name, is_default, notes, created_at)
        SELECT id, NULL, name, is_default, notes, created_at FROM categories;
        DROP TABLE categories;
        ALTER TABLE categories_new RENAME TO categories;

        CREATE TABLE app_settings_new (
          user_id INTEGER NOT NULL DEFAULT 0,
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (user_id, key)
        );
        INSERT INTO app_settings_new (user_id, key, value, updated_at)
        SELECT 0, key, value, updated_at FROM app_settings;
        DROP TABLE app_settings;
        ALTER TABLE app_settings_new RENAME TO app_settings;
      `);
    })();
    db.pragma('foreign_keys = ON');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      bank_name TEXT NOT NULL,
      nickname TEXT DEFAULT '',
      opening_balance REAL NOT NULL DEFAULT 0,
      current_balance REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE(user_id, name)
    );

    CREATE TABLE IF NOT EXISTS income_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tx_code TEXT NOT NULL,
      income_date TEXT NOT NULL,
      month TEXT NOT NULL,
      source TEXT NOT NULL,
      total_amount REAL NOT NULL,
      unallocated_amount REAL NOT NULL,
      bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS income_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      income_id INTEGER NOT NULL REFERENCES income_transactions(id) ON DELETE CASCADE,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      amount REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tx_code TEXT NOT NULL,
      expense_date TEXT NOT NULL,
      month TEXT NOT NULL,
      category_id INTEGER NOT NULL REFERENCES categories(id),
      subcategory TEXT DEFAULT '',
      amount REAL NOT NULL,
      bank_account_id INTEGER NOT NULL REFERENCES bank_accounts(id),
      description TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transaction_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      tx_type TEXT NOT NULL,
      ref_table TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      tx_code TEXT,
      tx_date TEXT NOT NULL,
      month TEXT NOT NULL,
      bank_account_id INTEGER,
      category_id INTEGER,
      amount REAL NOT NULL,
      direction TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      user_id INTEGER NOT NULL DEFAULT 0,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      tx_code TEXT,
      action TEXT NOT NULL,
      original_values TEXT NOT NULL,
      changed_values TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_banks_user ON bank_accounts(user_id);
    CREATE INDEX IF NOT EXISTS idx_categories_user ON categories(user_id);
    CREATE INDEX IF NOT EXISTS idx_income_user_month ON income_transactions(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_income_date ON income_transactions(income_date);
    CREATE INDEX IF NOT EXISTS idx_expense_user_month ON expense_transactions(user_id, month);
    CREATE INDEX IF NOT EXISTS idx_expense_date ON expense_transactions(expense_date);
    CREATE INDEX IF NOT EXISTS idx_expense_category ON expense_transactions(category_id);
    CREATE INDEX IF NOT EXISTS idx_alloc_income ON income_allocations(income_id);
    CREATE INDEX IF NOT EXISTS idx_alloc_category ON income_allocations(category_id);
    CREATE INDEX IF NOT EXISTS idx_ledger_user_date ON transaction_ledger(user_id, tx_date);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
  `);
}

export function seedDefaultCategoriesForUser(db: Database.Database, userId: number): void {
  const now = new Date().toISOString();
  const seeded = db
    .prepare(
      `SELECT value FROM app_settings WHERE user_id = ? AND key = 'default_categories_seeded'`
    )
    .get(userId) as { value: string } | undefined;

  if (!seeded) {
    const insertCategory = db.prepare(
      `INSERT OR IGNORE INTO categories (user_id, name, is_default, notes, created_at) VALUES (?, ?, 1, '', ?)`
    );
    for (const name of DEFAULT_CATEGORIES) {
      insertCategory.run(userId, name, now);
    }
    db.prepare(
      `INSERT OR REPLACE INTO app_settings (user_id, key, value, updated_at) VALUES (?, 'default_categories_seeded', 'true', ?)`
    ).run(userId, now);
  }
}

export function claimLegacyRowsForFirstUser(db: Database.Database, userId: number): void {
  const legacyCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM bank_accounts WHERE user_id IS NULL`).get() as {
      cnt: number;
    }
  ).cnt;
  const legacyCatCount = (
    db.prepare(`SELECT COUNT(*) as cnt FROM categories WHERE user_id IS NULL`).get() as {
      cnt: number;
    }
  ).cnt;

  if (legacyCount > 0 || legacyCatCount > 0) {
    db.prepare(`UPDATE bank_accounts SET user_id = ? WHERE user_id IS NULL`).run(userId);
    db.prepare(`UPDATE categories SET user_id = ? WHERE user_id IS NULL`).run(userId);
    db.prepare(`UPDATE income_transactions SET user_id = ? WHERE user_id IS NULL`).run(userId);
    db.prepare(`UPDATE expense_transactions SET user_id = ? WHERE user_id IS NULL`).run(userId);
    db.prepare(`UPDATE transaction_ledger SET user_id = ? WHERE user_id IS NULL`).run(userId);
    db.prepare(`UPDATE audit_logs SET user_id = ? WHERE user_id IS NULL`).run(userId);
    db.prepare(`UPDATE OR IGNORE app_settings SET user_id = ? WHERE user_id = 0`).run(userId);
  }
}

export function generateTxCode(
  db: Database.Database,
  userId: number,
  prefix: 'INC' | 'EXP'
): string {
  const table = prefix === 'INC' ? 'income_transactions' : 'expense_transactions';
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM ${table} WHERE user_id = ?`)
    .get(userId) as { cnt: number };
  let nextNum = row.cnt + 1;
  while (true) {
    const candidate = `${prefix}-${String(nextNum).padStart(4, '0')}`;
    const existing = db
      .prepare(`SELECT 1 FROM ${table} WHERE user_id = ? AND tx_code = ?`)
      .get(userId, candidate);
    if (!existing) {
      return candidate;
    }
    nextNum += 1;
  }
}

export interface CategorySummaryRow {
  id: number;
  name: string;
  is_default: number;
  notes: string;
  created_at: string;
  allocated_amount: number;
  spent_amount: number;
  remaining_balance: number;
}

export function getCategorySummaries(
  db: Database.Database,
  userId: number
): CategorySummaryRow[] {
  const rows = db
    .prepare(
      `
      SELECT
        c.id,
        c.name,
        c.is_default,
        COALESCE(c.notes, '') AS notes,
        c.created_at,
        COALESCE((SELECT SUM(ia.amount) FROM income_allocations ia WHERE ia.category_id = c.id), 0) AS allocated_amount,
        COALESCE((SELECT SUM(et.amount) FROM expense_transactions et WHERE et.category_id = c.id AND et.user_id = ?), 0) AS spent_amount
      FROM categories c
      WHERE c.user_id = ?
      ORDER BY c.is_default DESC, c.id ASC
    `
    )
    .all(userId, userId) as Array<{
    id: number;
    name: string;
    is_default: number;
    notes: string;
    created_at: string;
    allocated_amount: number;
    spent_amount: number;
  }>;

  return rows.map((r) => {
    const allocated = roundMoney(r.allocated_amount);
    const spent = roundMoney(r.spent_amount);
    return {
      ...r,
      allocated_amount: allocated,
      spent_amount: spent,
      remaining_balance: roundMoney(allocated - spent),
    };
  });
}

export function getCategoryBalance(
  db: Database.Database,
  userId: number,
  categoryId: number
): {
  id: number;
  name: string;
  allocated: number;
  spent: number;
  remaining: number;
} | null {
  const row = db
    .prepare(
      `
      SELECT
        c.id,
        c.name,
        COALESCE((SELECT SUM(ia.amount) FROM income_allocations ia WHERE ia.category_id = c.id), 0) AS allocated,
        COALESCE((SELECT SUM(et.amount) FROM expense_transactions et WHERE et.category_id = c.id AND et.user_id = ?), 0) AS spent
      FROM categories c
      WHERE c.id = ? AND c.user_id = ?
    `
    )
    .get(userId, categoryId, userId) as
    | { id: number; name: string; allocated: number; spent: number }
    | undefined;

  if (!row) return null;
  const allocated = roundMoney(row.allocated);
  const spent = roundMoney(row.spent);
  return {
    id: row.id,
    name: row.name,
    allocated,
    spent,
    remaining: roundMoney(allocated - spent),
  };
}
