import { NextRequest, NextResponse } from 'next/server';
import authSessions from '@/lib/auth-sessions';

const MINIMAX_API_URL = 'https://api.minimaxi.com/v1/text/chatcompletion_v2';

function verifyAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get('authorization');
  if (!authHeader) return false;
  const token = authHeader.replace('Bearer ', '');
  const session = authSessions.get(token);
  if (!session) return false;
  const age = Date.now() - session.createdAt;
  if (age > 7 * 24 * 60 * 60 * 1000) return false;
  return true;
}

export async function POST(req: NextRequest) {
  if (!verifyAuth(req)) {
    return NextResponse.json({ error: '请先登录' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { word, promptType = 'dictionary' } = body;

    if (!word || typeof word !== 'string') {
      return NextResponse.json({ error: '缺少 word 参数' }, { status: 400 });
    }
    if (word.length > 2000) {
      return NextResponse.json({ error: 'word 参数过长' }, { status: 400 });
    }
    if (body.context !== undefined && (typeof body.context !== 'string' || body.context.length > 2000)) {
      return NextResponse.json({ error: 'context 参数格式错误或过长' }, { status: 400 });
    }
    if (typeof promptType !== 'string' || promptType.length > 64) {
      return NextResponse.json({ error: 'promptType 参数错误' }, { status: 400 });
    }

    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: '未配置 MINIMAX_API_KEY，请在 .env.local 中设置' },
        { status: 500 }
      );
    }

    let systemPrompt = '';
    let userPrompt = '';

    if (promptType === 'dashboard') {
      systemPrompt =
        '你是VibeEnglish的AI学习教练。用户会给你一段学习统计数据。\n\n' +
        '【你的任务】\n' +
        '基于数据特征，直接给出3-5条可执行的学习建议。\n\n' +
        '【严格规则】\n' +
        '- 不要复述或分析数据，不要写"你目前有X个视频"\n' +
        '- 不要写"根据数据分析"、"数据显示"这类开头\n' +
        '- 直接以建议内容开头\n' +
        '- 每条建议用 emoji 开头，一行一条\n' +
        '- 每条不超过25个中文字符\n' +
        '- 建议要具体、可操作（如"每天精听15分钟"、"重点练习连读技巧"）\n' +
        '- 如果生词多就建议复习策略，如果点击少就建议增加互动\n' +
        '- 只输出建议本身，不要有任何开场白或结束语';
      userPrompt = word;
    } else if (promptType === 'accent') {
      systemPrompt =
        '你是一个英语口音识别专家。根据视频标题和描述，判断视频是英音还是美音。只回复一个单词：british 或 american。不要有任何其他内容。';
      userPrompt = word;
    } else if (promptType === 'vocab-classify') {
      systemPrompt =
        '你是一个英语词汇分类专家。用户会给你一组英语生词列表。\n\n' +
        '【任务】\n' +
        '将每个单词归入一个语义类别。\n\n' +
        '【可用类别（必须从中选择，可重复使用）】\n' +
        '- 动作与行为 (action)\n' +
        '- 事物与概念 (thing)\n' +
        '- 描述与状态 (description)\n' +
        '- 时间与数量 (time)\n' +
        '- 情感与态度 (emotion)\n' +
        '- 学术与专业 (academic)\n' +
        '- 短语与习语 (phrase)\n\n' +
        '【输出格式】严格JSON，不要任何其他内容：\n' +
        '{"categories":[{"name":"显示名","key":"对应key","words":["word1","word2"]}]}\n\n' +
        '【规则】\n' +
        '- 每个单词必须且只能属于一个类别\n' +
        '- 每个类别至少包含1个单词\n' +
        '- name用中文（4字以内），key用英文小写\n' +
        '- 不确定的词放入"事物与概念"';
      userPrompt = word;
    } else if (promptType === 'video-tag') {
      systemPrompt =
        '你是一个视频内容分析专家。根据视频的标题和描述，判断视频的【场景分类】和【难度等级】。\n\n' +
        '【场景分类（必须从中选一个）】\n' +
        '- beauty: 美妆护肤、化妆教程、产品测评\n' +
        '- tech: 科技、数码、编程、AI、硬件\n' +
        '- lifestyle: 日常生活、家居、Vlog\n' +
        '- education: 教育、学习、知识科普\n' +
        '- entertainment: 娱乐、电影、音乐、综艺\n' +
        '- business: 商业、财经、投资、创业\n' +
        '- travel: 旅行、旅游、探险\n' +
        '- food: 美食、烹饪、餐厅\n' +
        '- fitness: 健身、运动、健康\n' +
        '- vlog: 个人Vlog、日常记录\n' +
        '- other: 其他\n\n' +
        '【难度等级（必须从中选一个）】\n' +
        '- beginner: 简单词汇，慢速语速，适合初学者\n' +
        '- intermediate: 常用表达，正常语速，适合中级学习者\n' +
        '- advanced: 专业术语，快速语速，适合高级学习者\n\n' +
        '【输出格式】严格JSON，不要任何其他内容：\n' +
        '{"category":"分类key","difficulty":"难度key","reason":"简短理由（20字以内）"}';
      userPrompt = word;
    } else if (promptType === 'semantic-links') {
      systemPrompt =
        '你是一个英语词汇语义分析专家。用户会给你一组英语单词列表。\n\n' +
        '【核心任务】\n' +
        '深度分析这些单词之间的语义关联，构建一个语义知识网络。尽可能多地找出单词之间的关系。\n\n' +
        '【关系类型】\n' +
        '- synonym: 同义词/近义词（意思相近或可以互换使用的词）\n' +
        '- antonym: 反义词（意思相反的词）\n' +
        '- collocation: 常见搭配（经常一起出现的词组，如"make decision"、"take action"）\n' +
        '- root: 同根词（有相同词根/词缀，如 act-action-active, create-creative-creativity）\n' +
        '- topic: 同主题/同领域（属于同一话题领域的词，如哲学类：philosophy, reason, existence, consciousness）\n' +
        '- context: 上下文相关（在相同语境中经常出现，如学术写作中常用的词）\n\n' +
        '【输出格式】严格JSON，不要任何其他内容：\n' +
        '{"links":[{"from":"word1","to":"word2","type":"synonym|antonym|collocation|root|topic|context","label":"中文关系描述"}]}\n\n' +
        '【重要规则】\n' +
        '- 尽可能多找关系！每个单词至少尝试找2-3个关联\n' +
        '- topic 和 context 是最重要的关系类型，多从主题和语境角度思考\n' +
        '- label 用中文简短描述，如"同义词"、"反义"、"常见搭配"、"同根词"、"同属哲学领域"、"学术上下文"\n' +
        '- 每对关系只输出一次（不重复反向输出）\n' +
        '- 如果确实没有关联才输出 {"links":[]}';
      userPrompt = word;
    } else {
      const ctx = body.context || '';
      systemPrompt =
        '你是专业英汉词典。严格按以下格式输出，不要任何多余内容：\n\n' +
        '音标: /xxx/\n' +
        '释义: 词性. 中文释义\n' +
        '例句: English sentence (中文翻译)\n\n' +
        '【严格规则】\n' +
        '- 释义只给1个最常用意思，不超过15字\n' +
        '- 词性用英文缩写：n./v./adj./adv./prep./conj./pron.\n' +
        '- 例句要简短自然，8-12个单词\n' +
        '- 如果提供了上下文，必须根据上下文选择最贴切的释义\n' +
        '- 不要输出多余解释、词源、同义词等\n' +
        '- 不要用markdown格式';
      userPrompt = ctx
        ? `单词: ${word}\n上下文: ${ctx}`
        : `单词: ${word}`;
    }

    const response = await fetch(MINIMAX_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'MiniMax-M2.5',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `MiniMax API 错误: ${response.status}`, detail: errText },
        { status: 502 }
      );
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '暂无结果';

    return NextResponse.json({ word, definition: content, promptType });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '未知错误';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
