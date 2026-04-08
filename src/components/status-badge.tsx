const colorMap: Record<string, string> = {
  // Pipeline run statuses
  pending: 'bg-yellow-500/20 text-yellow-400',
  running: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-gray-500/20 text-gray-400',
  // Stage run statuses
  queued: 'bg-yellow-500/20 text-yellow-400',
  gate_pending: 'bg-purple-500/20 text-purple-400',
  rework: 'bg-orange-500/20 text-orange-400',
  skipped: 'bg-gray-500/20 text-gray-400',
  // Issue states
  open: 'bg-blue-500/20 text-blue-400',
  in_progress: 'bg-yellow-500/20 text-yellow-400',
  blocked: 'bg-red-500/20 text-red-400',
  closed: 'bg-gray-500/20 text-gray-400',
  // Issue priorities
  low: 'bg-gray-500/20 text-gray-400',
  medium: 'bg-blue-500/20 text-blue-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
};

export function StatusBadge({ status }: { status: string }) {
  const colors = colorMap[status] ?? 'bg-gray-500/20 text-gray-400';
  const label = status.replace(/_/g, ' ');

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize ${colors}`}
    >
      {label}
    </span>
  );
}
