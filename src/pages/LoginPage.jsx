import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'

const S = {
  page: { minHeight: '100vh', background: '#1C1208', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' },
  card: { background: '#FBF7F2', borderRadius: 20, padding: '2rem 1.75rem', width: '100%', maxWidth: 380 },
  logo: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.75rem' },
  logoIcon: { width: 48, height: 48, background: '#C4956A', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 },
  logoTitle: { fontFamily: 'Georgia, serif', fontSize: 20, fontWeight: 400, color: '#1C1208' },
  logoSub: { fontSize: 11, color: '#7A6A5A', letterSpacing: '.06em', textTransform: 'uppercase' },
  label: { fontSize: 12, fontWeight: 500, color: '#7A6A5A', marginBottom: 6, display: 'block' },
  input: { width: '100%', padding: '11px 14px', border: '.5px solid #C4A88A', borderRadius: 10, fontSize: 15, background: '#F5EFE6', color: '#1C1208', fontFamily: 'inherit', marginBottom: 14, outline: 'none' },
  btn: { width: '100%', padding: '13px', background: '#1C1208', color: '#F5EFE6', border: 'none', borderRadius: 10, fontSize: 14, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', marginTop: 4 },
  err: { background: '#FCEBEB', border: '.5px solid #F09595', borderRadius: 8, padding: '9px 12px', fontSize: 12, color: '#A32D2D', marginBottom: 12, textAlign: 'center' },
  hint: { fontSize: 11, color: '#7A6A5A', textAlign: 'center', marginTop: '1.25rem', lineHeight: 1.6 },
  divider: { textAlign: 'center', fontSize: 11, color: '#C4A88A', margin: '14px 0' },
}

export default function LoginPage() {
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  async function handleLogin(e) {
    e.preventDefault()
    if (!phone || pin.length < 4) { setError('Masukkan nomor HP dan PIN yang valid'); return }
    setLoading(true); setError('')
    try {
      const user = await login(phone, pin)
      navigate(user.is_owner ? '/owner' : '/absen', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={S.page}>
      <div style={S.card}>
        <div style={S.logo}>
          <div style={S.logoIcon}>☕</div>
          <div>
            <div style={S.logoTitle}>Piccolo Corner</div>
            <div style={S.logoSub}>Sistem Absensi</div>
          </div>
        </div>

        {error && <div style={S.err}>{error}</div>}

        <form onSubmit={handleLogin}>
          <label style={S.label}>Nomor HP</label>
          <input style={S.input} type="tel" placeholder="08xxxxxxxxxx"
            value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" />

          <label style={S.label}>PIN (6 digit)</label>
          <input style={S.input} type="password" placeholder="••••••" maxLength={6}
            value={pin} onChange={e => setPin(e.target.value)} autoComplete="current-password" />

          <button style={S.btn} type="submit" disabled={loading}>
            {loading ? 'Masuk...' : 'Masuk'}
          </button>
        </form>

        <p style={S.hint}>
          Masukkan nomor HP dan PIN yang diberikan oleh owner
        </p>
      </div>
    </div>
  )
}
