import React from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPaisaToINR } from '@/lib/currency'
import type { Product } from '@/types/domain'

export interface ProductCardProps {
  product: Product
  cartCount: number
  onAddClick: (product: Product) => void
}

export const ProductCard: React.FC<ProductCardProps> = ({
  product,
  cartCount,
  onAddClick,
}) => {
  const hasCustomizations = product.variants.length > 0 || product.addons.length > 0
  const isAvailable = product.isAvailable

  return (
    <div
      className={`bg-white rounded-xl border border-[#E6E2D8] p-4 flex items-start justify-between gap-4 transition-all hover:border-[#D95732]/30 shadow-2xs ${
        !isAvailable ? 'opacity-75 bg-[#FAF9F6]' : ''
      }`}
    >
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <Badge variant={product.isVeg ? 'veg' : 'non-veg'} />
          <h3 className="text-sm sm:text-base font-bold text-[#20201E] tracking-tight">
            {product.name}
          </h3>
          {!isAvailable && (
            <Badge variant="danger" size="sm" className="text-[10px] px-1.5 py-0">
              Sold Out
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <span className="text-sm font-bold text-[#20201E] tabular-nums">
            {formatPaisaToINR(product.basePricePaisa)}
          </span>
          {isAvailable && hasCustomizations && (
            <span className="text-[11px] text-[#8C8A84] flex items-center gap-0.5">
              <Sparkles className="w-3 h-3 text-[#D95732]" />
              Customizable
            </span>
          )}
        </div>

        {product.description && (
          <p className="text-xs text-[#575653] mt-1.5 line-clamp-2 leading-relaxed">
            {product.description}
          </p>
        )}
      </div>

      <div className="flex flex-col items-end shrink-0">
        {!isAvailable ? (
          <Button
            size="sm"
            variant="outline"
            disabled
            className="border-[#E6E2D8] text-[#8C8A84] bg-[#F2EFE9] font-semibold text-xs px-3 py-1.5 h-8 min-w-[76px] cursor-not-allowed opacity-80"
          >
            Sold Out
          </Button>
        ) : (
          <Button
            size="sm"
            variant={cartCount > 0 ? 'secondary' : 'outline'}
            onClick={() => onAddClick(product)}
            className="border-[#D95732] text-[#D95732] hover:bg-[#FDF1ED] font-bold text-xs px-3 py-1.5 h-8 min-w-[76px]"
          >
            {cartCount > 0 ? (
              <span className="flex items-center gap-1">
                <span>{cartCount} in Cart</span>
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                <span>ADD</span>
              </span>
            )}
          </Button>
        )}
      </div>
    </div>
  )
}

