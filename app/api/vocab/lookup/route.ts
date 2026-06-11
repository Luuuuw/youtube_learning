import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { verifyAuth, unauthorizedResponse } from '@/lib/auth-middleware';

const BANK_PATH = path.join(process.cwd(), 'public', 'vocab-bank.json');

interface VocabEntry {
  word: string;
  phonetic: string;
  definition: string;
  example: string;
  pos: string;
  frequency: number;
  videoIds: string[];
  difficulty: 'easy' | 'medium' | 'hard';
  relatedWords: string[];
}

let bankCache: { words: Record<string, VocabEntry>; loadedAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

function getBank(): Record<string, VocabEntry> | null {
  if (bankCache && Date.now() - bankCache.loadedAt < CACHE_TTL_MS) {
    return bankCache.words;
  }
  if (!fs.existsSync(BANK_PATH)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(BANK_PATH, 'utf-8'));
    bankCache = { words: raw.words || {}, loadedAt: Date.now() };
    return bankCache.words;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const auth = verifyAuth(req);
  if (!auth.valid) return unauthorizedResponse();
  const { searchParams } = new URL(req.url);
  const word = searchParams.get('word');
  const prefix = searchParams.get('prefix');
  const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 50);

  const bank = getBank();
  if (!bank) {
    return NextResponse.json({ error: '词汇库尚未构建，请先调用 POST /api/vocab/bank/build' }, { status: 404 });
  }

  if (prefix) {
    const key = prefix.toLowerCase().trim();
    const matches = Object.entries(bank)
      .filter(([w]) => w.startsWith(key))
      .sort((a, b) => b[1].frequency - a[1].frequency)
      .slice(0, limit)
      .map(([_, entry]) => entry);
    return NextResponse.json({ matches, total: matches.length });
  }

  if (word) {
    const key = word.toLowerCase().trim();
    const entry = bank[key];
    if (!entry) {
      return NextResponse.json({ found: false, word: key });
    }
    return NextResponse.json({ found: true, ...entry });
  }

  const stats = {
    totalWords: Object.keys(bank).length,
    topWords: Object.entries(bank)
      .sort((a, b) => b[1].frequency - a[1].frequency)
      .slice(0, 10)
      .map(([w, e]) => ({ word: w, frequency: e.frequency, difficulty: e.difficulty })),
  };

  return NextResponse.json(stats);
}
