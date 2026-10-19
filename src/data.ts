import type { ExpenseItem } from './types';

export const STORAGE_KEY = 'mainichi-kakeibo-expenses-v1';

export function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createSampleItems(): ExpenseItem[] {
  const now = new Date();
  const monthDate = (offset: number, day: number) => {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, day);
    return formatLocalDate(date);
  };

  return [
    { id: 'sample-1', date: monthDate(0, 3), store: 'まるいちスーパー', name: '季節の野菜セット', amount: 1280, category: '食費' },
    { id: 'sample-2', date: monthDate(0, 3), store: 'まるいちスーパー', name: '牛乳・たまご', amount: 498, category: '食費' },
    { id: 'sample-3', date: monthDate(0, 6), store: '街のドラッグストア', name: '洗濯洗剤', amount: 698, category: '日用品' },
    { id: 'sample-4', date: monthDate(0, 8), store: '喫茶アオ', name: 'ランチプレート', amount: 1350, category: '外食' },
    { id: 'sample-5', date: monthDate(0, 11), store: 'まるいちスーパー', name: 'お米 5kg', amount: 2380, category: '食費' },
    { id: 'sample-6', date: monthDate(1, 5), store: 'まるいちスーパー', name: 'お肉と野菜', amount: 2640, category: '食費' },
    { id: 'sample-7', date: monthDate(1, 12), store: '駅前ベーカリー', name: 'パン・コーヒー', amount: 920, category: '外食' },
    { id: 'sample-8', date: monthDate(2, 8), store: '街のドラッグストア', name: 'ティッシュ・石けん', amount: 1180, category: '日用品' },
    { id: 'sample-9', date: monthDate(2, 15), store: 'まるいちスーパー', name: '食材まとめ買い', amount: 3720, category: '食費' },
    { id: 'sample-10', date: monthDate(3, 4), store: '喫茶アオ', name: '日替わり定食', amount: 1100, category: '外食' },
    { id: 'sample-11', date: monthDate(4, 9), store: 'まるいちスーパー', name: 'お肉・お魚', amount: 4180, category: '食費' },
  ];
}