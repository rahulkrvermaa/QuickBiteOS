import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/features/auth/auth-context'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: string
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ children }) => {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F8F6F1] flex flex-col items-center justify-center p-4">
        <div className="w-14 h-14 bg-[#D95732] rounded-2xl flex items-center justify-center text-white text-3xl shadow-lg shadow-[#D95732]/25 animate-pulse mb-4">
          🥟
        </div>
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold text-[#20201E]">QuickBite OS</h2>
          <p className="text-xs text-neutral-500 font-mono tracking-wide">Authenticating staff session...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    // Preserve requested path for redirection after successful login
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}

