import { VocabItem } from './vocab';

export interface GraphNode {
  id: string;
  label: string;
  type: 'video' | 'word' | 'category';
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
  color: string;
  size: number;
  data?: VocabItem | VideoNodeData | CategoryNodeData;
  videoId?: string;
  category?: string;
  wordCount?: number;
}

export interface VideoNodeData {
  videoId: string;
  videoTitle: string;
  wordCount: number;
  thumbnail?: string;
}

export interface CategoryNodeData {
  key: string;
  name: string;
  wordCount: number;
}

export interface SemanticLink {
  from: string;
  to: string;
  type: 'synonym' | 'antonym' | 'collocation' | 'root' | 'topic' | 'context';
  label: string;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: 'video-word' | 'word-word' | 'category-word' | 'word-synonym' | 'synonym' | 'antonym' | 'collocation' | 'root' | 'topic' | 'context';
  strength?: number;
  label?: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

const VIDEO_COLORS = [
  '#f97316', '#3b82f6', '#a855f7', '#14b8a6',
  '#ec4899', '#eab308', '#22c55e', '#f43f5e',
  '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981',
];

const CATEGORY_COLORS: Record<string, string> = {
  action: '#f97316',
  thing: '#3b82f6',
  description: '#a855f7',
  time: '#14b8a6',
  emotion: '#ec4899',
  academic: '#eab308',
  phrase: '#22c55e',
};

export function buildVideoGalaxy(items: VocabItem[], categories?: CategoryGroup[]): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const videoMap = new Map<string, VocabItem[]>();

  items.forEach(item => {
    const list = videoMap.get(item.videoId) || [];
    list.push(item);
    videoMap.set(item.videoId, list);
  });

  const videoEntries = Array.from(videoMap.entries());

  videoEntries.forEach(([videoId, words], vi) => {
    const color = VIDEO_COLORS[vi % VIDEO_COLORS.length];
    const videoNode: GraphNode = {
      id: `video-${videoId}`,
      label: words[0]?.videoTitle || videoId,
      type: 'video',
      color,
      size: 24 + Math.min(words.length * 2, 20),
      data: {
        videoId,
        videoTitle: words[0]?.videoTitle || videoId,
        wordCount: words.length,
      } as VideoNodeData,
      videoId,
      wordCount: words.length,
    };
    nodes.push(videoNode);

    words.forEach((word, wi) => {
      const wordId = `word-${word.word}-${videoId}`;
      const angle = (wi / words.length) * Math.PI * 2;
      const radius = 80 + Math.random() * 40;

      nodes.push({
        id: wordId,
        label: word.word,
        type: 'word',
        color,
        size: 6,
        data: word,
        videoId,
        x: (videoNode.x || 0) + Math.cos(angle) * radius,
        y: (videoNode.y || 0) + Math.sin(angle) * radius,
      });

      links.push({
        source: videoNode.id,
        target: wordId,
        type: 'video-word',
        strength: 0.8,
      });
    });
  });

  if (categories && categories.length > 0) {
    const wordNodeMap = new Map<string, GraphNode>();
    nodes.filter(n => n.type === 'word').forEach(n => {
      if (n.data && 'word' in n.data) {
        wordNodeMap.set((n.data as VocabItem).word.toLowerCase(), n);
      }
    });

    categories.forEach((cat) => {
      const catColor = CATEGORY_COLORS[cat.key] || '#64748b';
      const catId = `cat-${cat.key}`;

      nodes.push({
        id: catId,
        label: cat.name,
        type: 'category',
        color: catColor,
        size: 16,
        data: {
          key: cat.key,
          name: cat.name,
          wordCount: cat.words.length,
        } as CategoryNodeData,
        category: cat.key,
        wordCount: cat.words.length,
      });

      cat.words.forEach(word => {
        const wordNode = wordNodeMap.get(word.toLowerCase());
        if (wordNode) {
          links.push({
            source: catId,
            target: wordNode.id,
            type: 'category-word',
            strength: 0.3,
          });
        }
      });
    });
  }

