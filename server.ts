import crypto from 'crypto';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createServer as createViteServer } from 'vite';
import {
  claimLegacyRowsForFirstUser,
  closeDb,
  DATA_DIR,
  DB_PATH,
  generateTxCode,
  getCategoryBalance,
  getCategorySummaries,
  getDb,
  hashPassword,
  hashToken,
  initializeSchema,
  roundMoney,
  seedDefaultCategoriesForUser,
  verifyPassword,
} from './server/db.ts';

const PORT = 3000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface AuthUserRecord {
  id: number;
  username: string;
  display_name: string;
  created_at: string;
}

interface AuthenticatedRequest extends Request {
  user?: AuthUserRecord;
  sessionTokenHash?: string;
}

function isValidDateStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

function isValidMonthStr(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}$/.test(v);
}

function parsePositiveAmount(v: unknown, label = 'Amount'): number {
  const num = Number(v);
  if (!Number.isFinite(num) || num <= 0) {
    throw new HttpError(400, `${label} must be a positive number.`);
  }
  return roundMoney(num);
}

function parseNonNegativeAmount(v: unknown, label = 'Amount'): number {
  const num = Number(v);
  if (!Number.isFinite(num) || num < 0) {
    throw new HttpError(400, `${label} must be zero or a positive number.`);
  }
  return roundMoney(num);
}

function csvEscape(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(amount);
}

function createSessionForUser(db: Database.Database, userId: number): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db.prepare(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
  ).run(userId, tokenHash, expiresAt, now.toISOString());
  return rawToken;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const rawToken = authHeader.slice(7).trim();
  if (!rawToken) {
    res.status(401).json({ error: 'Authentication required. Please sign in.' });
    return;
  }

  const db = getDb();
  const tokenHash = hashToken(rawToken);
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(
      `
      SELECT u.id, u.username, COALESCE(u.display_name, '') AS display_name, u.created_at, s.expires_at
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `
    )
    .get(tokenHash) as (AuthUserRecord & { expires_at: string }) | undefined;

  if (!row || row.expires_at <= nowIso) {
    if (row) {
      db.prepare(`DELETE FROM user_sessions WHERE token_hash = ?`).run(tokenHash);
    }
    res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
    return;
  }

  req.user = {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    created_at: row.created_at,
  };
  req.sessionTokenHash = tokenHash;
  next();
}

interface BankAccountRow {
  id: number;
  user_id: number;
  bank_name: string;
  nickname: string;
  opening_balance: number;
  current_balance: number;
  created_at: string;
  updated_at: string;
}

interface IncomeRow {
  id: number;
  user_id: number;
  tx_code: string;
  income_date: string;
  month: string;
  source: string;
  total_amount: number;
  unallocated_amount: number;
  bank_account_id: number;
  notes: string;
  created_at: string;
  updated_at: string;
}

