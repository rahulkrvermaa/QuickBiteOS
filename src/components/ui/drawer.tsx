import React, { useEffect } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DrawerProps {
  isOpen: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  position?: 'bottom' | 'right'
}

export const Drawer: React.FC<DrawerProps> = ({
  isOpen,
  onClose,
  title,
  children,
  position = 'bottom',
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
    <div className="fixed inset-0 z-50 overflow-hidden">
      <div
        className="fixed inset-0 bg-[#20201E]/40 backdrop-blur-xs transition-opacity"
        onClick={onClose}
      />

      <div
        className={cn(
          'fixed bg-white shadow-2xl transition-transform duration-250 ease-out z-10 flex flex-col',
          position === 'bottom'
            ? 'inset-x-0 bottom-0 max-h-[90vh] rounded-t-3xl border-t border-[#E6E2D8]'
            : 'inset-y-0 right-0 w-full max-w-md border-l border-[#E6E2D8]'
        )}
      >
        {/* Handle bar on bottom sheet */}
        {position === 'bottom' && (
          <div className="w-12 h-1.5 bg-[#E6E2D8] rounded-full mx-auto my-2.5 shrink-0" />
        )}

        <div className="flex items-center justify-between px-6 py-3 border-b border-[#F2EFE9] shrink-0">
          <h2 className="text-base font-bold text-[#20201E]">{title}</h2>
          <button
            onClick={onClose}
            className="text-[#8C8A84] hover:text-[#20201E] p-1.5 rounded-lg hover:bg-[#F2EFE9] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  )
}

