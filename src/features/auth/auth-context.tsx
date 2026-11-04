import React, { createContext, useContext, useEffect, useState } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'

export interface AuthContextType {
  user: User | null
  session: Session | null
  isLoading: boolean
  userRole: string | null
  signInWithEmail: (email: string, password: string) => Promise<{ error: string | null }>
  signUpWithEmail: (email: string, password: string, fullName?: string) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const MOCK_AUTH_STORAGE_KEY = 'quickbite_mock_auth_user'

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [userRole, setUserRole] = useState<string | null>(null)

  // Fetch staff role from business_members
  const fetchUserRole = async (userId: string) => {
    if (!isSupabaseConfigured) {
      setUserRole('owner')
      return
    }
    try {
      const { data } = await supabase
        .from('business_members')
        .select('role')
        .eq('user_id', userId)
        .eq('status', 'active')
        .maybeSingle()

      if (data?.role) {
        setUserRole(data.role)
      } else {
        setUserRole('staff')
      }
    } catch {
      setUserRole('staff')
    }
  }

  useEffect(() => {
    if (!isSupabaseConfigured) {
      // Offline fallback: check localStorage for simulated session
      const stored = localStorage.getItem(MOCK_AUTH_STORAGE_KEY)
      if (stored) {
        try {
          const parsed = JSON.parse(stored)
          setUser(parsed)
          setUserRole('owner')
        } catch {
          // ignore error
        }
      }
      setIsLoading(false)
      return
    }

    // 1. Initial Session Check
    supabase.auth.getSession().then(({ data: { session: initialSession } }) => {
      setSession(initialSession)
      setUser(initialSession?.user ?? null)
      if (initialSession?.user) {
        fetchUserRole(initialSession.user.id)
      }
      setIsLoading(false)
    })

    // 2. Realtime Auth State Listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession)
      setUser(currentSession?.user ?? null)
      if (currentSession?.user) {
        fetchUserRole(currentSession.user.id)
      } else {
        setUserRole(null)
      }
      setIsLoading(false)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const signInWithEmail = async (email: string, password: string): Promise<{ error: string | null }> => {
    setIsLoading(true)
    if (!isSupabaseConfigured) {
      const mockUser = {
        id: 'mock-staff-uid',
        email,
        app_metadata: {},
        user_metadata: { full_name: 'Store Staff' },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      } as unknown as User
      localStorage.setItem(MOCK_AUTH_STORAGE_KEY, JSON.stringify(mockUser))
      setUser(mockUser)
      setUserRole('owner')
      setIsLoading(false)
      return { error: null }
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (error) {
        setIsLoading(false)
        return { error: error.message }
      }

      setSession(data.session)
      setUser(data.user)
      if (data.user) {
        await fetchUserRole(data.user.id)
      }
      setIsLoading(false)
      return { error: null }
    } catch (err: unknown) {
      setIsLoading(false)
      return { error: err instanceof Error ? err.message : 'An unexpected error occurred during sign-in' }
    }
  }

  const signUpWithEmail = async (
    email: string,
    password: string,
    fullName?: string
  ): Promise<{ error: string | null }> => {
    setIsLoading(true)
    if (!isSupabaseConfigured) {
      const mockUser = {
        id: 'mock-staff-uid',
        email,
        app_metadata: {},
        user_metadata: { full_name: fullName || 'Store Staff' },
        aud: 'authenticated',
        created_at: new Date().toISOString(),
      } as unknown as User
      localStorage.setItem(MOCK_AUTH_STORAGE_KEY, JSON.stringify(mockUser))
      setUser(mockUser)
      setUserRole('owner')
      setIsLoading(false)
      return { error: null }
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          data: {
            full_name: fullName || email.split('@')[0],
          },
        },
      })

      if (error) {
        setIsLoading(false)
        return { error: error.message }
      }

      // If email auto-confirmed, sign in immediately
      if (data.user && !data.session) {
        const autoLogin = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })
        if (!autoLogin.error && autoLogin.data.session) {
          setSession(autoLogin.data.session)
          setUser(autoLogin.data.user)
          await fetchUserRole(autoLogin.data.user.id)
        }
      } else if (data.session) {
        setSession(data.session)
        setUser(data.user)
        if (data.user) {
          await fetchUserRole(data.user.id)
        }
      }

      setIsLoading(false)
      return { error: null }
    } catch (err: unknown) {
      setIsLoading(false)
      return { error: err instanceof Error ? err.message : 'Failed to register account' }
    }
  }

  const signOut = async (): Promise<void> => {
    if (!isSupabaseConfigured) {
      localStorage.removeItem(MOCK_AUTH_STORAGE_KEY)
      setUser(null)
      setSession(null)
      setUserRole(null)
      return
    }

    try {
      await supabase.auth.signOut()
    } finally {
      setUser(null)
      setSession(null)
      setUserRole(null)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        userRole,
        signInWithEmail,
        signUpWithEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

