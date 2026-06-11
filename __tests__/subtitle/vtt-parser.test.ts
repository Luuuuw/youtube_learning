import { describe, it, expect } from 'vitest';
import { parseVtt, formatTime } from '@/lib/vtt-parser';

const SIMPLE_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Hello world

00:00:05.000 --> 00:00:08.000
This is a test

00:00:10.000 --> 00:00:13.000
Goodbye world`;

const SHORT_TIME_VTT = `WEBVTT

00:01.000 --> 00:04.000
Short time format

00:05.000 --> 00:08.000
Another short cue`;

const HTML_TAG_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
<b>Bold</b> and <i>italic</i> text

00:00:05.000 --> 00:00:08.000
&lt;tag&gt; &amp; entity`;

const EMPTY_VTT = `WEBVTT`;

const MULTI_LINE_VTT = `WEBVTT

00:00:01.000 --> 00:00:04.000
Line one
Line two

00:00:05.000 --> 00:00:08.000
Single line`;

describe('parseVtt', () => {
  it('解析标准 VTT（注意：短句可能被合并）', () => {
    const result = parseVtt(SIMPLE_VTT);
    expect(result.length).toBeGreaterThanOrEqual(1);
    const allText = result.map(s => s.text).join(' ');
    expect(allText).toContain('Hello');
  });

  it('解析短时间戳格式 (MM:SS.mmm)', () => {
    const result = parseVtt(SHORT_TIME_VTT);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it('清理 VTT 格式标签（<b>, <i> 等）', () => {
    const result = parseVtt(HTML_TAG_VTT);
    for (const sub of result) {
      expect(sub.text).not.toMatch(/<(b|i|u|c)>/);
    }
  });

  it('HTML 实体被还原', () => {
    const result = parseVtt(HTML_TAG_VTT);
    const allText = result.map(s => s.text).join(' ');
    expect(allText).toContain('<tag>');
    expect(allText).toContain('&');
  });

  it('空 VTT 返回空数组', () => {
    const result = parseVtt(EMPTY_VTT);
    expect(result).toEqual([]);
  });

  it('null/undefined 输入返回空数组', () => {
    expect(parseVtt(null as any)).toEqual([]);
    expect(parseVtt(undefined as any)).toEqual([]);
  });

  it('空字符串返回空数组', () => {
    expect(parseVtt('')).toEqual([]);
  });

  it('每条字幕有正确的 id', () => {
    const result = parseVtt(SIMPLE_VTT);
    for (let i = 0; i < result.length; i++) {
      expect(result[i].id).toBe(i + 1);
    }
  });

  it('每条字幕有 startTime 和 endTime', () => {
    const result = parseVtt(SIMPLE_VTT);
    for (const sub of result) {
      expect(typeof sub.startTime).toBe('number');
      expect(typeof sub.endTime).toBe('number');
      expect(sub.endTime).toBeGreaterThan(sub.startTime);
    }
  });

  it('preserveCues 模式保留原始 cue', () => {
    const result = parseVtt(SIMPLE_VTT, { preserveCues: true });
    expect(result.length).toBeGreaterThanOrEqual(3);
  });

  it('多行文本合并为单行', () => {
    const result = parseVtt(MULTI_LINE_VTT);
    const firstSub = result.find(s => s.text.includes('Line'));
    if (firstSub) {
      expect(firstSub.text).toContain('Line one');
      expect(firstSub.text).toContain('Line two');
      expect(firstSub.text).not.toContain('\n');
    }
  });
});

describe('formatTime', () => {
  it('格式化秒数为 HH:MM:SS', () => {
    expect(formatTime(0)).toBe('00:00:00');
    expect(formatTime(61)).toBe('00:01:01');
    expect(formatTime(3661)).toBe('01:01:01');
  });

  it('边界值', () => {
    expect(formatTime(3599)).toBe('00:59:59');
    expect(formatTime(3600)).toBe('01:00:00');
  });
});
