import Papa from 'papaparse';
import { formatLocalDate } from './data';
import type { Category } from './types';

export type CardCsvDraft = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

export type CardCsvMapping = {
  date: string;
  merchant: string;
  amount: string;
};

export type CardCsvCandidate = {
  date: string;
  merchant: string;
  amount: number;
  category: Category;
};

const HEADER_ALIASES: Record<keyof CardCsvMapping, string[]> = {
  date: ['利用日', '利用年月日', 'ご利用日', '取引日', '年月日', '日付', 'date'],
  merchant: ['利用店名', '利用店舗', '利用先', 'ご利用先', '加盟店名', '利用店', '摘要', '店名', '店舗名', 'merchant', 'description'],
  amount: ['利用金額', 'ご利用金額', '利用額', '支払金額', '支払額', '金額', 'amount'],
};

function normalizeHeader(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/[\s　_()（）]/g, '');
}

export function detectCardCsvMapping(headers: string[]): CardCsvMapping {
  const findHeader = (key: keyof CardCsvMapping) => {
    const aliases = HEADER_ALIASES[key].map(normalizeHeader);
    return headers.find((header) => {
      const normalized = normalizeHeader(header);
      return aliases.some((alias) => normalized === alias || normalized.includes(alias));
    }) ?? '';
  };

  return {
    date: findHeader('date'),
    merchant: findHeader('merchant'),
    amount: findHeader('amount'),
  };
}

export async function parseCardCsvFile(file: File): Promise<CardCsvDraft> {
  if (!file.name.toLocaleLowerCase().endsWith('.csv')) {
    throw new Error('CSVファイルを選択してください。');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('CSVファイルは10MB以下にしてください。');
  }

  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('shift_jis').decode(buffer);
  }

  const result = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  const headers = result.meta.fields ?? [];
  const rows = result.data.filter((row) => Object.values(row).some((value) => String(value ?? '').trim()));

  if (result.errors.length && rows.length === 0) {
    throw new Error('CSVを読み取れませんでした。文字コードやファイル形式を確認してください。');
  }
  if (!headers.length || !rows.length) {
    throw new Error('CSVに見出し行または明細がありません。');
  }

  return { fileName: file.name, headers, rows };
}

export function parseCardDate(value: string): string | null {
  const normalized = value.trim().normalize('NFKC');
  const standard = normalized.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})/);
  const japanese = normalized.match(/^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日?/);
  const slashFirst = normalized.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  let year: number;
  let month: number;
  let day: number;

  if (standard || japanese) {
    const match = standard ?? japanese!;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else if (slashFirst) {
    month = Number(slashFirst[1]);
    day = Number(slashFirst[2]);
    year = Number(slashFirst[3]);
  } else if (/^\d{5}$/.test(normalized)) {
    const excelDate = new Date(1899, 11, 30 + Number(normalized));
    return formatLocalDate(excelDate);
  } else {
    return null;
  }

  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return formatLocalDate(date);
}

export function parseCardAmount(value: string): number | null {
  const normalized = value.normalize('NFKC').trim().replace(/[¥￥円,，\s]/g, '');
  if (!normalized) return null;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount) : null;
}

export function guessExpenseCategory(merchant: string): Category {
  const value = merchant.normalize('NFKC').toLocaleLowerCase('ja-JP');
  if (/スーパー|コンビニ|食品|食料|八百屋|精肉|鮮魚|market|grocery|生協|co-op/.test(value)) return '食費';
  if (/ドラッグ|薬局|薬店|日用品|ホームセンター|100円|百均|洗剤|雑貨|drug|hands|loft/.test(value)) return '日用品';
  if (/レストラン|食堂|カフェ|喫茶|居酒屋|レストラン|フード|マクドナルド|スターバックス|すき家|吉野家|飲食|restaurant|cafe/.test(value)) return '外食';
  if (/電車|鉄道|jr |jr東|jr西|地下鉄|バス|タクシー|高速|駐車|akippa|交通|航空|ana|jal|suica|pasmo/.test(value)) return '交通費';
  return 'その他';
}

export function mapCardCsvRows(draft: CardCsvDraft, mapping: CardCsvMapping) {
  let invalidCount = 0;
  let nonExpenseCount = 0;
  const candidates: CardCsvCandidate[] = [];

  for (const row of draft.rows) {
    const merchant = String(row[mapping.merchant] ?? '').trim();
    const date = parseCardDate(String(row[mapping.date] ?? ''));
    const amount = parseCardAmount(String(row[mapping.amount] ?? ''));
    if (!merchant || !date || amount === null) {
      invalidCount += 1;
      continue;
    }
    if (amount <= 0) {
      nonExpenseCount += 1;
      continue;
    }
    candidates.push({ date, merchant, amount, category: guessExpenseCategory(merchant) });
  }

  return { candidates, invalidCount, nonExpenseCount };
}