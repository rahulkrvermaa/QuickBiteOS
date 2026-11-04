import React from 'react'
import { cn } from '@/lib/utils'

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'veg' | 'non-veg'
  size?: 'sm' | 'md'
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  size = 'md',
  children,
  ...props
}) => {
  const baseStyles = 'inline-flex items-center font-medium select-none'

  const sizeStyles = {
    sm: 'text-[11px] px-2 py-0.5 rounded-md gap-1',
    md: 'text-xs px-2.5 py-1 rounded-md gap-1.5',
  }

  const variantStyles = {
    default: 'bg-[#F2EFE9] text-[#575653] border border-[#E6E2D8]',
    success: 'bg-[#EAF4EE] text-[#247A52] border border-[#C5E4D2]',
    warning: 'bg-[#FDF7EC] text-[#B8741A] border border-[#F3DEB8]',
    danger: 'bg-[#FDEEED] text-[#C0352A] border border-[#F5C5C1]',
    info: 'bg-[#EDF4FA] text-[#2B6CB0] border border-[#C0D9EF]',
    veg: 'bg-transparent text-[#247A52] p-0 font-normal',
    'non-veg': 'bg-transparent text-[#C0352A] p-0 font-normal',
  }

  if (variant === 'veg') {
    return (
      <span className={cn('inline-flex items-center justify-center w-4 h-4 border border-[#247A52] rounded-[3px] p-[2px]', className)} {...props}>
        <span className="w-2 h-2 rounded-full bg-[#247A52]" />
      </span>
    )
  }

  if (variant === 'non-veg') {
    return (
      <span className={cn('inline-flex items-center justify-center w-4 h-4 border border-[#C0352A] rounded-[3px] p-[2px]', className)} {...props}>
        <span className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[6px] border-b-[#C0352A]" />
      </span>
    )
  }

  return (
    <span className={cn(baseStyles, sizeStyles[size], variantStyles[variant], className)} {...props}>
      {children}
    </span>
  )
}

