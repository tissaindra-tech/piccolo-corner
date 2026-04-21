import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase.js'

export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      loading: false,
      error: null,

      login: async (phone, pin) => {
        set({ loading: true, error: null })
        try {
          const { data, error } = await supabase
            .from('employees')
            .select('*')
            .eq('phone', phone.trim())
            .eq('pin', pin.trim())
            .single()
          if (error || !data) throw new Error('Nomor HP atau PIN salah')
          set({ user: data, loading: false })
          return data
        } catch (e) {
          set({ error: e.message, loading: false })
          throw e
        }
      },

      logout: () => set({ user: null, error: null }),

      refreshUser: async () => {
        const { user } = get()
        if (!user) return
        const { data } = await supabase.from('employees').select('*').eq('id', user.id).single()
        if (data) set({ user: data })
      },
    }),
    { name: 'piccolo-auth', partialize: (s) => ({ user: s.user }) }
  )
)
