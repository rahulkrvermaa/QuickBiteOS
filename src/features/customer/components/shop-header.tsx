import React from 'react'
import { MapPin, Phone, Clock, ShieldCheck } from 'lucide-react'
import type { Business } from '@/types/domain'

export interface ShopHeaderProps {
  business: Business
}

export const ShopHeader: React.FC<ShopHeaderProps> = ({ business }) => {
  return (
    <div className="bg-white border-b border-[#E6E2D8] pt-4 pb-5 px-4 sm:px-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-bold text-[#20201E] tracking-tight">
                {business.name}
              </h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#247A52] bg-[#EAF4EE] px-2 py-0.5 rounded-full border border-[#C5E4D2]">
                <ShieldCheck className="w-3.5 h-3.5" />
                Verified
              </span>
            </div>

            {business.tagline && (
              <p className="text-xs sm:text-sm text-[#575653] mt-1 line-clamp-2">
                {business.tagline}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-y-1 gap-x-4 mt-3 text-xs text-[#575653]">
              <div className="flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-[#D95732]" />
                <span>{business.address}, {business.city}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Phone className="w-3.5 h-3.5 text-[#575653]" />
                <span>{business.phone}</span>
              </div>
              <div className="flex items-center gap-1.5 text-[#247A52] font-medium">
                <Clock className="w-3.5 h-3.5" />
                <span>Open Now (Prep ~10 mins)</span>
              </div>
            </div>
          </div>

          {/* Shop Avatar / Logo */}
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-[#FDF1ED] border border-[#F3DEB8] flex items-center justify-center text-2xl sm:text-3xl shrink-0 shadow-xs">
            🥟
          </div>
        </div>
      </div>
    </div>
  )
}

