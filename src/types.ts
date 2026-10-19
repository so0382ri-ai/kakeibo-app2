export const CATEGORIES = ['食費', '日用品', '外食', '交通費', 'その他'] as const;

export type Category = (typeof CATEGORIES)[number];

export type ExpenseItem = {
  id: string;
  date: string;
  store: string;
  name: string;
  amount: number;
  category: Category;
  source?: 'card' | 'receipt';
};

export type ParsedReceipt = {
  date: string;
  store: string;
  items: Array<{ name: string; amount: number; category: Category }>;
};