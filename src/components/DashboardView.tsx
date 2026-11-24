import React, { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  Building2,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type { BootstrapData, NavPage } from '../types';
import { formatDateShort, formatINR } from '../lib/format';

interface DashboardViewProps {
  data: BootstrapData;
  onNavigate: (page: NavPage, preselectedCategoryId?: number) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ data, onNavigate }) => {
  const [showBankBreakdown, setShowBankBreakdown] = useState(false);

  const { bankAccounts, categories, totals, recentTransactions } = data;
  const activeCategories = categories.filter(
    (c) => c.allocated_amount > 0 || c.spent_amount > 0 || c.remaining_balance !== 0
  );
  const displayCategories = activeCategories.length > 0 ? categories : categories;

  return (
    <div className="space-y-8">
      {/* Primary Hero Balance + Action Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Clickable Total Bank Balance Card */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
          <div>
            <button
              type="button"
              onClick={() => setShowBankBreakdown((prev) => !prev)}
              aria-expanded={showBankBreakdown}
              className="w-full text-left group focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg"
            >
              <div className="flex items-center justify-between gap-4">
                <span className="text-sm font-medium text-slate-600">
                  Total Bank Balance
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 group-hover:text-blue-700 whitespace-nowrap shrink-0">
                  <span>
                    {showBankBreakdown ? 'Hide breakdown' : `View ${bankAccounts.length} bank breakdown`}
                  </span>
                  {showBankBreakdown ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </span>
              </div>
              <div className="mt-2 text-3xl sm:text-4xl font-bold text-blue-600 font-mono-num tracking-tight">
                {formatINR(totals.totalBankBalance)}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Click total balance to inspect individual bank holdings ({bankAccounts.length}{' '}
                {bankAccounts.length === 1 ? 'account' : 'accounts'})
              </p>
            </button>

            {showBankBreakdown && (
              <div className="mt-5 pt-4 border-t border-slate-200">
                <div className="space-y-2.5">
                  {bankAccounts.map((bank) => (
                    <div
                      key={bank.id}
                      className="flex items-center justify-between gap-4 py-1.5 px-2.5 rounded-lg bg-slate-50"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Building2 className="w-4 h-4 text-blue-600 shrink-0" />
                        <div className="truncate">
                          <span className="text-sm font-semibold text-slate-900">
                            {bank.bank_name}
                          </span>
                          {bank.nickname && (
                            <span className="text-xs text-slate-500 ml-2">
                              · {bank.nickname}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-blue-600 font-mono-num shrink-0">
                        {formatINR(bank.current_balance)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2.5 sm:gap-3">
            <button
              type="button"
              onClick={() => onNavigate('add-money')}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Money</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('add-expense')}
              className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Minus className="w-4 h-4" />
              <span>Add Expense</span>
            </button>
            <button
              type="button"
              onClick={() => onNavigate('banks')}
              className="col-span-2 sm:col-span-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <span>Manage Banks</span>
            </button>
          </div>
        </div>

        {/* Summary Metrics Grid */}
        <div className="lg:col-span-5 grid grid-cols-2 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">Total Income Recorded</span>
            <div className="mt-2 text-xl sm:text-2xl font-bold text-emerald-600 font-mono-num">
              {formatINR(totals.totalIncome)}
            </div>
            <span className="mt-2 text-xs text-slate-500">Cumulative inflows</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">Total Expenses Spent</span>
            <div className="mt-2 text-xl sm:text-2xl font-bold text-red-600 font-mono-num">
              {formatINR(totals.totalExpenses)}
            </div>
            <span className="mt-2 text-xs text-slate-500">Cumulative outflows</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">Allocated to Categories</span>
            <div className="mt-2 text-xl sm:text-2xl font-bold text-slate-900 font-mono-num">
              {formatINR(totals.totalAllocated)}
            </div>
            <span className="mt-2 text-xs text-slate-500">Assigned budgets</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
            <span className="text-xs font-medium text-slate-500">Unallocated Income</span>
            <div className="mt-2 text-xl sm:text-2xl font-bold text-slate-900 font-mono-num">
              {formatINR(totals.totalUnallocated)}
            </div>
            <span className="mt-2 text-xs text-slate-500">Available to allocate</span>
          </div>
        </div>
      </div>

      {/* Category Balances Section */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Category Balances
            </h2>
            <p className="text-sm text-slate-500">
              Remaining = Allocated Amount − Total Expenses
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('categories')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
          >
            Manage Categories
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {displayCategories.map((cat) => {
            const pctSpent =
              cat.allocated_amount > 0
                ? Math.min(100, Math.round((cat.spent_amount / cat.allocated_amount) * 100))
                : 0;

            return (
              <div
                key={cat.id}
                className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between hover:border-slate-300 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">
                      {cat.name}
                    </h3>
                    <button
                      type="button"
                      onClick={() => onNavigate('add-expense', cat.id)}
                      className="min-h-[36px] px-2 -mr-2 text-xs font-medium text-red-600 hover:text-red-700 whitespace-nowrap shrink-0"
                    >
                      Spend
                    </button>
                  </div>

                  <div className="mt-2 text-xl font-bold font-mono-num text-slate-900">
                    {formatINR(cat.remaining_balance)}
                  </div>
                  <div className="text-xs text-slate-500">Remaining balance</div>
                </div>

                <div className="mt-4">
                  <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        pctSpent >= 90
                          ? 'bg-red-600'
                          : pctSpent >= 70
                          ? 'bg-amber-500'
                          : 'bg-blue-600'
                      }`}
                      style={{ width: `${pctSpent}%` }}
                    />
                  </div>

                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-500 font-mono-num">
                    <span>Alloc: {formatINR(cat.allocated_amount)}</span>
                    <span>Spent: {formatINR(cat.spent_amount)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Recent Transactions */}
      <section>
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 tracking-tight">
              Recent Activity
            </h2>
            <p className="text-sm text-slate-500">
              Latest recorded income and expense entries
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('history')}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
          >
            View All History
          </button>
        </div>

        {recentTransactions.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <p className="text-sm text-slate-600">
              No income or expense transactions recorded yet.
            </p>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => onNavigate('add-money')}
                className="px-4 py-2 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors"
              >
                Add First Income
              </button>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            {/* Mobile Tap-Friendly List */}
            <div className="md:hidden divide-y divide-slate-100">
              {recentTransactions.map((tx) => (
                <button
                  key={tx.uid}
                  type="button"
                  onClick={() => onNavigate('history')}
                  className="w-full text-left px-4 py-3.5 min-h-[60px] flex items-center justify-between gap-3 hover:bg-slate-50 active:bg-slate-100 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono-num">{tx.tx_code}</span>
                      <span>·</span>
                      <span>{formatDateShort(tx.date)}</span>
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-slate-900 truncate">
                      {tx.tx_type === 'income'
                        ? `${tx.source} (${tx.allocations?.length ?? 0} categories)`
                        : `${tx.category_name} · ${tx.description}`}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {tx.bank_name}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-bold font-mono-num ${
                        tx.tx_type === 'income' ? 'text-emerald-600' : 'text-red-600'
                      }`}
                    >
                      {tx.tx_type === 'income' ? '+' : '-'}
                      {formatINR(tx.amount)}
                    </div>
                    <div
                      className={`text-[11px] font-medium ${
                        tx.tx_type === 'income' ? 'text-emerald-700' : 'text-red-700'
                      }`}
                    >
                      {tx.tx_type === 'income' ? 'Income' : 'Expense'}
                    </div>
                  </div>
                </button>
              ))}
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                    <th className="py-3 px-4">ID</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Type</th>
                    <th className="py-3 px-4">Details</th>
                    <th className="py-3 px-4">Bank</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {recentTransactions.map((tx) => (
                    <tr
                      key={tx.uid}
                      onClick={() => onNavigate('history')}
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
                      <td className="py-3 px-4 text-slate-900 max-w-xs truncate">
                        {tx.tx_type === 'income'
                          ? `${tx.source} (${tx.allocations?.length ?? 0} categories)`
                          : `${tx.category_name} · ${tx.description}`}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