  return { nodes, links };
}

export interface CategoryGroup {
  name: string;
  key: string;
  words: string[];
}

export function buildCategoryConstellation(items: VocabItem[], categories: CategoryGroup[]): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const cx = 400;
  const cy = 300;

  const rootNode: GraphNode = {
    id: 'root',
    label: 'Vocabulary',
    type: 'category',
    color: '#c4d8f0',
    size: 20,
    x: cx,
    y: cy,
    fx: cx,
    fy: cy,
  };
  nodes.push(rootNode);

  const wordMap = new Map(items.map(i => [i.word.toLowerCase(), i]));

  categories.forEach((cat, ci) => {
    const color = CATEGORY_COLORS[cat.key] || '#64748b';
    const angle = (ci / categories.length) * Math.PI * 2 - Math.PI / 2;
    const radius = 180;
    const catId = `cat-${cat.key}`;

    const catNode: GraphNode = {
      id: catId,
      label: cat.name,
      type: 'category',
      color,
      size: 14,
      data: {
        key: cat.key,
        name: cat.name,
        wordCount: cat.words.length,
      } as CategoryNodeData,
      category: cat.key,
      wordCount: cat.words.length,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
    nodes.push(catNode);

    links.push({
      source: rootNode.id,
      target: catId,
      type: 'category-word',
      strength: 0.5,
    });

    cat.words.forEach((word, wi) => {
      const item = wordMap.get(word.toLowerCase());
      if (!item) return;

      const wordId = `word-${item.word}-${ci}`;
      const spreadAngle = cat.words.length > 1 ? (wi / (cat.words.length - 1) - 0.5) * 0.6 : 0;
      const wAngle = angle + spreadAngle;
      const wRadius = radius + 100 + Math.random() * 30;

      nodes.push({
        id: wordId,
        label: item.word,
        type: 'word',
        color,
        size: 6,
        data: item,
        videoId: item.videoId,
        x: cx + Math.cos(wAngle) * wRadius,
        y: cy + Math.sin(wAngle) * wRadius,
      });

      links.push({
        source: catId,
        target: wordId,
        type: 'category-word',
        strength: 0.4,
      });
    });
  });

  return { nodes, links };
}

export function applySemanticLinks(
  data: GraphData,
  semanticLinks: SemanticLink[]
): GraphData {
  const wordNodeMap = new Map<string, GraphNode>();
  data.nodes.filter(n => n.type === 'word').forEach(n => {
    if (n.data && 'word' in n.data) {
      wordNodeMap.set((n.data as VocabItem).word.toLowerCase(), n);
    }
  });

  const existingPairs = new Set<string>();
  data.links.forEach(l => {
    const s = typeof l.source === 'string' ? l.source : l.source.id;
    const t = typeof l.target === 'string' ? l.target : l.target.id;
    existingPairs.add(`${s}|${t}`);
    existingPairs.add(`${t}|${s}`);
  });

  const newLinks = [...data.links];

  semanticLinks.forEach(link => {
    const fromNode = wordNodeMap.get(link.from.toLowerCase());
    const toNode = wordNodeMap.get(link.to.toLowerCase());
    if (fromNode && toNode) {
      const pairKey = `${fromNode.id}|${toNode.id}`;
      if (existingPairs.has(pairKey)) return;

      const strengthMap = { synonym: 0.55, antonym: 0.45, collocation: 0.4, root: 0.5, topic: 0.35, context: 0.3 };
      newLinks.push({
        source: fromNode.id,
        target: toNode.id,
        type: link.type,
        strength: strengthMap[link.type],
        label: link.label,
      });
      existingPairs.add(pairKey);
    }
  });

  return { ...data, links: newLinks };
}

