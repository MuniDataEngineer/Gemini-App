import React, { useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Check,
  X,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { BankAccount, CategorySummary, UnifiedTransaction } from '../types';
import {
  apiFetch,
  currentMonthISO,
  formatINR,
  roundMoney,
  todayISO,
} from '../lib/format';

interface AddMoneyViewProps {
  bankAccounts: BankAccount[];
  categories: CategorySummary[];
  editingIncome?: UnifiedTransaction | null;
  onCancelEdit?: () => void;
  onSuccess: () => Promise<void>;
}

export const AddMoneyView: React.FC<AddMoneyViewProps> = ({
  bankAccounts,
  categories,
  editingIncome,
  onCancelEdit,
  onSuccess,
}) => {
  const [incomeDate, setIncomeDate] = useState(
    editingIncome ? editingIncome.date : todayISO()
  );
  const [month, setMonth] = useState(
    editingIncome ? editingIncome.month : currentMonthISO()
  );
  const [source, setSource] = useState(editingIncome?.source || 'Salary');
  const [totalAmount, setTotalAmount] = useState(
    editingIncome ? String(editingIncome.amount) : ''
  );
  const [bankAccountId, setBankAccountId] = useState<number>(
    editingIncome
      ? editingIncome.bank_account_id
      : bankAccounts[0]?.id ?? 0
  );
  const [notes, setNotes] = useState(editingIncome?.notes || '');

  // Map of categoryId -> string input value
  const [allocInputs, setAllocInputs] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    if (editingIncome?.allocations) {
      for (const a of editingIncome.allocations) {
        initial[a.category_id] = String(a.amount);
      }
    }
    return initial;
  });

  // Inline category management inside Add Money
  const [newCatName, setNewCatName] = useState('');
  const [addingCat, setAddingCat] = useState(false);
  const [editingCatId, setEditingCatId] = useState<number | null>(null);
  const [editingCatName, setEditingCatName] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!bankAccountId && bankAccounts.length > 0) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, bankAccountId]);

  const parsedIncome = useMemo(() => {
    const n = Number(totalAmount);
    return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
  }, [totalAmount]);

  const allocatedTotal = useMemo(() => {
    let sum = 0;
    for (const val of Object.values(allocInputs)) {
      const n = Number(val);
      if (Number.isFinite(n) && n > 0) {
        sum = roundMoney(sum + roundMoney(n));
      }
    }
    return sum;
  }, [allocInputs]);

  const unallocated = roundMoney(parsedIncome - allocatedTotal);
  const exceedsIncome = parsedIncome > 0 && allocatedTotal > parsedIncome;

  const handleDateChange = (newDate: string) => {
    setIncomeDate(newDate);
    if (/^\d{4}-\d{2}-\d{2}$/.test(newDate) && !editingIncome) {
      setMonth(newDate.slice(0, 7));
    }
  };

  const handleAllocChange = (catId: number, value: string) => {
    setAllocInputs((prev) => ({ ...prev, [catId]: value }));
  };

  const handleAddCategoryInline = async () => {
    setError(null);
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setAddingCat(true);
    try {
      await apiFetch('/api/categories', {
        method: 'POST',
        body: JSON.stringify({ name: trimmed, notes: '' }),
      });
      setNewCatName('');
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add category.');
    } finally {
      setAddingCat(false);
    }
  };

  const handleSaveCategoryRename = async (cat: CategorySummary) => {
    setError(null);
    const trimmed = editingCatName.trim();
    if (!trimmed) return;
    try {
      await apiFetch(`/api/categories/${cat.id}`, {
        method: 'PUT',
        body: JSON.stringify({ name: trimmed, notes: cat.notes }),
      });
      setEditingCatId(null);
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename category.');
    }
  };

  const handleDeleteCategoryInline = async (cat: CategorySummary) => {
    setError(null);
    try {
      await apiFetch(`/api/categories/${cat.id}`, { method: 'DELETE' });
      setAllocInputs((prev) => {
        const next = { ...prev };
        delete next[cat.id];
        return next;
      });
      await onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove category.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (parsedIncome <= 0) {
      setError('Please enter a positive income amount.');
      return;
    }
    if (!bankAccountId) {
      setError('Please select a bank account.');
      return;
    }
    if (exceedsIncome) {
      setError(
        `Total allocations (${formatINR(allocatedTotal)}) cannot exceed income amount (${formatINR(parsedIncome)}).`
      );
      return;
    }

    const allocations: Array<{ category_id: number; amount: number }> = [];
    for (const [catIdStr, rawVal] of Object.entries(allocInputs)) {
      const amt = Number(rawVal);
      if (!rawVal || !Number.isFinite(amt) || amt === 0) continue;
      if (amt < 0) {
        setError('Category allocation amounts cannot be negative.');
        return;
      }
      allocations.push({
        category_id: Number(catIdStr),
        amount: roundMoney(amt),
      });
    }

    setSubmitting(true);
    try {
      const payload = {
        income_date: incomeDate,
        month,
        source,
        total_amount: parsedIncome,
        bank_account_id: bankAccountId,
        notes: notes.trim(),
        allocations,
      };

      if (editingIncome) {
        await apiFetch(`/api/income/${editingIncome.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        await onSuccess();
        if (onCancelEdit) onCancelEdit();
      } else {
        await apiFetch('/api/income', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setTotalAmount('');
        setNotes('');
        setAllocInputs({});
        setSuccess(
          `Recorded ${formatINR(parsedIncome)} (${source}) with ${formatINR(allocatedTotal)} allocated and ${formatINR(unallocated)} unallocated.`
        );
        await onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save income.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {editingIncome ? `Edit Income (${editingIncome.tx_code})` : 'Add Money (Income & Allocation)'}
          </h2>
          <p className="text-sm text-slate-500">
            Record incoming money to a bank account and distribute across your spending or savings categories.
          </p>
        </div>
        {editingIncome && onCancelEdit && (
          <button
            type="button"
            onClick={onCancelEdit}
            className="px-3.5 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
          >
            Cancel Edit
          </button>
        )}
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Income Details Card */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="text-base font-semibold text-slate-900 mb-4">
            Income Details
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Income Date <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                required
                value={incomeDate}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Month <span className="text-red-600">*</span>
              </label>
              <input
                type="month"
                required
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Income Source <span className="text-red-600">*</span>
              </label>
              <select
                value={source}
                onChange={(e) => setSource(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                <option value="Salary">Salary</option>
                <option value="Bonus">Bonus</option>
                <option value="Other Income">Other Income</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Total Income Amount (₹) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.01"
                required
                placeholder="e.g., 50000"
                value={totalAmount}
                onChange={(e) => setTotalAmount(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Receiving Bank Account <span className="text-red-600">*</span>
              </label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-600"
              >
                {bankAccounts.map((bank) => (
                  <option key={bank.id} value={bank.id}>
                    {bank.bank_name}
                    {bank.nickname ? ` (${bank.nickname})` : ''} — {formatINR(bank.current_balance)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g., November salary credit"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
              />
            </div>
          </div>
        </div>

        {/* Live Allocation Status Strip */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <span className="text-xs font-medium text-slate-500">Total Income</span>
            <div className="mt-0.5 text-lg font-bold text-emerald-600 font-mono-num">
              {formatINR(parsedIncome)}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500">Allocated to Categories</span>
            <div
              className={`mt-0.5 text-lg font-bold font-mono-num ${
                exceedsIncome ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {formatINR(allocatedTotal)}
            </div>
          </div>
          <div>
            <span className="text-xs font-medium text-slate-500">
              {exceedsIncome ? 'Over-Allocated By' : 'Unallocated Income'}
            </span>
            <div
              className={`mt-0.5 text-lg font-bold font-mono-num ${
                exceedsIncome ? 'text-red-600' : 'text-blue-600'
              }`}
            >
              {exceedsIncome
                ? `-${formatINR(Math.abs(unallocated))}`
                : formatINR(Math.max(0, unallocated))}
            </div>
          </div>
        </div>

        {/* Category Allocation Section */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">
                Category Allocations (Partial Allocation Allowed)
              </h3>
              <p className="text-xs text-slate-500">
                Leave categories blank or 0 if not allocating from this income. Unallocated funds remain tracked separately.
              </p>
            </div>

            {/* Quick Add Category */}
            <div className="flex w-full sm:w-auto items-center gap-2">
              <input
                type="text"
                placeholder="New category name"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddCategoryInline();
                  }
                }}
                className="flex-1 sm:w-48 min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="button"
                onClick={handleAddCategoryInline}
                disabled={addingCat || !newCatName.trim()}
                className="min-h-[44px] inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Mobile Stacked Allocation Cards */}
          <div className="md:hidden divide-y divide-slate-200 border border-slate-200 rounded-lg overflow-hidden">
            {categories.map((cat) => (
              <div key={cat.id} className="p-3.5 space-y-2.5 bg-white">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {editingCatId === cat.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingCatName}
                          onChange={(e) => setEditingCatName(e.target.value)}
                          className="flex-1 min-h-[40px] px-2.5 py-1 text-sm border border-slate-300 rounded"
                        />
                        <button
                          type="button"
                          onClick={() => handleSaveCategoryRename(cat)}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-emerald-600 hover:bg-emerald-50 rounded"
                          title="Save name"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCatId(null)}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:bg-slate-100 rounded"
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div>
                        <div className="font-semibold text-sm text-slate-900 truncate">
                          {cat.name}
                        </div>
                        <div className="text-xs text-slate-500 font-mono-num">
                          Current Remaining: {formatINR(cat.remaining_balance)}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCatId(cat.id);
                        setEditingCatName(cat.name);
                      }}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-blue-600 rounded"
                      title="Edit category"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteCategoryInline(cat)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-red-600 rounded"
                      title="Remove category"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  placeholder="Allocate amount (₹)"
                  aria-label={`Allocate amount for ${cat.name}`}
                  value={allocInputs[cat.id] ?? ''}
                  onChange={(e) => handleAllocChange(cat.id, e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-num text-right border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-600"
                />
              </div>
            ))}
          </div>

          {/* Desktop Allocation Table */}
          <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4 text-right">Current Remaining</th>
                  <th className="py-2.5 px-4 w-48">Allocate Amount (₹)</th>
                  <th className="py-2.5 px-4 text-right w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {categories.map((cat) => (
                  <tr key={cat.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-medium text-slate-900">
                      {editingCatId === cat.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={editingCatName}
                            onChange={(e) => setEditingCatName(e.target.value)}
                            className="px-2 py-1 text-sm border border-slate-300 rounded"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveCategoryRename(cat)}
                            className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                            title="Save name"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingCatId(null)}
                            className="p-1 text-slate-500 hover:bg-slate-100 rounded"
                            title="Cancel"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <span>{cat.name}</span>
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono-num text-xs text-slate-600">
                      {formatINR(cat.remaining_balance)}
                    </td>
                    <td className="py-2.5 px-4">
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        placeholder="0"
                        aria-label={`Allocate amount for ${cat.name}`}
                        value={allocInputs[cat.id] ?? ''}
                        onChange={(e) => handleAllocChange(cat.id, e.target.value)}
                        className="w-full px-3 py-1.5 text-sm font-mono-num text-right border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingCatId(cat.id);
                          setEditingCatName(cat.name);
                        }}
                        className="p-1 text-slate-400 hover:text-blue-600 rounded"
                        title="Edit category"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCategoryInline(cat)}
                        className="p-1 text-slate-400 hover:text-red-600 rounded ml-1"
                        title="Remove category"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs text-slate-500">
              {exceedsIncome
                ? 'Reduce category allocations so total does not exceed total income.'
                : 'Ready to save income and update bank & category balances atomically.'}
            </span>
            <button
              type="submit"
              disabled={submitting || exceedsIncome}
              className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {submitting
                ? 'Saving...'
                : editingIncome
                ? 'Update Income & Recalculate'
                : 'Save Income & Allocations'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};
