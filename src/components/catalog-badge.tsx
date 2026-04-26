/** Catalog-colored badge — uses DB color, no hardcoded mappings. */
export function CatalogBadge({
  displayName,
  color,
}: {
  displayName: string;
  color: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span
        className="w-[7px] h-[7px] rounded-full"
        style={{ backgroundColor: color }}
      />
      {displayName}
    </span>
  );
}
