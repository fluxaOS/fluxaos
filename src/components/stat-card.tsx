import type { LucideIcon } from 'lucide-react';

const accentClasses = {
  violet: {
    border: 'accent-border-violet',
    iconBg: 'bg-electric-violet/15',
    iconColor: 'text-soft-violet',
  },
  blue: {
    border: 'accent-border-blue',
    iconBg: 'bg-info/15',
    iconColor: 'text-sky-400',
  },
  green: {
    border: 'accent-border-green',
    iconBg: 'bg-success/15',
    iconColor: 'text-emerald-400',
  },
  amber: {
    border: 'accent-border-amber',
    iconBg: 'bg-warning/15',
    iconColor: 'text-amber-400',
  },
} as const;

export function StatCard({
  label,
  value,
  trend,
  icon: Icon,
  accent = 'violet',
}: {
  label: string;
  value: number | string;
  trend?: string;
  icon?: LucideIcon;
  accent?: keyof typeof accentClasses;
}) {
  const a = accentClasses[accent];

  return (
    <div className={`card-base p-5 pl-6 relative ${a.border}`}>
      {Icon && (
        <div className={`absolute top-4 right-4 w-8 h-8 rounded-lg ${a.iconBg} ${a.iconColor} flex items-center justify-center`}>
          <Icon size={16} />
        </div>
      )}
      <p className="text-xs font-medium text-slate-400 mb-2.5">{label}</p>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] font-extrabold text-white leading-none">{value}</span>
        {trend && (
          <span className="text-xs font-semibold text-emerald-400">{trend}</span>
        )}
      </div>
    </div>
  );
}
