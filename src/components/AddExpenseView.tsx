import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import type { BankAccount, CategorySummary, UnifiedTransaction } from '../types';
import {
  apiFetch,
  currentMonthISO,
  formatINR,
  roundMoney,
  todayISO,
} from '../lib/format';

interface AddExpenseViewProps {
  bankAccounts: BankAccount[];
  categories: CategorySummary[];
  preselectedCategoryId?: number;
  editingExpense?: UnifiedTransaction | null;
  onCancelEdit?: () => void;
  onSuccess: () => Promise<void>;
}

export const AddExpenseView: React.FC<AddExpenseViewProps> = ({
  bankAccounts,
  categories,
  preselectedCategoryId,
  editingExpense,
  onCancelEdit,
  onSuccess,
}) => {
  const [expenseDate, setExpenseDate] = useState(
    editingExpense ? editingExpense.date : todayISO()
  );
  const [month, setMonth] = useState(
    editingExpense ? editingExpense.month : currentMonthISO()
  );
  const [amount, setAmount] = useState(
    editingExpense ? String(editingExpense.amount) : ''
  );
  const [categoryId, setCategoryId] = useState<number>(() => {
    if (editingExpense?.category_id) return editingExpense.category_id;
    if (preselectedCategoryId) return preselectedCategoryId;
    const funded = categories.find((c) => c.remaining_balance > 0);
    return funded?.id ?? categories[0]?.id ?? 0;
  });
  const [subcategory, setSubcategory] = useState(editingExpense?.subcategory || '');
  const [bankAccountId, setBankAccountId] = useState<number>(
    editingExpense ? editingExpense.bank_account_id : bankAccounts[0]?.id ?? 0
  );
  const [description, setDescription] = useState(editingExpense?.description || '');
  const [notes, setNotes] = useState(editingExpense?.notes || '');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (preselectedCategoryId && !editingExpense) {
      setCategoryId(preselectedCategoryId);
    }
  }, [preselectedCategoryId, editingExpense]);

  useEffect(() => {
    if (!bankAccountId && bankAccounts.length > 0) {
      setBankAccountId(bankAccounts[0].id);
    }
  }, [bankAccounts, bankAccountId]);

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId]
  );

  const selectedBank = useMemo(
    () => bankAccounts.find((b) => b.id === bankAccountId) ?? null,
    [bankAccounts, bankAccountId]
  );

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? roundMoney(n) : 0;
  }, [amount]);

  const effectiveCatAvailable = useMemo(() => {
    if (!selectedCategory) return 0;
    if (editingExpense && editingExpense.category_id === selectedCategory.id) {
      return roundMoney(selectedCategory.remaining_balance + editingExpense.amount);
    }
    return selectedCategory.remaining_balance;
  }, [selectedCategory, editingExpense]);

  const effectiveBankAvailable = useMemo(() => {
    if (!selectedBank) return 0;
    if (editingExpense && editingExpense.bank_account_id === selectedBank.id) {
      return roundMoney(selectedBank.current_balance + editingExpense.amount);
    }
    return selectedBank.current_balance;
  }, [selectedBank, editingExpense]);

  const insufficientCategory = parsedAmount > 0 && parsedAmount > effectiveCatAvailable;
  const insufficientBank = parsedAmount > 0 && parsedAmount > effectiveBankAvailable;

  const handleDateChange = (val: string) => {
    setExpenseDate(val);
    if (/^\d{4}-\d{2}-\d{2}$/.test(val) && !editingExpense) {
      setMonth(val.slice(0, 7));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (parsedAmount <= 0) {
      setError('Expense amount must be a positive number.');
      return;
    }
    if (!categoryId) {
      setError('Please select a category.');
      return;
    }
    if (!bankAccountId) {
      setError('Please select a bank account.');
      return;
    }
    if (!description.trim()) {
      setError('Please enter an expense description.');
      return;
    }
    if (insufficientCategory) {
      setError(
        `Insufficient category balance in "${selectedCategory?.name}". Available: ${formatINR(effectiveCatAvailable)}, Expense: ${formatINR(parsedAmount)}.`
      );
      return;
    }
    if (insufficientBank) {
      setError(
        `Insufficient bank balance in "${selectedBank?.bank_name}". Available: ${formatINR(effectiveBankAvailable)}, Expense: ${formatINR(parsedAmount)}.`
      );
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        expense_date: expenseDate,
        month,
        category_id: categoryId,
        subcategory: subcategory.trim(),
        amount: parsedAmount,
        bank_account_id: bankAccountId,
        description: description.trim(),
        notes: notes.trim(),
      };

      if (editingExpense) {
        await apiFetch(`/api/expenses/${editingExpense.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        await onSuccess();
        if (onCancelEdit) onCancelEdit();
      } else {
        await apiFetch('/api/expenses', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setAmount('');
        setDescription('');
        setSubcategory('');
        setNotes('');
        setSuccess(
          `Recorded expense of ${formatINR(parsedAmount)} under ${selectedCategory?.name} from ${selectedBank?.bank_name}.`
        );
        await onSuccess();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record expense.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            {editingExpense ? `Edit Expense (${editingExpense.tx_code})` : 'Add Expense'}
          </h2>
          <p className="text-sm text-slate-500">
            Spending deducts from both the selected category balance and the selected bank account balance.
          </p>
        </div>
        {editingExpense && onCancelEdit && (
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

      <form
        onSubmit={handleSubmit}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-5"
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Expense Date <span className="text-red-600">*</span>
            </label>
            <input
              type="date"
              required
              value={expenseDate}
              onChange={(e) => handleDateChange(e.target.value)}
              className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
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
              className="w-full px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Category <span className="text-red-600">*</span>
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name} (Avail: {formatINR(cat.remaining_balance)})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Subcategory <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="e.g., Dinner, Vegetables, Petrol"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Bank Account <span className="text-red-600">*</span>
            </label>
            <select
              value={bankAccountId}
              onChange={(e) => setBankAccountId(Number(e.target.value))}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-red-600"
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
              Amount (₹) <span className="text-red-600">*</span>
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              required
              placeholder="e.g., 2000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
            />
          </div>
        </div>

        {/* Live Available Balances Check */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-600">
              {selectedCategory?.name || 'Category'} Available:
            </span>
            <span
              className={`font-semibold font-mono-num ${
                insufficientCategory ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {formatINR(effectiveCatAvailable)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-600">
              {selectedBank?.bank_name || 'Bank'} Available:
            </span>
            <span
              className={`font-semibold font-mono-num ${
                insufficientBank ? 'text-red-600' : 'text-blue-600'
              }`}
            >
              {formatINR(effectiveBankAvailable)}
            </span>
          </div>
        </div>

        {(insufficientCategory || insufficientBank) && (
          <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            {insufficientCategory && (
              <div>
                Selected category balance is insufficient ({formatINR(effectiveCatAvailable)} available vs {formatINR(parsedAmount)} required).
              </div>
            )}
            {insufficientBank && (
              <div>
                Selected bank balance is insufficient ({formatINR(effectiveBankAvailable)} available vs {formatINR(parsedAmount)} required).
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Description <span className="text-red-600">*</span>
          </label>
          <input
            type="text"
            required
            placeholder="e.g., Weekly groceries and lunch"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Notes <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <textarea
            rows={2}
            placeholder="Additional details..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-600"
          />
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={submitting || insufficientCategory || insufficientBank}
            className="w-full sm:w-auto min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap"
          >
            {submitting
              ? 'Recording...'
              : editingExpense
              ? 'Update Expense & Recalculate'
              : 'Record Expense'}
          </button>
        </div>
      </form>
    </div>
  );
};
