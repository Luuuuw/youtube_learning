'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import {
  ZoomIn, ZoomOut, RotateCcw, Sparkles, Loader2,
  Filter, X, Search, Brain, Flame
} from 'lucide-react';
import { VocabItem } from '@/lib/vocab';
import {
  GraphNode, GraphLink, CategoryGroup, SemanticLink,
  buildObsidianGraph,
  applySemanticLinks,
  calculateNodeDegrees, getConnectedNodes
} from '@/lib/vocab-graph';

interface MindMapItem extends VocabItem {
  proficiency?: number;
}

interface Category {
  name: string;
  key: string;
  words: string[];
}

type ColorMode = 'video' | 'mastery' | 'time';

const VIDEO_COLORS = [
  '#f97316', '#3b82f6', '#a855f7', '#14b8a6',
  '#ec4899', '#eab308', '#22c55e', '#f43f5e',
  '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981',
];

const MASTERY_COLORS = {
  new: '#ef4444',
  learning: '#f59e0b',
  familiar: '#3b82f6',
  mastered: '#22c55e',
};

function getMasteryLevel(item: VocabItem): keyof typeof MASTERY_COLORS {
  const proficiency = (item as MindMapItem).proficiency;
  if (proficiency !== undefined) {
    if (proficiency <= 0) return 'new';
    if (proficiency <= 2) return 'learning';
    if (proficiency <= 3) return 'familiar';
    return 'mastered';
  }
  const age = Date.now() - new Date(item.addedAt).getTime();
  const days = age / (1000 * 60 * 60 * 24);
  if (days < 1) return 'new';
  if (days < 7) return 'learning';
  if (days < 30) return 'familiar';
  return 'mastered';
}

function getTimeColor(addedAt: string): string {
  const age = Date.now() - new Date(addedAt).getTime();
  const days = age / (1000 * 60 * 60 * 24);
  if (days < 1) return '#ef4444';
  if (days < 3) return '#f97316';
  if (days < 7) return '#eab308';
  if (days < 14) return '#22c55e';
  if (days < 30) return '#3b82f6';
  return '#64748b';
}

function mergeLinks(
  existing: SemanticLink[],
  incoming: SemanticLink[],
  currentWords: Set<string>
): SemanticLink[] {
  const pairSet = new Set<string>();
  existing.forEach(l => {
    pairSet.add(`${l.from.toLowerCase()}|${l.to.toLowerCase()}`);
    pairSet.add(`${l.to.toLowerCase()}|${l.from.toLowerCase()}`);
  });

  const result = [...existing];
  incoming.forEach(l => {
    const fk = l.from.toLowerCase();
    const tk = l.to.toLowerCase();
    if (!currentWords.has(fk) || !currentWords.has(tk)) return;
    const key = `${fk}|${tk}`;
    if (!pairSet.has(key)) {
      result.push(l);
      pairSet.add(key);
    }
  });
  return result;
}

