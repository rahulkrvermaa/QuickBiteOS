import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DialogProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  description?: string
  children: React.ReactNode
  className?: string
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.body.style.overflow = 'unset'
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-[#20201E]/40 backdrop-blur-xs transition-opacity animate-in fade-in"
        onClick={onClose}
      />

      {/* Modal Card */}
      <div
        className={cn(
          'relative w-full max-w-lg bg-white rounded-2xl shadow-xl border border-[#E6E2D8] p-6 z-10 overflow-hidden',
          'animate-in zoom-in-95 duration-150',
          className
        )}
      >
        <div className="flex items-start justify-between pb-3 border-b border-[#F2EFE9]">
          <div>
            {title && <h2 className="text-lg font-bold text-[#20201E] tracking-tight">{title}</h2>}
            {description && <p className="text-xs text-[#575653] mt-0.5">{description}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-[#8C8A84] hover:text-[#20201E] p-1 rounded-lg hover:bg-[#F2EFE9] transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  )
}

