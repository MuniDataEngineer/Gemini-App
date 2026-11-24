import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Building2,
  PlusCircle,
  MinusCircle,
  Tags,
  History,
  BarChart3,
  Menu,
  X,
  Plus,
  Minus,
  LogOut,
  KeyRound,
  User,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { AuthUser, BootstrapData, NavPage } from './types';
import {
  apiFetch,
  formatINR,
  setAuthToken,
  setUnauthorizedHandler,
} from './lib/format';
import { AuthScreen } from './components/AuthScreen';
import { InitialBankSetup } from './components/InitialBankSetup';
import { DashboardView } from './components/DashboardView';
import { BankAccountsView } from './components/BankAccountsView';
import { AddMoneyView } from './components/AddMoneyView';
import { AddExpenseView } from './components/AddExpenseView';
import { CategoriesView } from './components/CategoriesView';
import { TransactionHistoryView } from './components/TransactionHistoryView';
import { MonthlyReportsView } from './components/MonthlyReportsView';

const NAV_ITEMS: Array<{
  id: NavPage;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'banks', label: 'Bank Accounts', icon: Building2 },
  { id: 'add-money', label: 'Add Money', icon: PlusCircle },
  { id: 'add-expense', label: 'Add Expense', icon: MinusCircle },
  { id: 'categories', label: 'Categories', icon: Tags },
  { id: 'history', label: 'Transaction History', icon: History },
  { id: 'reports', label: 'Monthly Reports', icon: BarChart3 },
];

