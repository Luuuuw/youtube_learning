// POST /api/admin/ai-pending/approve body {ids: string[]}
// 对每个 pending proposal 触发 apply：按 targetFile 后缀决定 JSON / text 写盘
import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { verifyAdmin, forbiddenResponse } from '@/lib/auth-middleware';
import { approvePendingProposal, type AiProposal } from '@/lib/safe-ai-write';
import { atomicWriteJsonSync, atomicWriteTextSync } from '@/lib/atomic-write';

interface ApproveResult { id: string; status: 'applied' | 'rejected'; reason?: string }

function applyProposal(p: AiProposal): void {
  const ext = path.extname(p.targetFile).toLowerCase();
  const after = p.after;
  if (ext === '.json') {
    // after 可能是已经 parsed 的对象，或者是 JSON 字符串
    let data: unknown = after;
    if (typeof after === 'string') {
      try { data = JSON.parse(after); }
      catch { /* 不是合法 JSON 字符串，按字符串原样写（罕见） */ }
    }
    atomicWriteJsonSync(p.targetFile, data);
  } else {
    // .vtt / .txt / 其他文本
    const text = typeof after === 'string' ? after : JSON.stringify(after);
    atomicWriteTextSync(p.targetFile, text);
  }
}

export async function POST(req: NextRequest) {
  const auth = verifyAdmin(req);
  if (!auth.valid) return forbiddenResponse();

  let body: { ids?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: '无效 JSON' }, { status: 400 }); }
  const ids = Array.isArray(body.ids) ? body.ids.filter(x => typeof x === 'string') as string[] : [];
  if (ids.length === 0) return NextResponse.json({ error: '缺 ids' }, { status: 400 });

  const results: ApproveResult[] = [];
  for (const id of ids) {
    const r = await approvePendingProposal(id, (p) => { applyProposal(p); });
    results.push({ id, status: r.status === 'applied' ? 'applied' : 'rejected', reason: r.reason });
  }
  return NextResponse.json({ results });
}
