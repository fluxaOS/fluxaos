'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Copy, Check, Terminal, MessageSquare, Zap } from 'lucide-react';
import { registry } from '@/config/registry';
import type { RealtimeProvider } from '@/core/ports/realtime';
import { trpc } from '@/lib/trpc/client';
import type { TranscriptEntry, EntryKind } from '@/core/ports/stdout-parser';
import { EVENT_TYPE } from '@/core/constants';

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

  // Consume event payloads as already-typed TranscriptEntry records.
  // Output events carry a TranscriptEntry in payload directly (see
  // stage-runner.ts). Non-output events (launched/completed/error)
  // synthesize a 'system' entry so verbose mode can surface them.
  const entries = useMemo<TranscriptEntry[]>(() => {
    const out: TranscriptEntry[] = [];
    for (const e of eventsQuery.data ?? []) {
      if (e.type === EVENT_TYPE.output) {
        out.push(e.payload as TranscriptEntry);
      } else if (
        e.type === EVENT_TYPE.launched ||
        e.type === EVENT_TYPE.completed ||
        e.type === EVENT_TYPE.error
      ) {
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        const text = typeof payload.content === 'string'
          ? payload.content
          : typeof payload.message === 'string'
          ? payload.message
          : typeof payload.text === 'string'
          ? payload.text
          : typeof payload.summary === 'string'
          ? payload.summary
          : typeof payload.error === 'string'
          ? payload.error
          : JSON.stringify(payload);
        out.push({
          id: `sys-${e.id}`,
          kind: 'system' as EntryKind,
          lineNumber: 0,
          text: `[${e.type}] ${text}`,
        });
      }
    }
    return verbose ? out : out.filter((x) => x.kind !== 'system');
  }, [eventsQuery.data, verbose]);

  // Subscribe to Realtime for live updates (resolved via adapter registry)
  useEffect(() => {
    if (!isActive || !stageRunId) return;

    const realtime = registry.get<RealtimeProvider>('realtime');
    const unsubscribe = realtime.subscribeToTable<unknown>(
      `live-output-${stageRunId}`,
      'event',
      'INSERT',
      () => {
        // Refetch events when new ones arrive via Realtime
        eventsQuery.refetch();
      },
    );

    return () => {
      unsubscribe();
    };
  }, [stageRunId, isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [entries.length, (eventsQuery.data ?? []).length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;
    if (isNearBottom !== autoScroll) setAutoScroll(isNearBottom);
  }, [autoScroll]);

  const handleCopy = () => {
    let text: string;
    if (rawJson) {
      text = (eventsQuery.data ?? [])
        .map((e) => `${e.type} ${JSON.stringify(e.payload)}`)
        .join('\n');
    } else {
      text = entries.map((e) => {
        if (e.kind === 'text') return e.text ?? '';
        if (e.kind === 'tool_call') return `> ${e.toolName}: ${e.toolCommand ?? ''}`;
        if (e.kind === 'tool_result') return e.toolOutput ?? '';
        if (e.kind === 'result') return `[${e.isError ? 'failed' : 'done'}] ${e.text ?? ''}`;
        return e.text ?? '';
      }).filter(Boolean).join('\n');
    }
    // Clipboard API requires HTTPS; fall back to execCommand on HTTP
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative">
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-2 px-1">
        <span className="text-xs text-slate-500">
          {rawJson ? `${(eventsQuery.data ?? []).length} lines` : `${entries.length} entries`}
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
        {(eventsQuery.data ?? []).length === 0 ? (
          <span className="text-slate-600">No output yet.</span>
        ) : rawJson ? (
          (eventsQuery.data ?? []).map((ev, idx) => (
            <div key={ev.id} className="leading-relaxed whitespace-pre-wrap">
              <span className="text-slate-600 select-none mr-3">
                {String(idx + 1).padStart(4, ' ')}
              </span>
              {ev.type} {JSON.stringify(ev.payload)}
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
