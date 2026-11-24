import React, { useMemo, useState } from 'react';
import type { MonthlyReportResponse } from '../types';
import { formatINR, formatMonthLabel } from '../lib/format';

interface ReportChartsProps {
  report: MonthlyReportResponse;
}

const DONUT_COLORS = [
  '#DC2626',
  '#2563EB',
  '#D97706',
  '#0D9488',
  '#4F46E5',
  '#9333EA',
  '#64748B',
];

function formatCompactINR(val: number): string {
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(1)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(0)}K`;
  return `₹${Math.round(val)}`;
}

export const ReportCharts: React.FC<ReportChartsProps> = ({ report }) => {
  const [hoveredMonthIdx, setHoveredMonthIdx] = useState<number | null>(null);
  const [hoveredSliceIdx, setHoveredSliceIdx] = useState<number | null>(null);

  const trend = report.monthlyTrend;
  const maxTrendVal = useMemo(() => {
    const m = trend.reduce((acc, row) => Math.max(acc, row.income, row.expenses), 0);
    return m > 0 ? m * 1.15 : 10000;
  }, [trend]);

  const spendingCategories = useMemo(() => {
    const filtered = report.categoryBreakdown
      .filter((c) => c.spent_in_period > 0)
      .sort((a, b) => b.spent_in_period - a.spent_in_period);

    if (filtered.length <= 6) return filtered;
    const top = filtered.slice(0, 6);
    const otherSum = filtered.slice(6).reduce((s, c) => s + c.spent_in_period, 0);
    return [
      ...top,
      {
        id: -1,
        name: 'Other Categories',
        allocated_in_period: 0,
        spent_in_period: otherSum,
        cumulative_remaining: 0,
      },
    ];
  }, [report.categoryBreakdown]);

  const totalPeriodSpent = useMemo(
    () => spendingCategories.reduce((s, c) => s + c.spent_in_period, 0),
    [spendingCategories]
  );

  const allocationBars = useMemo(() => {
    return report.categoryBreakdown
      .filter((c) => c.allocated_in_period > 0 || c.spent_in_period > 0)
      .sort(
        (a, b) =>
          Math.max(b.allocated_in_period, b.spent_in_period) -
          Math.max(a.allocated_in_period, a.spent_in_period)
      )
      .slice(0, 10);
  }, [report.categoryBreakdown]);

  const maxCategoryBar = useMemo(() => {
    const m = allocationBars.reduce(
      (acc, c) => Math.max(acc, c.allocated_in_period, c.spent_in_period),
      0
    );
    return m > 0 ? m : 1;
  }, [allocationBars]);

  const maxBankVal = useMemo(() => {
    const m = report.bankBreakdown.reduce(
      (acc, b) => Math.max(acc, b.current_balance, b.inflow_in_period, b.outflow_in_period),
      0
    );
    return m > 0 ? m : 1;
  }, [report.bankBreakdown]);

  // SVG layout constants for Monthly Income vs Expenses Bar Chart
  const chartW = 640;
  const chartH = 260;
  const padL = 56;
  const padR = 16;
  const padT = 18;
  const padB = 36;
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;
  const yTicks = [0, 0.25, 0.5, 0.75, 1];

  // Donut geometry
  const donutSize = 184;
  const donutR = 66;
  const donutStroke = 26;
  const circumference = 2 * Math.PI * donutR;

  const donutSegments = useMemo(() => {
    if (totalPeriodSpent <= 0) return [];
    let offset = 0;
    return spendingCategories.map((c, idx) => {
      const fraction = c.spent_in_period / totalPeriodSpent;
      const len = fraction * circumference;
      const seg = {
        ...c,
        fraction,
        len,
        offset,
        color: DONUT_COLORS[idx % DONUT_COLORS.length],
      };
      offset += len;
      return seg;
    });
  }, [spendingCategories, totalPeriodSpent, circumference]);

  const activeTrendRow =
    hoveredMonthIdx !== null ? trend[hoveredMonthIdx] ?? null : null;

  return (
    <section className="space-y-6">
      {/* Row 1: Monthly Income vs Expenses Bar Chart + Spending Share Donut */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Monthly Income vs Expenses Trend Chart */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Monthly Income vs. Expenses
              </h3>
              <p className="text-xs text-slate-500">
                Month-by-month cash inflow and spending comparison
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
                Income
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" />
                Expenses
              </span>
            </div>
          </div>

          {trend.length === 0 ? (
            <div className="h-60 flex items-center justify-center text-sm text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
              Record income or expenses to view monthly comparison charts.
            </div>
          ) : (
            <div className="relative">
              <svg
                viewBox={`0 0 ${chartW} ${chartH}`}
                className="w-full h-auto overflow-visible"
                role="img"
                aria-label="Monthly Income vs Expenses Bar Chart"
              >
                {/* Horizontal gridlines & Y labels */}
                {yTicks.map((t) => {
                  const y = padT + plotH * (1 - t);
                  const val = maxTrendVal * t;
                  return (
                    <g key={t}>
                      <line
                        x1={padL}
                        y1={y}
                        x2={chartW - padR}
                        y2={y}
                        stroke={t === 0 ? '#CBD5E1' : '#F1F5F9'}
                        strokeWidth={1}
                      />
                      <text
                        x={padL - 8}
                        y={y + 4}
                        textAnchor="end"
                        className="fill-slate-500 text-[10px] font-mono-num"
                      >
                        {formatCompactINR(val)}
                      </text>
                    </g>
                  );
                })}

                {/* Grouped Bars */}
                {trend.map((row, idx) => {
                  const groupW = plotW / Math.max(trend.length, 1);
                  const centerX = padL + groupW * idx + groupW / 2;
                  const barW = Math.min(26, Math.max(10, groupW * 0.28));
                  const gap = 4;

                  const incH = (row.income / maxTrendVal) * plotH;
                  const expH = (row.expenses / maxTrendVal) * plotH;
                  const incY = padT + plotH - incH;
                  const expY = padT + plotH - expH;
                  const isHovered = hoveredMonthIdx === idx;
                  const shortMonth = row.month;

                  return (
                    <g
                      key={row.month}
                      onMouseEnter={() => setHoveredMonthIdx(idx)}
                      onMouseLeave={() => setHoveredMonthIdx(null)}
                      onClick={() =>
                        setHoveredMonthIdx((prev) => (prev === idx ? null : idx))
                      }
                      className="cursor-pointer"
                    >
                      {isHovered && (
                        <rect
                          x={padL + groupW * idx + 4}
                          y={padT}
                          width={Math.max(groupW - 8, 12)}
                          height={plotH}
                          rx={6}
                          fill="#F8FAFC"
                        />
                      )}

                      {/* Income bar */}
                      <rect
                        x={centerX - barW - gap / 2}
                        y={incY}
                        width={barW}
                        height={Math.max(incH, row.income > 0 ? 2 : 0)}
                        rx={3}
                        fill={isHovered ? '#15803D' : '#16A34A'}
                      />

                      {/* Expense bar */}
                      <rect
                        x={centerX + gap / 2}
                        y={expY}
                        width={barW}
                        height={Math.max(expH, row.expenses > 0 ? 2 : 0)}
                        rx={3}
                        fill={isHovered ? '#B91C1C' : '#DC2626'}
                      />

                      <text
                        x={centerX}
                        y={chartH - 12}
                        textAnchor="middle"
                        className={`text-[10px] font-mono-num ${
                          isHovered ? 'fill-slate-900 font-semibold' : 'fill-slate-500'
                        }`}
                      >
                        {shortMonth}
                      </text>
                    </g>
                  );
                })}
              </svg>

              {/* Fixed height readout bar below chart to avoid tooltip clipping */}
              <div className="mt-2 pt-2.5 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs min-h-[32px]">
                {activeTrendRow ? (
                  <>
                    <span className="font-semibold text-slate-900">
                      {formatMonthLabel(activeTrendRow.month)}
                    </span>
                    <div className="flex flex-wrap items-center gap-4 font-mono-num">
                      <span className="text-emerald-600">
                        Income: {formatINR(activeTrendRow.income)}
                      </span>
                      <span className="text-red-600">
                        Expenses: {formatINR(activeTrendRow.expenses)}
                      </span>
                      <span className="font-semibold text-slate-900">
                        Net: {activeTrendRow.net >= 0 ? '+' : ''}
                        {formatINR(activeTrendRow.net)}
                      </span>
                    </div>
                  </>
                ) : (
                  <span className="text-slate-400">
                    Tap or hover any month bar to inspect exact monthly figures.
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Expense Breakdown Donut Chart */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
          <div className="mb-4">
            <h3 className="text-base font-bold text-slate-900">
              Expense Share by Category
            </h3>
            <p className="text-xs text-slate-500">
              Distribution for {formatMonthLabel(report.selectedMonth)}
            </p>
          </div>

          {totalPeriodSpent <= 0 ? (
            <div className="h-60 flex items-center justify-center text-sm text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
              No expenses recorded in this period.
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-6 my-auto">
              <div className="relative shrink-0">
                <svg
                  width={donutSize}
                  height={donutSize}
                  viewBox={`0 0 ${donutSize} ${donutSize}`}
                  role="img"
                  aria-label="Category Expense Share Donut Chart"
                >
                  <circle
                    cx={donutSize / 2}
                    cy={donutSize / 2}
                    r={donutR}
                    fill="none"
                    stroke="#F1F5F9"
                    strokeWidth={donutStroke}
                  />
                  <g transform={`rotate(-90 ${donutSize / 2} ${donutSize / 2})`}>
                    {donutSegments.map((seg, idx) => (
                      <circle
                        key={seg.id + seg.name}
                        cx={donutSize / 2}
                        cy={donutSize / 2}
                        r={donutR}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={hoveredSliceIdx === idx ? donutStroke + 4 : donutStroke}
                        strokeDasharray={`${seg.len} ${circumference}`}
                        strokeDashoffset={-seg.offset}
                        onMouseEnter={() => setHoveredSliceIdx(idx)}
                        onMouseLeave={() => setHoveredSliceIdx(null)}
                        onClick={() =>
                          setHoveredSliceIdx((prev) => (prev === idx ? null : idx))
                        }
                        className="cursor-pointer transition-all duration-150"
                      />
                    ))}
                  </g>
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center px-3">
                  <span className="text-[11px] text-slate-500 truncate max-w-[100px]">
                    {hoveredSliceIdx !== null && donutSegments[hoveredSliceIdx]
                      ? donutSegments[hoveredSliceIdx].name
                      : 'Total Spent'}
                  </span>
                  <span className="text-sm font-bold text-slate-900 font-mono-num">
                    {hoveredSliceIdx !== null && donutSegments[hoveredSliceIdx]
                      ? formatINR(donutSegments[hoveredSliceIdx].spent_in_period)
                      : formatCompactINR(totalPeriodSpent)}
                  </span>
                </div>
              </div>

              <div className="flex-1 w-full space-y-2">
                {donutSegments.map((seg, idx) => (
                  <div
                    key={seg.id + seg.name}
                    onMouseEnter={() => setHoveredSliceIdx(idx)}
                    onMouseLeave={() => setHoveredSliceIdx(null)}
                    onClick={() =>
                      setHoveredSliceIdx((prev) => (prev === idx ? null : idx))
                    }
                    className={`flex items-center justify-between gap-2 text-xs px-2 py-1.5 rounded-md cursor-pointer transition-colors ${
                      hoveredSliceIdx === idx ? 'bg-slate-100' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-sm shrink-0"
                        style={{ backgroundColor: seg.color }}
                      />
                      <span className="text-slate-800 font-medium truncate">
                        {seg.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 font-mono-num shrink-0">
                      <span className="text-slate-900 font-semibold">
                        {formatINR(seg.spent_in_period)}
                      </span>
                      <span className="text-slate-500 w-10 text-right">
                        {Math.round(seg.fraction * 100)}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Category Allocated vs Spent + Bank Account Flow Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Category Allocated vs Spent Horizontal Chart */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Category Allocated vs. Spent
              </h3>
              <p className="text-xs text-slate-500">
                Budget utilization for {formatMonthLabel(report.selectedMonth)}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
                Allocated
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" />
                Spent
              </span>
            </div>
          </div>

          {allocationBars.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
              No category allocations or expenses in this period.
            </div>
          ) : (
            <div className="space-y-3.5">
              {allocationBars.map((c) => {
                const allocPct = Math.round((c.allocated_in_period / maxCategoryBar) * 100);
                const spentPct = Math.round((c.spent_in_period / maxCategoryBar) * 100);
                return (
                  <div key={c.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-800 truncate">{c.name}</span>
                      <div className="flex items-center gap-3 font-mono-num shrink-0">
                        <span className="text-emerald-700">
                          Alloc: {formatINR(c.allocated_in_period)}
                        </span>
                        <span className="text-red-600">
                          Spent: {formatINR(c.spent_in_period)}
                        </span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${allocPct}%` }}
                        />
                      </div>
                      <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-red-600 rounded-full"
                          style={{ width: `${spentPct}%` }}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bank Inflow, Outflow & Current Balance Visual */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Bank Cashflow & Holdings
              </h3>
              <p className="text-xs text-slate-500">
                Inflow, outflow, and current balance by bank account
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-medium text-slate-600">
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-emerald-600 inline-block" />
                In
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-600 inline-block" />
                Out
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" />
                Balance
              </span>
            </div>
          </div>

          {report.bankBreakdown.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-sm text-slate-500 bg-slate-50 rounded-lg border border-dashed border-slate-200">
              No bank accounts available.
            </div>
          ) : (
            <div className="space-y-4">
              {report.bankBreakdown.map((b) => {
                const inPct = Math.round((b.inflow_in_period / maxBankVal) * 100);
                const outPct = Math.round((b.outflow_in_period / maxBankVal) * 100);
                const balPct = Math.round((b.current_balance / maxBankVal) * 100);
                return (
                  <div key={b.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs gap-2">
                      <span className="font-semibold text-slate-900 truncate">
                        {b.bank_name}
                        {b.nickname ? ` (${b.nickname})` : ''}
                      </span>
                      <span className="font-mono-num font-bold text-blue-600 shrink-0">
                        Bal: {formatINR(b.current_balance)}
                      </span>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-600 rounded-full"
                            style={{ width: `${inPct}%` }}
                          />
                        </div>
                        <span className="w-24 text-right text-[11px] font-mono-num text-emerald-700 shrink-0">
                          +{formatINR(b.inflow_in_period)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-600 rounded-full"
                            style={{ width: `${outPct}%` }}
                          />
                        </div>
                        <span className="w-24 text-right text-[11px] font-mono-num text-red-600 shrink-0">
                          -{formatINR(b.outflow_in_period)}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-600 rounded-full"
                            style={{ width: `${balPct}%` }}
                          />
                        </div>
                        <span className="w-24 text-right text-[11px] font-mono-num text-blue-600 shrink-0">
                          {formatINR(b.current_balance)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
