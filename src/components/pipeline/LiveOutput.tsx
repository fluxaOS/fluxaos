'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Copy, Check, Terminal, MessageSquare, Zap } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { trpc } from '@/lib/trpc/client';
import type { TranscriptEntry, EntryKind } from '@/core/orchestrator/output-parser';
import { parseLine } from '@/core/orchestrator/output-parser';

interface LiveOutputProps {
  stageRunId: string;
  isActive: boolean;
}

// ── Entry renderers ──────────────────────────────────────────────────────────

function TextEntry({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className="flex gap-2 py-1.5">
      <MessageSquare className="h-3 w-3 mt-0.5 shrink-0 text-electric-violet opacity-70" />
      <span className="whitespace-pre-wrap">{entry.text}</span>
    </div>
  );
}

function ToolCallEntry({ entry, verbose }: { entry: TranscriptEntry; verbose: boolean }) {
  return (
    <div className="flex gap-2 py-1 opacity-80">
      <Terminal className="h-3 w-3 mt-0.5 shrink-0 text-slate-400" />
      <span className="text-slate-400">
        <span className="text-soft-violet font-medium">{entry.toolName}</span>
        {entry.toolCommand && (
          verbose
            ? <span className="ml-1">{entry.toolCommand}</span>
            : <span className="ml-1 opacity-70">{entry.toolCommand.split('\n')[0]?.slice(0, 120)}</span>
        )}
      </span>
    </div>
  );
}

function ToolResultEntry({ entry, verbose }: { entry: TranscriptEntry; verbose: boolean }) {
  if (!verbose && !entry.isError) return null;
  const output = entry.toolOutput ?? '';
  const preview = verbose ? output : output.slice(0, 300) + (output.length > 300 ? '\n...' : '');
  return (
    <div className={`ml-5 pl-2 border-l-2 py-0.5 text-xs whitespace-pre-wrap opacity-70 ${
      entry.isError ? 'border-red-400 text-red-400' : 'border-slate-700 text-slate-500'
    }`}>
      {preview || '(no output)'}
    </div>
  );
}

function ResultEntry({ entry }: { entry: TranscriptEntry }) {
  return (
    <div className={`flex gap-2 py-1.5 mt-1 pt-2 border-t border-slate-700/30 ${
      entry.isError ? 'text-red-400' : 'text-electric-violet'
    }`}>
      <Zap className="h-3 w-3 mt-0.5 shrink-0" />
      <span>
        <span className="font-medium">{entry.isError ? 'Failed' : 'Done'}</span>
        {entry.cost !== undefined && <span className="text-slate-500 ml-2">${entry.cost.toFixed(4)}</span>}
        {entry.text && <span className="ml-2 text-slate-300">{entry.text}</span>}
      </span>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function LiveOutput({ stageRunId, isActive }: LiveOutputProps) {
  const [rawJson, setRawJson] = useState(false);
  const [verbose, setVerbose] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Fetch existing events
  const eventsQuery = trpc.pipeline.runs.events.useQuery(
    { stageRunId },
    {
      enabled: !!stageRunId,
      refetchInterval: isActive ? 2000 : false,
    },
  );

  const rawLines = useMemo(() => {
    return (eventsQuery.data ?? [])
      .filter((e) => e.type === 'OUTPUT' || e.type === 'STAGE_STARTED' || e.type === 'STAGE_COMPLETED' || e.type === 'ERROR')
      .map((e, idx) => ({
        lineNumber: idx,
        content: typeof e.payload === 'object' && e.payload !== null
          ? (e.payload as Record<string, unknown>).content as string ?? JSON.stringify(e.payload)
          : String(e.payload),
        type: e.type,
      }));
  }, [eventsQuery.data]);

  // Parse into transcript entries
  const entries = useMemo(() => {
    const parsed: TranscriptEntry[] = [];
    for (const line of rawLines) {
      if (line.type === 'OUTPUT') {
        parsed.push(...parseLine(line.content, line.lineNumber));
      } else {
        // Non-output events (STAGE_STARTED, etc.) become system entries
        parsed.push({
          id: `sys-${line.lineNumber}`,
          kind: 'system' as EntryKind,
          lineNumber: line.lineNumber,
          text: `[${line.type}] ${line.content}`,
        });
      }
    }
    return verbose ? parsed : parsed.filter((e) => e.kind !== 'system');
  }, [rawLines, verbose]);

  // Subscribe to Supabase Realtime for live updates
  useEffect(() => {
    if (!isActive || !stageRunId) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`live-output-${stageRunId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'event',
          filter: `stage_run_id=eq.${stageRunId}`,
        },
        () => {
          // Refetch events when new ones arrive via Realtime
          eventsQuery.refetch();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stageRunId, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, rawLines.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (isNearBottom !== autoScroll) setAutoScroll(isNearBottom);
  }, [autoScroll]);

  const handleCopy = () => {
    let text: string;
    if (rawJson) {
      text = rawLines.map((l) => l.content).join('\n');
    } else {
      text = entries.map((e) => {
        if (e.kind === 'text') return e.text ?? '';
        if (e.kind === 'tool_call') return `> ${e.toolName}: ${e.toolCommand ?? ''}`;
        if (e.kind === 'tool_result') return e.toolOutput ?? '';
        if (e.kind === 'result') return `[${e.isError ? 'failed' : 'done'}] ${e.text ?? ''}`;
        return e.text ?? '';
      }).filter(Boolean).join('\n');
    }
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs text-slate-500">
          {rawJson ? `${rawLines.length} lines` : `${entries.length} entries`}
        </span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={verbose}
              onChange={(e) => setVerbose(e.target.checked)}
              className="h-3 w-3 rounded border-slate-600"
            />
            Verbose
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rawJson}
              onChange={(e) => setRawJson(e.target.checked)}
              className="h-3 w-3 rounded border-slate-600"
            />
            Raw JSON
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
              className="h-3 w-3 rounded border-slate-600"
            />
            Auto-scroll
          </label>
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors"
            title="Copy output"
          >
            {copied ? <Check className="h-3 w-3 text-electric-violet" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Output pane */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="font-mono text-xs rounded-lg p-4 h-96 overflow-y-auto bg-slate-950 text-slate-300 border border-slate-700/40"
      >
        {rawLines.length === 0 ? (
          <span className="text-slate-600">No output yet.</span>
        ) : rawJson ? (
          rawLines.map((line) => (
            <div key={line.lineNumber} className="leading-relaxed whitespace-pre-wrap">
              <span className="text-slate-600 select-none mr-3">
                {String(line.lineNumber + 1).padStart(4, ' ')}
              </span>
              {line.content}
            </div>
          ))
        ) : (
          entries.map((entry) => (
            <div key={entry.id}>
              {entry.kind === 'text' && <TextEntry entry={entry} />}
              {entry.kind === 'tool_call' && <ToolCallEntry entry={entry} verbose={verbose} />}
              {entry.kind === 'tool_result' && <ToolResultEntry entry={entry} verbose={verbose} />}
              {entry.kind === 'result' && <ResultEntry entry={entry} />}
              {entry.kind === 'system' && (
                <div className="text-slate-600 opacity-50 py-0.5">{entry.text}</div>
              )}
              {entry.kind === 'raw' && (
                <div className="whitespace-pre-wrap py-0.5">{entry.text}</div>
              )}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
