import * as SwitchPrimitive from '@radix-ui/react-switch';
import { cn } from '../../lib/utils';

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  description,
  className,
  ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  description?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const control = (
    <SwitchPrimitive.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-emerald-600 data-[state=unchecked]:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
  if (!label) return control;
  return (
    <label className="flex cursor-pointer items-start gap-3">
      {control}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-800">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs text-zinc-500">{description}</span>
        ) : null}
      </span>
    </label>
  );
}
