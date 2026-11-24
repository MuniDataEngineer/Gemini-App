import React, { useState } from 'react';
import {
  Lock,
  User,
  Eye,
  EyeOff,
  AlertCircle,
  ArrowRight,
  Database,
  ShieldCheck,
} from 'lucide-react';
import type { AuthUser } from '../types';
import { apiFetch } from '../lib/format';

interface AuthScreenProps {
  hasUsers: boolean;
  hasLegacyData: boolean;
  onAuthenticated: (token: string, user: AuthUser) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  hasUsers,
  hasLegacyData,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(hasUsers ? 'login' : 'register');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedUser = username.trim();
    if (trimmedUser.length < 3) {
      setError('Username must be at least 3 characters.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('Passwords do not match.');
        return;
      }
    }

    setSubmitting(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body =
        mode === 'register'
          ? {
              username: trimmedUser,
              display_name: displayName.trim(),
              password,
            }
          : {
              username: trimmedUser,
              password,
            };

      const res = await apiFetch<{ token: string; user: AuthUser }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onAuthenticated(res.token, res.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600 shrink-0">
              <Lock className="w-4 h-4" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">RupeeLedger</h1>
              <p className="text-xs text-slate-500">Personal Finance & SQLite Vault</p>
            </div>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            type="button"
            onClick={() => switchMode('login')}
            className={`min-h-[42px] text-sm font-medium rounded-md transition-colors ${
              mode === 'login'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => switchMode('register')}
            className={`min-h-[42px] text-sm font-medium rounded-md transition-colors ${
              mode === 'register'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Create Account
          </button>
        </div>

        {hasLegacyData && mode === 'register' && (
          <div className="p-3.5 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2.5 text-xs text-blue-800">
            <Database className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
            <span>
              Existing local ledger records were found in SQLite. Create your first username and
              password below to claim and protect that data.
            </span>
          </div>
        )}

        {!hasUsers && mode === 'register' && !hasLegacyData && (
          <div className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 flex items-start gap-2.5 text-xs text-slate-600">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0 text-blue-600" />
            <span>
              Choose your own username and password to initialize your private SQLite finance ledger.
            </span>
          </div>
        )}

        {error && (
          <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2.5 text-sm text-red-700">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="auth-username"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Username <span className="text-red-600">*</span>
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="auth-username"
                type="text"
                autoComplete="username"
                required
                placeholder="e.g., rahul_fin"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full min-h-[44px] pl-10 pr-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label
                htmlFor="auth-display-name"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Display Name <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="auth-display-name"
                type="text"
                autoComplete="name"
                placeholder="e.g., Rahul Sharma"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="auth-password"
              className="block text-sm font-medium text-slate-700 mb-1.5"
            >
              Password <span className="text-red-600">*</span>
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                required
                minLength={6}
                placeholder={mode === 'register' ? 'Minimum 6 characters' : 'Enter your password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full min-h-[44px] pl-10 pr-11 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 min-h-[38px] min-w-[38px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-md"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {mode === 'register' && (
            <div>
              <label
                htmlFor="auth-confirm-password"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Confirm Password <span className="text-red-600">*</span>
              </label>
              <input
                id="auth-confirm-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={6}
                placeholder="Re-enter your password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full min-h-[44px] px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[44px] mt-2 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap"
          >
            <span>
              {submitting
                ? mode === 'register'
                  ? 'Creating Account...'
                  : 'Signing In...'
                : mode === 'register'
                ? 'Create Account & Continue'
                : 'Sign In'}
            </span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="pt-4 border-t border-slate-200 text-xs text-slate-500 space-y-1">
          <p>
            All bank accounts, income allocations, expenses, and reports are saved locally in SQLite
            (<span className="font-mono-num text-slate-700">data/finance.db</span>) and isolated per user.
          </p>
        </div>
      </div>
    </div>
  );
};
