import React, { useCallback, useEffect, useState } from 'react';
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  Pencil,
  Trash2,
  X,
  Download,
  AlertCircle,
  CheckCircle2,
  ClipboardList,
} from 'lucide-react';
import type {
  AuditLogEntry,
  BankAccount,
  CategorySummary,
  UnifiedTransaction,
} from '../types';
import {
  apiFetch,
  downloadAuthorizedFile,
  formatDateShort,
  formatINR,
  formatMonthLabel,
} from '../lib/format';
import { AddMoneyView } from './AddMoneyView';
import { AddExpenseView } from './AddExpenseView';

interface TransactionHistoryViewProps {
  bankAccounts: BankAccount[];
  categories: CategorySummary[];
  onRefreshBootstrap: () => Promise<void>;
}

export const TransactionHistoryView: React.FC<TransactionHistoryViewProps> = ({
  bankAccounts,
  categories,
  onRefreshBootstrap,
}) => {
  const [activeTab, setActiveTab] = useState<'ledger' | 'audit'>('ledger');

  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [bankFilter, setBankFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [search, setSearch] = useState<string>('');

  const [transactions, setTransactions] = useState<UnifiedTransaction[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const [selectedTx, setSelectedTx] = useState<UnifiedTransaction | null>(null);
  const [editingTx, setEditingTx] = useState<UnifiedTransaction | null>(null);
  const [confirmDeleteTx, setConfirmDeleteTx] = useState<UnifiedTransaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState<boolean>(false);

  const loadTransactions = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('type', typeFilter);
      if (monthFilter) params.set('month', monthFilter);
      if (startDate) params.set('startDate', startDate);
      if (endDate) params.set('endDate', endDate);
      if (bankFilter) params.set('bankId', bankFilter);
      if (categoryFilter) params.set('categoryId', categoryFilter);
      if (search.trim()) params.set('search', search.trim());

      const res = await apiFetch<{ transactions: UnifiedTransaction[]; months: string[] }>(
        `/api/transactions?${params.toString()}`
      );
      setTransactions(res.transactions);
      setMonths(res.months);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load transaction history.');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, monthFilter, startDate, endDate, bankFilter, categoryFilter, search]);

  const loadAuditLogs = useCallback(async () => {
    try {
      const res = await apiFetch<{ logs: AuditLogEntry[] }>('/api/audit-logs');
      setAuditLogs(res.logs);
    } catch {
      // ignore silently
    }
  }, []);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    if (activeTab === 'audit') {
      void loadAuditLogs();
    }
  }, [activeTab, loadAuditLogs]);

  const handleDelete = async (tx: UnifiedTransaction) => {
    setError(null);
    setSuccess(null);
    setDeleting(true);
    try {
      const endpoint =
        tx.tx_type === 'income' ? `/api/income/${tx.id}` : `/api/expenses/${tx.id}`;
      await apiFetch(endpoint, { method: 'DELETE' });
      setConfirmDeleteTx(null);
      setSelectedTx(null);
      setSuccess(
        `Deleted ${tx.tx_code} and reversed its impact on ${tx.bank_name}${
          tx.tx_type === 'expense' ? ` & ${tx.category_name}` : ' & category allocations'
        }.`
      );
      await onRefreshBootstrap();
      await loadTransactions();
      await loadAuditLogs();
    } catch (err) {
      setConfirmDeleteTx(null);
      setError(err instanceof Error ? err.message : 'Failed to delete transaction.');
    } finally {
      setDeleting(false);
    }
  };

  const resetFilters = () => {
    setTypeFilter('all');
    setMonthFilter('all');
    setStartDate('');
    setEndDate('');
    setBankFilter('');
    setCategoryFilter('');
    setSearch('');
  };

  // If editing a transaction, render the full AddMoneyView or AddExpenseView in edit mode
  if (editingTx) {
    if (editingTx.tx_type === 'income') {
      return (
        <AddMoneyView
          bankAccounts={bankAccounts}
          categories={categories}
          editingIncome={editingTx}
          onCancelEdit={() => setEditingTx(null)}
          onSuccess={async () => {
            await onRefreshBootstrap();
            await loadTransactions();
            await loadAuditLogs();
            setSuccess(`Updated ${editingTx.tx_code} and recalculated all balances.`);
            setEditingTx(null);
          }}
        />
      );
    }
    return (
      <AddExpenseView
        bankAccounts={bankAccounts}
        categories={categories}
        editingExpense={editingTx}
        onCancelEdit={() => setEditingTx(null)}
        onSuccess={async () => {
          await onRefreshBootstrap();
          await loadTransactions();
          await loadAuditLogs();
          setSuccess(`Updated ${editingTx.tx_code} and recalculated all balances.`);
          setEditingTx(null);
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header + View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Transaction History
          </h2>
          <p className="text-sm text-slate-500">
            Permanent chronological ledger of income, category allocations, expenses, and edit audit trail.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('ledger')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'ledger'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              All Transactions
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('audit')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                activeTab === 'audit'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <ClipboardList className="w-3.5 h-3.5" />
              <span>Audit Log</span>
            </button>
          </div>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                await downloadAuthorizedFile(
                  `/api/export/csv?scope=transactions&month=${encodeURIComponent(monthFilter)}`,
                  'rupeeledger-transactions.csv'
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to export CSV.');
              }
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-sm text-emerald-700">
          <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {activeTab === 'ledger' ? (
        <>
          {/* Filter Bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Segmented Type Filter */}
              <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-full sm:w-auto">
                {(['all', 'income', 'expense'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTypeFilter(t)}
                    className={`flex-1 sm:flex-initial min-h-[38px] px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                      typeFilter === t
                        ? 'bg-white text-slate-900 shadow-sm'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {t === 'all' ? 'All' : t === 'income' ? 'Income' : 'Expenses'}
                  </button>
                ))}
              </div>

              {/* Search + Mobile Filter Toggle */}
              <div className="flex items-center gap-2 w-full sm:w-auto sm:flex-1 sm:max-w-md">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search description, category, or ID..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setShowMobileFilters((p) => !p)}
                  className="sm:hidden min-h-[42px] px-3 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg whitespace-nowrap shrink-0"
                >
                  {showMobileFilters ? 'Hide Filters' : 'Filters'}
                </button>
              </div>
            </div>

            <div className={`${showMobileFilters ? 'grid' : 'hidden sm:grid'} grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3`}>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Month
                </label>
                <select
                  value={monthFilter}
                  onChange={(e) => setMonthFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="all">All Months</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {formatMonthLabel(m)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Bank Account
                </label>
                <select
                  value={bankFilter}
                  onChange={(e) => setBankFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">All Banks</option>
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bank_name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Category
                </label>
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white"
                >
                  <option value="">All Categories</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  From Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  To Date
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-sm font-mono-num border border-slate-300 rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 border border-slate-300 rounded-lg whitespace-nowrap shrink-0"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Transactions Table */}
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-sm text-slate-500">
                Loading transaction history...
              </div>
            ) : transactions.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No transactions match the selected filters.
              </div>
            ) : (
              <>
                {/* Mobile Tap-Friendly Transaction List */}
                <div className="md:hidden divide-y divide-slate-100">
                  {transactions.map((tx) => (
                    <div
                      key={tx.uid}
                      onClick={() => setSelectedTx(tx)}
                      className="p-4 flex items-start justify-between gap-3 active:bg-slate-50 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono-num">{tx.tx_code}</span>
                          <span>·</span>
                          <span>{formatDateShort(tx.date)}</span>
                        </div>
                        <div className="mt-1 font-semibold text-sm text-slate-900 truncate">
                          {tx.tx_type === 'income'
                            ? `${tx.source} Income`
                            : `${tx.category_name}${tx.subcategory ? ` / ${tx.subcategory}` : ''}`}
                        </div>
                        <div className="text-xs text-slate-600 truncate mt-0.5">
                          {tx.tx_type === 'income'
                            ? tx.allocations && tx.allocations.length > 0
                              ? tx.allocations
                                  .map((a) => `${a.category_name} (${formatINR(a.amount)})`)
                                  .join(', ')
                              : 'Unallocated income'
                            : tx.description}
                        </div>
                        <div className="text-xs text-slate-500 mt-1">{tx.bank_name}</div>
                      </div>

                      <div className="text-right shrink-0 flex flex-col items-end gap-2">
                        <div
                          className={`text-sm font-bold font-mono-num ${
                            tx.tx_type === 'income' ? 'text-emerald-600' : 'text-red-600'
                          }`}
                        >
                          {tx.tx_type === 'income' ? '+' : '-'}
                          {formatINR(tx.amount)}
                        </div>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => setEditingTx(tx)}
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-md"
                            title="Edit transaction"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteTx(tx)}
                            className="min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-500 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-md"
                            title="Delete transaction"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">ID</th>
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Type</th>
                        <th className="py-3 px-4">Category / Source</th>
                        <th className="py-3 px-4">Description / Breakdown</th>
                        <th className="py-3 px-4">Bank</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {transactions.map((tx) => (
                        <tr
                          key={tx.uid}
                          onClick={() => setSelectedTx(tx)}
                          className="hover:bg-slate-50 cursor-pointer transition-colors"
                        >
                          <td className="py-3 px-4 font-mono-num text-xs text-slate-500 whitespace-nowrap">
                            {tx.tx_code}
                          </td>
                          <td className="py-3 px-4 font-mono-num text-xs text-slate-600 whitespace-nowrap">
                            {formatDateShort(tx.date)}
                          </td>
                          <td className="py-3 px-4 whitespace-nowrap">
                            {tx.tx_type === 'income' ? (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700">
                                <ArrowUpRight className="w-3.5 h-3.5" />
                                Income
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700">
                                <ArrowDownRight className="w-3.5 h-3.5" />
                                Expense
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900 whitespace-nowrap">
                            {tx.tx_type === 'income' ? tx.source : tx.category_name}
                            {tx.tx_type === 'expense' && tx.subcategory && (
                              <span className="text-xs text-slate-500 font-normal ml-1">
                                / {tx.subcategory}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                            {tx.tx_type === 'income'
                              ? tx.allocations && tx.allocations.length > 0
                                ? tx.allocations
                                    .map((a) => `${a.category_name} (${formatINR(a.amount)})`)
                                    .join(', ')
                                : 'Unallocated income'
                              : tx.description}
                          </td>
                          <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                            {tx.bank_name}
                          </td>
                          <td
                            className={`py-3 px-4 text-right font-semibold font-mono-num whitespace-nowrap ${
                              tx.tx_type === 'income' ? 'text-emerald-600' : 'text-red-600'
                            }`}
                          >
                            {tx.tx_type === 'income' ? '+' : '-'}
                            {formatINR(tx.amount)}
                          </td>
                          <td
                            className="py-3 px-4 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => setEditingTx(tx)}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                              title="Edit transaction"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteTx(tx)}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md ml-1"
                              title="Delete transaction"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        /* Audit Log View */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {auditLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500">
              No edits or deletions have been recorded yet. All modifications to transactions, banks, or categories are logged here automatically.
            </div>
          ) : (
            <div className="divide-y divide-slate-200">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-semibold ${
                          log.action === 'DELETE' ? 'text-red-600' : 'text-blue-600'
                        }`}
                      >
                        {log.action}
                      </span>
                      <span className="text-slate-400">·</span>
                      <span className="font-medium text-slate-800">{log.entity_type}</span>
                      {log.tx_code && (
                        <>
                          <span className="text-slate-400">·</span>
                          <span className="font-mono-num text-slate-600">{log.tx_code}</span>
                        </>
                      )}
                    </div>
                    <span className="font-mono-num text-slate-500">
                      {new Date(log.timestamp).toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 overflow-x-auto">
                      <div className="font-semibold text-slate-600 mb-1">Original Values</div>
                      <pre className="font-mono-num text-[11px] text-slate-700 whitespace-pre-wrap">
                        {JSON.stringify(log.original_values, null, 2)}
                      </pre>
                    </div>
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-2.5 overflow-x-auto">
                      <div className="font-semibold text-slate-600 mb-1">
                        {log.changed_values ? 'Changed Values' : 'Deleted (No Replacement)'}
                      </div>
                      <pre className="font-mono-num text-[11px] text-slate-700 whitespace-pre-wrap">
                        {log.changed_values ? JSON.stringify(log.changed_values, null, 2) : '—'}
                      </pre>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Transaction Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-lg bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto space-y-5 pb-safe">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-slate-500 font-mono-num">
                  <span>{selectedTx.tx_code}</span>
                  <span>·</span>
                  <span>{formatDateShort(selectedTx.date)}</span>
                  <span>·</span>
                  <span>{formatMonthLabel(selectedTx.month)}</span>
                </div>
                <h3 className="mt-1 text-lg font-bold text-slate-900">
                  {selectedTx.tx_type === 'income'
                    ? `${selectedTx.source} Income`
                    : selectedTx.description}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4 py-3 border-y border-slate-200 text-sm">
              <div>
                <div className="text-xs text-slate-500">Amount</div>
                <div
                  className={`mt-0.5 text-lg font-bold font-mono-num ${
                    selectedTx.tx_type === 'income' ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {selectedTx.tx_type === 'income' ? '+' : '-'}
                  {formatINR(selectedTx.amount)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500">Bank Account</div>
                <div className="mt-0.5 font-semibold text-blue-600">
                  {selectedTx.bank_name}
                  {selectedTx.bank_nickname ? ` (${selectedTx.bank_nickname})` : ''}
                </div>
              </div>

              {selectedTx.tx_type === 'expense' && (
                <>
                  <div>
                    <div className="text-xs text-slate-500">Category</div>
                    <div className="mt-0.5 font-medium text-slate-900">
                      {selectedTx.category_name}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Subcategory</div>
                    <div className="mt-0.5 text-slate-700">
                      {selectedTx.subcategory || '—'}
                    </div>
                  </div>
                </>
              )}

              {selectedTx.tx_type === 'income' && (
                <>
                  <div>
                    <div className="text-xs text-slate-500">Income Source</div>
                    <div className="mt-0.5 font-medium text-slate-900">{selectedTx.source}</div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Unallocated Amount</div>
                    <div className="mt-0.5 font-mono-num font-medium text-slate-900">
                      {formatINR(selectedTx.unallocated_amount ?? 0)}
                    </div>
                  </div>
                </>
              )}
            </div>

            {selectedTx.tx_type === 'income' && (
              <div>
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Category Allocation Breakdown
                </h4>
                {selectedTx.allocations && selectedTx.allocations.length > 0 ? (
                  <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-sm">
                    {selectedTx.allocations.map((a) => (
                      <div key={a.category_id} className="flex items-center justify-between px-3 py-2">
                        <span className="text-slate-800">{a.category_name}</span>
                        <span className="font-mono-num font-semibold text-slate-900">
                          {formatINR(a.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No category allocations for this income.</p>
                )}
              </div>
            )}

            <div>
              <div className="text-xs text-slate-500 mb-1">Notes</div>
              <p className="text-sm text-slate-700">{selectedTx.notes || 'No notes'}</p>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={() => {
                  const target = selectedTx;
                  setSelectedTx(null);
                  setConfirmDeleteTx(target);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-red-600 border border-red-200 hover:bg-red-50 rounded-lg"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = selectedTx;
                  setSelectedTx(null);
                  setEditingTx(target);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit Transaction</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {confirmDeleteTx && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 space-y-4 pb-safe">
            <h3 className="text-lg font-bold text-slate-900">
              Delete {confirmDeleteTx.tx_code}?
            </h3>
            <p className="text-sm text-slate-600">
              {confirmDeleteTx.tx_type === 'income'
                ? `This will reverse ${formatINR(confirmDeleteTx.amount)} from ${confirmDeleteTx.bank_name} and remove its category allocations. An audit entry will be saved.`
                : `This will refund ${formatINR(confirmDeleteTx.amount)} back to ${confirmDeleteTx.bank_name} and restore ${confirmDeleteTx.category_name} category balance. An audit entry will be saved.`}
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteTx(null)}
                className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => handleDelete(confirmDeleteTx)}
                className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-60 rounded-lg"
              >
                {deleting ? 'Deleting...' : 'Confirm Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
