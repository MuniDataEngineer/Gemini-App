import React, { useState } from 'react';
import { Plus, Pencil, Trash2, History, AlertCircle, CheckCircle2, X } from 'lucide-react';
import type { CategorySummary } from '../types';
import { apiFetch, formatDateShort, formatINR } from '../lib/format';

interface CategoriesViewProps {
  categories: CategorySummary[];
  onRefresh: () => Promise<void>;
}

interface CategoryHistoryData {
  category: {
    id: number;
    name: string;
    allocated: number;
    spent: number;
    remaining: number;
  };
  allocations: Array<{
    id: number;
    amount: number;
    tx_code: string;
    income_date: string;
    month: string;
    source: string;
    bank_name: string;
  }>;
  expenses: Array<{
    id: number;
    tx_code: string;
    expense_date: string;
    month: string;
    subcategory: string;
    amount: number;
    bank_name: string;
    description: string;
    notes: string;
  }>;
}

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  categories,
  onRefresh,
}) => {
  const [newName, setNewName] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const [editingCat, setEditingCat] = useState<CategorySummary | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const [historyData, setHistoryData] = useState<CategoryHistoryData | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!newName.trim()) {
      setError('Category name is required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name: newName.trim(), notes: newNotes.trim() }),
      });
      setNewName('');
      setNewNotes('');
      setShowAdd(false);
      setSuccess('Custom category created.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create category.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCat) return;
    setError(null);
    setSuccess(null);
    if (!editName.trim()) {
      setError('Category name is required.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch(`/api/categories/${editingCat.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: editName.trim(), notes: editNotes.trim() }),
      });
      setEditingCat(null);
      setSuccess('Category updated.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update category.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (cat: CategorySummary) => {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      setSuccess(`Removed category "${cat.name}".`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove category.');
    }
  };

  const openHistory = async (cat: CategorySummary) => {
    setError(null);
    setLoadingHistory(true);
    try {
      const res = await apiFetch<CategoryHistoryData>(`/api/categories/${cat.id}/history`);
      setHistoryData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load category history.');
    } finally {
      setLoadingHistory(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Categories</h2>
          <p className="text-sm text-slate-500">
            Track allocated budgets, total expenses, and remaining balance per category.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setShowAdd((prev) => !prev);
          }}
          className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Custom Category</span>
        </button>
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

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">New Custom Category</h3>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="p-1 text-slate-400 hover:text-slate-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Category Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g., Subscriptions, Education"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="Purpose or target monthly budget"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
            >
              {submitting ? 'Saving...' : 'Create Category'}
            </button>
          </div>
        </form>
      )}

      {/* Mobile Category Cards */}
      <div className="md:hidden space-y-3">
        {categories.map((cat) => (
          <div
            key={cat.id}
            className="bg-white border border-slate-200 rounded-xl p-4 space-y-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900 truncate">{cat.name}</div>
                {cat.notes && (
                  <div className="text-xs text-slate-500 mt-0.5">{cat.notes}</div>
                )}
              </div>
              <div className="text-right shrink-0">
                <div className="text-base font-bold font-mono-num text-slate-900">
                  {formatINR(cat.remaining_balance)}
                </div>
                <div className="text-[11px] text-slate-500">Remaining</div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono-num pt-2 border-t border-slate-100">
              <span className="text-emerald-700">
                Alloc: {formatINR(cat.allocated_amount)}
              </span>
              <span className="text-red-600">
                Spent: {formatINR(cat.spent_amount)}
              </span>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => openHistory(cat)}
                className="min-h-[40px] flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <History className="w-3.5 h-3.5" />
                <span>History</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditingCat(cat);
                  setEditName(cat.name);
                  setEditNotes(cat.notes || '');
                }}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg"
                title="Edit category"
              >
                <Pencil className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleDelete(cat)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 hover:text-red-600 bg-slate-50 hover:bg-red-50 rounded-lg"
                title="Delete unused category"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Categories Table */}
      <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Category</th>
                <th className="py-3 px-4 text-right">Allocated</th>
                <th className="py-3 px-4 text-right">Total Spent</th>
                <th className="py-3 px-4 text-right">Remaining Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {categories.map((cat) => (
                <tr key={cat.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{cat.name}</div>
                    {cat.notes && (
                      <div className="text-xs text-slate-500 mt-0.5">{cat.notes}</div>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num text-emerald-700">
                    {formatINR(cat.allocated_amount)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num text-red-600">
                    {formatINR(cat.spent_amount)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono-num font-bold text-slate-900">
                    {formatINR(cat.remaining_balance)}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => openHistory(cat)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                    >
                      <History className="w-3.5 h-3.5" />
                      <span>History</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCat(cat);
                        setEditName(cat.name);
                        setEditNotes(cat.notes || '');
                      }}
                      className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md ml-1"
                      title="Edit category"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(cat)}
                      className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md ml-1"
                      title="Delete unused category"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Category Modal */}
      {editingCat && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 pb-safe">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">Edit Category</h3>
              <button
                type="button"
                onClick={() => setEditingCat(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleEditSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Category Name <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Notes
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingCat(null)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Category History Modal */}
      {(loadingHistory || historyData) && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-2xl max-h-[85vh] overflow-y-auto bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 pb-safe">
            {loadingHistory ? (
              <p className="text-sm text-slate-500 py-8 text-center">Loading history...</p>
            ) : (
              historyData && (
                <div className="space-y-5">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">
                        {historyData.category.name} — Ledger History
                      </h3>
                      <div className="mt-1 flex flex-wrap gap-4 text-xs font-mono-num">
                        <span className="text-emerald-700">
                          Allocated: {formatINR(historyData.category.allocated)}
                        </span>
                        <span className="text-red-600">
                          Spent: {formatINR(historyData.category.spent)}
                        </span>
                        <span className="font-semibold text-slate-900">
                          Remaining: {formatINR(historyData.category.remaining)}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setHistoryData(null)}
                      className="p-1 text-slate-400 hover:text-slate-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Allocations Received ({historyData.allocations.length})
                    </h4>
                    {historyData.allocations.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">No allocations yet.</p>
                    ) : (
                      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                        {historyData.allocations.map((a) => (
                          <div key={a.id} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <span className="font-mono-num text-slate-500 mr-2">
                                {a.tx_code}
                              </span>
                              <span className="font-medium text-slate-900">
                                {a.source} ({a.bank_name})
                              </span>
                              <span className="text-slate-500 ml-2">
                                · {formatDateShort(a.income_date)}
                              </span>
                            </div>
                            <span className="font-mono-num font-semibold text-emerald-600">
                              +{formatINR(a.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                      Expenses Spent ({historyData.expenses.length})
                    </h4>
                    {historyData.expenses.length === 0 ? (
                      <p className="text-xs text-slate-500 py-2">No expenses recorded yet.</p>
                    ) : (
                      <div className="border border-slate-200 rounded-lg divide-y divide-slate-100 text-xs">
                        {historyData.expenses.map((ex) => (
                          <div key={ex.id} className="flex items-center justify-between px-3 py-2">
                            <div>
                              <span className="font-mono-num text-slate-500 mr-2">
                                {ex.tx_code}
                              </span>
                              <span className="font-medium text-slate-900">
                                {ex.description}
                              </span>
                              {ex.subcategory && (
                                <span className="text-slate-500 ml-1">({ex.subcategory})</span>
                              )}
                              <span className="text-slate-500 ml-2">
                                · {ex.bank_name} · {formatDateShort(ex.expense_date)}
                              </span>
                            </div>
                            <span className="font-mono-num font-semibold text-red-600">
                              -{formatINR(ex.amount)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};
