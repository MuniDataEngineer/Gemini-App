import React, { useState } from 'react';
import { Building2, Upload, ArrowRight, AlertCircle, LogOut } from 'lucide-react';
import { apiFetch, getAuthToken } from '../lib/format';

interface InitialBankSetupProps {
  username?: string;
  onSignOut?: () => void;
  onComplete: () => Promise<void>;
}

export const InitialBankSetup: React.FC<InitialBankSetupProps> = ({
  username,
  onSignOut,
  onComplete,
}) => {
  const [bankName, setBankName] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedName = bankName.trim();
    if (!trimmedName) {
      setError('Please enter a bank name (for example, SBI or HDFC).');
      return;
    }

    const balNum = openingBalance === '' ? 0 : Number(openingBalance);
    if (!Number.isFinite(balNum) || balNum < 0) {
      setError('Opening balance must be zero or a positive amount.');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/banks', {
        method: 'POST',
        body: JSON.stringify({
          bank_name: trimmedName,
          opening_balance: balNum,
          nickname: nickname.trim(),
        }),
      });
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save bank account.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setRestoring(true);
    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        await apiFetch('/api/restore/json', {
          method: 'POST',
          body: text,
        });
      } else {
        const buf = await file.arrayBuffer();
        const token = getAuthToken();
        const res = await fetch('/api/restore/sqlite', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: buf,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to restore SQLite backup.');
        }
      }
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-lg bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">
                Initial Bank Setup
              </h1>
              <p className="text-sm text-slate-500">
                {username
                  ? `Signed in as @${username}. Add your primary bank account to start.`
                  : 'Add your primary bank account to start tracking balances, income, and expenses.'}
              </p>
            </div>
          </div>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg shrink-0"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Sign Out</span>
            </button>
          )}
        </div>

        {error && (
          <div className="mb-5 p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="setup-bank-name"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Bank Name <span className="text-red-600">*</span>
            </label>
            <input
              id="setup-bank-name"
              type="text"
              required
              placeholder="e.g., SBI, HDFC, ICICI"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="setup-opening-balance"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Opening Balance (₹) <span className="text-red-600">*</span>
            </label>
            <input
              id="setup-opening-balance"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              required
              placeholder="e.g., 100000"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className="w-full min-h-[44px] px-3.5 py-2.5 text-sm font-mono-num bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
          </div>

          <div>
            <label
              htmlFor="setup-nickname"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Nickname <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="setup-nickname"
              type="text"
              placeholder="e.g., Salary Account, Primary Savings"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <span>{submitting ? 'Creating Account...' : 'Create Bank Account & Continue'}</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="mt-6 pt-5 border-t border-slate-200 flex items-center justify-between gap-4">
          <span className="text-xs text-slate-500">
            Have an existing RupeeLedger backup?
          </span>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>{restoring ? 'Restoring...' : 'Restore .db / .json'}</span>
            <input
              type="file"
              accept=".db,.sqlite,.json"
              onChange={handleRestoreFile}
              disabled={restoring}
              className="hidden"
            />
          </label>
        </div>
      </div>
    </div>
  );
};