export default function App() {
  const [authStatus, setAuthStatus] = useState<{
    checked: boolean;
    hasUsers: boolean;
    hasLegacyData: boolean;
  }>({ checked: false, hasUsers: false, hasLegacyData: false });

  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);

  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activePage, setActivePage] = useState<NavPage>('dashboard');
  const [preselectedCategoryId, setPreselectedCategoryId] = useState<number | undefined>(
    undefined
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Change Password modal state
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const status = await apiFetch<{ hasUsers: boolean; hasLegacyData: boolean }>(
        '/api/auth/status'
      );
      setAuthStatus({
        checked: true,
        hasUsers: status.hasUsers,
        hasLegacyData: status.hasLegacyData,
      });
    } catch {
      setAuthStatus((prev) => ({ ...prev, checked: true }));
    }
  }, []);

  const clearSession = useCallback(() => {
    setAuthToken(null);
    setToken(null);
    setCurrentUser(null);
    setBootstrap(null);
    setLoadError(null);
    setMobileMenuOpen(false);
    setPasswordModalOpen(false);
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  useEffect(() => {
    void refreshAuthStatus();
  }, [refreshAuthStatus]);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    try {
      setLoadError(null);
      const data = await apiFetch<BootstrapData>('/api/bootstrap');
      setBootstrap(data);
      if (data.user) {
        setCurrentUser(data.user);
      }
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Unable to connect to local finance database.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAuthenticated = (nextToken: string, user: AuthUser) => {
    setAuthToken(nextToken);
    setToken(nextToken);
    setCurrentUser(user);
    setActivePage('dashboard');
    void loadBootstrap();
  };

  const handleSignOut = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Clear local session regardless
    } finally {
      clearSession();
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);

    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setUpdatingPassword(true);
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          current_password: currentPassword,
          new_password: newPassword,
        }),
      });
      setPasswordSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleNavigate = (page: NavPage, categoryId?: number) => {
    setPreselectedCategoryId(categoryId);
    setActivePage(page);
    setMobileMenuOpen(false);
  };

  if (!authStatus.checked) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="text-sm text-slate-500">Connecting to RupeeLedger...</div>
      </div>
    );
  }

  if (!token) {
    return (
      <AuthScreen
        hasUsers={authStatus.hasUsers}
        hasLegacyData={authStatus.hasLegacyData}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  if (loading && !bootstrap) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="text-sm text-slate-500">Loading your RupeeLedger vault...</div>
      </div>
    );
  }

  if (loadError || !bootstrap) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center p-6">
        <div className="max-w-md w-full border border-red-200 bg-red-50 rounded-xl p-6 text-center space-y-3">
          <div className="text-base font-semibold text-red-800">
            Database Connection Error
          </div>
          <p className="text-sm text-red-700">{loadError}</p>
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => void loadBootstrap()}
              className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
            >
              Retry
            </button>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (bootstrap.needsSetup) {
    return (
      <InitialBankSetup
        username={currentUser?.username}
        onSignOut={handleSignOut}
        onComplete={loadBootstrap}
      />
    );
  }

  const activeNavLabel =
    NAV_ITEMS.find((n) => n.id === activePage)?.label ?? 'Dashboard';

  const isMoreActive =
    activePage === 'banks' || activePage === 'categories' || activePage === 'reports';

  const userDisplay = currentUser?.display_name?.trim() || currentUser?.username || 'User';

  return (
    <div className="min-h-screen bg-white text-slate-900 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 border-r border-slate-200 bg-slate-50/50">
        <div className="h-16 px-6 border-b border-slate-200 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
            RupeeLedger
          </span>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleNavigate(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 font-semibold'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 shrink-0 ${
                    isActive ? 'text-blue-600' : 'text-slate-400'
                  }`}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-slate-200 space-y-3">
          <div>
            <div className="text-xs text-slate-500">Total Bank Balance</div>
            <div className="mt-1 text-base font-bold text-blue-600 font-mono-num">
              {formatINR(bootstrap.totals.totalBankBalance)}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-200 space-y-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-slate-900 truncate">
                  {userDisplay}
                </div>
                <div className="text-[11px] text-slate-500 truncate">
                  @{currentUser?.username}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPasswordError(null);
                  setPasswordSuccess(null);
                  setPasswordModalOpen(true);
                }}
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 rounded-md transition-colors"
              >
                <KeyRound className="w-3 h-3" />
                <span>Password</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium text-red-600 hover:text-red-700 bg-white border border-slate-200 hover:bg-red-50 rounded-md transition-colors"
              >
                <LogOut className="w-3 h-3" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile / Tablet Slide-Out Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative w-72 max-w-[82vw] bg-white border-r border-slate-200 flex flex-col z-10">
            <div className="h-14 px-5 border-b border-slate-200 flex items-center justify-between">
              <span className="text-lg font-bold tracking-tight text-slate-900">
                RupeeLedger
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="min-h-[44px] min-w-[44px] -mr-2 flex items-center justify-center text-slate-500 hover:text-slate-900 rounded-lg"
                aria-label="Close navigation"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activePage === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNavigate(item.id)}
                    className={`w-full min-h-[44px] flex items-center gap-3 px-3.5 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap ${
                      isActive
                        ? 'bg-blue-50 text-blue-700 font-semibold'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-blue-600' : 'text-slate-400'
                      }`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-200 pb-safe bg-slate-50 space-y-3">
              <div>
                <div className="text-xs text-slate-500">Total Bank Balance</div>
                <div className="mt-0.5 text-base font-bold text-blue-600 font-mono-num">
                  {formatINR(bootstrap.totals.totalBankBalance)}
                </div>
              </div>
              <div className="pt-2.5 border-t border-slate-200 space-y-2">
                <div className="text-xs text-slate-600 truncate">
                  Signed in as <span className="font-semibold text-slate-900">@{currentUser?.username}</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setPasswordError(null);
                      setPasswordSuccess(null);
                      setPasswordModalOpen(true);
                    }}
                    className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Password</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="min-h-[40px] inline-flex items-center justify-center gap-1.5 px-2.5 text-xs font-medium text-red-600 bg-white border border-red-200 rounded-lg"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 lg:h-16 px-4 sm:px-8 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden min-h-[44px] min-w-[44px] -ml-2 flex items-center justify-center text-slate-600 hover:text-slate-900 rounded-lg"
              aria-label="Open navigation"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-sm truncate">
              <span className="text-slate-400 hidden sm:inline">Personal Finance</span>
              <span className="text-slate-300 hidden sm:inline">/</span>
              <span className="font-semibold text-slate-900 truncate">
                {activeNavLabel}
              </span>
            </div>
          </div>

          {/* Mobile compact balance display in header */}
          <button
            type="button"
            onClick={() => handleNavigate('banks')}
            className="sm:hidden text-right shrink-0 py-1 px-2 rounded-lg active:bg-slate-100"
          >
            <div className="text-[10px] text-slate-500 leading-tight">Bank Total</div>
            <div className="text-xs font-bold text-blue-600 font-mono-num leading-tight">
              {formatINR(bootstrap.totals.totalBankBalance)}
            </div>
          </button>

          {/* Tablet / Desktop Quick Actions */}
          <div className="hidden sm:flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => handleNavigate('add-money')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Money</span>
            </button>
            <button
              type="button"
              onClick={() => handleNavigate('add-expense')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Minus className="w-3.5 h-3.5" />
              <span>Add Expense</span>
            </button>
          </div>
        </header>

        {/* Viewport Content */}
        <main className="flex-1 p-4 sm:p-6 lg:p-8 pb-24 lg:pb-8 max-w-7xl w-full mx-auto">
          {activePage === 'dashboard' && (
            <DashboardView data={bootstrap} onNavigate={handleNavigate} />
          )}
          {activePage === 'banks' && (
            <BankAccountsView
              bankAccounts={bootstrap.bankAccounts}
              totalBankBalance={bootstrap.totals.totalBankBalance}
              onRefresh={loadBootstrap}
            />
          )}
          {activePage === 'add-money' && (
            <AddMoneyView
              bankAccounts={bootstrap.bankAccounts}
              categories={bootstrap.categories}
              onSuccess={loadBootstrap}
            />
          )}
          {activePage === 'add-expense' && (
            <AddExpenseView
              bankAccounts={bootstrap.bankAccounts}
              categories={bootstrap.categories}
              preselectedCategoryId={preselectedCategoryId}
              onSuccess={loadBootstrap}
            />
          )}
          {activePage === 'categories' && (
            <CategoriesView
              categories={bootstrap.categories}
              onRefresh={loadBootstrap}
            />
          )}
          {activePage === 'history' && (
            <TransactionHistoryView
              bankAccounts={bootstrap.bankAccounts}
              categories={bootstrap.categories}
              onRefreshBootstrap={loadBootstrap}
            />
          )}
          {activePage === 'reports' && (
            <MonthlyReportsView onRefreshBootstrap={loadBootstrap} />
          )}
        </main>
      </div>

      {/* Change Password Modal */}
      {passwordModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-end sm:items-center justify-center sm:p-4">
          <div className="w-full sm:max-w-md bg-white border border-slate-200 rounded-t-2xl sm:rounded-xl p-5 sm:p-6 space-y-4 pb-safe">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Change Password</h3>
                <p className="text-xs text-slate-500">Account: @{currentUser?.username}</p>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {passwordError && (
              <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-start gap-2 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{passwordError}</span>
              </div>
            )}

            {passwordSuccess && (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2 text-xs text-emerald-700">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{passwordSuccess}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Current Password
                </label>
                <input
                  type="password"
                  required
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  New Password (min 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm New Password
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  className="min-h-[44px] px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={updatingPassword}
                  className="min-h-[44px] px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg"
                >
                  {updatingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Fixed Mobile Bottom Navigation Bar (Thumb Zone, <=15% height) */}
      <nav
        aria-label="Mobile quick navigation"
        className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 pb-safe"
      >
        <div className="grid grid-cols-5 h-16">
          <button
            type="button"
            onClick={() => handleNavigate('dashboard')}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 transition-colors ${
              activePage === 'dashboard'
                ? 'text-blue-600 font-semibold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            <span className="text-[10px] leading-tight">Home</span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('add-money')}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 transition-colors ${
              activePage === 'add-money'
                ? 'text-emerald-600 font-semibold'
                : 'text-slate-500 hover:text-emerald-600'
            }`}
          >
            <PlusCircle className="w-5 h-5" />
            <span className="text-[10px] leading-tight">Income</span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('add-expense')}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 transition-colors ${
              activePage === 'add-expense'
                ? 'text-red-600 font-semibold'
                : 'text-slate-500 hover:text-red-600'
            }`}
          >
            <MinusCircle className="w-5 h-5" />
            <span className="text-[10px] leading-tight">Expense</span>
          </button>

          <button
            type="button"
            onClick={() => handleNavigate('history')}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 transition-colors ${
              activePage === 'history'
                ? 'text-blue-600 font-semibold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <History className="w-5 h-5" />
            <span className="text-[10px] leading-tight">History</span>
          </button>

          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className={`flex flex-col items-center justify-center min-h-[44px] gap-0.5 transition-colors ${
              isMoreActive
                ? 'text-blue-600 font-semibold'
                : 'text-slate-500 hover:text-slate-900'
            }`}
          >
            <BarChart3 className="w-5 h-5" />
            <span className="text-[10px] leading-tight">More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
