# PRD: 字幕翻译与断句优化系统 (Subtitle Translation Protocol)

## 1. 文档信息
- **版本**: v1.0
- **创建日期**: 2026-04-28
- **状态**: 待实施
- **优先级**: P0 (Critical)

---

## 2. 背景与问题

### 2.1 当前问题
- AI翻译的字幕经常出现"聚成一坨"的问题（多行合并）
- 翻译输出包含乱码或无法解析的字符
- 时间轴与翻译内容错位，导致前端渲染失败
- 翻译质量不稳定：有时过于冗长，有时丢失关键信息

### 2.2 根本原因分析
1. **缺少结构化指令**：AI没有收到明确的格式约束
2. **时间戳干扰**：原始VTT时间戳（`00:00:01.000 --> 00:00:04.000`）导致AI混乱
3. **无ID锚点**：缺乏行级标识符，AI容易合并或拆分行
4. **长度失控**：未限制单行字数，导致字幕铺满屏幕

---

## 3. 需求规格

### 3.1 身份设定 (Identity)
```
你是一个专业的视频翻译官和字幕后期专家，
精通多种语言的口语化翻译。
你的任务是将以下字幕内容翻译成中文，并优化其可读性。
```

### 3.2 核心原则 (Core Principles - 严禁违背)

#### 原则1: 保持行数一致 ✅
- **规则**: 翻译后的总行数必须与输入行数**完全相等**
- **禁止**: 
  - ❌ 将两行合并为一行
  - ❌ 将一行拆分为两行
- **示例**:
  ```
  输入:
  [[ID:1]] Hello guys, welcome back.
  [[ID:2]] Today we learn AI.
  
  正确输出 (2行):
  [[ID:1]] 大家好，欢迎回来。
  [[ID:2]] 今天我们学习AI。
  
  错误输出 (1行 - 合并):
  [[ID:1]] 大家好欢迎回来今天我们学习AI。❌
  ```

#### 原则2: 保留标识符 🔒
- **规则**: 每行开头的 `[[ID:数字]]` 是时间轴关联标识
- **要求**: 必须**原样保留**，严禁修改或删除
- **目的**: 用于后续代码自动对齐时间轴

#### 原则3: 语义完整性 📝
- **规则**: 翻译时要兼顾上下文
- **目标**: 确保中文表达地道、口语化
- **示例**:
  ```
  EN: I'm so happy this morning because I woke up with the sun.
  ZH: 我今天早上特别开心，因为醒来时阳光正好照进来。（自然流畅）✅
  ZH: 我是如此快乐今早因为我醒了伴随太阳。（生硬直译）❌
  ```

#### 原则4: 长度控制 📏
- **规则**: 每一行中文建议控制在 **15-20个汉字** 以内
- **处理策略**: 如果原文很长，请精简表达
- **目标**: 避免字幕铺满屏幕，影响观看体验
- **示例**:
  ```
  EN: When we met her for the first time, I somehow thought that she was going to be like a small toddler or something.
  
  ZH (过长 - 35字): 当我们第一次见到她的时候，我总觉得她会像一个小孩子或者什么似的。❌
  ZH (合适 - 18字): 第一次见她时，总觉得她会像个小孩。✅
  ```

#### 原则5: 严禁废话 🚫
- **规则**: 只输出翻译后的结果
- **禁止**:
  - ❌ 输出"好的"、"翻译如下"、"以下是翻译结果"
  - ❌ 输出任何解释性文字
  - ❌ 使用Markdown代码块符号（```）

---

### 3.3 格式规范 (Format Specification)

#### 输入格式
```
[[ID:1]] 原文内容
[[ID:2]] 原文内容
[[ID:3]] 原文内容
...
```

#### 输出格式
```
[[ID:1]] 翻译后的中文
[[ID:2]] 翻译后的中文
[[ID:3]] 翻译后的中文
...
```

#### 数据流架构
```
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│  原始VTT   │ => │  预处理脚本  │ => │  AI翻译API  │
│ (带时间戳)  │    │ (提取+编号)  │    │ (结构化Prompt)│
└─────────────┘    └──────────────┘    └─────────────┘
                                               │
┌─────────────┐    ┌──────────────┐            │
│  最终VTT   │ <= │  后处理脚本  │ <───────────┘
│ (时间轴对齐)│    │ (删除ID+还原)│
└─────────────┘    └──────────────┘
```

---

### 3.4 异常处理规则 (Exception Handling)

#### 规则1: 专业术语 💼
- **场景**: 遇到无法翻译的专有名词
- **处理**: 保留原样
- **示例**:
  - 软件名: `React`, `Next.js`, `MiniMax`
  - 代码函数: `useState()`, `fetch()`
  - 人名: `Sally`, `Copenhagen`
  - 品牌: `YouTube`, `GitHub`

#### 规则2: 语气词过滤 🗑️
- **忽略列表**: `uhm`, `uh`, `um`, `like`, `you know`, `right?`
- **目标**: 使字幕清爽，去除无意义占位词
- **示例**:
  ```
  EN: So, um, like, we're going to, uh, walk the dog.
  ZH: 所以我们要去遛狗。（已过滤语气词）✅
  ZH: 所以，嗯，像，我们要去，呃，遛狗。（未过滤）❌
  ```

#### 规则3: 乱码预防 ⚠️
- **禁止字符**:
  - ❌ Markdown代码块: ``` ``` ```
  - ❌ 特殊转义: `\n`, `\t`, `\r`
  - ❌ HTML标签: `<div>`, `<p>`
  - ❌ 星号/下划线: `*`, `_`, `~~`
