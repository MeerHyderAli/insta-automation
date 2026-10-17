import { forwardRef } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const variants: Record<Variant, string> = {
  primary:
    'bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm disabled:bg-zinc-400 focus-visible:outline-zinc-900',
  secondary:
    'bg-white text-zinc-800 border border-zinc-300 hover:bg-zinc-50 shadow-sm focus-visible:outline-zinc-900',
  ghost: 'text-zinc-700 hover:bg-zinc-100 focus-visible:outline-zinc-900',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm focus-visible:outline-red-600',
  outline: 'border border-zinc-300 bg-transparent text-zinc-800 hover:bg-zinc-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-10 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-base gap-2',
  icon: 'h-9 w-9 p-0',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    className,
    variant = 'primary',
    size = 'md',
    loading = false,
    asChild = false,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
        variants[variant],
        sizes[size],
        className,
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span>Working…</span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
});
