export type NavPage =
  | 'dashboard'
  | 'banks'
  | 'add-money'
  | 'add-expense'
  | 'categories'
  | 'history'
  | 'reports';

export interface BankAccount {
  id: number;
  bank_name: string;
  nickname: string;
  opening_balance: number;
  current_balance: number;
  created_at: string;
  updated_at: string;
}

export interface CategorySummary {
  id: number;
  name: string;
  is_default: number;
  notes: string;
  created_at: string;
  allocated_amount: number;
  spent_amount: number;
  remaining_balance: number;
}

export interface AllocationItem {
  category_id: number;
  category_name: string;
  amount: number;
}

export interface UnifiedTransaction {
  uid: string;
  id: number;
  tx_type: 'income' | 'expense';
  tx_code: string;
  date: string;
  month: string;
  amount: number;
  bank_account_id: number;
  bank_name: string;
  bank_nickname: string;
  source?: string;
  unallocated_amount?: number;
  allocations?: AllocationItem[];
  category_id?: number;
  category_name?: string;
  subcategory?: string;
  description?: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AuthUser {
  id: number;
  username: string;
  display_name: string;
  created_at: string;
}

export interface BootstrapData {
  user: AuthUser;
  needsSetup: boolean;
  bankAccounts: BankAccount[];
  categories: CategorySummary[];
  totals: {
    totalBankBalance: number;
    totalIncome: number;
    totalAllocated: number;
    totalUnallocated: number;
    totalExpenses: number;
  };
  recentTransactions: UnifiedTransaction[];
}

export interface AuditLogEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  tx_code: string | null;
  action: 'EDIT' | 'DELETE';
  original_values: Record<string, unknown>;
  changed_values: Record<string, unknown> | null;
  timestamp: string;
}

export interface MonthlyReportResponse {
  selectedMonth: string;
  availableMonths: string[];
  summary: {
    totalIncome: number;
    totalAllocated: number;
    unallocatedIncome: number;
    totalExpenses: number;
    netSavings: number;
  };
  categoryBreakdown: Array<{
    id: number;
    name: string;
    allocated_in_period: number;
    spent_in_period: number;
    cumulative_remaining: number;
  }>;
  bankBreakdown: Array<{
    id: number;
    bank_name: string;
    nickname: string;
    current_balance: number;
    inflow_in_period: number;
    outflow_in_period: number;
  }>;
  monthlyTrend: Array<{
    month: string;
    income: number;
    expenses: number;
    net: number;
  }>;
}