- **允许字符**: 中文标点（。，！？）、英文标点（,.!?）、数字、字母

---

## 4. 技术实现要求

### 4.1 预处理脚本 (Pre-processing)
```typescript
// 输入: 原始VTT文本
// 输出: 结构化文本 (带ID锚点)
function preprocessVtt(vttContent: string): string {
  // 1. 解析VTT，提取每行文本
  // 2. 剔除时间戳行 (00:00:01.000 --> 00:00:04.000)
  // 3. 为每行添加 [[ID:N]] 锚点
  // 4. 清理HTML实体 (&gt; -> >)
  // 5. 返回纯文本 + ID标识符
}
```

### 4.2 Prompt模板 (System Prompt)
```typescript
const SYSTEM_PROMPT = `
# 字幕翻译与断句优化指令 (Subtitle Translation Protocol)

## 1. 身份设定
你是一个专业的视频翻译官和字幕后期专家...

## 2. 核心原则（严禁违背）
- 保持行数一致...
- 保留标识符...
- 语义完整性...
- 长度控制（15-20字）...
- 严禁废话...

## 3. 格式规范
输入格式: [[ID:N]] 原文
输出格式: [[ID:N]] 翻译

## 4. 异常处理
- 专业术语保留原样
- 过滤语气词 (uhm, uh, like)
- 禁止Markdown和特殊字符

## 5. 待翻译内容
${preprocessedContent}
`;
```

### 4.3 后处理脚本 (Post-processing)
```typescript
// 输入: AI返回的翻译文本 (带ID)
// 输出: VTT格式 (时间轴对齐)
function postprocessTranslation(aiOutput: string, originalVtt: string): string {
  // 1. 按 [[ID:N]] 分割翻译结果
  // 2. 提取每个ID对应的中文翻译
  // 3. 与原始VTT的时间戳一一对应
  // 4. 生成新的中文字幕VTT文件
}
```

---

## 5. 测试用例 (Test Cases)

### 5.1 正向测试 ✅
```javascript
test('保持行数一致', () => {
  const input = `[[ID:1]] Hello world.
[[ID:2]] How are you?`;
  
  const output = await translate(input);
  
  const lines = output.split('\n').filter(l => l.startsWith('[[ID:'));
  expect(lines.length).toBe(2); // 必须是2行
});

test('保留ID标识符', () => {
  const input = `[[ID:5]] Test content.`;
  const output = await translate(input);
  
  expect(output).toContain('[[ID:5]]'); // ID必须存在
});
```

### 5.2 反向测试 ❌
```javascript
test('禁止合并行', () => {
  const input = `[[ID:1]] Line one.
[[ID:2]] Line two.`;
  const output = await translate(input);
  
  expect(output).not.toMatch(/\[\[ID:1\]\].*\[\[ID:2\]\]/s); // 不能在同一行
});

test('禁止废话', () => {
  const output = await translate('[[ID:1]] Hi.');
  
  expect(output).not.toContain('翻译如下');
  expect(output).not.toContain('```');
});
```

---

## 6. 成功指标 (Success Metrics)

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| **行数一致性** | 100% | `outputLines === inputLines` |
| **ID保留率** | 100% | 所有 `[[ID:N]]` 完整保留 |
| **平均行长** | 15-20 字 | 统计每行汉字数量 |
| **语气词过滤率** | >90% | uhm/uh/like 出现次数 |
| **无乱码** | 0% | Markdown/转义字符检测 |

---

## 7. 实施计划

### Phase 1: Prompt优化 (当前任务)
- [x] 创建PRD文档
- [ ] 更新 `translateBatch()` 函数的Prompt
- [ ] 实现预处理逻辑（添加ID锚点）
- [ ] 实现后处理逻辑（删除ID+还原时间戳）

### Phase 2: 测试验证
- [ ] 编写单元测试（测试用例见第5节）
- [ ] 用现有视频数据回归测试
- [ ] 对比修复前后的翻译质量

### Phase 3: 上线部署
- [ ] 删除所有旧的翻译缓存 (`*.zh-Hans.vtt`)
- [ ] 重新生成所有视频的翻译
- [ ] 前端验证显示效果

---

## 8. 参考资源

### 8.1 相关文件
- [lib/translate.ts](../lib/translate.ts) - 翻译核心逻辑
- [lib/vtt-parser.ts](../lib/vtt-parser.ts) - VTT解析器
- [components/subtitle-panel.tsx](../components/subtitle-panel.tsx) - 字幕显示组件

### 8.2 API文档
- MiniMax API: https://api.minimaxi.com/v1/text/chatcompletion_v2
- 模型推荐: `MiniMax-M2.5` (支持长上下文)

---

## 9. 版本历史

| 版本 | 日期 | 作者 | 变更说明 |
|------|------|------|---------|
| v1.0 | 2026-04-28 | User | 初始版本，定义完整Protocol |

---

**文档结束**