interface ExpenseRow {
  id: number;
  user_id: number;
  tx_code: string;
  expense_date: string;
  month: string;
  category_id: number;
  subcategory: string;
  amount: number;
  bank_account_id: number;
  description: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

function getUnifiedTransactions(
  db: Database.Database,
  userId: number,
  filters: {
    type?: string;
    month?: string;
    startDate?: string;
    endDate?: string;
    bankId?: string;
    categoryId?: string;
    search?: string;
  }
) {
  const incomes = db
    .prepare(
      `
      SELECT
        i.*,
        b.bank_name,
        COALESCE(b.nickname, '') AS bank_nickname
      FROM income_transactions i
      JOIN bank_accounts b ON b.id = i.bank_account_id
      WHERE i.user_id = ?
      ORDER BY i.income_date DESC, i.id DESC
    `
    )
    .all(userId) as Array<IncomeRow & { bank_name: string; bank_nickname: string }>;

  const allocRows = db
    .prepare(
      `
      SELECT
        ia.income_id,
        ia.category_id,
        ia.amount,
        c.name AS category_name
      FROM income_allocations ia
      JOIN income_transactions i ON i.id = ia.income_id
      JOIN categories c ON c.id = ia.category_id
      WHERE i.user_id = ?
      ORDER BY ia.id ASC
    `
    )
    .all(userId) as Array<{
    income_id: number;
    category_id: number;
    amount: number;
    category_name: string;
  }>;

  const allocMap = new Map<
    number,
    Array<{ category_id: number; category_name: string; amount: number }>
  >();
  for (const row of allocRows) {
    const list = allocMap.get(row.income_id) ?? [];
    list.push({
      category_id: row.category_id,
      category_name: row.category_name,
      amount: roundMoney(row.amount),
    });
    allocMap.set(row.income_id, list);
  }

  const expenses = db
    .prepare(
      `
      SELECT
        e.*,
        b.bank_name,
        COALESCE(b.nickname, '') AS bank_nickname,
        c.name AS category_name
      FROM expense_transactions e
      JOIN bank_accounts b ON b.id = e.bank_account_id
      JOIN categories c ON c.id = e.category_id
      WHERE e.user_id = ?
      ORDER BY e.expense_date DESC, e.id DESC
    `
    )
    .all(userId) as Array<
    ExpenseRow & { bank_name: string; bank_nickname: string; category_name: string }
  >;

  const unified: Array<{
    uid: string;
    id: number;
    tx_type: 'income' | 'expense';
    tx_code: string;
    date: string;
    month: string;
    amount: number;
    bank_account_id: number;
    bank_name: string;
    bank_nickname: string;
    source?: string;
    unallocated_amount?: number;
    allocations?: Array<{ category_id: number; category_name: string; amount: number }>;
    category_id?: number;
    category_name?: string;
    subcategory?: string;
    description?: string;
    notes: string;
    created_at: string;
    updated_at: string;
  }> = [];

  for (const inc of incomes) {
    unified.push({
      uid: `income-${inc.id}`,
      id: inc.id,
      tx_type: 'income',
      tx_code: inc.tx_code,
      date: inc.income_date,
      month: inc.month,
      amount: roundMoney(inc.total_amount),
      bank_account_id: inc.bank_account_id,
      bank_name: inc.bank_name,
      bank_nickname: inc.bank_nickname,
      source: inc.source,
      unallocated_amount: roundMoney(inc.unallocated_amount),
      allocations: allocMap.get(inc.id) ?? [],
      notes: inc.notes || '',
      created_at: inc.created_at,
      updated_at: inc.updated_at,
    });
  }

  for (const exp of expenses) {
    unified.push({
      uid: `expense-${exp.id}`,
      id: exp.id,
      tx_type: 'expense',
      tx_code: exp.tx_code,
      date: exp.expense_date,
      month: exp.month,
      amount: roundMoney(exp.amount),
      bank_account_id: exp.bank_account_id,
      bank_name: exp.bank_name,
      bank_nickname: exp.bank_nickname,
      category_id: exp.category_id,
      category_name: exp.category_name,
      subcategory: exp.subcategory || '',
      description: exp.description,
      notes: exp.notes || '',
      created_at: exp.created_at,
      updated_at: exp.updated_at,
    });
  }

  unified.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return b.created_at.localeCompare(a.created_at);
  });

  const typeFilter = (filters.type || 'all').toLowerCase();
  const monthFilter = filters.month?.trim() || '';
  const startDate = filters.startDate?.trim() || '';
  const endDate = filters.endDate?.trim() || '';
  const bankIdNum = filters.bankId ? Number(filters.bankId) : 0;
  const catIdNum = filters.categoryId ? Number(filters.categoryId) : 0;
  const searchLower = (filters.search || '').trim().toLowerCase();

  return unified.filter((item) => {
    if (typeFilter === 'income' && item.tx_type !== 'income') return false;
    if (typeFilter === 'expense' && item.tx_type !== 'expense') return false;
    if (monthFilter && monthFilter !== 'all' && item.month !== monthFilter) return false;
    if (startDate && item.date < startDate) return false;
    if (endDate && item.date > endDate) return false;
    if (bankIdNum > 0 && item.bank_account_id !== bankIdNum) return false;
    if (catIdNum > 0) {
      if (item.tx_type === 'expense') {
        if (item.category_id !== catIdNum) return false;
      } else {
        const hasCat = (item.allocations ?? []).some((a) => a.category_id === catIdNum);
        if (!hasCat) return false;
      }
    }
    if (searchLower) {
      const haystacks = [
        item.tx_code,
        item.bank_name,
        item.bank_nickname,
        item.notes,
        item.source || '',
        item.description || '',
        item.category_name || '',
        item.subcategory || '',
        ...(item.allocations ?? []).map((a) => a.category_name),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystacks.includes(searchLower)) return false;
    }
    return true;
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  // Ensure DB initializes at startup
  getDb();

  // -------------------- Public Auth Endpoints --------------------
  app.get('/api/auth/status', (_req: Request, res: Response) => {
    const db = getDb();
    const row = db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number };
    const legacyRows = (
      db.prepare(`SELECT COUNT(*) as cnt FROM bank_accounts WHERE user_id IS NULL`).get() as {
        cnt: number;
      }
    ).cnt;
    res.json({
      hasUsers: row.cnt > 0,
      hasLegacyData: row.cnt === 0 && legacyRows > 0,
    });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rawUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
      const displayName =
        typeof req.body.display_name === 'string' ? req.body.display_name.trim() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';

      if (rawUsername.length < 3 || rawUsername.length > 32) {
        throw new HttpError(400, 'Username must be between 3 and 32 characters.');
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(rawUsername)) {
        throw new HttpError(
          400,
          'Username may only contain letters, numbers, dots, underscores, and hyphens.'
        );
      }
      if (password.length < 6 || password.length > 128) {
        throw new HttpError(400, 'Password must be at least 6 characters long.');
      }

      const existing = db
        .prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`)
        .get(rawUsername);
      if (existing) {
        throw new HttpError(409, `Username "${rawUsername}" is already taken.`);
      }

      const result = db.transaction(() => {
        const userCountBefore = (
          db.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number }
        ).cnt;

        const now = new Date().toISOString();
        const passwordHash = hashPassword(password);
        const ins = db
          .prepare(
            `INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)`
          )
          .run(rawUsername, displayName, passwordHash, now);
        const userId = Number(ins.lastInsertRowid);

        if (userCountBefore === 0) {
          claimLegacyRowsForFirstUser(db, userId);
        }
        seedDefaultCategoriesForUser(db, userId);

        const token = createSessionForUser(db, userId);
        const user = db
          .prepare(
            `SELECT id, username, COALESCE(display_name, '') AS display_name, created_at FROM users WHERE id = ?`
          )
          .get(userId) as AuthUserRecord;

        return { token, user };
      })();

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to register user account.' });
      }
    }
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const db = getDb();
      const rawUsername = typeof req.body.username === 'string' ? req.body.username.trim() : '';
      const password = typeof req.body.password === 'string' ? req.body.password : '';

      if (!rawUsername || !password) {
        throw new HttpError(400, 'Username and password are required.');
      }

      const userRow = db
        .prepare(
          `SELECT id, username, COALESCE(display_name, '') AS display_name, password_hash, created_at FROM users WHERE username = ? COLLATE NOCASE`
        )
        .get(rawUsername) as (AuthUserRecord & { password_hash: string }) | undefined;

      if (!userRow || !verifyPassword(password, userRow.password_hash)) {
        throw new HttpError(401, 'Invalid username or password.');
      }

      seedDefaultCategoriesForUser(db, userRow.id);
      const token = createSessionForUser(db, userRow.id);

      res.json({
        token,
        user: {
          id: userRow.id,
          username: userRow.username,
          display_name: userRow.display_name,
          created_at: userRow.created_at,
        },
      });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to sign in.' });
      }
    }
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    if (req.sessionTokenHash) {
      db.prepare(`DELETE FROM user_sessions WHERE token_hash = ?`).run(req.sessionTokenHash);
    }
    res.json({ success: true });
  });

  app.post('/api/auth/change-password', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const currentPassword =
        typeof req.body.current_password === 'string' ? req.body.current_password : '';
      const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';

      if (!currentPassword || !newPassword) {
        throw new HttpError(400, 'Current password and new password are required.');
      }
      if (newPassword.length < 6 || newPassword.length > 128) {
        throw new HttpError(400, 'New password must be at least 6 characters long.');
      }

      const userRow = db
        .prepare(`SELECT password_hash FROM users WHERE id = ?`)
        .get(userId) as { password_hash: string } | undefined;

      if (!userRow || !verifyPassword(currentPassword, userRow.password_hash)) {
        throw new HttpError(401, 'Current password is incorrect.');
      }

      const nextHash = hashPassword(newPassword);
      db.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(nextHash, userId);

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to update password.' });
      }
    }
  });

  // -------------------- Authenticated Finance Endpoints --------------------
  // Bootstrap endpoint
  app.get('/api/bootstrap', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;

    seedDefaultCategoriesForUser(db, userId);

    const bankAccounts = db
      .prepare(`SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY id ASC`)
      .all(userId) as BankAccountRow[];
    const categories = getCategorySummaries(db, userId);

    const incomeAgg = db
      .prepare(
        `
        SELECT
          COALESCE(SUM(total_amount), 0) AS totalIncome,
          COALESCE(SUM(unallocated_amount), 0) AS totalUnallocated
        FROM income_transactions
        WHERE user_id = ?
      `
      )
      .get(userId) as { totalIncome: number; totalUnallocated: number };

    const allocAgg = db
      .prepare(
        `
        SELECT COALESCE(SUM(ia.amount), 0) AS totalAllocated
        FROM income_allocations ia
        JOIN income_transactions i ON i.id = ia.income_id
        WHERE i.user_id = ?
      `
      )
      .get(userId) as { totalAllocated: number };

    const expAgg = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expense_transactions WHERE user_id = ?`
      )
      .get(userId) as { totalExpenses: number };

    const totalBankBalance = roundMoney(
      bankAccounts.reduce((acc, b) => acc + Number(b.current_balance || 0), 0)
    );

    const recentTransactions = getUnifiedTransactions(db, userId, {}).slice(0, 8);

    res.json({
      user: req.user,
      needsSetup: bankAccounts.length === 0,
      bankAccounts: bankAccounts.map((b) => ({
        ...b,
        opening_balance: roundMoney(b.opening_balance),
        current_balance: roundMoney(b.current_balance),
      })),
      categories,
      totals: {
        totalBankBalance,
        totalIncome: roundMoney(incomeAgg.totalIncome),
        totalAllocated: roundMoney(allocAgg.totalAllocated),
        totalUnallocated: roundMoney(incomeAgg.totalUnallocated),
        totalExpenses: roundMoney(expAgg.totalExpenses),
      },
      recentTransactions,
    });
  });

  // Bank Accounts
  app.post('/api/banks', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const bankName = typeof req.body.bank_name === 'string' ? req.body.bank_name.trim() : '';
      const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
      if (!bankName) {
        throw new HttpError(400, 'Bank name is required.');
      }
      const openingBalance = parseNonNegativeAmount(req.body.opening_balance, 'Opening balance');
      const now = new Date().toISOString();
      const today = now.slice(0, 10);
      const month = now.slice(0, 7);

      const created = db.transaction(() => {
        const result = db
          .prepare(
            `INSERT INTO bank_accounts (user_id, bank_name, nickname, opening_balance, current_balance, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(userId, bankName, nickname, openingBalance, openingBalance, now, now);

        const bankId = Number(result.lastInsertRowid);

        db.prepare(
          `INSERT INTO transaction_ledger (user_id, tx_type, ref_table, ref_id, tx_code, tx_date, month, bank_account_id, category_id, amount, direction, summary, created_at)
           VALUES (?, 'BANK_OPENING', 'bank_accounts', ?, ?, ?, ?, ?, NULL, ?, 'CREDIT', ?, ?)`
        ).run(
          userId,
          bankId,
          `BNK-${String(bankId).padStart(4, '0')}`,
          today,
          month,
          bankId,
          openingBalance,
          `Opening balance for ${bankName}${nickname ? ` (${nickname})` : ''}`,
          now
        );

        db.prepare(
          `INSERT OR REPLACE INTO app_settings (user_id, key, value, updated_at) VALUES (?, 'initial_setup_done', 'true', ?)`
        ).run(userId, now);

        return db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankId, userId);
      })();

      res.status(201).json({ bank: created });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to create bank account.' });
      }
    }
  });

  app.put('/api/banks/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const bankId = Number(req.params.id);
      if (!Number.isInteger(bankId) || bankId <= 0) {
        throw new HttpError(400, 'Invalid bank account ID.');
      }
      const bankName = typeof req.body.bank_name === 'string' ? req.body.bank_name.trim() : '';
      const nickname = typeof req.body.nickname === 'string' ? req.body.nickname.trim() : '';
      if (!bankName) {
        throw new HttpError(400, 'Bank name is required.');
      }

      const hasOpeningEdit = req.body.opening_balance !== undefined && req.body.opening_balance !== null;
      const requestedOpening = hasOpeningEdit
        ? parseNonNegativeAmount(req.body.opening_balance, 'Opening balance')
        : null;

      const updated = db.transaction(() => {
        const existing = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankId, userId) as BankAccountRow | undefined;
        if (!existing) {
          throw new HttpError(404, 'Bank account not found.');
        }

        const newOpening = requestedOpening !== null ? requestedOpening : roundMoney(existing.opening_balance);
        const delta = roundMoney(newOpening - existing.opening_balance);
        const newCurrent = roundMoney(existing.current_balance + delta);
        if (newCurrent < 0) {
          throw new HttpError(
            400,
            `Cannot reduce opening balance because current balance (${formatINR(existing.current_balance)}) would become negative.`
          );
        }

        const now = new Date().toISOString();
        db.prepare(
          `UPDATE bank_accounts SET bank_name = ?, nickname = ?, opening_balance = ?, current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).run(bankName, nickname, newOpening, newCurrent, now, bankId, userId);

        const nextRow = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankId, userId);

        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'BANK_ACCOUNT', ?, ?, 'EDIT', ?, ?, ?)`
        ).run(
          userId,
          bankId,
          `BNK-${String(bankId).padStart(4, '0')}`,
          JSON.stringify(existing),
          JSON.stringify(nextRow),
          now
        );

        return nextRow;
      })();

      res.json({ bank: updated });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to update bank account.' });
      }
    }
  });

  app.delete('/api/banks/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const bankId = Number(req.params.id);
      if (!Number.isInteger(bankId) || bankId <= 0) {
        throw new HttpError(400, 'Invalid bank account ID.');
      }

      db.transaction(() => {
        const existing = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankId, userId) as BankAccountRow | undefined;
        if (!existing) {
          throw new HttpError(404, 'Bank account not found.');
        }

        const totalBanks = (
          db
            .prepare(`SELECT COUNT(*) as cnt FROM bank_accounts WHERE user_id = ?`)
            .get(userId) as { cnt: number }
        ).cnt;
        if (totalBanks <= 1) {
          throw new HttpError(400, 'At least one bank account must remain configured.');
        }

        const incCount = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM income_transactions WHERE bank_account_id = ? AND user_id = ?`
            )
            .get(bankId, userId) as { cnt: number }
        ).cnt;
        const expCount = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM expense_transactions WHERE bank_account_id = ? AND user_id = ?`
            )
            .get(bankId, userId) as { cnt: number }
        ).cnt;

        if (incCount > 0 || expCount > 0) {
          throw new HttpError(
            400,
            'Cannot delete a bank account with existing income or expense transactions. Edit or remove its transactions first.'
          );
        }

        const now = new Date().toISOString();
        db.prepare(
          `DELETE FROM transaction_ledger WHERE ref_table = 'bank_accounts' AND ref_id = ? AND user_id = ?`
        ).run(bankId, userId);
        db.prepare(`DELETE FROM bank_accounts WHERE id = ? AND user_id = ?`).run(bankId, userId);
        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'BANK_ACCOUNT', ?, ?, 'DELETE', ?, NULL, ?)`
        ).run(
          userId,
          bankId,
          `BNK-${String(bankId).padStart(4, '0')}`,
          JSON.stringify(existing),
          now
        );
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to delete bank account.' });
      }
    }
  });

  // Categories
  app.get('/api/categories', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    res.json({ categories: getCategorySummaries(db, req.user!.id) });
  });

  app.get('/api/categories/:id/history', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;
    const categoryId = Number(req.params.id);
    if (!Number.isInteger(categoryId) || categoryId <= 0) {
      res.status(400).json({ error: 'Invalid category ID.' });
      return;
    }

    const summary = getCategoryBalance(db, userId, categoryId);
    if (!summary) {
      res.status(404).json({ error: 'Category not found.' });
      return;
    }

    const allocations = db
      .prepare(
        `
        SELECT ia.id, ia.amount, i.id AS income_id, i.tx_code, i.income_date, i.month, i.source, b.bank_name
        FROM income_allocations ia
        JOIN income_transactions i ON i.id = ia.income_id
        JOIN bank_accounts b ON b.id = i.bank_account_id
        WHERE ia.category_id = ? AND i.user_id = ?
        ORDER BY i.income_date DESC, i.id DESC
      `
      )
      .all(categoryId, userId);

    const expenses = db
      .prepare(
        `
        SELECT e.*, b.bank_name
        FROM expense_transactions e
        JOIN bank_accounts b ON b.id = e.bank_account_id
        WHERE e.category_id = ? AND e.user_id = ?
        ORDER BY e.expense_date DESC, e.id DESC
      `
      )
      .all(categoryId, userId);

    res.json({ category: summary, allocations, expenses });
  });

  app.post('/api/categories', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
      if (!name) {
        throw new HttpError(400, 'Category name is required.');
      }

      const duplicate = db
        .prepare(`SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?)`)
        .get(userId, name);
      if (duplicate) {
        throw new HttpError(409, `Category "${name}" already exists.`);
      }

      const now = new Date().toISOString();
      const result = db
        .prepare(
          `INSERT INTO categories (user_id, name, is_default, notes, created_at) VALUES (?, ?, 0, ?, ?)`
        )
        .run(userId, name, notes, now);

      const created = getCategoryBalance(db, userId, Number(result.lastInsertRowid));
      res.status(201).json({ category: created });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to create category.' });
      }
    }
  });

  app.put('/api/categories/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const categoryId = Number(req.params.id);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        throw new HttpError(400, 'Invalid category ID.');
      }
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';
      if (!name) {
        throw new HttpError(400, 'Category name is required.');
      }

      const existing = db
        .prepare(`SELECT * FROM categories WHERE id = ? AND user_id = ?`)
        .get(categoryId, userId) as
        | { id: number; user_id: number; name: string; is_default: number; notes: string; created_at: string }
        | undefined;
      if (!existing) {
        throw new HttpError(404, 'Category not found.');
      }

      const duplicate = db
        .prepare(`SELECT id FROM categories WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id != ?`)
        .get(userId, name, categoryId);
      if (duplicate) {
        throw new HttpError(409, `Another category named "${name}" already exists.`);
      }

      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare(`UPDATE categories SET name = ?, notes = ? WHERE id = ? AND user_id = ?`).run(
          name,
          notes,
          categoryId,
          userId
        );
        const updated = db
          .prepare(`SELECT * FROM categories WHERE id = ? AND user_id = ?`)
          .get(categoryId, userId);
        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'CATEGORY', ?, ?, 'EDIT', ?, ?, ?)`
        ).run(
          userId,
          categoryId,
          `CAT-${String(categoryId).padStart(3, '0')}`,
          JSON.stringify(existing),
          JSON.stringify(updated),
          now
        );
      })();

      res.json({ category: getCategoryBalance(db, userId, categoryId) });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to update category.' });
      }
    }
  });

  app.delete('/api/categories/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const categoryId = Number(req.params.id);
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        throw new HttpError(400, 'Invalid category ID.');
      }

      db.transaction(() => {
        const existing = db
          .prepare(`SELECT * FROM categories WHERE id = ? AND user_id = ?`)
          .get(categoryId, userId);
        if (!existing) {
          throw new HttpError(404, 'Category not found.');
        }

        const allocCount = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM income_allocations ia JOIN income_transactions i ON i.id = ia.income_id WHERE ia.category_id = ? AND i.user_id = ?`
            )
            .get(categoryId, userId) as { cnt: number }
        ).cnt;
        const expCount = (
          db
            .prepare(
              `SELECT COUNT(*) as cnt FROM expense_transactions WHERE category_id = ? AND user_id = ?`
            )
            .get(categoryId, userId) as { cnt: number }
        ).cnt;

        if (allocCount > 0 || expCount > 0) {
          throw new HttpError(
            400,
            'Cannot delete a category that has historical income allocations or expenses.'
          );
        }

        const now = new Date().toISOString();
        db.prepare(`DELETE FROM categories WHERE id = ? AND user_id = ?`).run(categoryId, userId);
        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'CATEGORY', ?, ?, 'DELETE', ?, NULL, ?)`
        ).run(
          userId,
          categoryId,
          `CAT-${String(categoryId).padStart(3, '0')}`,
          JSON.stringify(existing),
          now
        );
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to delete category.' });
      }
    }
  });

  // Add Money (Income + Allocations)
  app.post('/api/income', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const incomeDate = req.body.income_date;
      const month = req.body.month;
      const source = typeof req.body.source === 'string' ? req.body.source.trim() : '';
      const bankAccountId = Number(req.body.bank_account_id);
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

      if (!isValidDateStr(incomeDate)) {
        throw new HttpError(400, 'Income date must be in YYYY-MM-DD format.');
      }
      if (!isValidMonthStr(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }
      if (!source) {
        throw new HttpError(400, 'Income source is required.');
      }
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) {
        throw new HttpError(400, 'Please select a valid receiving bank account.');
      }
      const totalAmount = parsePositiveAmount(req.body.total_amount, 'Total income amount');

      const rawAllocs = Array.isArray(req.body.allocations) ? req.body.allocations : [];
      const allocByCategory = new Map<number, number>();
      for (const item of rawAllocs) {
        const catId = Number(item?.category_id);
        const amt = parseNonNegativeAmount(item?.amount ?? 0, 'Category allocation');
        if (amt === 0) continue;
        if (!Number.isInteger(catId) || catId <= 0) {
          throw new HttpError(400, 'Invalid category selected in allocations.');
        }
        allocByCategory.set(catId, roundMoney((allocByCategory.get(catId) ?? 0) + amt));
      }

      let allocatedTotal = 0;
      for (const amt of allocByCategory.values()) {
        allocatedTotal = roundMoney(allocatedTotal + amt);
      }

      if (allocatedTotal > totalAmount) {
        throw new HttpError(
          400,
          `Total allocations (${formatINR(allocatedTotal)}) cannot exceed income amount (${formatINR(totalAmount)}).`
        );
      }

      const unallocatedAmount = roundMoney(totalAmount - allocatedTotal);

      const created = db.transaction(() => {
        const bank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankAccountId, userId) as BankAccountRow | undefined;
        if (!bank) {
          throw new HttpError(404, 'Selected bank account does not exist.');
        }

        for (const catId of allocByCategory.keys()) {
          const cat = db
            .prepare(`SELECT id FROM categories WHERE id = ? AND user_id = ?`)
            .get(catId, userId);
          if (!cat) {
            throw new HttpError(404, 'One or more allocated categories do not exist.');
          }
        }

        const now = new Date().toISOString();
        const txCode = generateTxCode(db, userId, 'INC');

        const incRes = db
          .prepare(
            `INSERT INTO income_transactions (user_id, tx_code, income_date, month, source, total_amount, unallocated_amount, bank_account_id, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            userId,
            txCode,
            incomeDate,
            month,
            source,
            totalAmount,
            unallocatedAmount,
            bankAccountId,
            notes,
            now,
            now
          );

        const incomeId = Number(incRes.lastInsertRowid);

        const insertAlloc = db.prepare(
          `INSERT INTO income_allocations (income_id, category_id, amount, created_at) VALUES (?, ?, ?, ?)`
        );
        const insertLedger = db.prepare(
          `INSERT INTO transaction_ledger (user_id, tx_type, ref_table, ref_id, tx_code, tx_date, month, bank_account_id, category_id, amount, direction, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        insertLedger.run(
          userId,
          'INCOME',
          'income_transactions',
          incomeId,
          txCode,
          incomeDate,
          month,
          bankAccountId,
          null,
          totalAmount,
          'CREDIT',
          `${source} received in ${bank.bank_name}`,
          now
        );

        for (const [catId, amt] of allocByCategory.entries()) {
          insertAlloc.run(incomeId, catId, amt, now);
          const catRow = db
            .prepare(`SELECT name FROM categories WHERE id = ? AND user_id = ?`)
            .get(catId, userId) as {
            name: string;
          };
          insertLedger.run(
            userId,
            'ALLOCATION',
            'income_transactions',
            incomeId,
            txCode,
            incomeDate,
            month,
            bankAccountId,
            catId,
            amt,
            'INFO',
            `Allocated ${formatINR(amt)} to ${catRow.name} from ${txCode}`,
            now
          );
        }

        const nextBankBalance = roundMoney(bank.current_balance + totalAmount);
        db.prepare(
          `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).run(nextBankBalance, now, bankAccountId, userId);

        return { id: incomeId, tx_code: txCode };
      })();

      res.status(201).json({ income: created });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to save income transaction.' });
      }
    }
  });

  app.put('/api/income/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const incomeId = Number(req.params.id);
      if (!Number.isInteger(incomeId) || incomeId <= 0) {
        throw new HttpError(400, 'Invalid income ID.');
      }

      const incomeDate = req.body.income_date;
      const month = req.body.month;
      const source = typeof req.body.source === 'string' ? req.body.source.trim() : '';
      const bankAccountId = Number(req.body.bank_account_id);
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

      if (!isValidDateStr(incomeDate)) {
        throw new HttpError(400, 'Income date must be in YYYY-MM-DD format.');
      }
      if (!isValidMonthStr(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }
      if (!source) {
        throw new HttpError(400, 'Income source is required.');
      }
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) {
        throw new HttpError(400, 'Please select a valid receiving bank account.');
      }
      const newTotalAmount = parsePositiveAmount(req.body.total_amount, 'Total income amount');

      const rawAllocs = Array.isArray(req.body.allocations) ? req.body.allocations : [];
      const newAllocMap = new Map<number, number>();
      for (const item of rawAllocs) {
        const catId = Number(item?.category_id);
        const amt = parseNonNegativeAmount(item?.amount ?? 0, 'Category allocation');
        if (amt === 0) continue;
        if (!Number.isInteger(catId) || catId <= 0) {
          throw new HttpError(400, 'Invalid category selected in allocations.');
        }
        newAllocMap.set(catId, roundMoney((newAllocMap.get(catId) ?? 0) + amt));
      }

      let newAllocatedTotal = 0;
      for (const amt of newAllocMap.values()) {
        newAllocatedTotal = roundMoney(newAllocatedTotal + amt);
      }

      if (newAllocatedTotal > newTotalAmount) {
        throw new HttpError(
          400,
          `Total allocations (${formatINR(newAllocatedTotal)}) cannot exceed income amount (${formatINR(newTotalAmount)}).`
        );
      }

      const newUnallocated = roundMoney(newTotalAmount - newAllocatedTotal);

      db.transaction(() => {
        const oldIncome = db
          .prepare(`SELECT * FROM income_transactions WHERE id = ? AND user_id = ?`)
          .get(incomeId, userId) as IncomeRow | undefined;
        if (!oldIncome) {
          throw new HttpError(404, 'Income transaction not found.');
        }

        const oldAllocs = db
          .prepare(`SELECT category_id, amount FROM income_allocations WHERE income_id = ?`)
          .all(incomeId) as Array<{ category_id: number; amount: number }>;

        const oldBank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(oldIncome.bank_account_id, userId) as BankAccountRow;
        const newBank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankAccountId, userId) as BankAccountRow | undefined;
        if (!newBank) {
          throw new HttpError(404, 'Selected receiving bank account not found.');
        }

        if (oldIncome.bank_account_id === bankAccountId) {
          const resultingBal = roundMoney(
            oldBank.current_balance - oldIncome.total_amount + newTotalAmount
          );
          if (resultingBal < 0) {
            throw new HttpError(
              400,
              `Cannot reduce income below funds already spent from ${oldBank.bank_name}.`
            );
          }
        } else {
          const oldBankAfterReversal = roundMoney(oldBank.current_balance - oldIncome.total_amount);
          if (oldBankAfterReversal < 0) {
            throw new HttpError(
              400,
              `Cannot move income away from ${oldBank.bank_name} because ${formatINR(oldIncome.total_amount)} reversal would leave negative balance.`
            );
          }
        }

        const oldAllocMap = new Map<number, number>();
        for (const a of oldAllocs) {
          oldAllocMap.set(a.category_id, roundMoney((oldAllocMap.get(a.category_id) ?? 0) + a.amount));
        }

        const affectedCategoryIds = new Set<number>([
          ...oldAllocMap.keys(),
          ...newAllocMap.keys(),
        ]);

        for (const catId of affectedCategoryIds) {
          const catBal = getCategoryBalance(db, userId, catId);
          if (!catBal) {
            throw new HttpError(404, 'One or more categories no longer exist.');
          }
          const oldAmt = oldAllocMap.get(catId) ?? 0;
          const newAmt = newAllocMap.get(catId) ?? 0;
          const newAllocatedForCat = roundMoney(catBal.allocated - oldAmt + newAmt);
          if (newAllocatedForCat < catBal.spent) {
            throw new HttpError(
              400,
              `Cannot reduce "${catBal.name}" allocation to ${formatINR(newAllocatedForCat)} because ${formatINR(catBal.spent)} has already been spent.`
            );
          }
        }

        const now = new Date().toISOString();

        if (oldIncome.bank_account_id === bankAccountId) {
          const nextBal = roundMoney(
            oldBank.current_balance - oldIncome.total_amount + newTotalAmount
          );
          db.prepare(
            `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          ).run(nextBal, now, bankAccountId, userId);
        } else {
          db.prepare(
            `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          ).run(
            roundMoney(oldBank.current_balance - oldIncome.total_amount),
            now,
            oldIncome.bank_account_id,
            userId
          );
          db.prepare(
            `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          ).run(roundMoney(newBank.current_balance + newTotalAmount), now, bankAccountId, userId);
        }

        db.prepare(`DELETE FROM income_allocations WHERE income_id = ?`).run(incomeId);
        db.prepare(
          `UPDATE income_transactions
           SET income_date = ?, month = ?, source = ?, total_amount = ?, unallocated_amount = ?, bank_account_id = ?, notes = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        ).run(
          incomeDate,
          month,
          source,
          newTotalAmount,
          newUnallocated,
          bankAccountId,
          notes,
          now,
          incomeId,
          userId
        );

        const insertAlloc = db.prepare(
          `INSERT INTO income_allocations (income_id, category_id, amount, created_at) VALUES (?, ?, ?, ?)`
        );
        for (const [catId, amt] of newAllocMap.entries()) {
          insertAlloc.run(incomeId, catId, amt, now);
        }

        db.prepare(
          `DELETE FROM transaction_ledger WHERE ref_table = 'income_transactions' AND ref_id = ? AND user_id = ?`
        ).run(incomeId, userId);
        const insertLedger = db.prepare(
          `INSERT INTO transaction_ledger (user_id, tx_type, ref_table, ref_id, tx_code, tx_date, month, bank_account_id, category_id, amount, direction, summary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        insertLedger.run(
          userId,
          'INCOME',
          'income_transactions',
          incomeId,
          oldIncome.tx_code,
          incomeDate,
          month,
          bankAccountId,
          null,
          newTotalAmount,
          'CREDIT',
          `${source} received in ${newBank.bank_name}`,
          now
        );
        for (const [catId, amt] of newAllocMap.entries()) {
          const catRow = db
            .prepare(`SELECT name FROM categories WHERE id = ? AND user_id = ?`)
            .get(catId, userId) as {
            name: string;
          };
          insertLedger.run(
            userId,
            'ALLOCATION',
            'income_transactions',
            incomeId,
            oldIncome.tx_code,
            incomeDate,
            month,
            bankAccountId,
            catId,
            amt,
            'INFO',
            `Allocated ${formatINR(amt)} to ${catRow.name} from ${oldIncome.tx_code}`,
            now
          );
        }

        const updatedIncome = db
          .prepare(`SELECT * FROM income_transactions WHERE id = ? AND user_id = ?`)
          .get(incomeId, userId);
        const updatedAllocs = db
          .prepare(`SELECT category_id, amount FROM income_allocations WHERE income_id = ?`)
          .all(incomeId);

        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'INCOME', ?, ?, 'EDIT', ?, ?, ?)`
        ).run(
          userId,
          incomeId,
          oldIncome.tx_code,
          JSON.stringify({ ...oldIncome, allocations: oldAllocs }),
          JSON.stringify({ ...(updatedIncome as object), allocations: updatedAllocs }),
          now
        );
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to update income transaction.' });
      }
    }
  });

  app.delete('/api/income/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const incomeId = Number(req.params.id);
      if (!Number.isInteger(incomeId) || incomeId <= 0) {
        throw new HttpError(400, 'Invalid income ID.');
      }

      db.transaction(() => {
        const oldIncome = db
          .prepare(`SELECT * FROM income_transactions WHERE id = ? AND user_id = ?`)
          .get(incomeId, userId) as IncomeRow | undefined;
        if (!oldIncome) {
          throw new HttpError(404, 'Income transaction not found.');
        }

        const oldAllocs = db
          .prepare(`SELECT category_id, amount FROM income_allocations WHERE income_id = ?`)
          .all(incomeId) as Array<{ category_id: number; amount: number }>;

        const bank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(oldIncome.bank_account_id, userId) as BankAccountRow;

        const nextBankBal = roundMoney(bank.current_balance - oldIncome.total_amount);
        if (nextBankBal < 0) {
          throw new HttpError(
            400,
            `Cannot delete ${oldIncome.tx_code} because ${bank.bank_name} balance would become negative (${formatINR(nextBankBal)}). Delete or edit dependent expenses first.`
          );
        }

        for (const alloc of oldAllocs) {
          const catBal = getCategoryBalance(db, userId, alloc.category_id);
          if (catBal && roundMoney(catBal.allocated - alloc.amount) < catBal.spent) {
            throw new HttpError(
              400,
              `Cannot delete ${oldIncome.tx_code} because category "${catBal.name}" has ${formatINR(catBal.spent)} in expenses relying on this allocation.`
            );
          }
        }

        const now = new Date().toISOString();
        db.prepare(
          `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).run(nextBankBal, now, oldIncome.bank_account_id, userId);

        db.prepare(
          `DELETE FROM transaction_ledger WHERE ref_table = 'income_transactions' AND ref_id = ? AND user_id = ?`
        ).run(incomeId, userId);
        db.prepare(`DELETE FROM income_allocations WHERE income_id = ?`).run(incomeId);
        db.prepare(`DELETE FROM income_transactions WHERE id = ? AND user_id = ?`).run(
          incomeId,
          userId
        );

        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'INCOME', ?, ?, 'DELETE', ?, NULL, ?)`
        ).run(
          userId,
          incomeId,
          oldIncome.tx_code,
          JSON.stringify({ ...oldIncome, allocations: oldAllocs }),
          now
        );
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to delete income transaction.' });
      }
    }
  });

  // Add Expense
  app.post('/api/expenses', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const expenseDate = req.body.expense_date;
      const month =
        typeof req.body.month === 'string' && isValidMonthStr(req.body.month)
          ? req.body.month
          : isValidDateStr(expenseDate)
          ? expenseDate.slice(0, 7)
          : '';
      const categoryId = Number(req.body.category_id);
      const subcategory = typeof req.body.subcategory === 'string' ? req.body.subcategory.trim() : '';
      const bankAccountId = Number(req.body.bank_account_id);
      const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

      if (!isValidDateStr(expenseDate)) {
        throw new HttpError(400, 'Expense date must be in YYYY-MM-DD format.');
      }
      if (!isValidMonthStr(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        throw new HttpError(400, 'Please select a valid category.');
      }
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) {
        throw new HttpError(400, 'Please select a valid bank account.');
      }
      if (!description) {
        throw new HttpError(400, 'Expense description is required.');
      }
      const amount = parsePositiveAmount(req.body.amount, 'Expense amount');

      const created = db.transaction(() => {
        const bank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankAccountId, userId) as BankAccountRow | undefined;
        if (!bank) {
          throw new HttpError(404, 'Selected bank account not found.');
        }

        const catBalance = getCategoryBalance(db, userId, categoryId);
        if (!catBalance) {
          throw new HttpError(404, 'Selected category not found.');
        }

        if (catBalance.remaining < amount) {
          throw new HttpError(
            400,
            `Insufficient category balance in "${catBalance.name}". Available: ${formatINR(catBalance.remaining)}, Expense: ${formatINR(amount)}.`
          );
        }

        if (bank.current_balance < amount) {
          throw new HttpError(
            400,
            `Insufficient bank balance in "${bank.bank_name}". Available: ${formatINR(bank.current_balance)}, Expense: ${formatINR(amount)}.`
          );
        }

        const now = new Date().toISOString();
        const txCode = generateTxCode(db, userId, 'EXP');

        const expRes = db
          .prepare(
            `INSERT INTO expense_transactions (user_id, tx_code, expense_date, month, category_id, subcategory, amount, bank_account_id, description, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            userId,
            txCode,
            expenseDate,
            month,
            categoryId,
            subcategory,
            amount,
            bankAccountId,
            description,
            notes,
            now,
            now
          );

        const expenseId = Number(expRes.lastInsertRowid);
        const nextBankBal = roundMoney(bank.current_balance - amount);

        db.prepare(
          `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).run(nextBankBal, now, bankAccountId, userId);

        db.prepare(
          `INSERT INTO transaction_ledger (user_id, tx_type, ref_table, ref_id, tx_code, tx_date, month, bank_account_id, category_id, amount, direction, summary, created_at)
           VALUES (?, 'EXPENSE', 'expense_transactions', ?, ?, ?, ?, ?, ?, ?, 'DEBIT', ?, ?)`
        ).run(
          userId,
          expenseId,
          txCode,
          expenseDate,
          month,
          bankAccountId,
          categoryId,
          amount,
          `${catBalance.name}: ${description} (${bank.bank_name})`,
          now
        );

        return { id: expenseId, tx_code: txCode };
      })();

      res.status(201).json({ expense: created });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to record expense.' });
      }
    }
  });

  app.put('/api/expenses/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const expenseId = Number(req.params.id);
      if (!Number.isInteger(expenseId) || expenseId <= 0) {
        throw new HttpError(400, 'Invalid expense ID.');
      }

      const expenseDate = req.body.expense_date;
      const month =
        typeof req.body.month === 'string' && isValidMonthStr(req.body.month)
          ? req.body.month
          : isValidDateStr(expenseDate)
          ? expenseDate.slice(0, 7)
          : '';
      const categoryId = Number(req.body.category_id);
      const subcategory = typeof req.body.subcategory === 'string' ? req.body.subcategory.trim() : '';
      const bankAccountId = Number(req.body.bank_account_id);
      const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
      const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() : '';

      if (!isValidDateStr(expenseDate)) {
        throw new HttpError(400, 'Expense date must be in YYYY-MM-DD format.');
      }
      if (!isValidMonthStr(month)) {
        throw new HttpError(400, 'Month must be in YYYY-MM format.');
      }
      if (!Number.isInteger(categoryId) || categoryId <= 0) {
        throw new HttpError(400, 'Please select a valid category.');
      }
      if (!Number.isInteger(bankAccountId) || bankAccountId <= 0) {
        throw new HttpError(400, 'Please select a valid bank account.');
      }
      if (!description) {
        throw new HttpError(400, 'Expense description is required.');
      }
      const newAmount = parsePositiveAmount(req.body.amount, 'Expense amount');

      db.transaction(() => {
        const oldExpense = db
          .prepare(`SELECT * FROM expense_transactions WHERE id = ? AND user_id = ?`)
          .get(expenseId, userId) as ExpenseRow | undefined;
        if (!oldExpense) {
          throw new HttpError(404, 'Expense transaction not found.');
        }

        const oldBank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(oldExpense.bank_account_id, userId) as BankAccountRow;
        const newBank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(bankAccountId, userId) as BankAccountRow | undefined;
        if (!newBank) {
          throw new HttpError(404, 'Selected bank account not found.');
        }

        const catBalance = getCategoryBalance(db, userId, categoryId);
        if (!catBalance) {
          throw new HttpError(404, 'Selected category not found.');
        }

        const effectiveCatRemaining =
          oldExpense.category_id === categoryId
            ? roundMoney(catBalance.remaining + oldExpense.amount)
            : catBalance.remaining;

        if (effectiveCatRemaining < newAmount) {
          throw new HttpError(
            400,
            `Insufficient category balance in "${catBalance.name}". Available: ${formatINR(effectiveCatRemaining)}, Required: ${formatINR(newAmount)}.`
          );
        }

        const effectiveBankBalance =
          oldExpense.bank_account_id === bankAccountId
            ? roundMoney(oldBank.current_balance + oldExpense.amount)
            : newBank.current_balance;

        if (effectiveBankBalance < newAmount) {
          throw new HttpError(
            400,
            `Insufficient bank balance in "${newBank.bank_name}". Available: ${formatINR(effectiveBankBalance)}, Required: ${formatINR(newAmount)}.`
          );
        }

        const now = new Date().toISOString();

        if (oldExpense.bank_account_id === bankAccountId) {
          const nextBal = roundMoney(oldBank.current_balance + oldExpense.amount - newAmount);
          db.prepare(
            `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          ).run(nextBal, now, bankAccountId, userId);
        } else {
          db.prepare(
            `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          ).run(
            roundMoney(oldBank.current_balance + oldExpense.amount),
            now,
            oldExpense.bank_account_id,
            userId
          );
          db.prepare(
            `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
          ).run(roundMoney(newBank.current_balance - newAmount), now, bankAccountId, userId);
        }

        db.prepare(
          `UPDATE expense_transactions
           SET expense_date = ?, month = ?, category_id = ?, subcategory = ?, amount = ?, bank_account_id = ?, description = ?, notes = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        ).run(
          expenseDate,
          month,
          categoryId,
          subcategory,
          newAmount,
          bankAccountId,
          description,
          notes,
          now,
          expenseId,
          userId
        );

        db.prepare(
          `DELETE FROM transaction_ledger WHERE ref_table = 'expense_transactions' AND ref_id = ? AND user_id = ?`
        ).run(expenseId, userId);
        db.prepare(
          `INSERT INTO transaction_ledger (user_id, tx_type, ref_table, ref_id, tx_code, tx_date, month, bank_account_id, category_id, amount, direction, summary, created_at)
           VALUES (?, 'EXPENSE', 'expense_transactions', ?, ?, ?, ?, ?, ?, ?, 'DEBIT', ?, ?)`
        ).run(
          userId,
          expenseId,
          oldExpense.tx_code,
          expenseDate,
          month,
          bankAccountId,
          categoryId,
          newAmount,
          `${catBalance.name}: ${description} (${newBank.bank_name})`,
          now
        );

        const updatedExpense = db
          .prepare(`SELECT * FROM expense_transactions WHERE id = ? AND user_id = ?`)
          .get(expenseId, userId);

        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'EXPENSE', ?, ?, 'EDIT', ?, ?, ?)`
        ).run(
          userId,
          expenseId,
          oldExpense.tx_code,
          JSON.stringify(oldExpense),
          JSON.stringify(updatedExpense),
          now
        );
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to update expense transaction.' });
      }
    }
  });

  app.delete('/api/expenses/:id', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const expenseId = Number(req.params.id);
      if (!Number.isInteger(expenseId) || expenseId <= 0) {
        throw new HttpError(400, 'Invalid expense ID.');
      }

      db.transaction(() => {
        const oldExpense = db
          .prepare(`SELECT * FROM expense_transactions WHERE id = ? AND user_id = ?`)
          .get(expenseId, userId) as ExpenseRow | undefined;
        if (!oldExpense) {
          throw new HttpError(404, 'Expense transaction not found.');
        }

        const bank = db
          .prepare(`SELECT * FROM bank_accounts WHERE id = ? AND user_id = ?`)
          .get(oldExpense.bank_account_id, userId) as BankAccountRow;

        const now = new Date().toISOString();
        const refundedBal = roundMoney(bank.current_balance + oldExpense.amount);

        db.prepare(
          `UPDATE bank_accounts SET current_balance = ?, updated_at = ? WHERE id = ? AND user_id = ?`
        ).run(refundedBal, now, oldExpense.bank_account_id, userId);
        db.prepare(
          `DELETE FROM transaction_ledger WHERE ref_table = 'expense_transactions' AND ref_id = ? AND user_id = ?`
        ).run(expenseId, userId);
        db.prepare(`DELETE FROM expense_transactions WHERE id = ? AND user_id = ?`).run(
          expenseId,
          userId
        );

        db.prepare(
          `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp)
           VALUES (?, 'EXPENSE', ?, ?, 'DELETE', ?, NULL, ?)`
        ).run(userId, expenseId, oldExpense.tx_code, JSON.stringify(oldExpense), now);
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to delete expense transaction.' });
      }
    }
  });

  // Transaction History + Audit Logs
  app.get('/api/transactions', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;
    const transactions = getUnifiedTransactions(db, userId, {
      type: typeof req.query.type === 'string' ? req.query.type : 'all',
      month: typeof req.query.month === 'string' ? req.query.month : '',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : '',
      bankId: typeof req.query.bankId === 'string' ? req.query.bankId : '',
      categoryId: typeof req.query.categoryId === 'string' ? req.query.categoryId : '',
      search: typeof req.query.search === 'string' ? req.query.search : '',
    });

    const monthsRows = db
      .prepare(
        `
        SELECT DISTINCT month FROM income_transactions WHERE user_id = ?
        UNION
        SELECT DISTINCT month FROM expense_transactions WHERE user_id = ?
        ORDER BY month DESC
      `
      )
      .all(userId, userId) as Array<{ month: string }>;

    res.json({
      transactions,
      months: monthsRows.map((m) => m.month),
    });
  });

  app.get('/api/audit-logs', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;
    const rows = db
      .prepare(
        `SELECT * FROM audit_logs WHERE user_id = ? ORDER BY timestamp DESC, id DESC LIMIT 200`
      )
      .all(userId) as Array<{
      id: number;
      entity_type: string;
      entity_id: number;
      tx_code: string | null;
      action: string;
      original_values: string;
      changed_values: string | null;
      timestamp: string;
    }>;

    res.json({
      logs: rows.map((r) => ({
        ...r,
        original_values: JSON.parse(r.original_values),
        changed_values: r.changed_values ? JSON.parse(r.changed_values) : null,
      })),
    });
  });

  // Monthly Reports
  app.get('/api/reports/monthly', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;
    const monthsRows = db
      .prepare(
        `
        SELECT DISTINCT month FROM income_transactions WHERE user_id = ?
        UNION
        SELECT DISTINCT month FROM expense_transactions WHERE user_id = ?
        ORDER BY month DESC
      `
      )
      .all(userId, userId) as Array<{ month: string }>;

    const availableMonths = monthsRows.map((m) => m.month);
    const requestedMonth =
      typeof req.query.month === 'string' && req.query.month.trim()
        ? req.query.month.trim()
        : availableMonths[0] || new Date().toISOString().slice(0, 7);

    const isAll = requestedMonth === 'all';

    const incomeSummary = (
      isAll
        ? db
            .prepare(
              `SELECT COALESCE(SUM(total_amount), 0) AS totalIncome, COALESCE(SUM(unallocated_amount), 0) AS unallocatedIncome FROM income_transactions WHERE user_id = ?`
            )
            .get(userId)
        : db
            .prepare(
              `SELECT COALESCE(SUM(total_amount), 0) AS totalIncome, COALESCE(SUM(unallocated_amount), 0) AS unallocatedIncome FROM income_transactions WHERE user_id = ? AND month = ?`
            )
            .get(userId, requestedMonth)
    ) as { totalIncome: number; unallocatedIncome: number };

    const expenseSummary = (
      isAll
        ? db
            .prepare(
              `SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expense_transactions WHERE user_id = ?`
            )
            .get(userId)
        : db
            .prepare(
              `SELECT COALESCE(SUM(amount), 0) AS totalExpenses FROM expense_transactions WHERE user_id = ? AND month = ?`
            )
            .get(userId, requestedMonth)
    ) as { totalExpenses: number };

    const totalAllocated = roundMoney(incomeSummary.totalIncome - incomeSummary.unallocatedIncome);

    const categoryParams: unknown[] = isAll
      ? [userId, userId, userId, userId, userId]
      : [userId, requestedMonth, userId, requestedMonth, userId, userId, userId];

    const categoryBreakdown = db
      .prepare(
        `
        SELECT
          c.id,
          c.name,
          COALESCE((
            SELECT SUM(ia.amount)
            FROM income_allocations ia
            JOIN income_transactions i ON i.id = ia.income_id
            WHERE ia.category_id = c.id AND i.user_id = ? ${isAll ? '' : 'AND i.month = ?'}
          ), 0) AS allocated_in_period,
          COALESCE((
            SELECT SUM(et.amount)
            FROM expense_transactions et
            WHERE et.category_id = c.id AND et.user_id = ? ${isAll ? '' : 'AND et.month = ?'}
          ), 0) AS spent_in_period,
          COALESCE((
            SELECT SUM(ia2.amount)
            FROM income_allocations ia2
            JOIN income_transactions i2 ON i2.id = ia2.income_id
            WHERE ia2.category_id = c.id AND i2.user_id = ?
          ), 0) -
          COALESCE((
            SELECT SUM(et2.amount)
            FROM expense_transactions et2
            WHERE et2.category_id = c.id AND et2.user_id = ?
          ), 0) AS cumulative_remaining
        FROM categories c
        WHERE c.user_id = ?
        ORDER BY spent_in_period DESC, allocated_in_period DESC, c.id ASC
      `
      )
      .all(...categoryParams) as Array<{
      id: number;
      name: string;
      allocated_in_period: number;
      spent_in_period: number;
      cumulative_remaining: number;
    }>;

    const bankParams: unknown[] = isAll
      ? [userId, userId, userId]
      : [userId, requestedMonth, userId, requestedMonth, userId];

    const bankBreakdown = db
      .prepare(
        `
        SELECT
          b.id,
          b.bank_name,
          COALESCE(b.nickname, '') AS nickname,
          b.current_balance,
          COALESCE((
            SELECT SUM(i.total_amount)
            FROM income_transactions i
            WHERE i.bank_account_id = b.id AND i.user_id = ? ${isAll ? '' : 'AND i.month = ?'}
          ), 0) AS inflow_in_period,
          COALESCE((
            SELECT SUM(e.amount)
            FROM expense_transactions e
            WHERE e.bank_account_id = b.id AND e.user_id = ? ${isAll ? '' : 'AND e.month = ?'}
          ), 0) AS outflow_in_period
        FROM bank_accounts b
        WHERE b.user_id = ?
        ORDER BY b.id ASC
      `
      )
      .all(...bankParams) as Array<{
      id: number;
      bank_name: string;
      nickname: string;
      current_balance: number;
      inflow_in_period: number;
      outflow_in_period: number;
    }>;

    const monthlyTrend = availableMonths
      .slice()
      .reverse()
      .map((m) => {
        const inc = (
          db
            .prepare(
              `SELECT COALESCE(SUM(total_amount), 0) AS val FROM income_transactions WHERE user_id = ? AND month = ?`
            )
            .get(userId, m) as { val: number }
        ).val;
        const exp = (
          db
            .prepare(
              `SELECT COALESCE(SUM(amount), 0) AS val FROM expense_transactions WHERE user_id = ? AND month = ?`
            )
            .get(userId, m) as { val: number }
        ).val;
        return {
          month: m,
          income: roundMoney(inc),
          expenses: roundMoney(exp),
          net: roundMoney(inc - exp),
        };
      });

    res.json({
      selectedMonth: requestedMonth,
      availableMonths,
      summary: {
        totalIncome: roundMoney(incomeSummary.totalIncome),
        totalAllocated,
        unallocatedIncome: roundMoney(incomeSummary.unallocatedIncome),
        totalExpenses: roundMoney(expenseSummary.totalExpenses),
        netSavings: roundMoney(incomeSummary.totalIncome - expenseSummary.totalExpenses),
      },
      categoryBreakdown: categoryBreakdown.map((c) => ({
        ...c,
        allocated_in_period: roundMoney(c.allocated_in_period),
        spent_in_period: roundMoney(c.spent_in_period),
        cumulative_remaining: roundMoney(c.cumulative_remaining),
      })),
      bankBreakdown: bankBreakdown.map((b) => ({
        ...b,
        current_balance: roundMoney(b.current_balance),
        inflow_in_period: roundMoney(b.inflow_in_period),
        outflow_in_period: roundMoney(b.outflow_in_period),
      })),
      monthlyTrend,
    });
  });

  // CSV Exports
  app.get('/api/export/csv', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;
    const scope = typeof req.query.scope === 'string' ? req.query.scope : 'transactions';
    const month = typeof req.query.month === 'string' ? req.query.month : '';

    if (scope === 'categories') {
      const cats = getCategorySummaries(db, userId);
      const headers = ['ID', 'Category', 'Type', 'Allocated (INR)', 'Spent (INR)', 'Remaining (INR)', 'Notes'];
      const lines = [
        headers.join(','),
        ...cats.map((c) =>
          [
            c.id,
            csvEscape(c.name),
            c.is_default ? 'Default' : 'Custom',
            c.allocated_amount.toFixed(2),
            c.spent_amount.toFixed(2),
            c.remaining_balance.toFixed(2),
            csvEscape(c.notes),
          ].join(',')
        ),
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="rupeeledger-categories.csv"');
      res.send(lines.join('\n'));
      return;
    }

    const txs = getUnifiedTransactions(db, userId, { month: month || 'all' });
    const headers = [
      'Transaction ID',
      'Type',
      'Date',
      'Month',
      'Bank Account',
      'Source / Category',
      'Subcategory / Allocations',
      'Amount (INR)',
      'Unallocated (INR)',
      'Description',
      'Notes',
    ];

    const lines = [
      headers.join(','),
      ...txs.map((t) =>
        [
          csvEscape(t.tx_code),
          t.tx_type === 'income' ? 'INCOME' : 'EXPENSE',
          csvEscape(t.date),
          csvEscape(t.month),
          csvEscape(t.bank_name),
          csvEscape(t.tx_type === 'income' ? t.source : t.category_name),
          csvEscape(
            t.tx_type === 'income'
              ? (t.allocations ?? []).map((a) => `${a.category_name}: ${a.amount}`).join('; ')
              : t.subcategory || ''
          ),
          t.amount.toFixed(2),
          t.tx_type === 'income' ? (t.unallocated_amount ?? 0).toFixed(2) : '',
          csvEscape(t.tx_type === 'expense' ? t.description : `Income (${t.source})`),
          csvEscape(t.notes),
        ].join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rupeeledger-transactions.csv"');
    res.send(lines.join('\n'));
  });

  // SQLite Binary Backup
  app.get('/api/backup/sqlite', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const tempBackup = path.join(DATA_DIR, `backup-${Date.now()}.db`);
      if (fs.existsSync(tempBackup)) {
        fs.unlinkSync(tempBackup);
      }
      db.exec(`VACUUM INTO '${tempBackup.replace(/'/g, "''")}'`);
      const buffer = fs.readFileSync(tempBackup);
      fs.unlinkSync(tempBackup);

      const dateTag = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="rupeeledger-backup-${dateTag}.db"`);
      res.send(buffer);
    } catch {
      res.status(500).json({ error: 'Failed to generate SQLite database backup.' });
    }
  });

  // JSON Snapshot Backup (scoped strictly to authenticated user)
  app.get('/api/backup/json', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const db = getDb();
    const userId = req.user!.id;
    const payload = {
      exportedAt: new Date().toISOString(),
      version: 2,
      username: req.user!.username,
      bank_accounts: db
        .prepare(`SELECT * FROM bank_accounts WHERE user_id = ? ORDER BY id ASC`)
        .all(userId),
      categories: db
        .prepare(`SELECT * FROM categories WHERE user_id = ? ORDER BY id ASC`)
        .all(userId),
      income_transactions: db
        .prepare(`SELECT * FROM income_transactions WHERE user_id = ? ORDER BY id ASC`)
        .all(userId),
      income_allocations: db
        .prepare(
          `SELECT ia.* FROM income_allocations ia JOIN income_transactions i ON i.id = ia.income_id WHERE i.user_id = ? ORDER BY ia.id ASC`
        )
        .all(userId),
      expense_transactions: db
        .prepare(`SELECT * FROM expense_transactions WHERE user_id = ? ORDER BY id ASC`)
        .all(userId),
      transaction_ledger: db
        .prepare(`SELECT * FROM transaction_ledger WHERE user_id = ? ORDER BY id ASC`)
        .all(userId),
      app_settings: db
        .prepare(`SELECT key, value, updated_at FROM app_settings WHERE user_id = ?`)
        .all(userId),
      audit_logs: db
        .prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY id ASC`)
        .all(userId),
    };
    const dateTag = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="rupeeledger-snapshot-${dateTag}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  });

  // SQLite Binary Restore
  app.post(
    '/api/restore/sqlite',
    requireAuth,
    express.raw({ type: 'application/octet-stream', limit: '50mb' }),
    (req: AuthenticatedRequest, res: Response) => {
      const tempVerifyPath = path.join(DATA_DIR, `restore-verify-${Date.now()}.db`);
      try {
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length < 100) {
          throw new HttpError(400, 'Invalid or empty SQLite database file.');
        }
        const header = buf.subarray(0, 16).toString('utf8');
        if (header !== 'SQLite format 3\0') {
          throw new HttpError(400, 'Uploaded file is not a valid SQLite 3 database.');
        }

        const activeDb = getDb();
        const currentUserRow = activeDb
          .prepare(`SELECT username, display_name, password_hash, created_at FROM users WHERE id = ?`)
          .get(req.user!.id) as
          | { username: string; display_name: string; password_hash: string; created_at: string }
          | undefined;
        const currentSessionHash = req.sessionTokenHash;

        fs.writeFileSync(tempVerifyPath, buf);

        // Validate schema and integrity before replacing active database
        const testDb = new Database(tempVerifyPath, { readonly: true });
        try {
          const integrity = testDb.pragma('integrity_check') as Array<{ integrity_check: string }>;
          if (!integrity.length || integrity[0].integrity_check !== 'ok') {
            throw new HttpError(400, 'Uploaded SQLite database failed integrity check.');
          }

          const tables = testDb
            .prepare(`SELECT name FROM sqlite_master WHERE type='table'`)
            .all() as Array<{ name: string }>;
          const tableSet = new Set(tables.map((t) => t.name));
          const requiredTables = [
            'bank_accounts',
            'categories',
            'income_transactions',
            'income_allocations',
            'expense_transactions',
            'app_settings',
          ];
          for (const reqTable of requiredTables) {
            if (!tableSet.has(reqTable)) {
              throw new HttpError(400, `Backup database is missing required table "${reqTable}".`);
            }
          }
        } finally {
          testDb.close();
        }

        closeDb();
        for (const suffix of ['', '-wal', '-shm']) {
          const target = `${DB_PATH}${suffix}`;
          if (fs.existsSync(target)) {
            fs.unlinkSync(target);
          }
        }
        fs.renameSync(tempVerifyPath, DB_PATH);

        const reopened = getDb();
        initializeSchema(reopened);

        let requiresRelogin = false;
        const userCount = (
          reopened.prepare(`SELECT COUNT(*) as cnt FROM users`).get() as { cnt: number }
        ).cnt;

        if (userCount === 0 && currentUserRow && currentSessionHash) {
          // Legacy single-user backup: re-attach current user & active session
          const nowIso = new Date().toISOString();
          const ins = reopened
            .prepare(
              `INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)`
            )
            .run(
              currentUserRow.username,
              currentUserRow.display_name,
              currentUserRow.password_hash,
              currentUserRow.created_at
            );
          const restoredUserId = Number(ins.lastInsertRowid);
          claimLegacyRowsForFirstUser(reopened, restoredUserId);
          reopened
            .prepare(
              `INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
            )
            .run(
              restoredUserId,
              currentSessionHash,
              new Date(Date.now() + SESSION_TTL_MS).toISOString(),
              nowIso
            );
        } else if (currentUserRow && currentSessionHash) {
          const matchingUser = reopened
            .prepare(`SELECT id FROM users WHERE username = ? COLLATE NOCASE`)
            .get(currentUserRow.username) as { id: number } | undefined;
          if (matchingUser) {
            reopened
              .prepare(
                `INSERT OR REPLACE INTO user_sessions (user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?)`
              )
              .run(
                matchingUser.id,
                currentSessionHash,
                new Date(Date.now() + SESSION_TTL_MS).toISOString(),
                new Date().toISOString()
              );
          } else {
            requiresRelogin = true;
          }
        }

        res.json({ success: true, requiresRelogin });
      } catch (err) {
        if (fs.existsSync(tempVerifyPath)) {
          fs.unlinkSync(tempVerifyPath);
        }
        if (err instanceof HttpError) {
          res.status(err.status).json({ error: err.message });
        } else {
          res.status(500).json({ error: 'Failed to restore SQLite database.' });
        }
      }
    }
  );

  // JSON Snapshot Restore (scoped strictly to authenticated user with safe ID remapping)
  app.post('/api/restore/json', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const db = getDb();
      const userId = req.user!.id;
      const data = req.body;
      if (
        !data ||
        !Array.isArray(data.bank_accounts) ||
        !Array.isArray(data.categories) ||
        !Array.isArray(data.income_transactions) ||
        !Array.isArray(data.income_allocations) ||
        !Array.isArray(data.expense_transactions)
      ) {
        throw new HttpError(400, 'Invalid JSON snapshot format.');
      }

      db.transaction(() => {
        // Delete only records belonging to the authenticated user
        db.prepare(`DELETE FROM audit_logs WHERE user_id = ?`).run(userId);
        db.prepare(`DELETE FROM transaction_ledger WHERE user_id = ?`).run(userId);
        db.prepare(
          `DELETE FROM income_allocations WHERE income_id IN (SELECT id FROM income_transactions WHERE user_id = ?)`
        ).run(userId);
        db.prepare(`DELETE FROM expense_transactions WHERE user_id = ?`).run(userId);
        db.prepare(`DELETE FROM income_transactions WHERE user_id = ?`).run(userId);
        db.prepare(`DELETE FROM categories WHERE user_id = ?`).run(userId);
        db.prepare(`DELETE FROM bank_accounts WHERE user_id = ?`).run(userId);
        db.prepare(`DELETE FROM app_settings WHERE user_id = ?`).run(userId);

        const bankIdMap = new Map<number, number>();
        const insBank = db.prepare(
          `INSERT INTO bank_accounts (user_id, bank_name, nickname, opening_balance, current_balance, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const b of data.bank_accounts) {
          const r = insBank.run(
            userId,
            b.bank_name,
            b.nickname || '',
            roundMoney(Number(b.opening_balance)),
            roundMoney(Number(b.current_balance)),
            b.created_at,
            b.updated_at
          );
          bankIdMap.set(Number(b.id), Number(r.lastInsertRowid));
        }

        const catIdMap = new Map<number, number>();
        const insCat = db.prepare(
          `INSERT INTO categories (user_id, name, is_default, notes, created_at) VALUES (?, ?, ?, ?, ?)`
        );
        for (const c of data.categories) {
          const r = insCat.run(userId, c.name, c.is_default ? 1 : 0, c.notes || '', c.created_at);
          catIdMap.set(Number(c.id), Number(r.lastInsertRowid));
        }

        const incIdMap = new Map<number, number>();
        const insInc = db.prepare(
          `INSERT INTO income_transactions (user_id, tx_code, income_date, month, source, total_amount, unallocated_amount, bank_account_id, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const i of data.income_transactions) {
          const mappedBankId = bankIdMap.get(Number(i.bank_account_id));
          if (!mappedBankId) continue;
          const r = insInc.run(
            userId,
            i.tx_code,
            i.income_date,
            i.month,
            i.source,
            roundMoney(Number(i.total_amount)),
            roundMoney(Number(i.unallocated_amount)),
            mappedBankId,
            i.notes || '',
            i.created_at,
            i.updated_at
          );
          incIdMap.set(Number(i.id), Number(r.lastInsertRowid));
        }

        const insAlloc = db.prepare(
          `INSERT INTO income_allocations (income_id, category_id, amount, created_at) VALUES (?, ?, ?, ?)`
        );
        for (const a of data.income_allocations) {
          const mappedIncId = incIdMap.get(Number(a.income_id));
          const mappedCatId = catIdMap.get(Number(a.category_id));
          if (!mappedIncId || !mappedCatId) continue;
          insAlloc.run(mappedIncId, mappedCatId, roundMoney(Number(a.amount)), a.created_at);
        }

        const expIdMap = new Map<number, number>();
        const insExp = db.prepare(
          `INSERT INTO expense_transactions (user_id, tx_code, expense_date, month, category_id, subcategory, amount, bank_account_id, description, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const e of data.expense_transactions) {
          const mappedCatId = catIdMap.get(Number(e.category_id));
          const mappedBankId = bankIdMap.get(Number(e.bank_account_id));
          if (!mappedCatId || !mappedBankId) continue;
          const r = insExp.run(
            userId,
            e.tx_code,
            e.expense_date,
            e.month,
            mappedCatId,
            e.subcategory || '',
            roundMoney(Number(e.amount)),
            mappedBankId,
            e.description,
            e.notes || '',
            e.created_at,
            e.updated_at
          );
          expIdMap.set(Number(e.id), Number(r.lastInsertRowid));
        }

        if (Array.isArray(data.transaction_ledger)) {
          const insLed = db.prepare(
            `INSERT INTO transaction_ledger (user_id, tx_type, ref_table, ref_id, tx_code, tx_date, month, bank_account_id, category_id, amount, direction, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const l of data.transaction_ledger) {
            let mappedRefId = Number(l.ref_id);
            if (l.ref_table === 'bank_accounts') {
              mappedRefId = bankIdMap.get(mappedRefId) ?? mappedRefId;
            } else if (l.ref_table === 'income_transactions') {
              mappedRefId = incIdMap.get(mappedRefId) ?? mappedRefId;
            } else if (l.ref_table === 'expense_transactions') {
              mappedRefId = expIdMap.get(mappedRefId) ?? mappedRefId;
            }
            const mappedBankId = l.bank_account_id
              ? bankIdMap.get(Number(l.bank_account_id)) ?? null
              : null;
            const mappedCatId = l.category_id
              ? catIdMap.get(Number(l.category_id)) ?? null
              : null;
            insLed.run(
              userId,
              l.tx_type,
              l.ref_table,
              mappedRefId,
              l.tx_code,
              l.tx_date,
              l.month,
              mappedBankId,
              mappedCatId,
              roundMoney(Number(l.amount)),
              l.direction,
              l.summary,
              l.created_at
            );
          }
        }

        if (Array.isArray(data.app_settings)) {
          const insSet = db.prepare(
            `INSERT OR REPLACE INTO app_settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)`
          );
          for (const s of data.app_settings) {
            insSet.run(userId, s.key, s.value, s.updated_at);
          }
        }

        if (Array.isArray(data.audit_logs)) {
          const insAudit = db.prepare(
            `INSERT INTO audit_logs (user_id, entity_type, entity_id, tx_code, action, original_values, changed_values, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const a of data.audit_logs) {
            insAudit.run(
              userId,
              a.entity_type,
              a.entity_id,
              a.tx_code,
              a.action,
              a.original_values,
              a.changed_values,
              a.timestamp
            );
          }
        }

        seedDefaultCategoriesForUser(db, userId);
      })();

      res.json({ success: true });
    } catch (err) {
      if (err instanceof HttpError) {
        res.status(err.status).json({ error: err.message });
      } else {
        res.status(500).json({ error: 'Failed to restore JSON snapshot.' });
      }
    }
  });

  // Vite middleware in dev, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RupeeLedger server listening on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
