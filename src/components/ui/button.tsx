import React from 'react'
import { cn } from '@/lib/utils'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'success'
  size?: 'sm' | 'md' | 'lg'
  isLoading?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, children, disabled, ...props }, ref) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-all duration-150 select-none focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer'

    const variantStyles = {
      primary:
        'bg-[#D95732] text-white hover:bg-[#C24B29] active:bg-[#B33F1F] focus-visible:ring-[#D95732] shadow-sm',
      secondary:
        'bg-[#F2EFE9] text-[#20201E] hover:bg-[#EAE5DC] active:bg-[#DFD9CE] border border-[#E6E2D8] focus-visible:ring-[#575653]',
      outline:
        'border border-[#E6E2D8] text-[#20201E] bg-white hover:bg-[#F8F6F1] active:bg-[#F2EFE9] focus-visible:ring-[#D95732]',
      ghost:
        'text-[#575653] hover:text-[#20201E] hover:bg-[#F2EFE9] active:bg-[#EAE5DC] focus-visible:ring-[#575653]',
      danger:
        'bg-[#C0352A] text-white hover:bg-[#A92A20] active:bg-[#91231A] focus-visible:ring-[#C0352A] shadow-sm',
      success:
        'bg-[#247A52] text-white hover:bg-[#1D6343] active:bg-[#164D34] focus-visible:ring-[#247A52] shadow-sm',
    }

    const sizeStyles = {
      sm: 'text-xs px-2.5 py-1.5 rounded-md gap-1.5',
      md: 'text-sm px-4 py-2 rounded-lg gap-2',
      lg: 'text-base px-5 py-2.5 rounded-xl gap-2.5 font-semibold',
    }

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
        disabled={disabled || isLoading}
        {...props}
      >
        {isLoading && (
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
        )}
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'

