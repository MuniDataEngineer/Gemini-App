import React, { useCallback, useEffect, useState } from 'react';
import {
  Download,
  Upload,
  Database,
  FileSpreadsheet,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import type { MonthlyReportResponse } from '../types';
import {
  apiFetch,
  downloadAuthorizedFile,
  formatINR,
  formatMonthLabel,
  getAuthToken,
} from '../lib/format';
import { ReportCharts } from './ReportCharts';

interface MonthlyReportsViewProps {
  onRefreshBootstrap: () => Promise<void>;
}

export const MonthlyReportsView: React.FC<MonthlyReportsViewProps> = ({
  onRefreshBootstrap,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [report, setReport] = useState<MonthlyReportResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [restoring, setRestoring] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadReport = useCallback(async (monthParam: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = monthParam ? `?month=${encodeURIComponent(monthParam)}` : '';
      const res = await apiFetch<MonthlyReportResponse>(`/api/reports/monthly${qs}`);
      setReport(res);
      if (!monthParam) {
        setSelectedMonth(res.selectedMonth);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load monthly report.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport(selectedMonth);
  }, [selectedMonth, loadReport]);

  const handleRestoreUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
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
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to restore SQLite database.');
        }
      }
      setSuccess('Database restored successfully. All balances and records updated.');
      await onRefreshBootstrap();
      await loadReport('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to restore backup.');
    } finally {
      setRestoring(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">
            Monthly Reports & Data Management
          </h2>
          <p className="text-sm text-slate-500">
            Analyze monthly income, category allocations, spending, bank flows, and manage SQLite backups.
          </p>
        </div>

        <div className="flex w-full sm:w-auto items-center gap-3">
          <label htmlFor="report-month-select" className="text-xs font-medium text-slate-600 shrink-0">
            Period:
          </label>
          <select
            id="report-month-select"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="flex-1 sm:flex-initial min-h-[44px] px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="all">All Months (Cumulative)</option>
            {report?.availableMonths.map((m) => (
              <option key={m} value={m}>
                {formatMonthLabel(m)}
              </option>
            ))}
          </select>
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

      {loading && !report ? (
        <div className="p-8 text-center text-sm text-slate-500">Loading monthly report...</div>
      ) : (
        report && (
          <>
            {/* Summary KPIs */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Income</div>
                <div className="mt-1.5 text-xl font-bold text-emerald-600 font-mono-num">
                  {formatINR(report.summary.totalIncome)}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Allocated</div>
                <div className="mt-1.5 text-xl font-bold text-slate-900 font-mono-num">
                  {formatINR(report.summary.totalAllocated)}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Unallocated</div>
                <div className="mt-1.5 text-xl font-bold text-blue-600 font-mono-num">
                  {formatINR(report.summary.unallocatedIncome)}
                </div>
              </div>
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Expenses</div>
                <div className="mt-1.5 text-xl font-bold text-red-600 font-mono-num">
                  {formatINR(report.summary.totalExpenses)}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1 bg-white border border-slate-200 rounded-xl p-4">
                <div className="text-xs font-medium text-slate-500">Net Cashflow</div>
                <div
                  className={`mt-1.5 text-xl font-bold font-mono-num ${
                    report.summary.netSavings >= 0 ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {report.summary.netSavings >= 0 ? '+' : ''}
                  {formatINR(report.summary.netSavings)}
                </div>
              </div>
            </div>

            {/* Graphical Reports */}
            <ReportCharts report={report} />

            {/* Category & Bank Breakdowns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200">
                  <h3 className="text-base font-bold text-slate-900">
                    Category Performance ({formatMonthLabel(report.selectedMonth)})
                  </h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-2.5 px-4">Category</th>
                        <th className="py-2.5 px-4 text-right">Allocated</th>
                        <th className="py-2.5 px-4 text-right">Spent</th>
                        <th className="py-2.5 px-4 text-right">Cumulative Rem.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {report.categoryBreakdown.map((c) => (
                        <tr key={c.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-medium text-slate-900">{c.name}</td>
                          <td className="py-2.5 px-4 text-right font-mono-num text-emerald-700">
                            {formatINR(c.allocated_in_period)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-num text-red-600">
                            {formatINR(c.spent_in_period)}
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono-num font-semibold text-slate-900">
                            {formatINR(c.cumulative_remaining)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900">
                      Bank Cashflow ({formatMonthLabel(report.selectedMonth)})
                    </h3>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-sm">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-2.5 px-4">Bank</th>
                          <th className="py-2.5 px-4 text-right">Inflow</th>
                          <th className="py-2.5 px-4 text-right">Outflow</th>
                          <th className="py-2.5 px-4 text-right">Current Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {report.bankBreakdown.map((b) => (
                          <tr key={b.id} className="hover:bg-slate-50/70">
                            <td className="py-2.5 px-4 font-medium text-slate-900">
                              {b.bank_name}
                              {b.nickname && (
                                <span className="text-xs text-slate-500 ml-1">
                                  ({b.nickname})
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-num text-emerald-600">
                              +{formatINR(b.inflow_in_period)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-num text-red-600">
                              -{formatINR(b.outflow_in_period)}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono-num font-bold text-blue-600">
                              {formatINR(b.current_balance)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Month-over-Month History */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200">
                    <h3 className="text-base font-bold text-slate-900">
                      Historical Months Summary
                    </h3>
                  </div>
                  {report.monthlyTrend.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-500">
                      Monthly history will appear once income or expense transactions are recorded.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-sm">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                            <th className="py-2.5 px-4">Month</th>
                            <th className="py-2.5 px-4 text-right">Income</th>
                            <th className="py-2.5 px-4 text-right">Expenses</th>
                            <th className="py-2.5 px-4 text-right">Net</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {report.monthlyTrend.map((row) => (
                            <tr key={row.month} className="hover:bg-slate-50/70">
                              <td className="py-2.5 px-4 font-medium text-slate-900">
                                {formatMonthLabel(row.month)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono-num text-emerald-600">
                                {formatINR(row.income)}
                              </td>
                              <td className="py-2.5 px-4 text-right font-mono-num text-red-600">
                                {formatINR(row.expenses)}
                              </td>
                              <td
                                className={`py-2.5 px-4 text-right font-mono-num font-semibold ${
                                  row.net >= 0 ? 'text-slate-900' : 'text-red-600'
                                }`}
                              >
                                {formatINR(row.net)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )
      )}

      {/* Database Backup, Restore & CSV Exports */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            SQLite Backup, Restore & CSV Export
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            All records persist locally in SQLite. Download full backups or restore from a saved file at any time.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                await downloadAuthorizedFile(
                  '/api/backup/sqlite',
                  `rupeeledger-backup-${new Date().toISOString().slice(0, 10)}.db`
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download SQLite backup.');
              }
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
          >
            <Database className="w-4 h-4" />
            <span>Download SQLite Backup (.db)</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                await downloadAuthorizedFile(
                  '/api/backup/json',
                  `rupeeledger-snapshot-${new Date().toISOString().slice(0, 10)}.json`
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to download JSON snapshot.');
              }
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Download JSON Snapshot</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                await downloadAuthorizedFile(
                  `/api/export/csv?scope=transactions&month=${encodeURIComponent(selectedMonth || 'all')}`,
                  'rupeeledger-transactions.csv'
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to export transactions CSV.');
              }
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Transactions CSV</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              setError(null);
              try {
                await downloadAuthorizedFile(
                  '/api/export/csv?scope=categories',
                  'rupeeledger-categories.csv'
                );
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to export categories CSV.');
              }
            }}
            className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Export Categories CSV</span>
          </button>

          <label className="min-h-[44px] inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors whitespace-nowrap">
            <Upload className="w-4 h-4" />
            <span>{restoring ? 'Restoring...' : 'Restore Backup (.db / .json)'}</span>
            <input
              type="file"
              accept=".db,.sqlite,.json"
              onChange={handleRestoreUpload}
              disabled={restoring}
              className="hidden"
            />
          </label>
        </div>
      </section>
    </div>
  );
};