export function detectRootFamily(items: VocabItem[]): SemanticLink[] {
  const links: SemanticLink[] = [];
  const words = items.map(i => i.word.toLowerCase());

  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const w1 = words[i];
      const w2 = words[j];
      if (w1 === w2) continue;

      const minLen = Math.min(w1.length, w2.length);
      if (minLen < 4) continue;

      for (let len = 4; len <= minLen; len++) {
        if (w1.substring(0, len) === w2.substring(0, len)) {
          links.push({
            from: items[i].word,
            to: items[j].word,
            type: 'root',
            label: '同根词',
          });
          break;
        }
      }
    }
  }

  return links;
}

export function buildObsidianGraph(items: VocabItem[], categories?: CategoryGroup[]): GraphData {
  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const wordMap = new Map(items.map(i => [i.word.toLowerCase(), i]));

  items.forEach((item, i) => {
    nodes.push({
      id: `word-${item.word}-${i}`,
      label: item.word,
      type: 'word',
      color: '#94a3b8',
      size: 4,
      data: item,
      videoId: item.videoId,
    });
  });

  if (categories && categories.length > 0) {
    categories.forEach((cat) => {
      const color = CATEGORY_COLORS[cat.key] || '#64748b';
      const catId = `cat-${cat.key}`;

      nodes.push({
        id: catId,
        label: cat.name,
        type: 'category',
        color,
        size: 10 + Math.min(cat.words.length * 1.5, 12),
        data: {
          key: cat.key,
          name: cat.name,
          wordCount: cat.words.length,
        } as CategoryNodeData,
        category: cat.key,
        wordCount: cat.words.length,
      });

      cat.words.forEach(word => {
        const item = wordMap.get(word.toLowerCase());
        if (item) {
          links.push({
            source: catId,
            target: `word-${item.word}-${items.indexOf(item)}`,
            type: 'category-word',
            strength: 0.15,
          });
        }
      });
    });
  }

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const w1 = items[i].word.toLowerCase();
      const w2 = items[j].word.toLowerCase();

      const minLen = Math.min(w1.length, w2.length);
      let sharedPrefixLen = 0;
      for (let k = 0; k < Math.min(minLen, 4); k++) {
        if (w1[k] === w2[k]) sharedPrefixLen++;
        else break;
      }
      if (sharedPrefixLen >= 3) {
        links.push({
          source: `word-${items[i].word}-${i}`,
          target: `word-${items[j].word}-${j}`,
          type: 'root',
          strength: 0.15,
        });
      }
    }
  }

  return { nodes, links };
}

export function calculateNodeDegrees(nodes: GraphNode[], links: GraphLink[]): Map<string, number> {
  const degrees = new Map<string, number>();
  nodes.forEach(n => degrees.set(n.id, 0));
  links.forEach(link => {
    const s = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
    const t = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
    degrees.set(s, (degrees.get(s) || 0) + 1);
    degrees.set(t, (degrees.get(t) || 0) + 1);
  });
  return degrees;
}

export function getConnectedNodes(nodeId: string, nodes: GraphNode[], links: GraphLink[]): Set<string> {
  const connected = new Set<string>();
  connected.add(nodeId);

  links.forEach(l => {
    const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
    const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
    if (s === nodeId) connected.add(t);
    if (t === nodeId) connected.add(s);
  });

  return connected;
}

export function findShortestPath(
  startId: string,
  endId: string,
  nodes: GraphNode[],
  links: GraphLink[]
): string[] {
  const adj = new Map<string, string[]>();
  nodes.forEach(n => adj.set(n.id, []));

  links.forEach(link => {
    const s = typeof link.source === 'string' ? link.source : link.source.id;
    const t = typeof link.target === 'string' ? link.target : link.target.id;
    adj.get(s)?.push(t);
    adj.get(t)?.push(s);
  });

  const queue: [string, string[]][] = [[startId, [startId]]];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const [current, path] = queue.shift()!;
    if (current === endId) return path;

    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = adj.get(current) || [];
    for (const neighbor of neighbors) {
      if (!visited.has(neighbor)) {
        queue.push([neighbor, [...path, neighbor]]);
      }
    }
  }

  return [];
}
