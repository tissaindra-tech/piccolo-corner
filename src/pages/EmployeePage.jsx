import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabase.js'
import { getCurrentPosition, getDistanceMeters, formatDistance } from '../lib/gps.js'

const T = {
  black: '#0D0D0D', white: '#FAFAF8', cream: '#F5F0E8',
  coral: '#E8674A', coralLight: '#FAE8E3',
  green: '#2D7A4F', greenLight: '#E0F0E8',
  amber: '#F0A500', amberLight: '#FDF3D9',
  purple: '#5B4FCF', purpleLight: '#ECEAFC',
  sage: '#7C9E8A', sageLight: '#D4E4DA',
  border: '#E8E4DC', surface: '#FFFFFF', muted: '#999',
  dng: '#C0392B', dngBg: '#FEE8E3',
}

const s = {
  app: { minHeight: '100vh', background: T.cream, display: 'flex', flexDirection: 'column', fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif" },
  hdr: { background: T.black, padding: '14px 18px 18px', flexShrink: 0 },
  hdrTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  brandTag: { display: 'flex', alignItems: 'center', gap: 7 },
  brandDot: { width: 8, height: 8, borderRadius: '50%', background: T.coral },
  brandName: { fontSize: 11, fontWeight: 700, color: T.white, letterSpacing: '.12em', textTransform: 'uppercase' },
  timeChip: { background: '#1A1A1A', borderRadius: 20, padding: '4px 12px', fontSize: 13, fontWeight: 700, color: T.white, letterSpacing: '.02em' },
  greetHey: { fontSize: 11, color: '#666', letterSpacing: '.06em', textTransform: 'uppercase', fontWeight: 500 },
  greetName: { fontSize: 24, fontWeight: 800, color: T.white, lineHeight: 1.1, letterSpacing: '-.02em', fontFamily: 'inherit' },
  greetRole: { fontSize: 11, color: '#888', marginTop: 3 },
  scroll: { flex: 1, overflowY: 'auto', paddingBottom: 70 },
  botNav: { position: 'fixed', bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `.5px solid ${T.border}`, display: 'flex', justifyContent: 'space-around', padding: '10px 0 14px', zIndex: 100 },
  navItem: (active) => ({ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: active ? T.black : '#CCC', cursor: 'pointer', border: 'none', background: 'transparent', fontFamily: 'inherit' }),
  navIco: (active) => ({ width: 28, height: 28, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, background: active ? T.black : 'transparent' }),
  section: { margin: '10px 14px 0' },
  card: { background: T.surface, borderRadius: 18, padding: '14px 16px', border: `.5px solid ${T.border}` },
  sLabel: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: T.muted, marginBottom: 8, padding: '0 2px' },
}

function StatusPill({ record }) {
  if (!record) return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 30, background: '#1A1A1A', border: '.5px solid #333', marginTop: 10 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#EF9F27', animation: 'blink 1.5s ease-in-out infinite' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: '#EF9F27' }}>Belum absen hari ini</span>
    </div>
  )
  const map = { hadir: ['#4CAF79', '#1A2E20', 'Sudah check in'], sakit: ['#7C6CF0', '#1E1A3A', 'Sakit'], cuti: ['#4CAF79', '#1A2E20', 'Cuti'], ctb: ['#B07CF0', '#221A3A', 'CTB'], day_off: ['#F0A500', '#2A1F00', 'Day Off'] }
  const [color, bg, label] = map[record.status] || ['#999', '#1A1A1A', record.status]
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 30, background: bg, border: `.5px solid ${color}33`, marginTop: 10 }}>
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color }} />
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{label}{record.check_in ? ` · ${new Date(record.check_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}` : ''}</span>
    </div>
  )
}

