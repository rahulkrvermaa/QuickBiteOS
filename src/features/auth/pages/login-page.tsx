import React, { useState } from 'react'
import { useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/auth-context'
import { Lock, Mail, ShieldCheck, ArrowRight, Eye, EyeOff, Store, AlertCircle } from 'lucide-react'

export const LoginPage: React.FC = () => {
  const { user, signInWithEmail } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const destination = (location.state as { from?: string })?.from || '/dashboard/orders'

  // If already logged in, redirect to destination
  React.useEffect(() => {
    if (user) {
      navigate(destination, { replace: true })
    }
  }, [user, navigate, destination])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErrorMsg(null)
    setSuccessMsg(null)

    if (!email.trim() || !password) {
      setErrorMsg('Please enter both email and password.')
      return
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.')
      return
    }

    setIsSubmitting(true)

    try {
      const { error } = await signInWithEmail(email, password)
      if (error) {
        setErrorMsg(error)
      } else {
        navigate(destination, { replace: true })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F8F6F1] flex flex-col justify-between p-4 sm:p-6 lg:p-8">
      {/* Top Bar with Customer Store Navigation */}
      <div className="w-full max-w-md mx-auto flex items-center justify-between py-2">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 bg-[#D95732] rounded-xl flex items-center justify-center text-white text-xl shadow-md shadow-[#D95732]/20">
            🥟
          </div>
          <div>
            <span className="font-bold text-[#20201E] tracking-tight text-base">QuickBite OS</span>
            <span className="block text-[10px] font-mono text-neutral-500 uppercase tracking-wider">Merchant Portal</span>
          </div>
        </div>

        <Link
          to="/shop/samosa-corner"
          className="flex items-center gap-1.5 text-xs font-semibold text-neutral-600 hover:text-[#D95732] transition-colors bg-white/80 backdrop-blur-sm border border-neutral-200/80 px-3 py-1.5 rounded-lg shadow-2xs"
        >
          <Store className="w-3.5 h-3.5 text-[#D95732]" />
          <span>Customer Shop</span>
        </Link>
      </div>

      {/* Main Authentication Card */}
      <div className="w-full max-w-md mx-auto my-auto py-6">
        <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-xl shadow-neutral-200/40 p-6 sm:p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-[#D95732]/10 text-[#D95732] rounded-full mb-3">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-extrabold text-[#20201E] tracking-tight">Staff Sign In</h1>
            <p className="text-xs text-neutral-500 mt-1 max-w-xs mx-auto">
              Authorized personnel only. Access to Order Console, Kitchen KDS & Catalog Management.
            </p>
          </div>

          {/* Error & Success Alerts */}
          {errorMsg && (
            <div className="mb-5 p-3.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="mb-5 p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5 uppercase tracking-wider">
                Staff Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter authorized email"
                  className="w-full pl-10 pr-4 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#D95732]/20 focus:border-[#D95732] transition-colors"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-neutral-700 mb-1.5 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-neutral-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-10 py-2.5 bg-neutral-50 border border-neutral-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#D95732]/20 focus:border-[#D95732] transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-2 py-3 bg-[#D95732] hover:bg-[#C24824] text-white font-bold rounded-xl shadow-md shadow-[#D95732]/25 hover:shadow-lg transition-all flex items-center justify-center gap-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In to Dashboard</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        </div>
      </div>

      {/* Footer Store Info */}
      <div className="w-full max-w-md mx-auto text-center py-2 text-[11px] text-neutral-400 font-mono">
        <span>Samosa Corner · Jamui, Bihar 811307</span>
        <span className="mx-2">·</span>
        <span>QuickBite Security Engine</span>
      </div>
    </div>
  )
}

