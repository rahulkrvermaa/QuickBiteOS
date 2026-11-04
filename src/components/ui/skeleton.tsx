import React from 'react'
import { cn } from '@/lib/utils'

export const Skeleton: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({ className, ...props }) => {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-[#E6E2D8]/50', className)}
      {...props}
    />
  )
}