function GPSBar({ gpsState, gpsInfo, settings, onCheck }) {
  return (
    <div style={{ ...s.section }}>
      <div style={{ borderRadius: 14, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
        background: gpsState === 'ok' ? T.greenLight : gpsState === 'blocked' ? T.dngBg : gpsState === 'checking' ? T.amberLight : '#FFF8E8',
        border: `.5px solid ${gpsState === 'ok' ? '#A8D4B8' : gpsState === 'blocked' ? '#F5B4A3' : '#F5D98A'}` }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, flexShrink: 0,
          background: gpsState === 'ok' ? T.green : gpsState === 'blocked' ? T.coral : T.amber }}>
          {gpsState === 'ok' ? '📍' : gpsState === 'blocked' ? '🚫' : '📡'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: gpsState === 'ok' ? T.green : gpsState === 'blocked' ? T.dng : '#8B6914' }}>
            {gpsState === 'idle' && 'Cek lokasi dulu ya'}
            {gpsState === 'checking' && 'Mendeteksi lokasi...'}
            {gpsState === 'ok' && `Lokasi valid — ${formatDistance(gpsInfo.dist)} dari cafe`}
            {gpsState === 'blocked' && (gpsInfo?.error || `Di luar area — ${formatDistance(gpsInfo?.dist)}`)}
          </div>
          <div style={{ fontSize: 9, color: T.muted, marginTop: 1 }}>
            {gpsState === 'ok' ? 'Siap absen!' : gpsState === 'blocked' ? `Batas ${settings.gps_radius_meters}m` : 'GPS diperlukan untuk absen'}
          </div>
        </div>
        {gpsState !== 'checking' && (
          <button onClick={onCheck} style={{ fontSize: 9, fontWeight: 700, padding: '5px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit', textTransform: 'uppercase', letterSpacing: '.05em',
            background: gpsState === 'ok' ? T.green : gpsState === 'blocked' ? T.coral : T.amber, color: '#fff' }}>
            {gpsState === 'idle' ? 'Cek GPS' : '↻'}
          </button>
        )}
      </div>
      {gpsState === 'blocked' && (
        <div style={{ marginTop: 8, background: T.dngBg, borderRadius: 14, padding: '20px', textAlign: 'center', border: `.5px solid #F5B4A3` }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>📍</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.dng, marginBottom: 5, letterSpacing: '-.01em' }}>Kamu belum di cafe nih!</div>
          <div style={{ fontSize: 11, color: T.dng, opacity: .8, lineHeight: 1.6 }}>Datang ke Piccolo Corner dulu ya buat bisa check in 👋</div>
          <div style={{ marginTop: 12, background: '#fff', borderRadius: 10, padding: '6px 14px', display: 'inline-block' }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: T.dng }}>{gpsInfo?.dist ? formatDistance(gpsInfo.dist) : '—'}</div>
            <div style={{ fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>dari cafe</div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EmployeePage() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const [tab, setTab] = useState('home')
  const [gpsState, setGpsState] = useState('idle')
  const [gpsInfo, setGpsInfo] = useState(null)
  const [settings, setSettings] = useState({ cafe_lat: -8.7162, cafe_lng: 115.2108, gps_radius_meters: 100, open_time: '10:00', late_tolerance_minutes: 15 })
  const [todayRecord, setTodayRecord] = useState(null)
  const [history, setHistory] = useState([])
  const [leaveBalance, setLeaveBalance] = useState(user?.leave_balance || 0)
  const [modal, setModal] = useState(null)
  const [scanStep, setScanStep] = useState('ready')
  const [selfieData, setSelfieData] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [docFile, setDocFile] = useState(null)
  const [note, setNote] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinOld, setPinOld] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMsg, setPinMsg] = useState(null)
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [quote, setQuote] = useState(null)
  const [notifSent, setNotifSent] = useState(false)

  useEffect(() => { fetchAll(); fetchQuote(); setupNotifications() }, [])

  async function fetchQuote() {
    const { data } = await supabase.from('quotes').select('*').eq('is_active', true)
    if (data && data.length > 0) {
      const dayIndex = new Date().getDate() % data.length
      setQuote(data[dayIndex])
    }
  }

  function setupNotifications() {
    if (!('Notification' in window)) return
    Notification.requestPermission()

    const checkTime = async () => {
      const now = new Date()
      const h = now.getHours()
      const m = now.getMinutes()

      // Notif jam 10:00 — tepat jam masuk
      if (h === 10 && m === 0 && Notification.permission === 'granted') {
        const { data: ws } = await supabase.from('work_settings').select('notif_message').eq('id', 1).single()
        const msg = ws?.notif_message || 'Selamat pagi! Yuk segera absen dan mulai hari yang produktif 💪'
        new Notification('☕ Piccolo Corner — Waktunya Kerja!', { body: msg })
      }
    }

    checkTime()
    const interval = setInterval(checkTime, 60000)
    return () => clearInterval(interval)
  }

  async function fetchAll() {
    const { data: s } = await supabase.from('work_settings').select('*').eq('id', 1).single()
    if (s) setSettings(s)
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    const { data: att } = await supabase.from('attendance').select('*').eq('employee_id', user.id).eq('date', today).single()
    setTodayRecord(att || null)
    const { data: hist } = await supabase.from('attendance').select('*').eq('employee_id', user.id).order('date', { ascending: false }).limit(10)
    setHistory(hist || [])
    const { data: emp } = await supabase.from('employees').select('leave_balance').eq('id', user.id).single()
    if (emp) setLeaveBalance(emp.leave_balance)
  }

  async function checkGPS() {
    setGpsState('checking')
    try {
      const pos = await getCurrentPosition()
      const dist = getDistanceMeters(pos.lat, pos.lng, settings.cafe_lat, settings.cafe_lng)
      const valid = dist <= settings.gps_radius_meters
      setGpsInfo({ ...pos, dist, valid })
      if (!valid) {
        setGpsState('blocked')
        await supabase.from('gps_fraud_log').insert({ employee_id: user.id, gps_lat: pos.lat, gps_lng: pos.lng, distance_m: dist, radius_limit: settings.gps_radius_meters })
      } else {
        setGpsState('ok')
      }
    } catch (e) {
      setGpsState('blocked')
      setGpsInfo({ error: e.message })
    }
  }

  async function startCamera(action) {
    setPendingAction(action)
    setScanStep('camera')
    setSelfieData(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (e) {
      showToast('error', 'Izin kamera ditolak')
      setScanStep('ready')
    }
  }

  function takeSelfie() {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    canvas.width = video.videoWidth || 480
    canvas.height = video.videoHeight || 480
    canvas.getContext('2d').drawImage(video, 0, 0)
    setSelfieData(canvas.toDataURL('image/jpeg', 0.7))
    stopCamera()
    setScanStep('confirm')
  }

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  async function confirmAndSubmit() {
    setSubmitting(true)
    let selfieUrl = null
    if (selfieData) {
      try {
        const blob = await fetch(selfieData).then(r => r.blob())
        const path = `selfies/${user.id}/${pendingAction}_${Date.now()}.jpg`
        const { data } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (data) { const { data: u } = supabase.storage.from('documents').getPublicUrl(path); selfieUrl = u.publicUrl }
      } catch (e) {}
    }
    const now = new Date()
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`

    if (pendingAction === 'checkin') {
      const [oh, om] = settings.open_time.split(':').map(Number)
      const openMs = oh * 60 + om
      const nowMs = now.getHours() * 60 + now.getMinutes()
      const isLate = nowMs > openMs + settings.late_tolerance_minutes
      const lateMinutes = isLate ? nowMs - openMs : 0
      const { error } = await supabase.from('attendance').upsert({
        employee_id: user.id, date: today, check_in: now.toISOString(),
        status: 'hadir', gps_lat_in: gpsInfo?.lat, gps_lng_in: gpsInfo?.lng, gps_dist_in: gpsInfo?.dist,
        is_late: isLate, late_minutes: lateMinutes, doc_url: selfieUrl,
      }, { onConflict: 'employee_id,date' })
      if (!error) showToast('ok', isLate ? `Check In ✓ — Terlambat ${lateMinutes} menit` : 'Check In berhasil! ✓')
      else showToast('error', 'Gagal check in')
    } else {
      const { error } = await supabase.from('attendance').update({
        check_out: now.toISOString(), gps_lat_out: gpsInfo?.lat, gps_lng_out: gpsInfo?.lng, gps_dist_out: gpsInfo?.dist,
        doc_out_url: selfieUrl,
      }).eq('id', todayRecord.id)
      if (!error) showToast('ok', 'Check Out berhasil!')
      else showToast('error', 'Gagal check out')
    }
    setScanStep('done')
    setSubmitting(false)
    fetchAll()
  }

  async function submitLeave(type) {
    setSubmitting(true)
    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
    let docUrl = null
    if (docFile) {
      const ext = docFile.name.split('.').pop()
      const path = `docs/${user.id}/${Date.now()}.${ext}`
      const { data } = await supabase.storage.from('documents').upload(path, docFile)
      if (data) { const { data: u } = supabase.storage.from('documents').getPublicUrl(path); docUrl = u.publicUrl }
    }
    await supabase.from('attendance').upsert({ employee_id: user.id, date: today, status: type, note, doc_url: docUrl, doc_status: docUrl ? 'pending' : null }, { onConflict: 'employee_id,date' })
    if (type === 'cuti') await supabase.from('employees').update({ leave_balance: Math.max(0, leaveBalance - 1) }).eq('id', user.id)
    if (type === 'day_off' || type === 'cuti') {
      await supabase.from('leave_requests').insert({ employee_id: user.id, type, date_start: today, date_end: today, days: 1, reason: note, status: 'pending' })
    }
    setSubmitting(false); setModal(null); setDocFile(null); setNote('')
    showToast('ok', `${type === 'sakit' ? 'Sakit' : type === 'cuti' ? 'Cuti' : type === 'day_off' ? 'Day Off' : 'CTB'} berhasil dicatat`)
    fetchAll()
  }

  async function changePin() {
    if (!pinOld || !pin1 || pin1.length < 4) { setPinMsg({ type: 'err', text: 'PIN minimal 4 angka' }); return }
    if (pin1 !== pin2) { setPinMsg({ type: 'err', text: 'Konfirmasi PIN tidak cocok' }); return }
    setPinSaving(true)
    const { data } = await supabase.from('employees').select('pin').eq('id', user.id).single()
    if (!data || data.pin !== pinOld) { setPinMsg({ type: 'err', text: 'PIN lama salah' }); setPinSaving(false); return }
    await supabase.from('employees').update({ pin: pin1 }).eq('id', user.id)
    setPinSaving(false); setPinMsg({ type: 'ok', text: 'PIN berhasil diubah! Silakan login ulang.' })
    setPinOld(''); setPin1(''); setPin2('')
    setTimeout(() => { logout(); navigate('/login') }, 2000)
  }

  function showToast(type, msg) { setToast({ type, msg }); setTimeout(() => setToast(null), 3500) }

  const now = new Date()
  const timeStr = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })
  const dayOfWeek = now.getDay()
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const dayName = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'][dayOfWeek]
  const canCheckIn = gpsState === 'ok' && !todayRecord?.check_in
  const canCheckOut = gpsState === 'ok' && todayRecord?.check_in && !todayRecord?.check_out

  const badgeColors = { hadir: [T.green, T.greenLight], sakit: [T.purple, T.purpleLight], cuti: [T.green, T.greenLight], ctb: ['#8B5CF6', '#F3EFFE'], day_off: [T.amber, T.amberLight] }

  return (
    <div style={s.app}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap');
        @keyframes blink{0%,100%{opacity:1;}50%{opacity:.3;}}
        @keyframes slideUp{from{transform:translateY(20px);opacity:0;}to{transform:translateY(0);opacity:1;}}
        @keyframes fadeIn{from{opacity:0;}to{opacity:1;}}
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* ── HEADER ── */}
      <div style={s.hdr}>
        <div style={s.hdrTop}>
          <div style={s.brandTag}>
            <div style={s.brandDot} />
            <span style={s.brandName}>Piccolo</span>
          </div>
          <div style={s.timeChip}>{timeStr}</div>
        </div>
        {tab === 'home' && <>
          <div style={s.greetHey}>Halo,</div>
          <div style={s.greetName}>{user?.name?.split(' ')[0]} 👋</div>
          <div style={s.greetRole}>{user?.role}{user?.shift ? ` · Shift ${user.shift}` : ''} · {dayName}</div>
          <StatusPill record={todayRecord} />
          {quote && (
            <div style={{ marginTop: 12, background: '#1A1A1A', borderRadius: 12, padding: '10px 14px', borderLeft: `3px solid ${T.coral}` }}>
              <div style={{ fontSize: 10, color: T.coral, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 4 }}>Quote Hari Ini ✨</div>
              <div style={{ fontSize: 12, color: '#DDD', lineHeight: 1.6, fontStyle: 'italic' }}>{quote.text}</div>
              {quote.author && <div style={{ fontSize: 10, color: '#666', marginTop: 4 }}>— {quote.author}</div>}
            </div>
          )}
        </>}
        {tab === 'profile' && <>
          <div style={s.greetHey}>Akun saya</div>
          <div style={s.greetName}>Profil</div>
        </>}
        {tab === 'history' && <>
          <div style={s.greetHey}>Rekap</div>
          <div style={s.greetName}>Riwayat</div>
        </>}
      </div>

      {/* ── CONTENT ── */}
      <div style={s.scroll}>

        {/* HOME TAB */}
        {tab === 'home' && <>
          {/* Balance cards */}
          <div style={{ display: 'flex', gap: 8, margin: '10px 14px 0' }}>
            {[['Sisa Cuti', leaveBalance, 'hari', leaveBalance <= 3 ? T.coral : T.green], ['Minggu Ini', history.filter(h => { const d = new Date(h.date); const diff = Math.floor((now - d) / 86400000); return diff < 7 && h.status === 'hadir' }).length, 'hari hadir', T.purple]].map(([lbl, val, unit, color]) => (
              <div key={lbl} style={{ flex: 1, background: T.surface, borderRadius: 16, padding: '12px 14px', border: `.5px solid ${T.border}` }}>
                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.08em', color: T.muted, marginBottom: 4 }}>{lbl}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1 }}>{val}</div>
                <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{unit}</div>
              </div>
            ))}
          </div>

          {/* GPS */}
          <GPSBar gpsState={gpsState} gpsInfo={gpsInfo} settings={settings} onCheck={checkGPS} />

          {/* Scan / Camera */}
          {gpsState === 'ok' && (
            <div style={{ ...s.section }}>
              <div style={{ background: T.surface, borderRadius: 20, padding: '16px', border: `.5px solid ${T.border}` }}>
                <div style={s.sLabel}>Verifikasi wajah</div>

                {scanStep === 'ready' && (
                  <>
                    <div style={{ width: 100, height: 100, borderRadius: '50%', margin: '0 auto 12px', border: `2.5px solid ${T.black}`, display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.cream, position: 'relative' }}>
                      <span style={{ fontSize: 42 }}>🧑</span>
                      <div style={{ position: 'absolute', inset: -6, borderRadius: '50%', border: `1.5px solid ${T.coral}`, animation: 'blink 2s ease-in-out infinite' }} />
                    </div>
                    <div style={{ fontSize: 10, color: T.muted, textAlign: 'center', marginBottom: 14 }}>Tap tombol untuk ambil selfie saat absen</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <button disabled={!canCheckIn} onClick={() => startCamera('checkin')}
                        style={{ padding: '13px 8px', borderRadius: 14, border: 'none', background: canCheckIn ? T.black : '#E8E4DC', color: canCheckIn ? T.white : T.muted, fontSize: 12, fontWeight: 800, cursor: canCheckIn ? 'pointer' : 'not-allowed', fontFamily: 'inherit', letterSpacing: '.02em' }}>
                        📷 Check In
                      </button>
                      <button disabled={!canCheckOut} onClick={() => startCamera('checkout')}
                        style={{ padding: '13px 8px', borderRadius: 14, border: `.5px solid ${canCheckOut ? T.border : '#E8E4DC'}`, background: canCheckOut ? T.cream : '#F5F5F5', color: canCheckOut ? T.black : T.muted, fontSize: 12, fontWeight: 800, cursor: canCheckOut ? 'pointer' : 'not-allowed', fontFamily: 'inherit', letterSpacing: '.02em' }}>
                        📷 Check Out
                      </button>
                    </div>
                  </>
                )}

                {scanStep === 'camera' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ position: 'relative', width: '100%', borderRadius: 14, overflow: 'hidden', border: `2px solid ${T.coral}`, aspectRatio: '1' }}>
                      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                        <div style={{ width: '65%', aspectRatio: '3/4', border: `2px solid rgba(232,103,74,0.7)`, borderRadius: '50%' }} />
                      </div>
                    </div>
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                      <button onClick={() => { stopCamera(); setScanStep('ready') }} style={{ flex: 1, padding: '11px', background: T.cream, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Batal</button>
                      <button onClick={takeSelfie} style={{ flex: 2, padding: '11px', background: T.black, color: T.white, border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>📸 Ambil Foto</button>
                    </div>
                  </div>
                )}

                {scanStep === 'confirm' && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: T.black }}>Pastikan wajah terlihat jelas</div>
                    <div style={{ width: '100%', borderRadius: 14, overflow: 'hidden', border: `2px solid ${T.green}`, aspectRatio: '1' }}>
                      <img src={selfieData} alt="selfie" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    </div>
                    <div style={{ background: T.amberLight, border: `.5px solid #F5D98A`, borderRadius: 10, padding: '8px 12px', fontSize: 11, color: '#8B5800', width: '100%', textAlign: 'center', lineHeight: 1.4 }}>
                      ⚠ Foto ini akan dilihat owner sebagai bukti kehadiran
                    </div>
                    <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                      <button onClick={() => { setSelfieData(null); startCamera(pendingAction) }} disabled={submitting} style={{ flex: 1, padding: '11px', background: T.cream, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 12, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 Ulang</button>
                      <button onClick={confirmAndSubmit} disabled={submitting} style={{ flex: 2, padding: '11px', background: T.black, color: T.white, border: 'none', borderRadius: 12, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting ? .6 : 1 }}>
                        {submitting ? 'Menyimpan...' : pendingAction === 'checkin' ? '✓ Konfirmasi Check In' : '✓ Konfirmasi Check Out'}
                      </button>
                    </div>
                  </div>
                )}

                {scanStep === 'done' && (
                  <div style={{ textAlign: 'center', padding: '1rem 0', animation: 'slideUp .4s ease' }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                    <div style={{ fontSize: 14, fontWeight: 800, color: T.green }}>Absensi tercatat!</div>
                    <button onClick={() => setScanStep('ready')} style={{ marginTop: 10, fontSize: 11, color: T.muted, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Absen lagi</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Absence options */}
          <div style={s.section}>
            <div style={s.sLabel}>Tidak masuk hari ini? (dari mana saja)</div>
            {isWeekend && (
              <div style={{ background: T.amberLight, border: `.5px solid #F5D98A`, borderRadius: 12, padding: '8px 12px', fontSize: 11, color: '#8B5800', marginBottom: 8, lineHeight: 1.5 }}>
                ⚠ Hari <strong>{dayName}</strong> — Day Off tidak tersedia. Tidak hadir = <strong>CTB otomatis</strong>.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { key: 'sakit', icon: '💊', label: 'Sakit', bg: T.purpleLight, color: T.purple },
                { key: 'cuti', icon: '📅', label: 'Cuti', bg: T.sageLight, color: '#2A5E3C' },
                { key: 'day_off', icon: '🌴', label: 'Day Off', bg: '#FFF3E0', color: '#8B4A00', disabled: isWeekend },
                { key: 'ctb', icon: '📋', label: 'CTB', bg: '#F5EBF5', color: '#6B2E6B' },
              ].map(b => (
                <button key={b.key} onClick={() => !b.disabled && !todayRecord && setModal(b.key)}
                  style={{ padding: '12px 12px', borderRadius: 14, border: 'none', background: (b.disabled || todayRecord) ? '#F5F5F5' : b.bg,
                    color: (b.disabled || todayRecord) ? '#CCC' : b.color, cursor: (b.disabled || todayRecord) ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', textAlign: 'left', opacity: b.disabled ? .5 : 1 }}>
                  <div style={{ fontSize: 18, marginBottom: 3 }}>{b.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{b.label}</div>
                  {b.disabled && <div style={{ fontSize: 9, opacity: .7 }}>Weekday only</div>}
                </button>
              ))}
            </div>
            {todayRecord && <div style={{ fontSize: 10, color: T.muted, textAlign: 'center', marginTop: 6 }}>Sudah ada catatan hari ini</div>}
          </div>

          {/* Recent history preview */}
          <div style={s.section}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', ...s.sLabel, marginBottom: 8 }}>
              <span>3 hari terakhir</span>
              <button onClick={() => setTab('history')} style={{ fontSize: 9, color: T.coral, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>Lihat semua →</button>
            </div>
            {history.slice(0, 3).map(h => {
              const [color, bg] = badgeColors[h.status] || [T.muted, '#F5F5F5']
              return (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: T.surface, borderRadius: 12, marginBottom: 5, border: `.5px solid ${T.border}` }}>
                  <div style={{ width: 3, height: 32, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: T.black }}>{new Date(h.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                    {h.check_in && <div style={{ fontSize: 9, color: T.muted }}>{new Date(h.check_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}{h.check_out ? ` – ${new Date(h.check_out).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}` : ''}</div>}
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: bg, color }}>
                    {h.status === 'hadir' ? (h.is_late ? `+${h.late_minutes}m` : 'On time') : h.status.toUpperCase()}
                  </span>
                </div>
              )
            })}
          </div>

          <div style={{ height: 10 }} />
        </>}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div style={s.section}>
            <div style={{ marginTop: 4 }}>
              {history.length === 0 && <div style={{ textAlign: 'center', padding: '2rem', color: T.muted, fontSize: 13 }}>Belum ada riwayat</div>}
              {history.map(h => {
                const [color, bg] = badgeColors[h.status] || [T.muted, '#F5F5F5']
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', background: T.surface, borderRadius: 14, marginBottom: 7, border: `.5px solid ${T.border}` }}>
                    <div style={{ width: 4, height: 38, borderRadius: 2, background: color, flexShrink: 0 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: T.black }}>{new Date(h.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>
                        {h.check_in ? `Masuk ${new Date(h.check_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}` : '—'}
                        {h.check_out ? ` · Keluar ${new Date(h.check_out).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}` : ''}
                        {h.note && h.note !== 'Otomatis — tidak ada catatan kehadiran' ? ` · ${h.note}` : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 20, background: bg, color, display: 'block' }}>
                        {h.status === 'hadir' ? (h.is_late ? `Terlambat` : 'Hadir') : h.status === 'ctb' && h.note === 'Otomatis — tidak ada catatan kehadiran' ? 'CTB (auto)' : h.status.toUpperCase()}
                      </span>
                      {h.gps_dist_in && <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>{h.gps_dist_in}m GPS</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* PROFILE TAB */}
        {tab === 'profile' && (
          <div style={s.section}>
            {/* Avatar upload */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 0 16px' }}>
              <label style={{ cursor: 'pointer', position: 'relative' }}>
                <div style={{ width: 80, height: 80, borderRadius: '50%', background: T.sage, border: `3px solid ${T.black}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: T.white }}>
                  {user?.photo_url
                    ? <img src={user.photo_url} alt="foto" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : user?.name?.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}
                </div>
                <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, background: T.coral, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, border: `2px solid ${T.white}` }}>📷</div>
                <input type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={async e => {
                  const file = e.target.files[0]
                  if (!file) return
                  const path = `photos/${user.id}_${Date.now()}.${file.name.split('.').pop()}`
                  const { data } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
                  if (data) {
                    const { data: url } = supabase.storage.from('documents').getPublicUrl(path)
                    await supabase.from('employees').update({ photo_url: url.publicUrl }).eq('id', user.id)
                    showToast('ok', 'Foto profil diperbarui!')
                    window.location.reload()
                  }
                }} />
              </label>
              <div style={{ marginTop: 10, fontSize: 16, fontWeight: 800, color: T.black }}>{user?.name}</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{user?.role}</div>
            </div>

            {/* Data diri */}
            <div style={{ ...s.card, marginBottom: 10 }}>
              <div style={s.sLabel}>Data Diri</div>
              {[['Nama Lengkap', user?.name], ['Jabatan', user?.role], ['Shift', user?.shift || '—'], ['Nomor HP', user?.phone]].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: `.5px solid ${T.border}` }}>
                  <div style={{ fontSize: 12, color: T.muted }}>{k}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: T.black }}>{v}</div>
                </div>
              ))}
            </div>

            {/* Saldo cuti */}
            <div style={{ ...s.card, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: T.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>📅</div>
              <div style={{ flex: 1 }}>
                <div style={s.sLabel}>Sisa Hak Cuti</div>
                <div style={{ fontSize: 26, fontWeight: 800, color: leaveBalance <= 3 ? T.coral : T.green }}>{leaveBalance} <span style={{ fontSize: 13, fontWeight: 400, color: T.muted }}>hari</span></div>
              </div>
            </div>

            {/* Ganti PIN */}
            <div style={{ ...s.card, marginBottom: 10 }}>
              <div style={s.sLabel}>Ganti PIN</div>
              {[['PIN saat ini', pinOld, setPinOld], ['PIN baru (min. 4 angka)', pin1, setPin1], ['Konfirmasi PIN baru', pin2, setPin2]].map(([lbl, val, setter]) => (
                <div key={lbl} style={{ marginBottom: 10 }}>
                  <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>{lbl}</div>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} value={val}
                    onChange={e => setter(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="••••••"
                    style={{ width: '100%', padding: '10px 12px', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 16, fontWeight: 700, letterSpacing: '.2em', background: T.cream, color: T.black, fontFamily: 'inherit' }} />
                </div>
              ))}
              {pinMsg && (
                <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, background: pinMsg.type === 'ok' ? T.greenLight : T.dngBg, color: pinMsg.type === 'ok' ? T.green : T.dng, marginBottom: 10 }}>
                  {pinMsg.text}
                </div>
              )}
              <button onClick={changePin} disabled={pinSaving || !pinOld || !pin1 || !pin2}
                style={{ width: '100%', padding: '12px', background: T.black, color: T.white, border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: (pinSaving || !pinOld || !pin1 || !pin2) ? .5 : 1 }}>
                {pinSaving ? 'Menyimpan...' : 'Simpan PIN Baru'}
              </button>
            </div>

            {/* Logout */}
            <button onClick={() => { stopCamera(); logout(); navigate('/login') }}
              style={{ width: '100%', padding: '12px', background: 'transparent', border: `.5px solid ${T.border}`, borderRadius: 12, fontSize: 13, fontWeight: 700, color: T.muted, cursor: 'pointer', fontFamily: 'inherit', marginBottom: 14 }}>
              Keluar dari akun
            </button>
          </div>
        )}
      </div>

      {/* BOTTOM NAV */}
      <div style={s.botNav}>
        {[['home','🏠','Beranda'], ['history','📋','Riwayat'], ['profile','👤','Profil']].map(([key, ico, lbl]) => (
          <button key={key} onClick={() => setTab(key)} style={s.navItem(tab === key)}>
            <div style={s.navIco(tab === key)}><span style={{ fontSize: 14 }}>{ico}</span></div>
            {lbl}
          </button>
        ))}
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 80, left: 14, right: 14, padding: '12px 16px', borderRadius: 14, fontSize: 13, fontWeight: 700, textAlign: 'center', zIndex: 999, animation: 'slideUp .3s ease',
          background: toast.type === 'ok' ? T.black : T.coral, color: T.white }}>
          {toast.msg}
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ background: T.white, borderRadius: '24px 24px 0 0', padding: '20px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: modal === 'sakit' ? T.purpleLight : modal === 'cuti' ? T.greenLight : modal === 'day_off' ? T.amberLight : '#F5EBF5', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                {modal === 'sakit' ? '💊' : modal === 'cuti' ? '📅' : modal === 'day_off' ? '🌴' : '📋'}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: T.black }}>Catat {modal === 'sakit' ? 'Sakit' : modal === 'cuti' ? 'Cuti' : modal === 'day_off' ? 'Day Off' : 'CTB'}</div>
                <div style={{ fontSize: 11, color: T.muted }}>{user?.name} · {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              </div>
            </div>

            {modal === 'cuti' && (
              <div style={{ background: T.greenLight, borderRadius: 12, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 12, color: T.green }}>Sisa hak cuti</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: T.green }}>{leaveBalance} hari</span>
              </div>
            )}
            {modal === 'day_off' && (
              <div style={{ background: T.amberLight, borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 11, color: '#8B5800', lineHeight: 1.5 }}>
                🌴 Day Off mingguan — hanya Senin–Jumat, maks. 1x per minggu. Perlu persetujuan owner.
              </div>
            )}
            {modal === 'ctb' && (
              <div style={{ background: '#F5EBF5', borderRadius: 12, padding: '10px 14px', marginBottom: 14, fontSize: 11, color: '#6B2E6B', lineHeight: 1.5 }}>
                CTB digunakan saat saldo cuti habis. Tidak memotong saldo cuti.
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 6 }}>Keterangan</div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder={modal === 'sakit' ? 'Contoh: demam, flu...' : 'Jelaskan alasan...'}
                style={{ width: '100%', padding: '10px 12px', border: `.5px solid ${T.border}`, borderRadius: 12, fontSize: 13, background: T.cream, color: T.black, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                Upload dokumen
                {modal === 'sakit' && <span style={{ fontSize: 9, background: T.dngBg, color: T.dng, padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>WAJIB</span>}
                {modal !== 'sakit' && <span style={{ fontSize: 9, color: T.muted }}>(opsional)</span>}
              </div>
              <label style={{ display: 'block', border: `1.5px dashed ${docFile ? T.green : T.border}`, borderRadius: 12, padding: '16px', textAlign: 'center', cursor: 'pointer', background: docFile ? T.greenLight : T.cream }}>
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setDocFile(e.target.files[0])} />
                {docFile ? <div style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ {docFile.name}</div> : (
                  <><div style={{ fontSize: 22, marginBottom: 4 }}>📎</div>
                  <div style={{ fontSize: 12, color: T.muted }}>Tap untuk upload foto atau PDF</div></>
                )}
              </label>
            </div>

            {modal === 'sakit' && (
              <div style={{ background: T.purpleLight, borderRadius: 10, padding: '8px 12px', fontSize: 11, color: T.purple, marginBottom: 14, lineHeight: 1.5 }}>
                Dokumen bisa menyusul maks. 3 hari. Tanpa dokumen → CTB otomatis.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => { setModal(null); setDocFile(null); setNote('') }}
                style={{ padding: '13px', background: T.cream, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 14, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                Batal
              </button>
              <button onClick={() => submitLeave(modal)} disabled={submitting}
                style={{ padding: '13px', background: T.black, color: T.white, border: 'none', borderRadius: 14, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting ? .6 : 1 }}>
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