export default function VocabMindMap({ items }: { items: MindMapItem[] }) {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('video');
  const [selectedVideo, setSelectedVideo] = useState<string | null>(null);
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [semanticLinks, setSemanticLinks] = useState<SemanticLink[] | null>(null);
  const [scale, setScale] = useState(1);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [showFilters, setShowFilters] = useState(false);
  const [showColorLegend, setShowColorLegend] = useState(false);

  const svgRef = useRef<SVGSVGElement>(null);
  const analyzedRef = useRef(false);

  const currentWordSet = useMemo(() => {
    return new Set(items.map(v => v.word.toLowerCase()));
  }, [items]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('ve-semantic-links');
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.links && Array.isArray(saved.links)) {
          setSemanticLinks(saved.links);
          analyzedRef.current = true;
        }
      }
    } catch { }
  }, []);

  const saveSemanticLinks = useCallback((links: SemanticLink[]) => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('ve-semantic-links', JSON.stringify({
        links,
        words: items.map(v => v.word.toLowerCase()),
        updatedAt: Date.now(),
      }));
    } catch { }
  }, [items]);

  const graphData = useMemo(() => {
    const cats: CategoryGroup[] | undefined = categories?.map(c => ({
      name: c.name,
      key: c.key,
      words: c.words,
    }));

    let data = buildObsidianGraph(items, cats);

    if (semanticLinks) {
      data = applySemanticLinks(data, semanticLinks);
    }

    return data;
  }, [items, categories, semanticLinks]);

  const filteredData = useMemo(() => {
    let nodes = [...graphData.nodes];
    let links = [...graphData.links];

    if (selectedVideo) {
      nodes = nodes.filter(n =>
        n.videoId === selectedVideo || n.type === 'category'
      );
      const nodeIds = new Set(nodes.map(n => n.id));
      links = links.filter(l => {
        const s = typeof l.source === 'string' ? l.source : l.source.id;
        const t = typeof l.target === 'string' ? l.target : l.target.id;
        return nodeIds.has(s) && nodeIds.has(t);
      });
    }

    return { nodes, links };
  }, [graphData, selectedVideo]);

  const nodeDegrees = useMemo(() => {
    return calculateNodeDegrees(filteredData.nodes, filteredData.links);
  }, [filteredData]);

  const maxDegree = Math.max(...Array.from(nodeDegrees.values()), 1);

  useEffect(() => {
    if (!svgRef.current || filteredData.nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    svg.selectAll('*').remove();

    const g = svg.append('g');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.15, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setScale(event.transform.k);
        setTranslate({ x: event.transform.x, y: event.transform.y });
      });

    svg.call(zoom as any);

    const simulation = d3.forceSimulation<GraphNode>(filteredData.nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(filteredData.links)
        .id(d => d.id)
        .distance(70)
        .strength(d => d.strength || 0.25)
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength(-180))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => {
        const deg = nodeDegrees.get(d.id) || 1;
        return 8 + (deg / maxDegree) * 12;
      }));

    const linkGroup = g.append('g').attr('class', 'links');
    const nodeGroup = g.append('g').attr('class', 'nodes');

    const linkElements = linkGroup.selectAll('line')
      .data(filteredData.links)
      .enter()
      .append('line')
      .attr('stroke', () => '#4a5568')
      .attr('stroke-opacity', 0.22)
      .attr('stroke-width', 1.2);

    const nodeElements = nodeGroup.selectAll('g')
      .data(filteredData.nodes)
      .enter()
      .append('g')
      .attr('class', 'node')
      .style('cursor', 'pointer')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    function renderNodes() {
      nodeElements.each(function(d) {
        const el = d3.select(this);
        el.selectAll('*').remove();

        const isFocused = focusedNodeId !== null && d.id === focusedNodeId;
        const isConnected = focusedNodeId !== null ? getConnectedNodes(focusedNodeId, filteredData.nodes, filteredData.links).has(d.id) : false;
        const isDimmed = focusedNodeId !== null && !isFocused && !isConnected && d.id !== focusedNodeId;

        const baseRadius = 4 + ((nodeDegrees.get(d.id) || 1) / maxDegree) * 10;
        const radius = isFocused ? baseRadius * 1.8 : isConnected ? baseRadius * 1.3 : baseRadius;

        const nodeColor = getNodeColor(d, colorMode);

        el.append('circle')
          .attr('r', radius)
          .attr('fill', isFocused ? '#fff' : isConnected ? nodeColor : nodeColor)
          .attr('opacity', isDimmed ? 0.12 : isFocused ? 1 : 0.72)
          .attr('stroke', isFocused ? nodeColor : 'none')
          .attr('stroke-width', isFocused ? 2.5 : 0);

        el.append('text')
          .attr('dy', radius + 14)
          .attr('text-anchor', 'middle')
          .attr('fill', isDimmed ? '#334155' : isFocused ? '#e2e8f0' : '#94a3b8')
          .attr('font-size', d.type === 'category' ? '11px' : '9px')
          .attr('font-weight', d.type === 'category' ? '600' : '400')
          .attr('opacity', isDimmed ? 0.3 : 1)
          .text(d.label.length > 20 ? d.label.slice(0, 20) + '...' : d.label);
      });
    }

    renderNodes();

    nodeElements
      .on('mouseenter', function(event, d) {
        d3.select(this).raise();

        d3.select(this).select('circle').transition()
          .duration(200)
          .ease(d3.easeCubicOut)
          .attr('transform', `translate(0, -10)`);

        const connectedIds = getConnectedNodes(d.id, filteredData.nodes, filteredData.links);

        linkElements.transition().duration(150)
          .attr('stroke-opacity', l => {
            const s = typeof l.source === 'string' ? l.source : l.source.id;
            const t = typeof l.target === 'string' ? l.target : l.target.id;
            return (s === d.id || t === d.id) ? 0.9 : 0.05;
          })
          .attr('stroke-width', l => {
            const s = typeof l.source === 'string' ? l.source : l.source.id;
            const t = typeof l.target === 'string' ? l.target : l.target.id;
            return (s === d.id || t === d.id) ? 2.5 : 0.8;
          });

        nodeElements.transition().duration(150)
          .attr('opacity', n => n.id === d.id ? 1 : connectedIds.has(n.id) ? 0.85 : 0.12);

        nodeElements.select('circle')
          .filter((n: GraphNode) => n.id === d.id)
          .transition().duration(200)
          .attr('r', () => 4 + ((nodeDegrees.get(d.id) || 1) / maxDegree) * 10 * 1.6);
      })
      .on('mouseleave', function(event, d) {
        d3.select(this).select('circle').transition()
          .duration(300)
          .ease(d3.easeCubicOut)
          .attr('transform', 'translate(0, 0)');

        const baseRadius = 4 + ((nodeDegrees.get(d.id) || 1) / maxDegree) * 10;

        nodeElements.select('circle')
          .filter((n: GraphNode) => n.id === d.id)
          .transition().duration(300)
          .attr('r', baseRadius);

        if (focusedNodeId === null) {
          linkElements.transition().duration(250)
            .attr('stroke-opacity', 0.22)
            .attr('stroke-width', 1.2);
          nodeElements.transition().duration(250).attr('opacity', 1);
        } else {
          const cIds = getConnectedNodes(focusedNodeId, filteredData.nodes, filteredData.links);
          linkElements.transition().duration(150)
            .attr('stroke-opacity', l => {
              const s = typeof l.source === 'string' ? l.source : l.source.id;
              const t = typeof l.target === 'string' ? l.target : l.target.id;
              return cIds.has(s) && cIds.has(t) ? 0.7 : 0.03;
            });
          nodeElements.transition().duration(150)
            .attr('opacity', n => n.id === focusedNodeId ? 1 : cIds.has(n.id) ? 0.9 : 0.12);
        }
      })
      .on('click', function(event, d) {
        event.stopPropagation();

        if (focusedNodeId === d.id) {
          setFocusedNodeId(null);
        } else {
          setFocusedNodeId(d.id);
        }
      });

    simulation.on('tick', () => {
      linkElements
        .attr('x1', d => (d.source as GraphNode).x || 0)
        .attr('y1', d => (d.source as GraphNode).y || 0)
        .attr('x2', d => (d.target as GraphNode).x || 0)
        .attr('y2', d => (d.target as GraphNode).y || 0);

      nodeElements.attr('transform', d => `translate(${d.x || 0},${d.y || 0})`);
    });

    svg.on('click', () => setFocusedNodeId(null));

    return () => { simulation.stop(); };
  }, [filteredData, colorMode, focusedNodeId]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);

    if (focusedNodeId !== null) {
      const connectedIds = getConnectedNodes(focusedNodeId, filteredData.nodes, filteredData.links);

      svg.selectAll<SVGLineElement, GraphLink>('.links line').transition().duration(250)
        .attr('stroke-opacity', l => {
          const s = typeof l.source === 'string' ? l.source : l.source.id;
          const t = typeof l.target === 'string' ? l.target : l.target.id;
          return connectedIds.has(s) && connectedIds.has(t) ? 0.7 : 0.03;
        })
        .attr('stroke-width', l => {
          const s = typeof l.source === 'string' ? l.source : l.source.id;
          const t = typeof l.target === 'string' ? l.target : l.target.id;
          return connectedIds.has(s) && connectedIds.has(t) ? 2.0 : 0.8;
        });

      svg.selectAll<SVGGElement, GraphNode>('.nodes g').each(function(d) {
        const el = d3.select(this);
        const isFocused = d.id === focusedNodeId;
        const isConnected = connectedIds.has(d.id);
        const nc = getNodeColor(d, colorMode);

        el.transition().duration(250)
          .attr('opacity', isFocused ? 1 : isConnected ? 0.9 : 0.12);

        el.select('circle').transition().duration(250)
          .attr('fill', isFocused ? '#fff' : nc)
          .attr('stroke', isFocused ? nc : 'none')
          .attr('stroke-width', isFocused ? 2.5 : 0);
      });

      renderNodesForFocus(svg, filteredData.nodes, focusedNodeId, nodeDegrees, maxDegree);
    } else {
      svg.selectAll<SVGLineElement, GraphLink>('.links line').transition().duration(250)
        .attr('stroke-opacity', 0.22)
        .attr('stroke-width', 1.2);
      svg.selectAll<SVGGElement, GraphNode>('.nodes g').transition().duration(250)
        .attr('opacity', 1);
      svg.selectAll<SVGCircleElement, GraphNode>('.nodes g circle').transition().duration(250)
        .attr('stroke', 'none')
        .attr('stroke-width', 0);
    }
  }, [focusedNodeId]);

  function renderNodesForFocus(
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined>,
    nodes: GraphNode[],
    focusId: string | null,
    degs: Map<string, number>,
    maxD: number
  ) {
    svg.selectAll<SVGGElement, GraphNode>('.nodes g').each(function(d) {
      const el = d3.select(this);
      el.selectAll('text').remove();

      const isFocused = focusId !== null && d.id === focusId;
      const isConnected = focusId !== null ? getConnectedNodes(focusId, nodes, []).has(d.id) : false;
      const isDimmed = focusId !== null && !isFocused && !isConnected;

      const baseR = 4 + ((degs.get(d.id) || 1) / maxD) * 10;
      const r = isFocused ? baseR * 1.8 : isConnected ? baseR * 1.3 : baseR;

      el.append('text')
        .attr('dy', r + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', isDimmed ? '#334155' : isFocused ? '#e2e8f0' : '#94a3b8')
        .attr('font-size', d.type === 'category' ? '11px' : '9px')
        .attr('font-weight', d.type === 'category' ? '600' : '400')
        .attr('opacity', isDimmed ? 0.3 : 1)
        .text(d.label.length > 20 ? d.label.slice(0, 20) + '...' : d.label);
    });
  }

  const getNodeColor = (node: GraphNode, mode: ColorMode): string => {
    if (node.type === 'video') return node.color;
    if (node.type === 'category') return node.color;

    if (mode === 'mastery' && node.data && 'addedAt' in (node.data as VocabItem)) {
      return MASTERY_COLORS[getMasteryLevel(node.data as VocabItem)];
    }
    if (mode === 'time' && node.data && 'addedAt' in (node.data as VocabItem)) {
      return getTimeColor((node.data as VocabItem).addedAt);
    }
    return node.color;
  };

  const handleClassify = useCallback(async () => {
    if (items.length === 0) return;
    setClassifying(true);
    try {
      const wordList = items.map(v => v.word);
      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ word: JSON.stringify(wordList), promptType: 'vocab-classify' }),
      });
      const data = await res.json();
      if (data.definition) {
        try {
          const parsed = JSON.parse(data.definition.replace(/```json\n?|\n?```/g, '').trim());
          if (parsed.categories) setCategories(parsed.categories);
        } catch { console.warn('[mindmap] 分类结果解析失败'); }
      }
    } catch { }
    setClassifying(false);
  }, [items]);

  const handleSemanticAnalyze = useCallback(async (onlyNewWords?: boolean) => {
    if (items.length === 0) return;
    setAnalyzing(true);
    try {
      let wordList: string[];
      if (onlyNewWords && semanticLinks) {
        const existingWords = new Set(semanticLinks.flatMap(l => [l.from.toLowerCase(), l.to.toLowerCase()]));
        const newWords = items.filter(v => !existingWords.has(v.word.toLowerCase())).map(v => v.word);
        const existingSample = items.filter(v => existingWords.has(v.word.toLowerCase())).slice(0, 8).map(v => v.word);
        wordList = [...newWords, ...existingSample];
        if (wordList.length < 2) {
          setAnalyzing(false);
          return;
        }
      } else {
        if (!onlyNewWords) {
          setSemanticLinks(null);
          if (typeof window !== 'undefined') localStorage.removeItem('ve-semantic-links');
        }
        wordList = items.map(v => v.word);
      }

      const token = typeof window !== 'undefined' ? localStorage.getItem('ve-session-token') : '';
      const res = await fetch('/api/lookup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ word: JSON.stringify(wordList), promptType: 'semantic-links' }),
      });
      const data = await res.json();
      if (data.definition) {
        try {
          const parsed = JSON.parse(data.definition.replace(/```json\n?|\n?```/g, '').trim());
          if (parsed.links) {
            if (onlyNewWords && semanticLinks) {
              const merged = mergeLinks(semanticLinks, parsed.links, currentWordSet);
              setSemanticLinks(merged);
              saveSemanticLinks(merged);
            } else {
              setSemanticLinks(parsed.links);
              saveSemanticLinks(parsed.links);
            }
          }
        } catch { console.warn('[mindmap] 语义关联解析失败'); }
      }
    } catch { }
    setAnalyzing(false);
  }, [items, semanticLinks, currentWordSet, saveSemanticLinks]);

  useEffect(() => {
    if (items.length < 2) return;
    if (semanticLinks) {
      const savedWords = new Set(semanticLinks.flatMap(l => [l.from.toLowerCase(), l.to.toLowerCase()]));
        const hasNew = items.some(v => !savedWords.has(v.word.toLowerCase()));
        if (hasNew && !analyzedRef.current) {
          analyzedRef.current = true;
          handleSemanticAnalyze(true);
        }
    } else if (!analyzedRef.current) {
      analyzedRef.current = true;
      handleSemanticAnalyze();
    }
  }, [items.length, semanticLinks, handleSemanticAnalyze]);

  const handleReset = () => {
    setScale(1);
    setTranslate({ x: 0, y: 0 });
    setSelectedVideo(null);
    setFocusedNodeId(null);
    if (svgRef.current) {
      d3.select(svgRef.current).call(
        d3.zoom<SVGSVGElement, unknown>().transform as any,
        d3.zoomIdentity
      );
    }
  };

  const videoList = useMemo(() => {
    const map = new Map<string, { title: string; count: number; color: string }>();
    items.forEach(item => {
      const existing = map.get(item.videoId);
      if (existing) existing.count++;
      else map.set(item.videoId, { title: item.videoTitle, count: 1, color: VIDEO_COLORS[map.size % VIDEO_COLORS.length] });
    });
    return Array.from(map.entries()).map(([id, data]) => ({ id, ...data }));
  }, [items]);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handleClassify} disabled={classifying || items.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{
              background: classifying ? 'hsl(var(--muted))' : 'linear-gradient(135deg, rgba(99,102,241,0.15), rgba(168,85,247,0.15))',
              border: '1px solid rgba(139,92,246,0.25)', color: '#a78bfa',
            }}>
            {classifying ? (<><Loader2 className="h-4 w-4 animate-spin" />AI 分类中...</>)
              : (<><Sparkles className="h-4 w-4" />{categories ? '重新分类' : 'AI 智能分类'}</>)}
          </button>

          <button onClick={() => handleSemanticAnalyze(false)} disabled={analyzing || items.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
            style={{
              background: analyzing ? 'hsl(var(--muted))' : 'linear-gradient(135deg, rgba(34,197,94,0.15), rgba(20,184,166,0.15))',
              border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80',
            }}>
            {analyzing ? (<><Loader2 className="h-4 w-4 animate-spin" />AI 分析语义中...</>)
              : (<><Brain className="h-4 w-4" />{semanticLinks ? `重新分析语义 (${semanticLinks.length}条)` : 'AI 语义连线'}</>)}
          </button>

          <button onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${showFilters ? 'bg-slate-700/50 text-slate-200' : 'text-slate-400 hover:text-slate-300'}`}>
            <Filter className="h-3.5 w-3.5" />筛选
          </button>

          <button onClick={() => setShowColorLegend(!showColorLegend)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${showColorLegend ? 'bg-slate-700/50 text-slate-200' : 'text-slate-400 hover:text-slate-300'}`}>
            <Flame className="h-3.5 w-3.5" />着色
          </button>
        </div>

        <div className="flex items-center gap-1">
          <button onClick={() => {
            if (svgRef.current) d3.select(svgRef.current).transition().duration(300).call(
              d3.zoom<SVGSVGElement, unknown>().transform as any,
              d3.zoomIdentity.translate(translate.x, translate.y).scale(Math.max(0.15, scale - 0.2))
            );
          }} className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-xs text-white/40 w-10 text-center">{Math.round(scale * 100)}%</span>
          <button onClick={() => {
            if (svgRef.current) d3.select(svgRef.current).transition().duration(300).call(
              d3.zoom<SVGSVGElement, unknown>().transform as any,
              d3.zoomIdentity.translate(translate.x, translate.y).scale(Math.min(4, scale + 0.2))
            );
          }} className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button onClick={handleReset} className="p-1.5 rounded-md text-white/40 hover:text-white/70 hover:bg-white/5 transition-colors ml-1">
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {showColorLegend && (
        <div className="mb-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700/30">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-slate-400 font-medium">着色模式:</span>
            {(['video', 'mastery', 'time'] as ColorMode[]).map(m => (
              <button key={m} onClick={() => setColorMode(m)}
                className={`px-3 py-1 rounded-full text-xs transition-all ${colorMode === m ? 'bg-indigo-500/20 text-indigo-300' : 'text-slate-400'}`}>
                {m === 'video' ? '按视频' : m === 'mastery' ? '按掌握度' : '按时间'}
              </button>
            ))}
          </div>
          {colorMode === 'mastery' && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-700/30">
              {Object.entries(MASTERY_COLORS).map(([level, color]) => (
                <div key={level} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                  <span className="text-[10px] text-slate-400">{{new:'新词',learning:'学习中',familiar:'熟悉',mastered:'已掌握'}[level]}</span>
                </div>
              ))}
            </div>
          )}
          {colorMode === 'time' && (
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-700/30">
              {[['#ef4444','今天'],['#f97316','3天内'],['#eab308','1周内'],['#22c55e','2周内'],['#3b82f6','1月内'],['#64748b','更早']].map(([c,l]) => (
                <div key={c} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: c }} /><span className="text-[10px] text-slate-400">{l}</span></div>
              ))}
            </div>
          )}
        </div>
      )}

      {showFilters && (
        <div className="mb-4 p-3 rounded-xl bg-slate-800/40 border border-slate-700/30">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-xs text-slate-400 font-medium">视频筛选:</span>
            {videoList.map(video => (
              <button key={video.id} onClick={() => setSelectedVideo(selectedVideo === video.id ? null : video.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-all ${selectedVideo === video.id ? 'text-white' : 'text-slate-400 hover:text-slate-300 bg-slate-700/30'}`}
                style={selectedVideo === video.id ? { backgroundColor: `${video.color}30`, border: `1px solid ${video.color}60` } : {}}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: video.color }} />
                {video.title.length > 15 ? video.title.slice(0, 15) + '...' : video.title}
                <span className="text-slate-500">({video.count})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="relative w-full h-[600px] rounded-xl overflow-hidden" style={{ background: '#0d1117' }}>
        <svg ref={svgRef} className="w-full h-full relative z-10" style={{ cursor: 'grab' }} />

        {focusedNodeId && (
          <div className="absolute top-3 left-3 right-3 px-3 py-1.5 rounded-lg text-xs flex items-center justify-between"
            style={{ background: 'rgba(13,17,23,0.92)', border: '1px solid rgba(148,163,184,0.15)', color: '#94a3b8' }}>
            <span><Search className="h-3 w-3 inline mr-1" />已选中节点，点击空白处取消</span>
            <button onClick={() => setFocusedNodeId(null)} className="text-slate-500 hover:text-slate-300"><X className="h-3 w-3" /></button>
          </div>
        )}

        <div className="absolute bottom-3 left-3 text-[10px] pointer-events-none select-none" style={{ color: '#333' }}>
          滚轮缩放 · 拖拽平移 · 点击节点查看关系 · 悬停高亮连线
        </div>
      </div>
    </div>
  );
}
