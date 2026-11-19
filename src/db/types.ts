export type AccountType = 'cash' | 'checking' | 'household' | 'credit' | 'savings' | 'fixed' | 'depot' | 'loan';

export const ACCOUNT_TYPES: Record<AccountType, string> = {
  checking: 'Girokonto',
  cash: 'Bargeld',
  household: 'Haushaltskasse',
  credit: 'Kreditkarte',
  savings: 'Sparkonto / Tagesgeld',
  fixed: 'Festgeld',
  depot: 'Depot',
  loan: 'Kredit / Darlehen',
};

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  owner: string | null;
  currency: string;
  opening_balance: number;
  iban: string | null;
  bank: string | null;
  interest_rate: number | null;
  exemption: number | null;
  exemption_used: number | null;
  note: string | null;
  sort_order: number;
  archived: number;
  balance: number;
  /** Datum des letzten erfassten Kontostands, falls vorhanden */
  balance_date: string | null;
}

export interface Snapshot {
  id: string;
  account_id: string;
  date: string;
  balance: number;
  note: string | null;
}

export interface Holding {
  id: string;
  account_id: string | null;
  owner: string | null;
  wkn: string | null;
  isin: string | null;
  name: string;
  quantity: number;
  cost_value: number | null;
  price: number | null;
  market_value: number | null;
  as_of: string | null;
}

export interface Pension {
  id: string;
  person: string | null;
  provider: string;
  contribution: number | null;
  interval: string | null;
  lump_sum: number | null;
  monthly_pension: number | null;
  projection1: number | null;
  projection2: number | null;
  projection3: number | null;
  start_text: string | null;
  as_of: string | null;
  advisor: string | null;
  death_action: string | null;
  note: string | null;
}

export interface Category {
  id: string;
  parent_id: string | null;
  name: string;
  kind: 'income' | 'expense';
  tax_category: string | null;
  color: string | null;
  sort_order: number;
}

export interface CategoryNode extends Category {
  children: CategoryNode[];
  path: string;
}

export interface Split {
  id?: string;
  category_id: string | null;
  amount: number;
  note?: string | null;
}

export interface Transaction {
  id: string;
  account_id: string;
  account_name: string;
  date: string;
  amount: number;
  payee: string | null;
  purpose: string | null;
  note: string | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  transfer_id: string | null;
  recurring_id: string | null;
  is_lump_sum: number;
  split_count: number;
  doc_count: number;
}

export interface Rule {
  id: string;
  field: 'payee' | 'purpose' | 'any';
  op: 'contains' | 'equals' | 'starts_with' | 'regex';
  value: string;
  category_id: string;
  priority: number;
  enabled: number;
}

export interface Budget {
  id: string;
  category_id: string;
  period: 'month' | 'year';
  amount: number;
  valid_from: string;
  valid_to: string | null;
}
