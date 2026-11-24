import React, { useState } from 'react';
import { Building2, Plus, Pencil, Trash2, AlertCircle, CheckCircle2, X } from 'lucide-react';
import type { BankAccount } from '../types';
import { apiFetch, formatINR } from '../lib/format';

interface BankAccountsViewProps {
  bankAccounts: BankAccount[];
  totalBankBalance: number;
  onRefresh: () => Promise<void>;
}

export const BankAccountsView: React.FC<BankAccountsViewProps> = ({
  bankAccounts,
  totalBankBalance,
  onRefresh,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [bankName, setBankName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [nickname, setNickname] = useState('');

  const [editingBank, setEditingBank] = useState<BankAccount | null>(null);
  const [editName, setEditName] = useState('');
  const [editNickname, setEditNickname] = useState('');
  const [editOpening, setEditOpening] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleAddBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!bankName.trim()) {
      setError('Bank name is required.');
      return;
    }
    const bal = openingBalance === '' ? 0 : Number(openingBalance);
    if (!Number.isFinite(bal) || bal < 0) {
      setError('Opening balance must be zero or positive.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/banks', {
        method: 'POST',
        body: JSON.stringify({
          bank_name: bankName.trim(),
          opening_balance: bal,
          nickname: nickname.trim(),
        }),
      });
      setBankName('');
      setOpeningBalance('');
      setNickname('');
      setShowAddForm(false);
      setSuccess('Bank account added successfully.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add bank account.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEdit = (bank: BankAccount) => {
    setError(null);
    setSuccess(null);
    setEditingBank(bank);
    setEditName(bank.bank_name);
    setEditNickname(bank.nickname || '');
    setEditOpening(String(bank.opening_balance));
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBank) return;
    setError(null);
    setSuccess(null);

    if (!editName.trim()) {
      setError('Bank name is required.');
      return;
    }
    const opBal = Number(editOpening);
    if (!Number.isFinite(opBal) || opBal < 0) {
      setError('Opening balance must be zero or positive.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/api/banks/${editingBank.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          bank_name: editName.trim(),
          nickname: editNickname.trim(),
          opening_balance: opBal,
        }),
      });
      setEditingBank(null);
      setSuccess('Bank account updated successfully.');
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update bank account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteBank = async (bank: BankAccount) => {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/banks/${bank.id}`, { method: 'DELETE' });
      setSuccess(`Removed bank account "${bank.bank_name}".`);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete bank account.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Bank Accounts
          </h2>
          <p className="text-sm text-slate-500">
            Total Holdings:{' '}
            <span className="font-semibold text-blue-600 font-mono-num">
              {formatINR(totalBankBalance)}
            </span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setSuccess(null);
            setShowAddForm((prev) => !prev);
          }}
          className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Add Bank Account</span>
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

      {showAddForm && (
        <form
          onSubmit={handleAddBank}
          className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-slate-900">New Bank Account</h3>
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="text-slate-400 hover:text-slate-600 p-1"
              aria-label="Close form"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Bank Name <span className="text-red-600">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g., HDFC, ICICI"
                value={bankName}
                onChange={(e) => setBankName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Opening Balance (₹) <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                required
                placeholder="0"
                value={openingBalance}
                onChange={(e) => setOpeningBalance(e.target.value)}
                className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Nickname (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g., Household Savings"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setShowAddForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
            >
              {submitting ? 'Saving...' : 'Save Bank Account'}
            </button>
          </div>
        </form>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bankAccounts.map((bank) => (
          <div
            key={bank.id}
            className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shrink-0">
                    <Building2 className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900 truncate">
                      {bank.bank_name}
                    </h3>
                    <p className="text-xs text-slate-500 truncate">
                      {bank.nickname || 'No nickname'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => openEdit(bank)}
                    className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                    title="Edit bank account"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  {bankAccounts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDeleteBank(bank)}
                      className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                      title="Delete bank account"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <div className="text-xs text-slate-500">Current Balance</div>
                <div className="mt-1 text-2xl font-bold text-blue-600 font-mono-num">
                  {formatINR(bank.current_balance)}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
              <span>Opening balance</span>
              <span className="font-mono-num text-slate-700 font-medium">
                {formatINR(bank.opening_balance)}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Edit Bank Modal */}
      {editingBank && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 pb-safe">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-slate-900">Edit Bank Account</h3>
              <button
                type="button"
                onClick={() => setEditingBank(null)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Bank Name <span className="text-red-600">*</span>
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
                  Nickname
                </label>
                <input
                  type="text"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Opening Balance (₹)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  required
                  value={editOpening}
                  onChange={(e) => setEditOpening(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm font-mono-num border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Adjusting opening balance updates current balance by the same difference.
                </p>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingBank(null)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
                >
                  {submitting ? 'Updating...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
