import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  FileImage,
  FileSpreadsheet,
  Leaf,
  LoaderCircle,
  ReceiptText,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Utensils,
  Wallet,
  X,
} from 'lucide-react';
import { createSampleItems, formatLocalDate, STORAGE_KEY } from './data';
import {
  detectCardCsvMapping,
  mapCardCsvRows,
  parseCardCsvFile,
  type CardCsvDraft,
  type CardCsvMapping,
} from './cardCsv';
import { CATEGORIES, type Category, type ExpenseItem, type ParsedReceipt } from './types';

ChartJS.register(ArcElement, BarElement, CategoryScale, Filler, Legend, LinearScale, Tooltip);

const categoryColors: Record<Category, string> = {
  食費: '#54866c',
  日用品: '#e9a24b',
  外食: '#df7259',
  交通費: '#7196c8',
  その他: '#a7b2a9',
};

const yen = new Intl.NumberFormat('ja-JP');

type CropArea = { x: number; y: number; width: number; height: number };

async function createCroppedImage(imageUrl: string, area: CropArea) {
  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const canvas = document.createElement('canvas');
  canvas.width = area.width;
  canvas.height = area.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を切り抜けませんでした。');
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, area.width, area.height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('切り抜き画像を作成できませんでした。'));
    }, 'image/jpeg', 0.92);
  });
}

function loadItems(): { items: ExpenseItem[]; isDemo: boolean } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { items: JSON.parse(stored) as ExpenseItem[], isDemo: false };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return { items: createSampleItems(), isDemo: true };
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function getInitials(store: string) {
  return Array.from(store.replace(/^(街の|駅前)/, ''))[0] ?? '？';
}

