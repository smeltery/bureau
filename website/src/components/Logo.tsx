import type { BrandIcon } from '../brand-icons.ts';

export function Logo({ icon, size = 16 }: { icon: BrandIcon; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false">
      <path d={icon.path} fill="currentColor" />
    </svg>
  );
}
