import React from 'react'
import { cn } from '@/lib/utils'
import type { Category } from '@/types/domain'

export interface CategoryNavProps {
  categories: Category[]
  activeCategoryId: string
  onSelectCategory: (id: string) => void
}

export const CategoryNav: React.FC<CategoryNavProps> = ({
  categories,
  activeCategoryId,
  onSelectCategory,
}) => {
  return (
    <div className="sticky top-0 z-30 bg-[#F8F6F1]/95 backdrop-blur-md border-b border-[#E6E2D8] py-2.5 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto flex items-center gap-2 overflow-x-auto scrollbar-none">
        {categories.map((category) => {
          const isActive = category.id === activeCategoryId
          return (
            <button
              key={category.id}
              onClick={() => onSelectCategory(category.id)}
              className={cn(
                'px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all select-none cursor-pointer border',
                isActive
                  ? 'bg-[#D95732] text-white border-[#D95732] shadow-xs'
                  : 'bg-white text-[#575653] border-[#E6E2D8] hover:border-[#D95732]/40 hover:text-[#20201E]'
              )}
            >
              {category.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

