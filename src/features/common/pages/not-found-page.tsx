import React from 'react'
import { Link } from 'react-router-dom'

export const NotFoundPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-[#FDF8E2] flex flex-col items-center justify-center p-6 sm:p-10 select-none">
      <div className="w-full max-w-2xl mx-auto flex flex-col items-center text-center">
        {/* 404 Chutney Graphic */}
        <div className="mb-6 sm:mb-8">
          <img
            src="/404-sauce.webp"
            alt="404 - Lost in the Sauce"
            className="w-full max-w-[280px] sm:max-w-[380px] md:max-w-[420px] h-auto object-contain mx-auto drop-shadow-xs"
          />
        </div>

        {/* Heading */}
        <h1 className="font-serif text-3xl sm:text-4xl md:text-[44px] text-[#2A5132] font-normal tracking-tight mb-3 sm:mb-4 leading-tight">
          Oops! Lost in the Sauce
        </h1>

        {/* Description Body - Clean balanced wrapping with zero orphaned words */}
        <p className="text-sm sm:text-[15px] md:text-base text-[#3D6247] leading-relaxed max-w-xl text-center text-balance font-normal mb-8 px-4">
          It seems we&apos;ve run out of ingredients for this page! Unfortunately, the page you’re looking for has
          either been moved or doesn’t exist. How about we guide you back home or help you find what you&apos;re
          craving?
        </p>

        {/* Back to Home Pill Button */}
        <Link
          to="/shop/samosa-corner"
          className="inline-flex items-center justify-center px-8 py-2.5 sm:py-3 bg-[#DBE46F] hover:bg-[#D0DC5E] active:scale-98 text-[#325132] font-medium text-xs sm:text-sm rounded-full transition-all shadow-xs"
        >
          Back to Home
        </Link>
      </div>
    </div>
  )
}
