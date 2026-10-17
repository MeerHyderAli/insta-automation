import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export const Dropdown = DropdownPrimitive.Root;
export const DropdownTrigger = DropdownPrimitive.Trigger;

export function DropdownContent({
  children,
  className,
  align = 'end',
}: {
  children: React.ReactNode;
  className?: string;
  align?: 'start' | 'center' | 'end';
}) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg',
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  );
}

export function DropdownItem({
  children,
  onSelect,
  className,
  disabled,
}: {
  children: React.ReactNode;
  onSelect?: (event: Event) => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <DropdownPrimitive.Item
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex cursor-pointer select-none items-center gap-2 rounded-md px-2.5 py-2 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50',
        className,
      )}
    >
      {children}
    </DropdownPrimitive.Item>
  );
}

export function DropdownLabel({ children }: { children: React.ReactNode }) {
  return (
    <DropdownPrimitive.Label className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">
      {children}
    </DropdownPrimitive.Label>
  );
}

export function DropdownSeparator() {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-zinc-100" />;
}

export function DropdownCheckItem({
  children,
  active,
  onSelect,
}: {
  children: React.ReactNode;
  active?: boolean;
  onSelect?: (event: Event) => void;
}) {
  return (
    <DropdownItem onSelect={onSelect} className={cn(active && 'bg-zinc-50 font-medium')}>
      <span className="flex h-4 w-4 items-center justify-center">
        {active ? <Check className="h-4 w-4 text-emerald-600" /> : null}
      </span>
      <span className="truncate">{children}</span>
    </DropdownItem>
  );
}
