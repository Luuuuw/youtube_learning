const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.join(process.cwd(), 'public', 'content');

async function tagVideo(metaPath, title, description) {
  try {
    const res = await fetch('http://localhost:3000/api/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        word: `标题: ${title}\n描述: ${description || ''}`,
        promptType: 'video-tag',
      }),
    });

    if (!res.ok) {
      console.error(`  API错误: ${res.status}`);
      return null;
    }

    const data = await res.json();
    const content = data.definition;

    // 尝试解析 JSON
    let result;
    try {
      // 清理可能的 markdown 代码块
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      result = JSON.parse(clean);
    } catch {
      console.error(`  JSON解析失败: ${content}`);
      return null;
    }

    if (!result.category || !result.difficulty) {
      console.error(`  缺少字段: ${JSON.stringify(result)}`);
      return null;
    }

    return result;
  } catch (e) {
    console.error(`  请求失败: ${e.message}`);
    return null;
  }
}

async function main() {
  if (!fs.existsSync(CONTENT_DIR)) {
    console.log('content 目录不存在');
    return;
  }

  const dirs = fs.readdirSync(CONTENT_DIR);
  console.log(`找到 ${dirs.length} 个视频目录\n`);

  for (const dir of dirs) {
    const metaPath = path.join(CONTENT_DIR, dir, 'meta.json');
    if (!fs.existsSync(metaPath)) {
      console.log(`跳过 ${dir}: 无 meta.json`);
      continue;
    }

    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));

    // 如果已有标签，跳过
    if (meta.category && meta.difficulty) {
      console.log(`跳过 ${dir}: 已有标签 [${meta.category}, ${meta.difficulty}]`);
      continue;
    }

    console.log(`处理 ${dir}: ${meta.title?.substring(0, 60)}...`);

    const result = await tagVideo(metaPath, meta.title, meta.description);

    if (result) {
      meta.category = result.category;
      meta.difficulty = result.difficulty;
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      console.log(`  ✅ 标签: ${result.category} / ${result.difficulty} (${result.reason})`);
    } else {
      console.log(`  ❌ 打标签失败`);
    }

    // 避免 API 限流
    await new Promise(r => setTimeout(r, 1500));
  }

  console.log('\n完成！');
}

main().catch(console.error);
