import React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', error, ...props }, ref) => {
    return (
      <div className="w-full">
        <input
          type={type}
          className={cn(
            'flex h-10 w-full rounded-lg border border-[#E6E2D8] bg-white px-3 py-2 text-sm text-[#20201E]',
            'placeholder:text-[#8C8A84] focus:outline-none focus:ring-2 focus:ring-[#D95732]/20 focus:border-[#D95732]',
            'disabled:cursor-not-allowed disabled:opacity-50 transition-colors',
            error && 'border-[#C0352A] focus:border-[#C0352A] focus:ring-[#C0352A]/20',
            className
          )}
          ref={ref}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-[#C0352A] font-medium">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

