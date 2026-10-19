import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 3001);
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

app.use(express.json({ limit: '12mb' }));

app.get('/api/health', (_request, response) => {
  response.json({ status: 'ok', configured: Boolean(process.env.ANTHROPIC_API_KEY) });
});

app.post('/api/receipts/parse', async (request, response) => {
  const { image, mediaType } = request.body as { image?: string; mediaType?: string };

  if (!image || !mediaType || !allowedTypes.has(mediaType)) {
    response.status(400).json({ error: 'JPEG、PNG、WebP、GIF画像を選択してください。' });
    return;
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    response.status(503).json({ error: 'サーバーにANTHROPIC_API_KEYが設定されていません。.envを確認してください。' });
    return;
  }

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const message = await anthropic.messages.create({
      model: 'claude-haiku-5-5',
      max_tokens: 1800,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: image,
              },
            },
            {
              type: 'text',
              text: 'このレシート画像を読み取り、商品明細を抽出してください。回答は説明文なしのJSONのみ。形式: {"date":"YYYY-MM-DD","store":"店舗名","items":[{"name":"商品名","amount":整数の円,"category":"食費|日用品|外食|交通費|その他"}]}。税込の明細金額を使い、判読できない値は推測せず除外してください。日付が読めない場合は空文字にしてください。',
            },
          ],
        },
      ],
    });

    const text = message.content.find((block) => block.type === 'text')?.text;
    if (!text) throw new Error('Claudeから読み取り結果が返されませんでした。');

    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const receipt = JSON.parse(jsonText) as {
      date?: string;
      store?: string;
      items?: Array<{ name?: string; amount?: number; category?: string }>;
    };

    if (!Array.isArray(receipt.items)) throw new Error('読み取り結果の形式が正しくありません。');

    response.json({
      date: receipt.date ?? '',
      store: receipt.store ?? '店舗名不明',
      items: receipt.items
        .filter((item) => item.name && Number.isFinite(item.amount) && Number(item.amount) >= 0)
        .map((item) => ({
          name: item.name,
          amount: Math.round(Number(item.amount)),
          category: ['食費', '日用品', '外食', '交通費'].includes(item.category ?? '') ? item.category : 'その他',
        })),
    });
  } catch (error) {
    console.error('レシート解析に失敗しました:', error);
    response.status(502).json({ error: 'レシートを読み取れませんでした。画像を確認してもう一度お試しください。' });
  }
});

if (process.env.NODE_ENV === 'production') {
  const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
  const distPath = path.resolve(currentDirectory, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_request, response) => response.sendFile(path.join(distPath, 'index.html')));
}

app.listen(port, () => {
  console.log(`家計簿サーバーを起動しました: http://localhost:${port}`);
});