export default function App() {
  const [ledger, setLedger] = useState(loadItems);
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()));
  const [isDragging, setIsDragging] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [notice, setNotice] = useState('');
  const [filter, setFilter] = useState<Category | 'すべて'>('すべて');
  const [pendingReceipt, setPendingReceipt] = useState<ParsedReceipt | null>(null);
  const [cropImageUrl, setCropImageUrl] = useState('');
  const [cropArea, setCropArea] = useState<CropArea | null>(null);
  const [cropImageReady, setCropImageReady] = useState(false);
  const [cardCsvDraft, setCardCsvDraft] = useState<CardCsvDraft | null>(null);
  const [cardCsvMapping, setCardCsvMapping] = useState<CardCsvMapping>({ date: '', merchant: '', amount: '' });
  const [dateOverride, setDateOverride] = useState('');
  const [storeOverride, setStoreOverride] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const csvInput = useRef<HTMLInputElement>(null);
  const cropStageRef = useRef<HTMLDivElement>(null);
  const cropImageRef = useRef<HTMLImageElement>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => () => {
    if (cropImageUrl) URL.revokeObjectURL(cropImageUrl);
  }, [cropImageUrl]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger.items));
  }, [ledger.items]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const [yearText, monthText] = selectedMonth.split('-');
  const currentItems = useMemo(
    () => ledger.items.filter((item) => item.date.startsWith(selectedMonth)),
    [ledger.items, selectedMonth],
  );
  const monthlyTotal = currentItems.reduce((sum, item) => sum + item.amount, 0);
  const previousMonth = monthKey(new Date(Number(yearText), Number(monthText) - 2, 1));
  const previousTotal = ledger.items
    .filter((item) => item.date.startsWith(previousMonth))
    .reduce((sum, item) => sum + item.amount, 0);
  const categoryTotals = CATEGORIES.map((category) => ({
    category,
    amount: currentItems
      .filter((item) => item.category === category)
      .reduce((sum, item) => sum + item.amount, 0),
  })).filter((row) => row.amount > 0);
  const averageSpend = currentItems.length ? Math.round(monthlyTotal / currentItems.length) : 0;
  const visibleItems = currentItems.filter((item) => filter === 'すべて' || item.category === filter);
  const isDemo = ledger.isDemo && ledger.items.some((item) => item.id.startsWith('sample-'));
  const cardCsvAssessment = useMemo(() => {
    if (!cardCsvDraft || !cardCsvMapping.date || !cardCsvMapping.merchant || !cardCsvMapping.amount) return null;
    const mapped = mapCardCsvRows(cardCsvDraft, cardCsvMapping);
    const known = new Set(ledger.items
      .filter((item) => item.source === 'card')
      .map((item) => `${item.date}|${item.store.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')}|${item.amount}`));
    const seen = new Set<string>();
    let duplicateCount = 0;
    const rows = mapped.candidates.map((candidate) => {
      const key = `${candidate.date}|${candidate.merchant.normalize('NFKC').trim().toLocaleLowerCase('ja-JP')}|${candidate.amount}`;
      const isDuplicate = known.has(key) || seen.has(key);
      if (isDuplicate) duplicateCount += 1;
      seen.add(key);
      return { ...candidate, isDuplicate };
    });
    return { ...mapped, rows, duplicateCount, importCount: rows.length - duplicateCount };
  }, [cardCsvDraft, cardCsvMapping, ledger.items]);

  const monthlyHistory = Array.from({ length: 6 }, (_, index) => {
    const month = new Date(Number(yearText), Number(monthText) - 6 + index, 1);
    const key = monthKey(month);
    return {
      label: `${month.getMonth() + 1}月`,
      amount: ledger.items
        .filter((item) => item.date.startsWith(key))
        .reduce((sum, item) => sum + item.amount, 0),
      active: key === selectedMonth,
    };
  });

  const changeMonth = (offset: number) => {
    const date = new Date(Number(yearText), Number(monthText) - 1 + offset, 1);
    setSelectedMonth(monthKey(date));
  };

  function openReceiptCrop(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setNotice('画像ファイルを選択してください。');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice('画像サイズは8MB以下にしてください。');
      return;
    }

    setNotice('');
    setCropImageUrl(URL.createObjectURL(file));
    setCropArea(null);
    setCropImageReady(false);
  }

  async function analyzeCroppedReceipt() {
    if (!cropImageUrl || !cropArea) return;
    setIsParsing(true);
    setNotice('');
    try {
      const croppedBlob = await createCroppedImage(cropImageUrl, cropArea);
      const image = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('切り抜き画像を読み込めませんでした。'));
        reader.readAsDataURL(croppedBlob);
      });
      const response = await fetch('/api/receipts/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mediaType: 'image/jpeg' }),
      });
      const result = await response.json() as ParsedReceipt & { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'レシート解析に失敗しました。');
      if (!result.items.length) throw new Error('商品明細を見つけられませんでした。画像を確認してください。');
      setPendingReceipt(result);
      setDateOverride(result.date || formatLocalDate(new Date()));
      setStoreOverride(result.store || '店舗名不明');
      setCropImageUrl('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'レシートを読み取れませんでした。');
    } finally {
      setIsParsing(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    openReceiptCrop(event.target.files?.[0]);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function handleCardCsvChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const draft = await parseCardCsvFile(file);
      setCardCsvDraft(draft);
      setCardCsvMapping(detectCardCsvMapping(draft.headers));
      setNotice('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'CSVを読み込めませんでした。');
    } finally {
      if (csvInput.current) csvInput.current.value = '';
    }
  }

  function saveCardCsv() {
    if (!cardCsvAssessment || cardCsvAssessment.importCount === 0) return;
    const additions = cardCsvAssessment.rows
      .filter((row) => !row.isDuplicate)
      .map((row) => ({
        id: crypto.randomUUID(),
        date: row.date,
        store: row.merchant,
        name: 'カード利用',
        amount: row.amount,
        category: row.category,
        source: 'card' as const,
      }));
    setLedger((current) => ({
      items: [...additions, ...current.items.filter((item) => !(current.isDemo && item.id.startsWith('sample-')))],
      isDemo: false,
    }));
    const latestDate = additions.map((item) => item.date).sort().at(-1);
    if (latestDate) setSelectedMonth(latestDate.slice(0, 7));
    setCardCsvDraft(null);
    setNotice(`${additions.length}件を取り込みました。重複${cardCsvAssessment.duplicateCount}件、対象外${cardCsvAssessment.invalidCount + cardCsvAssessment.nonExpenseCount}件をスキップしました。`);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    openReceiptCrop(event.dataTransfer.files[0]);
  }

  function getCropPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const image = cropImageRef.current;
    const stage = cropStageRef.current;
    if (!image || !stage) return null;
    const bounds = stage.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    const scale = Math.min(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    const imageLeft = bounds.left + (bounds.width - imageWidth) / 2;
    const imageTop = bounds.top + (bounds.height - imageHeight) / 2;
    if (event.clientX < imageLeft || event.clientX > imageLeft + imageWidth || event.clientY < imageTop || event.clientY > imageTop + imageHeight) return null;
    return {
      x: Math.round((event.clientX - imageLeft) / scale),
      y: Math.round((event.clientY - imageTop) / scale),
    };
  }

  function handleCropPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropImageRef.current || !cropImageReady) return;
    const point = getCropPoint(event);
    if (!point) return;
    cropStartRef.current = point;
    setCropArea({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleCropPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const start = cropStartRef.current;
    const point = getCropPoint(event);
    if (!start || !point) return;
    setCropArea({
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.abs(point.x - start.x),
      height: Math.abs(point.y - start.y),
    });
  }

  function handleCropPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!cropStartRef.current) return;
    handleCropPointerMove(event);
    cropStartRef.current = null;
  }

  function resetCropSelection() {
    cropStartRef.current = null;
    setCropArea(null);
  }

  const cropSelectionStyle = (() => {
    const image = cropImageRef.current;
    const stage = cropStageRef.current;
    if (!image || !stage || !cropImageReady || !cropArea) return undefined;
    const stageBounds = stage.getBoundingClientRect();
    const scale = Math.min(stageBounds.width / image.naturalWidth, stageBounds.height / image.naturalHeight);
    const imageWidth = image.naturalWidth * scale;
    const imageHeight = image.naturalHeight * scale;
    return {
      left: (stageBounds.width - imageWidth) / 2 + cropArea.x * scale,
      top: (stageBounds.height - imageHeight) / 2 + cropArea.y * scale,
      width: cropArea.width * scale,
      height: cropArea.height * scale,
    };
  })();

  function closeCropper() {
    setCropImageUrl('');
    setCropArea(null);
  }

  function saveReceipt() {
    if (!pendingReceipt) return;
    const additions = pendingReceipt.items.map((item) => ({
      ...item,
      id: crypto.randomUUID(),
      date: dateOverride || formatLocalDate(new Date()),
      store: storeOverride || '店舗名不明',
      source: 'receipt' as const,
    }));
    setLedger((current) => ({ items: [...additions, ...current.items], isDemo: false }));
    setSelectedMonth(monthKey(new Date(`${dateOverride}T00:00:00`)));
    setPendingReceipt(null);
    setNotice(`${additions.length}件の明細を保存しました。`);
  }

  function removeItem(id: string) {
    setLedger((current) => ({
      items: current.items.filter((item) => item.id !== id),
      isDemo: current.isDemo,
    }));
  }

  function clearLedger() {
    setLedger({ items: [], isDemo: false });
    setFilter('すべて');
    setNotice('サンプル明細を削除しました。');
  }

  const doughnutData = {
    labels: categoryTotals.map((row) => row.category),
    datasets: [{
      data: categoryTotals.map((row) => row.amount),
      backgroundColor: categoryTotals.map((row) => categoryColors[row.category]),
      borderWidth: 0,
      hoverOffset: 5,
      spacing: 3,
    }],
  };

  const barData = {
    labels: monthlyHistory.map((month) => month.label),
    datasets: [{
      data: monthlyHistory.map((month) => month.amount),
      backgroundColor: monthlyHistory.map((month) => month.active ? '#df7259' : '#d8e5dd'),
      borderRadius: 5,
      maxBarThickness: 28,
    }],
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#home" aria-label="まいにち帳 ホーム">
          <span className="brand-mark"><ReceiptText size={19} strokeWidth={2.3} /></span>
          <span className="brand-copy"><strong>まいにち帳</strong><small>MY LITTLE LEDGER</small></span>
        </a>
        <div className="sidebar-caption">MENU</div>
        <nav className="side-nav" aria-label="メインメニュー">
          <a className="nav-link nav-link-active" href="#overview"><Wallet size={17} />家計ダッシュボード</a>
          <a className="nav-link" href="#receipts"><ReceiptText size={17} />レシート・明細</a>
        </nav>
        <div className="sidebar-grow" />
        <div className="sidebar-tip">
          <span className="tip-icon"><Leaf size={17} /></span>
          <p>小さな記録が、<br />大きな安心に。</p>
          <span>今日も一歩ずつ。</span>
          <span className="tip-sun" aria-hidden="true" />
        </div>
        <div className="profile-row">
          <span className="profile-avatar">わ</span>
          <span className="profile-copy"><strong>わたしの家計簿</strong><small>この端末に保存中</small></span>
          <CircleHelp size={16} className="profile-help" aria-hidden="true" />
        </div>
      </aside>

      <main
        className="main-content"
        id="home"
        onDragEnter={(event) => {
          if (event.dataTransfer.types.includes('Files')) setIsDragging(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
      >
        <header className="topbar">
          <div className="breadcrumb">マイページ <ChevronRight size={14} /> <span>家計ダッシュボード</span></div>
          <div className="topbar-right"><span className="local-status"><span />この端末に保存</span><span className="today-label">{new Intl.DateTimeFormat('ja-JP', { dateStyle: 'full' }).format(new Date())}</span></div>
        </header>

        <div className="page-wrap" id="overview">
          <section className="page-heading">
            <div>
              <div className="eyebrow"><span />YOUR HOUSEHOLD ACCOUNT</div>
              <h1>おかえりなさい。</h1>
              <p>日々のお買いもの、ここで一緒に振り返りましょう。</p>
            </div>
            <div className="heading-actions">
              <button className="outline-button csv-action" onClick={() => csvInput.current?.click()}><FileSpreadsheet size={16} />カード明細CSV</button>
              <button className="primary-button" onClick={() => fileInput.current?.click()} disabled={isParsing}>
                <Upload size={17} />レシートを読み込む
              </button>
            </div>
          </section>

          <section className="month-strip" aria-label="表示する月">
            <div className="month-select"><span className="month-dot" />集計期間</div>
            <div className="month-controls">
              <button className="icon-button" onClick={() => changeMonth(-1)} aria-label="前の月"><ChevronLeft size={18} /></button>
              <strong>{Number(yearText)}年{Number(monthText)}月</strong>
              <button className="icon-button" onClick={() => changeMonth(1)} aria-label="次の月"><ChevronRight size={18} /></button>
            </div>
            <span className="month-count">{currentItems.length}件の記録</span>
          </section>

          <section className="summary-grid" aria-label="今月のサマリー">
            <article className="summary-card total-card">
              <div className="summary-top"><span>今月の支出</span><span className="summary-icon total-icon"><Wallet size={17} /></span></div>
              <strong className="summary-value">¥{yen.format(monthlyTotal)}</strong>
              <span className="summary-foot"><span className="summary-trend"><ArrowDownLeft size={13} /> {previousTotal ? `${Math.round((monthlyTotal / previousTotal - 1) * 100)}%` : '—'}</span> 前月比</span>
              <span className="card-corner" />
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>記録した明細</span><span className="summary-icon items-icon"><ReceiptText size={17} /></span></div>
              <strong className="summary-value">{currentItems.length}<small> 件</small></strong>
              <span className="summary-foot"><span className="summary-neutral"><Sparkles size={13} /> 買いものの記録</span></span>
            </article>
            <article className="summary-card">
              <div className="summary-top"><span>1件あたり</span><span className="summary-icon average-icon"><ArrowUpRight size={17} /></span></div>
              <strong className="summary-value">¥{yen.format(averageSpend)}</strong>
              <span className="summary-foot"><span className="summary-neutral">今月の平均金額</span></span>
            </article>
          </section>

          <section className="analytics-grid" aria-label="支出グラフ">
            <article className="panel category-panel">
              <div className="panel-heading"><div><span className="panel-kicker">BREAKDOWN</span><h2>カテゴリ別の支出</h2></div><span className="panel-period">{Number(monthText)}月</span></div>
              {categoryTotals.length ? <div className="category-chart-wrap">
                <div className="doughnut-wrap"><Doughnut data={doughnutData} options={{ cutout: '73%', maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ¥${yen.format(Number(context.raw))}` } } } }} /><div className="doughnut-center"><span>合計</span><strong>¥{yen.format(monthlyTotal)}</strong></div></div>
                <div className="category-legend">{categoryTotals.map((row) => <div className="legend-row" key={row.category}><span className="legend-dot" style={{ background: categoryColors[row.category] }} /><span>{row.category}</span><strong>¥{yen.format(row.amount)}</strong><small>{monthlyTotal ? Math.round(row.amount / monthlyTotal * 100) : 0}%</small></div>)}</div>
              </div> : <div className="chart-empty"><span><Utensils size={20} /></span><p>この月の記録はまだありません</p></div>}
            </article>
            <article className="panel trend-panel">
              <div className="panel-heading"><div><span className="panel-kicker">SPENDING TREND</span><h2>月ごとの支出</h2></div><span className="chart-unit">円</span></div>
              <div className="bar-chart-wrap"><Bar data={barData} options={{ maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (context) => ` ¥${yen.format(Number(context.raw))}` } } }, scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#89958f', font: { family: 'DM Sans, Noto Sans JP, sans-serif', size: 11 } } }, y: { beginAtZero: true, border: { display: false, dash: [3, 4] }, grid: { color: '#edf1ee' }, ticks: { color: '#9ba59f', maxTicksLimit: 5, callback: (value) => `${Number(value) / 1000}k`, font: { size: 10 } } } } }} /></div>
              <div className="trend-note"><span className="trend-marker" />月ごとの合計支出</div>
            </article>
          </section>

          <section className="receipt-section" id="receipts">
            <div className="section-heading"><div><span className="panel-kicker">YOUR RECORDS</span><h2>お買いもの明細 <span>{currentItems.length}</span></h2></div><label className="filter-control"><span>カテゴリ</span><select value={filter} onChange={(event) => setFilter(event.target.value as Category | 'すべて')} aria-label="カテゴリで絞り込む"><option>すべて</option>{CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select><ChevronDown size={14} /></label></div>
            {isDemo && <div className="demo-note"><Sparkles size={15} /><span>画面確認用のサンプル明細です</span><button onClick={clearLedger}>サンプルを削除</button></div>}
            {visibleItems.length ? <div className="records-table-wrap"><table className="records-table"><thead><tr><th>お店・日付</th><th>商品名</th><th>カテゴリ</th><th className="amount-cell">金額</th><th><span className="sr-only">操作</span></th></tr></thead><tbody>{visibleItems.map((item) => <tr key={item.id}><td><div className="store-cell"><span className="store-avatar">{getInitials(item.store)}</span><span><strong>{item.store}</strong><small>{formatDate(item.date)}</small></span></div></td><td className="product-name">{item.name}</td><td><span className={`category-pill category-${CATEGORIES.indexOf(item.category)}`}>{item.category}</span></td><td className="amount-cell">¥{yen.format(item.amount)}</td><td><button className="delete-button" aria-label={`${item.name}を削除`} onClick={() => removeItem(item.id)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div> : <div className="empty-records"><span><ReceiptText size={23} /></span><strong>明細はまだありません</strong><p>レシートを読み込むと、ここに記録されます。</p><button className="outline-button" onClick={() => fileInput.current?.click()}><Upload size={15} />レシートを追加</button></div>}
            <div className="records-footer"><span>この月の記録 <strong>{visibleItems.length}</strong> 件</span><span>合計 <strong>¥{yen.format(visibleItems.reduce((sum, item) => sum + item.amount, 0))}</strong></span></div>
          </section>

          <footer className="page-footer"><span>まいにち帳 <span>·</span> あなたの暮らしに、ちいさな見える化。</span><span><Leaf size={13} />データはこの端末の中だけに保存されます</span></footer>
        </div>
      </main>

      <input ref={fileInput} className="file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileChange} />
      <input ref={csvInput} className="file-input" type="file" accept=".csv,text/csv" onChange={(event) => void handleCardCsvChange(event)} />
      {isDragging && <div className="drop-overlay" onDragOver={(event) => event.preventDefault()} onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}><div><FileImage size={36} /><strong>レシートをここにドロップ</strong><span>JPG・PNG・WebP</span></div></div>}
      {isParsing && <div className="loading-toast"><LoaderCircle className="spin" size={18} /><span><strong>レシートを読み取り中</strong><small>商品と金額を確認しています…</small></span></div>}
      {notice && <div className="notice-toast" role="status"><span className="notice-check"><Check size={14} /></span>{notice}<button onClick={() => setNotice('')} aria-label="通知を閉じる"><X size={15} /></button></div>}

      {cropImageUrl && <div className="modal-backdrop crop-backdrop"><section className="review-modal crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-title"><div className="modal-header"><span className="modal-icon"><FileImage size={19} /></span><button className="icon-button" onClick={closeCropper} aria-label="閉じる"><X size={18} /></button></div><span className="panel-kicker">CROP RECEIPT</span><h2 id="crop-title">切り抜く範囲を指定</h2><p className="modal-intro">画像上をドラッグして、品目名・金額・総額を含む範囲を四角く囲んでください。</p><div ref={cropStageRef} className={`crop-stage ${cropImageReady ? 'crop-stage-ready' : ''}`} onPointerDown={handleCropPointerDown} onPointerMove={handleCropPointerMove} onPointerUp={handleCropPointerUp} onPointerCancel={handleCropPointerUp}><img ref={cropImageRef} className="crop-source-image" src={cropImageUrl} alt="切り抜き範囲を選ぶレシート" draggable={false} onLoad={() => setCropImageReady(true)} />{cropSelectionStyle && cropArea && cropArea.width > 0 && cropArea.height > 0 && <div className="crop-selection" style={cropSelectionStyle}><span>{cropArea.width} × {cropArea.height} px</span></div>}{cropImageReady && !cropArea && <div className="crop-hint">ここをドラッグして範囲を選択</div>}</div><div className="crop-controls"><span>{cropArea && cropArea.width > 0 && cropArea.height > 0 ? `選択範囲 ${cropArea.width} × ${cropArea.height} px` : '範囲未選択'}</span><button className="icon-button" onClick={resetCropSelection} aria-label="選択範囲をクリア" disabled={!cropArea}><RotateCcw size={16} /></button></div><div className="modal-actions"><button className="outline-button" onClick={closeCropper}>キャンセル</button><button className="primary-button" onClick={() => void analyzeCroppedReceipt()} disabled={!cropArea || cropArea.width < 8 || cropArea.height < 8 || isParsing}><Sparkles size={16} />範囲を切り抜いて読み取る</button></div></section></div>}

      {pendingReceipt && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPendingReceipt(null); }}><section className="review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title"><div className="modal-header"><span className="modal-icon"><Sparkles size={19} /></span><button className="icon-button" onClick={() => setPendingReceipt(null)} aria-label="閉じる"><X size={18} /></button></div><span className="panel-kicker">CLAUDE RECEIPT SCAN</span><h2 id="review-title">読み取り内容を確認</h2><p className="modal-intro">保存前に店舗名と日付を確認できます。</p><div className="modal-fields"><label>お店の名前<input value={storeOverride} onChange={(event) => setStoreOverride(event.target.value)} /></label><label>お買いものした日<input type="date" value={dateOverride} onChange={(event) => setDateOverride(event.target.value)} /></label></div><div className="review-list">{pendingReceipt.items.map((item, index) => <div className="review-row" key={`${item.name}-${index}`}><span>{item.name}<small>{item.category}</small></span><strong>¥{yen.format(item.amount)}</strong></div>)}</div><div className="review-total"><span>{pendingReceipt.items.length}件の明細</span><strong>¥{yen.format(pendingReceipt.items.reduce((sum, item) => sum + item.amount, 0))}</strong></div><div className="modal-actions"><button className="outline-button" onClick={() => setPendingReceipt(null)}>キャンセル</button><button className="primary-button" onClick={saveReceipt}><Check size={16} />この内容で保存</button></div></section></div>}

      {cardCsvDraft && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCardCsvDraft(null); }}><section className="review-modal csv-modal" role="dialog" aria-modal="true" aria-labelledby="csv-title"><div className="modal-header"><span className="modal-icon"><FileSpreadsheet size={19} /></span><button className="icon-button" onClick={() => setCardCsvDraft(null)} aria-label="閉じる"><X size={18} /></button></div><span className="panel-kicker">CARD STATEMENT IMPORT</span><h2 id="csv-title">カード明細を取り込む</h2><p className="modal-intro"><strong>{cardCsvDraft.fileName}</strong> · ファイルはこの端末内で読み込みます。</p><div className="mapping-grid">{([['date', '利用日'], ['merchant', '利用先・摘要'], ['amount', '利用金額']] as const).map(([key, label]) => <label key={key}>{label}<select value={cardCsvMapping[key]} onChange={(event) => setCardCsvMapping((current) => ({ ...current, [key]: event.target.value }))}><option value="">列を選択</option>{cardCsvDraft.headers.map((header) => <option key={`${key}-${header}`} value={header}>{header}</option>)}</select></label>)}</div><div className="csv-summary-note"><span>取込予定 <strong>{cardCsvAssessment?.importCount ?? '—'}</strong> 件</span><span>重複 <strong>{cardCsvAssessment?.duplicateCount ?? '—'}</strong> 件</span><span>対象外 <strong>{cardCsvAssessment ? cardCsvAssessment.invalidCount + cardCsvAssessment.nonExpenseCount : '—'}</strong> 件</span></div>{cardCsvAssessment && cardCsvAssessment.rows.length > 0 ? <div className="csv-preview-wrap"><table className="csv-preview-table"><thead><tr><th>利用日</th><th>利用先</th><th>カテゴリ</th><th>金額</th><th>状態</th></tr></thead><tbody>{cardCsvAssessment.rows.slice(0, 8).map((row, index) => <tr key={`${row.date}-${row.merchant}-${index}`}><td>{row.date}</td><td>{row.merchant}</td><td><span className={`category-pill category-${CATEGORIES.indexOf(row.category)}`}>{row.category}</span></td><td>¥{yen.format(row.amount)}</td><td>{row.isDuplicate ? <span className="csv-duplicate">重複</span> : <span className="csv-ready">取込</span>}</td></tr>)}</tbody></table>{cardCsvAssessment.rows.length > 8 && <p className="csv-more">ほか {cardCsvAssessment.rows.length - 8} 件</p>}</div> : <div className="csv-empty">列を選択すると、取り込み内容を確認できます。</div>}<p className="csv-footnote">同じ日付・利用先・金額の明細は重複として除外します。金額が0以下の行（返品・支払など）は支出に含めません。</p><div className="modal-actions"><button className="outline-button" onClick={() => setCardCsvDraft(null)}>キャンセル</button><button className="primary-button" onClick={saveCardCsv} disabled={!cardCsvAssessment || cardCsvAssessment.importCount === 0}><Check size={16} />{cardCsvAssessment?.importCount ?? 0}件を家計簿に追加</button></div></section></div>}
    </div>
  );
}