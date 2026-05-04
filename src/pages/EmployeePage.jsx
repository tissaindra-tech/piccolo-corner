import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabase.js'
import { getCurrentPosition, getDistanceMeters, formatDistance } from '../lib/gps.js'

// ── THEME: Clean Minimal ──────────────────────────────────────────────────────
const T = {
  black: '#111111', white: '#FFFFFF', bg: '#F8F8F6',
  orange: '#F97316', orangeLight: '#FFF7ED',
  green: '#16A34A', greenLight: '#F0FDF4', greenBd: '#86EFAC',
  red: '#DC2626', redLight: '#FEF2F2', redBd: '#FCA5A5',
  blue: '#2563EB', blueLight: '#EFF6FF', blueBd: '#93C5FD',
  amber: '#D97706', amberLight: '#FFFBEB', amberBd: '#FCD34D',
  purple: '#7C3AED', purpleLight: '#F5F3FF', purpleBd: '#C4B5FD',
  gray: '#6B7280', grayLight: '#F9FAFB', grayBd: '#E5E7EB',
  border: '#E5E7EB', surface: '#FFFFFF', muted: '#9CA3AF',
}

function localToday() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

const statusConfig = {
  hadir:   { color: T.green,  bg: T.greenLight,  bd: T.greenBd,  label: 'Hadir' },
  sakit:   { color: T.blue,   bg: T.blueLight,   bd: T.blueBd,   label: 'Sakit' },
  cuti:    { color: T.green,  bg: T.greenLight,  bd: T.greenBd,  label: 'Cuti' },
  ctb:     { color: T.purple, bg: T.purpleLight, bd: T.purpleBd, label: 'CTB' },
  day_off: { color: T.amber,  bg: T.amberLight,  bd: T.amberBd,  label: 'Day Off' },
}

// ── COMPONENTS ────────────────────────────────────────────────────────────────
function Pill({ children, color, bg, bd }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: bg, color, border: `.5px solid ${bd}` }}>
      {children}
    </span>
  )
}

function Card({ children, style = {}, onClick }) {
  return (
    <div onClick={onClick} style={{ background: '#FFFFFF', borderRadius: 14, border: `.5px solid ${T.border}`, padding: '14px 16px', ...style }}>
      {children}
    </div>
  )
}

function SLabel({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: T.muted, marginBottom: 8 }}>{children}</div>
}

export default function EmployeePage() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()

  const [tab, setTab] = useState('home')
  const [gpsState, setGpsState] = useState('idle')
  const [gpsInfo, setGpsInfo] = useState(null)
  const [settings, setSettings] = useState({ cafe_lat: -8.7162, cafe_lng: 115.2108, gps_radius_meters: 100, open_time: '10:00', late_tolerance_minutes: 15, doc_upload_deadline_days: 3, notif_message: '' })
  const [todayRecord, setTodayRecord] = useState(null)
  const [history, setHistory] = useState([])
  const [leaveBalance, setLeaveBalance] = useState(user?.leave_balance || 0)
  const [quote, setQuote] = useState(null)
  const [modal, setModal] = useState(null)
  const [docFile, setDocFile] = useState(null)
  const [note, setNote] = useState('')
  const [scanStep, setScanStep] = useState('ready')
  const [selfieData, setSelfieData] = useState(null)
  const [pendingAction, setPendingAction] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [points, setPoints] = useState(0)
  const [rank, setRank] = useState(1)
  const [totalEmp, setTotalEmp] = useState(1)
  const [backdateModal, setBackdateModal] = useState(false)
  const [backdateDate, setBackdateDate] = useState('')
  const [backdateNote, setBackdateNote] = useState('')
  const [backdateDoc, setBackdateDoc] = useState(null)
  const [backdateErr, setBackdateErr] = useState(null)
  const [pinOld, setPinOld] = useState('')
  const [pin1, setPin1] = useState('')
  const [pin2, setPin2] = useState('')
  const [pinSaving, setPinSaving] = useState(false)
  const [pinMsg, setPinMsg] = useState(null)
  // Slip Gaji state
  const [slipList, setSlipList] = useState([])
  const [slipDetail, setSlipDetail] = useState(null)
  const [slipLoading, setSlipLoading] = useState(false)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => {
    fetchAll()
    fetchQuote()
    setupNotif()
  }, [])

  async function fetchAll() {
    const { data: s } = await supabase.from('work_settings').select('*').eq('id', 1).single()
    if (s) setSettings(s)
    const today = localToday()
    const { data: att } = await supabase.from('attendance').select('*').eq('employee_id', user.id).eq('date', today).single()
    setTodayRecord(att || null)
    const { data: hist } = await supabase.from('attendance').select('*,is_excused,excuse_reason').eq('employee_id', user.id).order('date', { ascending: false }).limit(14)
    setHistory(hist || [])
    const { data: emp } = await supabase.from('employees').select('leave_balance').eq('id', user.id).single()
    if (emp) setLeaveBalance(emp.leave_balance)
    // Hitung insentif bulan ini dalam Rupiah
    // Ontime ≤10:30 = +Rp10.000 | Telat 1-5m = -Rp2.000 | 6-30m = -Rp6.000 | >30m = -Rp10.000
    // Izin Tugas dari owner = +Rp10.000 (ontime penuh)
    const thisMonth = localToday().slice(0, 7)
    const { data: myAtt } = await supabase.from('attendance').select('status,is_late,late_minutes,is_excused,excuse_reason').eq('employee_id', user.id).gte('date', thisMonth + '-01')
    if (myAtt) {
      let totalRp = 0
      myAtt.forEach(a => {
        if (a.status === 'hadir') {
          if (a.is_excused) totalRp += 10000      // Izin tugas = ontime penuh
          else if (!a.is_late) totalRp += 10000   // Ontime
          else {
            const m = a.late_minutes || 0
            if (m <= 5) totalRp -= 2000
            else if (m <= 30) totalRp -= 6000
            else totalRp -= 10000
          }
        }
      })
      setPoints(totalRp)
    }
    const { data: allEmps } = await supabase.from('employees').select('id').eq('is_owner', false)
    if (allEmps) setTotalEmp(allEmps.length)
  }

  async function fetchQuote() {
    try {
      const { data } = await supabase.from('quotes').select('*').eq('is_active', true)
      if (data?.length > 0) setQuote(data[new Date().getDate() % data.length])
    } catch (e) {}
  }

  function setupNotif() {
    if (!('Notification' in window)) return
    Notification.requestPermission()
    const checkTime = async () => {
      const now = new Date()
      if (now.getHours() === 10 && now.getMinutes() === 0 && Notification.permission === 'granted') {
        const { data: ws } = await supabase.from('work_settings').select('notif_message').eq('id', 1).single()
        const msg = ws?.notif_message || 'Selamat pagi! Yuk segera absen dan mulai hari yang produktif 💪'
        new Notification('☕ Piccolo Corner — Waktunya Kerja!', { body: msg })
      }
    }
    checkTime()
    const iv = setInterval(checkTime, 60000)
    return () => clearInterval(iv)
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
      } else setGpsState('ok')
    } catch (e) { setGpsState('blocked'); setGpsInfo({ error: e.message }) }
  }

  async function startCamera(action) {
    setPendingAction(action); setScanStep('camera'); setSelfieData(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (e) { showToast('error', 'Izin kamera ditolak'); setScanStep('ready') }
  }

  function takeSelfie() {
    const canvas = canvasRef.current, video = videoRef.current
    if (!canvas || !video) return
    canvas.width = video.videoWidth || 480; canvas.height = video.videoHeight || 480
    canvas.getContext('2d').drawImage(video, 0, 0)
    setSelfieData(canvas.toDataURL('image/jpeg', 0.7))
    stopCamera(); setScanStep('confirm')
  }

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  async function confirmAndSubmit() {
    setSubmitting(true)

    // Upload selfie dulu (opsional, tidak blocking)
    let selfieUrl = null
    if (selfieData) {
      try {
        const blob = await fetch(selfieData).then(r => r.blob())
        const path = `selfies/${user.id}/${pendingAction}_${Date.now()}.jpg`
        const { data: upData } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (upData) {
          const { data: urlData } = supabase.storage.from('documents').getPublicUrl(path)
          selfieUrl = urlData.publicUrl
        }
      } catch (e) { console.log('Selfie upload failed (non-critical):', e) }
    }

    const now = new Date()
    const today = localToday()

    if (pendingAction === 'checkin') {
      // ── CHECK IN ──────────────────────────────────────────
      const [oh, om] = settings.open_time.split(':').map(Number)
      const nowMs = now.getHours() * 60 + now.getMinutes()
      const openMs = oh * 60 + om
      const isLate = nowMs > openMs + (settings.late_tolerance_minutes || 15)
      const lateMinutes = isLate ? nowMs - openMs : 0

      const { error } = await supabase.from('attendance').upsert({
        employee_id: user.id,
        date: today,
        check_in: now.toISOString(),
        status: 'hadir',
        is_late: isLate,
        late_minutes: lateMinutes,
        doc_url: selfieUrl,
        // GPS check-in (kolom ini ada dari awal)
        gps_lat_in: gpsInfo?.lat || null,
        gps_lng_in: gpsInfo?.lng || null,
        gps_dist_in: gpsInfo?.dist || null,
      }, { onConflict: 'employee_id,date' })

      if (!error) {
        showToast('ok', isLate ? `Clock In ✓ — Terlambat ${lateMinutes} mnt` : 'Clock In berhasil! ✓')
      } else {
        showToast('error', `Gagal check in: ${error.message}`)
        setSubmitting(false); return
      }

    } else {
      // ── CHECK OUT ─────────────────────────────────────────
      // GPS wajib — durasi kerja hanya valid kalau check out dari cafe
      const { error } = await supabase
        .from('attendance')
        .update({
          check_out: now.toISOString(),
          gps_lat_out: gpsInfo?.lat || null,
          gps_lng_out: gpsInfo?.lng || null,
          gps_dist_out: gpsInfo?.dist || null,
          ...(selfieUrl ? { note: `selfie_out:${selfieUrl}` } : {}),
        })
        .eq('employee_id', user.id)
        .eq('date', today)

      if (!error) {
        showToast('ok', 'Check Out berhasil! ✓')
      } else {
        showToast('error', `Gagal check out: ${error.message}`)
        setSubmitting(false); return
      }
    }

    setScanStep('done')
    setSubmitting(false)
    fetchAll()
  }

  async function submitLeave(type) {
    setSubmitting(true)
    const today = localToday()
    let docUrl = null
    if (docFile) {
      const ext = docFile.name.split('.').pop()
      const { data } = await supabase.storage.from('documents').upload(`docs/${user.id}/${Date.now()}.${ext}`, docFile)
      if (data) { const { data: u } = supabase.storage.from('documents').getPublicUrl(data.path); docUrl = u.publicUrl }
    }
    await supabase.from('attendance').upsert({ employee_id: user.id, date: today, status: type, note, doc_url: docUrl, doc_status: docUrl ? 'pending' : null }, { onConflict: 'employee_id,date' })
    if (type === 'cuti') await supabase.from('employees').update({ leave_balance: Math.max(0, leaveBalance - 1) }).eq('id', user.id)
    if (type === 'day_off' || type === 'cuti') await supabase.from('leave_requests').insert({ employee_id: user.id, type, date_start: today, date_end: today, days: 1, reason: note, status: 'pending' })
    setSubmitting(false); setModal(null); setDocFile(null); setNote('')
    showToast('ok', `${type === 'sakit' ? 'Sakit' : type === 'cuti' ? 'Cuti' : type === 'day_off' ? 'Day Off' : 'CTB'} berhasil dicatat`)
    fetchAll()
  }

  async function submitBackdate() {
    if (!backdateDate) { setBackdateErr('Pilih tanggal dulu'); return }
    setSubmitting(true); setBackdateErr(null)
    const { data: existing } = await supabase.from('attendance').select('id,status').eq('employee_id', user.id).eq('date', backdateDate).single()
    if (existing && existing.status !== 'ctb') { setBackdateErr(`Sudah ada catatan (${existing.status.toUpperCase()}). Tidak bisa diubah.`); setSubmitting(false); return }
    let docUrl = null
    if (backdateDoc) {
      const ext = backdateDoc.name.split('.').pop()
      const { data } = await supabase.storage.from('documents').upload(`docs/${user.id}/sakit_${backdateDate}_${Date.now()}.${ext}`, backdateDoc, { upsert: true })
      if (data) { const { data: u } = supabase.storage.from('documents').getPublicUrl(data.path); docUrl = u.publicUrl }
    }
    if (existing) {
      await supabase.from('attendance').update({ status: 'sakit', note: backdateNote, doc_url: docUrl, doc_status: docUrl ? 'pending' : 'missing' }).eq('id', existing.id)
    } else {
      await supabase.from('attendance').insert({ employee_id: user.id, date: backdateDate, status: 'sakit', note: backdateNote, doc_url: docUrl, doc_status: docUrl ? 'pending' : 'missing' })
    }
    setSubmitting(false); setBackdateModal(false); setBackdateDate(''); setBackdateNote(''); setBackdateDoc(null)
    showToast('ok', `Sakit ${backdateDate} berhasil dicatat`); fetchAll()
  }

  // ===== FETCH SLIP GAJI YANG SUDAH DIBAYARKAN =====
  // Dipanggil saat user buka tab 'gaji'
  async function fetchSlipGaji() {
    if (!user?.id) return
    setSlipLoading(true)
    const { data } = await supabase
      .from('slip_gaji_final')
      .select('*')
      .eq('employee_id', user.id)
      .order('bulan', { ascending: false })
    setSlipList(data || [])
    setSlipLoading(false)
  }

  // Print slip gaji karyawan (read-only versi karyawan)
  function printSlipKaryawan(slip) {
    const s = slip.snapshot || {}
    const tunj = Array.isArray(s.tunjangan) ? s.tunjangan : []
    const bons = Array.isArray(s.bonuses) ? s.bonuses : []
    const pots = Array.isArray(s.potongan_manual) ? s.potongan_manual : []
    const dibayarTgl = s.tgl_bayar
      ? new Date(s.tgl_bayar).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      : new Date(slip.dibayarkan_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
    const metodeBayarStr = s.metode_bayar === 'cash' ? 'Tunai (Cash)' : 'Transfer Bank'
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slip Gaji ${s.nama} ${s.bulan}</title>
<style>
body{font-family:'Helvetica',Arial,sans-serif;color:#111;max-width:680px;margin:30px auto;padding:0 20px;font-size:13px;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:20px}
.cafe{font-size:18px;font-weight:700}.cafe-addr{font-size:11px;color:#666;margin-top:3px}
.title{text-align:right}.title-l{font-size:10px;color:#666;letter-spacing:.1em;text-transform:uppercase}
.title-v{font-size:14px;font-weight:700;margin-top:2px}
.info{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
.info-item .info-l{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.info-item .info-v{font-weight:600;margin-top:2px}
.section{margin-bottom:14px}
.section-h{font-size:11px;color:#666;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:6px}
.row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}
.row-total{font-weight:700;border-top:1px solid #ccc;padding-top:6px;margin-top:4px}
.bersih{background:#F0FDF4;border:2px solid #16A34A;padding:14px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:18px}
.bersih-l{font-size:11px;color:#16A34A;text-transform:uppercase;letter-spacing:.05em}
.bersih-v{font-size:22px;font-weight:800;color:#16A34A;margin-top:2px}
.paid-badge{display:inline-block;background:#D1FAE5;color:#065F46;padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;margin-top:8px}
.note{margin-top:30px;font-size:10px;color:#999;text-align:center}
@media print{body{margin:0;padding:20px}.no-print{display:none}}
</style></head><body>
<div class="header">
  <div><div class="cafe">Piccolo Corner</div><div class="cafe-addr">Jl. Bypass Ngurah Rai No.729, Pedungan, Denpasar Selatan, Bali</div></div>
  <div class="title"><div class="title-l">Slip Gaji</div><div class="title-v">${s.label||s.bulan}</div></div>
</div>
<div class="info">
  <div class="info-item"><div class="info-l">Nama</div><div class="info-v">${s.nama||''}</div></div>
  <div class="info-item"><div class="info-l">Jabatan</div><div class="info-v">${s.role||''}</div></div>
  <div class="info-item"><div class="info-l">Periode</div><div class="info-v">${s.label||s.bulan}</div></div>
  <div class="info-item"><div class="info-l">Hari Hadir</div><div class="info-v">${s.hari_hadir||0} hari</div></div>
</div>
<div class="section">
  <div class="section-h">Pendapatan</div>
  <div class="row"><span>Gaji Pokok</span><span>Rp ${(s.gaji_pokok||0).toLocaleString('id-ID')}</span></div>
  ${tunj.map(t=>`<div class="row"><span>Tunjangan ${t.nama||'-'}</span><span>Rp ${(parseInt(t.nominal)||0).toLocaleString('id-ID')}</span></div>`).join('')}
  ${bons.map(b=>`<div class="row" style="color:#2563EB"><span>${b.nama||'Bonus'}${b.catatan?' ('+b.catatan+')':''}</span><span>+ Rp ${(parseInt(b.nominal)||0).toLocaleString('id-ID')}</span></div>`).join('')}
  ${(s.insentif||0)>0?`<div class="row" style="color:#16A34A"><span>Insentif Kehadiran</span><span>+ Rp ${(s.insentif||0).toLocaleString('id-ID')}</span></div>`:''}
  <div class="row row-total"><span>Total Pendapatan</span><span>Rp ${(s.total_pendapatan||0).toLocaleString('id-ID')}</span></div>
</div>
<div class="section">
  <div class="section-h">Potongan</div>
  ${(s.insentif||0)<0?`<div class="row" style="color:#DC2626"><span>Potongan Telat (Insentif)</span><span>- Rp ${Math.abs(s.insentif||0).toLocaleString('id-ID')}</span></div>`:''}
  ${pots.map(p=>`<div class="row" style="color:#DC2626"><span>${p.tipe||'Potongan'}${p.catatan?' ('+p.catatan+')':''}</span><span>- Rp ${(parseInt(p.nominal)||0).toLocaleString('id-ID')}</span></div>`).join('')}
  ${(s.total_potongan||0)===0?'<div class="row" style="color:#999"><span>Tidak ada potongan</span><span>-</span></div>':''}
  <div class="row row-total"><span>Total Potongan</span><span>Rp ${(s.total_potongan||0).toLocaleString('id-ID')}</span></div>
</div>
<div class="bersih">
  <div><div class="bersih-l">Gaji Bersih Diterima</div><div class="bersih-v">Rp ${(s.gaji_bersih||0).toLocaleString('id-ID')}</div><div class="paid-badge">✅ ${dibayarTgl} · ${metodeBayarStr}</div></div>
</div>
<div class="note">Slip gaji resmi dari Piccolo Corner<br/>Dicetak: ${new Date().toLocaleString('id-ID')}</div>
<div class="no-print" style="margin-top:30px;text-align:center;border-top:1px dashed #ccc;padding-top:20px">
  <button onclick="window.print()" style="padding:10px 24px;background:#111;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">🖨 Simpan / Print PDF</button>
  <button onclick="window.close()" style="padding:10px 24px;background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;cursor:pointer;font-size:13px;margin-left:8px">Tutup</button>
</div>
</body></html>`
    const w = window.open('', '_blank', 'width=800,height=900')
    if (w) { w.document.write(html); w.document.close() }
  }

  async function changePin() {
    if (!pinOld || pin1.length < 4) { setPinMsg({ type: 'err', text: 'PIN minimal 4 angka' }); return }
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
  const dateStr = now.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
  const canCheckIn = gpsState === 'ok' && !todayRecord?.check_in
  const canCheckOut = gpsState === 'ok' && todayRecord?.check_in && !todayRecord?.check_out
  const todaySt = todayRecord ? (statusConfig[todayRecord.status] || {}) : null

  const inputSt = { width: '100%', padding: '10px 12px', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, background: '#FFFFFF', color: T.black, fontFamily: 'inherit' }

  return (
    <div style={{ minHeight: '100vh', background: '#FFFFFF', fontFamily: "'Inter', -apple-system, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        @keyframes fadeUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:translateY(0)} }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
      `}</style>

      {/* ── HEADER ── */}
      <div style={{ background: T.surface, borderBottom: `.5px solid ${T.border}`, padding: '14px 18px', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tab === 'home' ? 12 : 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 32, height: 32, background: T.black, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>☕</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.black }}>Piccolo Corner</div>
              <div style={{ fontSize: 10, color: T.muted }}>
                {tab === 'home' ? `${dayName}, ${dateStr}` : tab === 'history' ? 'Riwayat Absensi' : 'Profil Saya'}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: T.black, letterSpacing: '-.01em' }}>{timeStr}</div>
        </div>

        {tab === 'home' && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, color: T.muted, marginBottom: 2 }}>Halo,</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: T.black, letterSpacing: '-.02em' }}>{user?.name?.split(' ')[0]} 👋</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{user?.role}{user?.shift ? ` · ${user.shift}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {todayRecord ? (
                <Pill color={todaySt?.color} bg={todaySt?.bg} bd={todaySt?.bd}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: todaySt?.color, display: 'inline-block' }} />
                  {todaySt?.label}
                  {todayRecord.check_in ? ` · ${new Date(todayRecord.check_in).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})}` : ''}
                </Pill>
              ) : (
                <Pill color={T.orange} bg={T.orangeLight} bd="#FED7AA">
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: T.orange, display: 'inline-block', animation: 'blink 1.5s ease-in-out infinite' }} />
                  Belum absen
                </Pill>
              )}
            </div>
          </div>
        )}

        {/* Quote strip */}
        {tab === 'home' && quote && (
          <div style={{ marginTop: 12, background: T.orangeLight, borderRadius: 10, padding: '8px 12px', borderLeft: `3px solid ${T.orange}`, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>✨</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: T.amber, fontStyle: 'italic', lineHeight: 1.5 }}>{quote.text}</div>
              {quote.author && <div style={{ fontSize: 9, color: T.muted, marginTop: 3 }}>— {quote.author}</div>}
            </div>
          </div>
        )}
      </div>

      {/* ── CONTENT ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px', paddingBottom: 80, display: 'flex', flexDirection: 'column', gap: 10, background: '#F3F4F6' }}>

        {/* HOME */}
        {tab === 'home' && <>
          {/* 1. INSENTIF HERO — hanya tampil kalau program aktif */}
          {settings.incentive_program_active ? (
          <div style={{ background: T.black, borderRadius: 16, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: '#9CA3AF', marginBottom: 4 }}>Total poin bulan ini</div>
              <div style={{ fontSize: 32, fontWeight: 800, color: T.white, lineHeight: 1, letterSpacing: '-.02em' }}>
                {points >= 0 ? `Rp ${points.toLocaleString('id-ID')}` : `−Rp ${Math.abs(points).toLocaleString('id-ID')}`}
              </div>
              <div style={{ fontSize: 10, color: '#6B7280', marginTop: 4 }}>
                Rank #{rank} dari {totalEmp} karyawan
              </div>
              <div style={{ marginTop: 8, background: '#1F2937', borderRadius: 8, height: 5, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: T.orange, borderRadius: 8, width: `${Math.min(100, Math.round((Math.max(0,points)/260000)*100))}%`, transition: 'width .6s ease' }} />
              </div>
              <div style={{ fontSize: 9, color: '#6B7280', marginTop: 3 }}>{points >= 0 ? `Rp ${(260000-points).toLocaleString('id-ID')} lagi ke maks bonus` : 'Ada potongan gaji bulan ini'}</div>
            </div>
            <div style={{ background: '#FEF9C3', borderRadius: 12, padding: '10px 12px', textAlign: 'center', flexShrink: 0, border: '.5px solid #FDE68A' }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#D97706' }}>#{rank}</div>
              <div style={{ fontSize: 9, color: '#92400E', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Rank</div>
            </div>
          </div>
          ) : (
          <div style={{ background: '#FFFFFF', borderRadius: 14, padding: '12px 16px', border: '.5px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 22 }}>👋</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: T.black }}>Program insentif belum aktif</div>
              <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Akan diinformasikan oleh owner saat dimulai</div>
            </div>
          </div>
          )}

          {/* 2. GPS */}
          <div style={{ background: gpsState==='ok' ? T.greenLight : gpsState==='blocked' ? T.redLight : gpsState==='checking' ? T.blueLight : T.orangeLight,
            border: `.5px solid ${gpsState==='ok' ? T.greenBd : gpsState==='blocked' ? T.redBd : gpsState==='checking' ? T.blueBd : '#FED7AA'}`,
            borderRadius: 12, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: gpsState==='ok' ? T.green : gpsState==='blocked' ? T.red : gpsState==='checking' ? T.blue : T.orange, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
              {gpsState==='ok' ? '📍' : gpsState==='blocked' ? '🚫' : '📡'}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: gpsState==='ok' ? T.green : gpsState==='blocked' ? T.red : gpsState==='checking' ? T.blue : T.amber }}>
                {gpsState==='idle' && 'Cek lokasi GPS dulu'}
                {gpsState==='checking' && 'Mendeteksi lokasi...'}
                {gpsState==='ok' && `Lokasi valid — ${formatDistance(gpsInfo?.dist)}`}
                {gpsState==='blocked' && (gpsInfo?.error || `Di luar area — ${formatDistance(gpsInfo?.dist)}`)}
              </div>
              <div style={{ fontSize: 10, color: T.muted, marginTop: 1 }}>
                {gpsState==='ok' ? 'Siap absen!' : gpsState==='blocked' ? `Batas: ${settings.gps_radius_meters}m` : 'Diperlukan untuk absen'}
              </div>
            </div>
            {gpsState !== 'checking' && (
              <button onClick={checkGPS} style={{ fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 20, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                background: gpsState==='ok' ? T.green : gpsState==='blocked' ? T.red : T.orange, color: '#fff' }}>
                {gpsState==='idle' ? 'Cek GPS' : '↻ Ulang'}
              </button>
            )}
          </div>

          {gpsState==='blocked' && (
            <Card style={{ textAlign: 'center', padding: '20px 16px' }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📍</div>
              <div style={{ fontSize: 14, fontWeight: 800, color: T.black, marginBottom: 4 }}>Kamu belum di cafe nih!</div>
              <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.6, marginBottom: 10 }}>
                Check In dan Check Out hanya bisa dilakukan dari dalam area Piccolo Corner 📍
              </div>
              {gpsInfo?.dist && (
                <div style={{ marginBottom: 12, display: 'inline-block', background: T.redLight, borderRadius: 10, padding: '6px 16px' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: T.red }}>{formatDistance(gpsInfo.dist)}</div>
                  <div style={{ fontSize: 9, color: T.muted, textTransform: 'uppercase', letterSpacing: '.07em' }}>dari cafe</div>
                </div>
              )}
            </Card>
          )}

          {/* Scan / Camera — GPS wajib untuk Check In dan Check Out */}
          {gpsState === 'ok' && (
            <Card>
              <SLabel>Selfie — Clock In / Clock Out</SLabel>
              {scanStep === 'ready' && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                    <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#FFFFFF', border: `2px solid ${T.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>🧑</div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <button disabled={!canCheckIn} onClick={() => startCamera('checkin')}
                      style={{ padding: '12px', background: canCheckIn ? T.black : T.border, color: canCheckIn ? '#fff' : T.muted, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: canCheckIn ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                      📷 Clock In
                    </button>
                    <button disabled={!canCheckOut} onClick={() => startCamera('checkout')}
                      style={{ padding: '12px', background: canCheckOut ? T.black : T.grayLight,
                        color: canCheckOut ? '#fff' : T.muted,
                        border: canCheckOut ? 'none' : `.5px solid ${T.grayBd}`,
                        borderRadius: 10, fontSize: 12, fontWeight: 700,
                        cursor: canCheckOut ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                      ← Clock Out
                    </button>
                  </div>
                  {!canCheckIn && !canCheckOut && todayRecord && (
                    <div style={{ textAlign: 'center', marginTop: 10, fontSize: 12, color: T.green, fontWeight: 600 }}>✓ Absensi hari ini selesai</div>
                  )}
                </>
              )}

              {scanStep === 'camera' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ background: T.blueLight, borderRadius: 9, padding: '7px 12px', fontSize: 11, color: T.blue, fontWeight: 600, textAlign: 'center' }}>
                    📷 {pendingAction === 'checkin' ? 'Selfie untuk Clock In' : 'Selfie untuk Clock Out'}
                  </div>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: `2px solid ${T.orange}` }}>
                    <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <div style={{ width: '65%', aspectRatio: '3/4', border: `2px solid rgba(249,115,22,.6)`, borderRadius: '50%' }} />
                    </div>
                  </div>
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { stopCamera(); setScanStep('ready') }} style={{ flex: 1, padding: '11px', background: T.surface, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Batal</button>
                    <button onClick={takeSelfie} style={{ flex: 2, padding: '11px', background: T.black, color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>📸 Ambil Foto</button>
                  </div>
                </div>
              )}

              {scanStep === 'confirm' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '1', borderRadius: 12, overflow: 'hidden', border: `2px solid ${T.green}` }}>
                    <img src={selfieData} alt="selfie" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                  </div>
                  <div style={{ background: T.amberLight, border: `.5px solid ${T.amberBd}`, borderRadius: 9, padding: '8px 12px', fontSize: 11, color: T.amber, textAlign: 'center' }}>
                    ⚠ Foto ini dilihat owner sebagai bukti kehadiran
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => { setSelfieData(null); startCamera(pendingAction) }} disabled={submitting} style={{ flex: 1, padding: '11px', background: T.surface, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>🔄 Ulang</button>
                    <button onClick={confirmAndSubmit} disabled={submitting} style={{ flex: 2, padding: '11px', background: T.black, color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting ? .6 : 1 }}>
                      {submitting ? 'Menyimpan...' : pendingAction === 'checkin' ? '✓ Clock In' : '✓ Clock Out'}
                    </button>
                  </div>
                </div>
              )}

              {scanStep === 'done' && (
                <div style={{ textAlign: 'center', padding: '16px 0', animation: 'fadeUp .3s ease' }}>
                  <div style={{ fontSize: 40, marginBottom: 8 }}>✅</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.green }}>Absensi tercatat!</div>
                  <button onClick={() => setScanStep('ready')} style={{ marginTop: 10, fontSize: 11, color: T.muted, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Absen lagi</button>
                </div>
              )}
            </Card>
          )}

          {/* Absence Buttons */}
          <Card>
            <SLabel>Tidak Masuk Hari Ini?</SLabel>
            {isWeekend && (
              <div style={{ background: T.amberLight, border: `.5px solid ${T.amberBd}`, borderRadius: 9, padding: '8px 12px', fontSize: 11, color: T.amber, marginBottom: 10, lineHeight: 1.5 }}>
                ⚠ Hari <strong>{dayName}</strong> — Day Off tidak tersedia. Tidak hadir = CTB otomatis.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
              {[
                { key: 'sakit',   icon: '💊', label: 'Sakit',   color: T.blue,   bg: T.blueLight,   bd: T.blueBd },
                { key: 'cuti',    icon: '📅', label: 'Cuti',    color: T.green,  bg: T.greenLight,  bd: T.greenBd },
                { key: 'day_off', icon: '🌴', label: 'Day Off', color: T.amber,  bg: T.amberLight,  bd: T.amberBd, disabled: isWeekend },
                { key: 'ctb',     icon: '📋', label: 'CTB',     color: T.purple, bg: T.purpleLight, bd: T.purpleBd },
              ].map(b => (
                <button key={b.key} onClick={() => !b.disabled && !todayRecord && setModal(b.key)}
                  style={{ padding: '12px', borderRadius: 10, border: `.5px solid ${(b.disabled||todayRecord) ? T.border : b.bd}`,
                    background: (b.disabled||todayRecord) ? T.grayLight : b.bg,
                    color: (b.disabled||todayRecord) ? T.muted : b.color,
                    cursor: (b.disabled||todayRecord) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', textAlign: 'left', opacity: b.disabled ? .5 : 1 }}>
                  <div style={{ fontSize: 18, marginBottom: 3 }}>{b.icon}</div>
                  <div style={{ fontSize: 11, fontWeight: 700 }}>{b.label}</div>
                  {b.disabled && <div style={{ fontSize: 9, opacity: .7 }}>Weekday only</div>}
                </button>
              ))}
            </div>
            {todayRecord && <div style={{ fontSize: 11, color: T.muted, textAlign: 'center', marginTop: 8 }}>Sudah ada catatan hari ini</div>}
          </Card>

          {/* Backdate */}
          <button onClick={() => { setBackdateModal(true); setBackdateErr(null) }}
            style={{ width: '100%', padding: '11px', background: 'transparent', border: `1.5px dashed ${T.border}`, borderRadius: 10, fontSize: 12, fontWeight: 600, color: T.muted, cursor: 'pointer', fontFamily: 'inherit' }}>
            📅 Lupa lapor sakit kemarin? Klik di sini
          </button>

          {/* History preview */}
          <Card>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <SLabel style={{ margin: 0 }}>3 Hari Terakhir</SLabel>
              <button onClick={() => setTab('history')} style={{ fontSize: 11, fontWeight: 600, color: T.orange, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}>Lihat semua →</button>
            </div>
            {history.slice(0, 3).map(h => {
              const st = statusConfig[h.status] || { color: T.gray, bg: T.grayLight, bd: T.grayBd, label: h.status }
              return (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `.5px solid ${T.border}` }}>
                  <div style={{ width: 3, height: 32, borderRadius: 2, background: st.color, flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: T.black }}>{new Date(h.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}</div>
                    {h.check_in && <div style={{ fontSize: 10, color: T.muted }}>{new Date(h.check_in).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})}{h.check_out ? ` – ${new Date(h.check_out).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})}` : ''}</div>}
                  </div>
                  <Pill color={st.color} bg={st.bg} bd={st.bd}>
                    {h.status === 'hadir' ? (h.is_late ? `+${h.late_minutes}m` : 'On time') : st.label}
                  </Pill>
                </div>
              )
            })}
          </Card>
        </>}

        {/* HISTORY TAB */}
        {tab === 'history' && history.map(h => {
          const st = statusConfig[h.status] || { color: T.gray, bg: T.grayLight, bd: T.grayBd, label: h.status }
          return (
            <Card key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
              <div style={{ width: 4, height: 40, borderRadius: 2, background: st.color, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.black }}>{new Date(h.date).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
                  {h.check_in ? `Masuk ${new Date(h.check_in).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})}` : '—'}
                  {h.check_out ? ` · Keluar ${new Date(h.check_out).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})}` : ''}
                </div>
              </div>
              <Pill color={st.color} bg={st.bg} bd={st.bd}>
                {h.status === 'ctb' && h.note === 'Otomatis — tidak ada catatan kehadiran' ? 'CTB (auto)' : st.label}
                {h.is_late ? ` +${h.late_minutes}m` : ''}
              </Pill>
            </Card>
          )
        })}

        {/* GAJI TAB */}
        {tab === 'gaji' && <>
          {slipLoading && <div style={{textAlign:'center',padding:'2rem',color:T.muted,fontSize:13}}>Memuat slip gaji...</div>}

          {!slipLoading && slipList.length === 0 && (
            <Card style={{textAlign:'center',padding:'2rem 1rem'}}>
              <div style={{fontSize:36,marginBottom:12}}>💰</div>
              <div style={{fontSize:14,fontWeight:700,color:T.black,marginBottom:6}}>Belum ada slip gaji</div>
              <div style={{fontSize:12,color:T.muted,lineHeight:1.5}}>Slip gaji akan muncul di sini setelah owner memproses pembayaran gajimu</div>
            </Card>
          )}

          {!slipLoading && slipList.map(slip => {
            const s = slip.snapshot || {}
            const bln = new Date(slip.bulan + '-01').toLocaleDateString('id-ID', {month:'long', year:'numeric'})
            const dibayarTgl = new Date(slip.dibayarkan_at).toLocaleDateString('id-ID', {day:'numeric', month:'short', year:'numeric'})
            return (
              <Card key={slip.id} onClick={() => setSlipDetail(slip)} style={{cursor:'pointer', marginBottom:0}}>
                <div style={{display:'flex', alignItems:'center', gap:12}}>
                  <div style={{width:42, height:42, borderRadius:12, background:T.greenLight, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0}}>🧾</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14, fontWeight:800, color:T.black}}>{bln}</div>
                    <div style={{fontSize:10, color:T.muted, marginTop:2}}>Dibayarkan {dibayarTgl}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:15, fontWeight:800, color:T.green}}>Rp {(slip.gaji_bersih||0).toLocaleString('id-ID')}</div>
                    <div style={{fontSize:9, padding:'2px 7px', background:T.greenLight, color:T.green, borderRadius:5, fontWeight:700, marginTop:3, display:'inline-block'}}>✅ Lunas</div>
                  </div>
                </div>
                <div style={{marginTop:10, paddingTop:10, borderTop:`.5px solid ${T.border}`, display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:4}}>
                  {[
                    ['Gaji Pokok', 'Rp '+(s.gaji_pokok||0).toLocaleString('id-ID')],
                    ['Bonus', (s.bonus_total||0)>0 ? '+Rp '+(s.bonus_total||0).toLocaleString('id-ID') : '—'],
                    ['Insentif', (s.insentif||0)>=0 ? '+Rp '+(s.insentif||0).toLocaleString('id-ID') : '-Rp '+Math.abs(s.insentif||0).toLocaleString('id-ID')],
                    ['Potongan', (s.total_potongan||0)>0 ? '-Rp '+(s.total_potongan||0).toLocaleString('id-ID') : '—'],
                  ].map(([lbl, val]) => (
                    <div key={lbl} style={{textAlign:'center'}}>
                      <div style={{fontSize:8, color:T.muted, textTransform:'uppercase', letterSpacing:'.04em'}}>{lbl}</div>
                      <div style={{fontSize:10, fontWeight:700, color:T.black, marginTop:2}}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{marginTop:8, textAlign:'center', fontSize:11, color:T.muted}}>Tap untuk lihat rincian lengkap →</div>
              </Card>
            )
          })}
        </>}

        {/* PROFILE TAB */}
        {tab === 'profile' && <>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0 12px' }}>
            <label style={{ cursor: 'pointer', position: 'relative' }}>
              <div style={{ width: 80, height: 80, borderRadius: '50%', background: T.border, border: `3px solid ${T.black}`, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, fontWeight: 800, color: T.muted }}>
                {user?.photo_url ? <img src={user.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : user?.name?.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}
              </div>
              <div style={{ position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, background: T.orange, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, border: `2px solid ${T.surface}` }}>📷</div>
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async e => {
                const file = e.target.files[0]; if (!file) return
                const path = `photos/${user.id}_${Date.now()}.${file.name.split('.').pop()}`
                const { data } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
                if (data) { const { data: u } = supabase.storage.from('documents').getPublicUrl(path); await supabase.from('employees').update({ photo_url: u.publicUrl }).eq('id', user.id); showToast('ok', 'Foto diperbarui!'); window.location.reload() }
              }} />
            </label>
            <div style={{ marginTop: 10, fontSize: 17, fontWeight: 800, color: T.black }}>{user?.name}</div>
            <div style={{ fontSize: 12, color: T.muted }}>{user?.role}</div>
          </div>

          <Card>
            <SLabel>Data Diri</SLabel>
            {[['Nama', user?.name], ['Jabatan', user?.role], ['Shift', user?.shift || '—'], ['Nomor HP', user?.phone]].map(([k,v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: `.5px solid ${T.border}` }}>
                <div style={{ fontSize: 12, color: T.muted }}>{k}</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: T.black }}>{v}</div>
              </div>
            ))}
          </Card>

          <Card style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: T.greenLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>📅</div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: T.muted, textTransform: 'uppercase', letterSpacing: '.08em' }}>Sisa Hak Cuti</div>
              <div style={{ fontSize: 26, fontWeight: 800, color: leaveBalance <= 3 ? T.red : T.green }}>{leaveBalance} <span style={{ fontSize: 13, fontWeight: 400, color: T.muted }}>hari</span></div>
            </div>
          </Card>

          <Card>
            <SLabel>Ganti PIN</SLabel>
            {[['PIN saat ini', pinOld, setPinOld], ['PIN baru (min. 4)', pin1, setPin1], ['Konfirmasi PIN baru', pin2, setPin2]].map(([lbl, val, setter]) => (
              <div key={lbl} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: T.muted, marginBottom: 4 }}>{lbl}</div>
                <input type="text" inputMode="numeric" maxLength={6} value={val} onChange={e => setter(e.target.value.replace(/[^0-9]/g,''))} placeholder="••••••"
                  style={{ ...inputSt, fontSize: 16, fontWeight: 700, letterSpacing: '.2em' }} />
              </div>
            ))}
            {pinMsg && <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600, marginBottom: 10, background: pinMsg.type==='ok' ? T.greenLight : T.redLight, color: pinMsg.type==='ok' ? T.green : T.red }}>{pinMsg.text}</div>}
            <button onClick={changePin} disabled={pinSaving || !pinOld || !pin1 || !pin2}
              style={{ width: '100%', padding: '12px', background: T.black, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: (pinSaving||!pinOld||!pin1||!pin2)?.5:1 }}>
              {pinSaving ? 'Menyimpan...' : 'Simpan PIN Baru'}
            </button>
          </Card>

          <button onClick={() => { stopCamera(); logout(); navigate('/login') }}
            style={{ width: '100%', padding: '12px', background: 'transparent', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, fontWeight: 600, color: T.muted, cursor: 'pointer', fontFamily: 'inherit' }}>
            Keluar dari akun
          </button>
        </>}
      </div>

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, background: T.surface, borderTop: `.5px solid ${T.border}`, display: 'flex', justifyContent: 'space-around', padding: '10px 0 16px', zIndex: 100 }}>
        {[['home','🏠','Beranda'],['history','📋','Riwayat'],['gaji','💰','Gaji'],['profile','👤','Profil']].map(([key,ico,lbl]) => (
          <button key={key} onClick={() => { setTab(key); if(key==='gaji') fetchSlipGaji() }}
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: tab===key ? T.black : T.muted, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, background: tab===key ? T.black : 'transparent' }}>
              <span style={{ filter: tab===key ? 'brightness(10)' : 'none' }}>{ico}</span>
            </div>
            {lbl}
          </button>
        ))}
      </div>

      {/* TOAST */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 80, left: 14, right: 14, padding: '12px 16px', borderRadius: 12, fontSize: 13, fontWeight: 700, textAlign: 'center', zIndex: 999,
          background: toast.type==='ok' ? T.black : T.red, color: '#fff', animation: 'fadeUp .3s ease' }}>
          {toast.msg}
        </div>
      )}

      {/* SLIP GAJI DETAIL MODAL */}
      {slipDetail && (() => {
        const s = slipDetail.snapshot || {}
        const tunj = Array.isArray(s.tunjangan) ? s.tunjangan : []
        const bons = Array.isArray(s.bonuses) ? s.bonuses : []
        const pots = Array.isArray(s.potongan_manual) ? s.potongan_manual : []
        const dibayarTgl = new Date(slipDetail.dibayarkan_at).toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'})
        const tglBayarModal = s.tgl_bayar
          ? new Date(s.tgl_bayar).toLocaleDateString('id-ID', {day:'numeric', month:'long', year:'numeric'})
          : dibayarTgl
        const metodeBayarModal = s.metode_bayar === 'cash' ? '💵 Tunai (Cash)' : '🏦 Transfer Bank'
        const rowSt = {display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:12}
        const secHd = {fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'.06em', marginBottom:6, paddingBottom:4, borderBottom:`.5px solid ${T.border}`}
        return (
          <div style={{position:'fixed', inset:0, background:'rgba(0,0,0,.55)', display:'flex', alignItems:'flex-end', zIndex:1001}}>
            <div style={{background:T.surface, borderRadius:'20px 20px 0 0', padding:'20px 18px 80px', width:'100%', maxHeight:'90vh', overflowY:'auto'}}>

              {/* Header modal */}
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16, paddingBottom:12, borderBottom:`.5px solid ${T.border}`}}>
                <div>
                  <div style={{fontSize:10, color:T.muted, textTransform:'uppercase', letterSpacing:'.06em'}}>Slip Gaji Resmi</div>
                  <div style={{fontSize:16, fontWeight:800, color:T.black}}>{s.label||s.bulan}</div>
                  <div style={{fontSize:11, color:T.muted}}>Piccolo Corner</div>
                </div>
                <button onClick={()=>setSlipDetail(null)} style={{width:32, height:32, borderRadius:'50%', background:T.bg, border:`.5px solid ${T.border}`, fontSize:16, cursor:'pointer'}}>×</button>
              </div>

              {/* Info karyawan */}
              <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:14, padding:'10px 12px', background:T.bg, borderRadius:10}}>
                {[['Nama',s.nama],['Jabatan',s.role],['Periode',s.label||s.bulan],['Hari Hadir',(s.hari_hadir||0)+' hari']].map(([k,v])=>(
                  <div key={k}><div style={{fontSize:9,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>{k}</div><div style={{fontSize:12,fontWeight:700,color:T.black,marginTop:2}}>{v}</div></div>
                ))}
              </div>

              {/* Pendapatan */}
              <div style={{background:T.greenLight, border:`.5px solid ${T.greenBd}`, borderRadius:12, padding:'12px 14px', marginBottom:10}}>
                <div style={{...secHd, color:T.green, borderBottomColor:T.greenBd}}>Pendapatan</div>
                <div style={rowSt}><span>Gaji Pokok</span><span>Rp {(s.gaji_pokok||0).toLocaleString('id-ID')}</span></div>
                {tunj.map((t,i)=><div key={i} style={rowSt}><span>Tunjangan {t.nama||'-'}</span><span>Rp {(parseInt(t.nominal)||0).toLocaleString('id-ID')}</span></div>)}
                {bons.map((b,i)=><div key={i} style={{...rowSt, color:T.blue}}><span>🎁 {b.nama||'Bonus'}{b.catatan?' ('+b.catatan+')':''}</span><span>+ Rp {(parseInt(b.nominal)||0).toLocaleString('id-ID')}</span></div>)}
                {(s.insentif||0)>0 && <div style={{...rowSt, color:T.green}}><span>Insentif Kehadiran</span><span>+ Rp {(s.insentif||0).toLocaleString('id-ID')}</span></div>}
                <div style={{...rowSt, fontWeight:700, borderTop:`.5px solid ${T.greenBd}`, marginTop:6, paddingTop:8}}><span>Total Pendapatan</span><span>Rp {(s.total_pendapatan||0).toLocaleString('id-ID')}</span></div>
              </div>

              {/* Potongan */}
              <div style={{background:T.redLight, border:`.5px solid ${T.redBd}`, borderRadius:12, padding:'12px 14px', marginBottom:10}}>
                <div style={{...secHd, color:T.red, borderBottomColor:T.redBd}}>Potongan</div>
                {(s.insentif||0)<0 && <div style={{...rowSt, color:T.red}}><span>Potongan Telat</span><span>- Rp {Math.abs(s.insentif||0).toLocaleString('id-ID')}</span></div>}
                {pots.map((p,i)=><div key={i} style={{...rowSt, color:T.red}}><span>{(p.tipe||'Potongan').charAt(0).toUpperCase()+(p.tipe||'').slice(1)}{p.catatan?' ('+p.catatan+')':''}</span><span>- Rp {(parseInt(p.nominal)||0).toLocaleString('id-ID')}</span></div>)}
                {(s.total_potongan||0)===0 && <div style={{...rowSt, color:T.muted, fontStyle:'italic'}}><span>Tidak ada potongan</span><span>—</span></div>}
                <div style={{...rowSt, fontWeight:700, borderTop:`.5px solid ${T.redBd}`, marginTop:6, paddingTop:8}}><span>Total Potongan</span><span>Rp {(s.total_potongan||0).toLocaleString('id-ID')}</span></div>
              </div>

              {/* Gaji Bersih */}
              <div style={{background:T.green, borderRadius:14, padding:'16px 18px', marginBottom:14, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <div>
                  <div style={{fontSize:10, color:'rgba(255,255,255,.75)', fontWeight:700, letterSpacing:'.06em'}}>GAJI BERSIH DITERIMA</div>
                  <div style={{fontSize:24, fontWeight:800, color:'#fff', marginTop:4}}>Rp {(slipDetail.gaji_bersih||0).toLocaleString('id-ID')}</div>
                  <div style={{fontSize:10, color:'rgba(255,255,255,.75)', marginTop:5}}>✅ {tglBayarModal}</div>
                  <div style={{fontSize:11, color:'rgba(255,255,255,.85)', fontWeight:700, marginTop:2}}>{metodeBayarModal}</div>
                </div>
              </div>

              {/* Buttons */}
              <div style={{display:'flex', gap:8}}>
                <button onClick={()=>setSlipDetail(null)} style={{flex:1, padding:12, background:T.bg, color:T.black, border:`.5px solid ${T.border}`, borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>Tutup</button>
                <button onClick={()=>printSlipKaryawan(slipDetail)} style={{flex:2, padding:12, background:T.black, color:'#fff', border:'none', borderRadius:10, fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>🖨 Simpan PDF</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* BACKDATE MODAL */}
      {backdateModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', zIndex: 1001 }}>
          <div style={{ background: T.surface, borderRadius: '20px 20px 0 0', padding: '20px', width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: T.blueLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🏥</div>
              <div><div style={{ fontSize: 15, fontWeight: 800, color: T.black }}>Lapor Sakit Kemarin</div><div style={{ fontSize: 11, color: T.muted }}>Backdate maks. {settings.doc_upload_deadline_days || 3} hari</div></div>
            </div>
            <div style={{ background: T.amberLight, borderRadius: 10, padding: '10px 14px', fontSize: 11, color: T.amber, marginBottom: 14, lineHeight: 1.6 }}>
              ⚠ Jika tanggal sudah tercatat sebagai <strong>CTB otomatis</strong>, akan diubah menjadi <strong>Sakit</strong>.
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 5 }}>Tanggal Sakit</div>
              <input type="date" value={backdateDate}
                max={(() => { const d = new Date(); d.setDate(d.getDate()-1); return d.toISOString().split('T')[0] })()}
                min={(() => { const d = new Date(); d.setDate(d.getDate()-(settings.doc_upload_deadline_days||3)); return d.toISOString().split('T')[0] })()}
                onChange={e => { setBackdateDate(e.target.value); setBackdateErr(null) }}
                style={{ ...inputSt, fontWeight: 700, fontSize: 14 }} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 5 }}>Keterangan</div>
              <textarea value={backdateNote} onChange={e => setBackdateNote(e.target.value)} rows={2} placeholder="Contoh: demam, flu..." style={{ ...inputSt, resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 5 }}>Upload Surat Dokter</div>
              <label style={{ display: 'block', border: `1.5px dashed ${backdateDoc ? T.green : T.border}`, borderRadius: 10, padding: '14px', textAlign: 'center', cursor: 'pointer', background: backdateDoc ? T.greenLight : T.bg }}>
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setBackdateDoc(e.target.files[0])} />
                {backdateDoc ? <div style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ {backdateDoc.name}</div> : <><div style={{ fontSize: 20 }}>📎</div><div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Tap untuk upload</div></>}
              </label>
            </div>
            {backdateErr && <div style={{ background: T.redLight, borderRadius: 9, padding: '10px 12px', fontSize: 12, color: T.red, fontWeight: 600, marginBottom: 12 }}>⚠ {backdateErr}</div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => { setBackdateModal(false); setBackdateDate(''); setBackdateNote(''); setBackdateDoc(null) }}
                style={{ padding: '12px', background: T.surface, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Batal</button>
              <button onClick={submitBackdate} disabled={submitting || !backdateDate}
                style={{ padding: '12px', background: !backdateDate ? T.border : T.black, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: (!backdateDate||submitting) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: submitting?.6:1 }}>
                {submitting ? 'Menyimpan...' : '✓ Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ABSENCE MODAL */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ background: T.surface, borderRadius: '20px 20px 0 0', padding: '20px', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: modal==='sakit'?T.blueLight:modal==='cuti'?T.greenLight:modal==='day_off'?T.amberLight:T.purpleLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                {modal==='sakit'?'💊':modal==='cuti'?'📅':modal==='day_off'?'🌴':'📋'}
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: T.black }}>Catat {modal==='sakit'?'Sakit':modal==='cuti'?'Cuti':modal==='day_off'?'Day Off':'CTB'}</div>
                <div style={{ fontSize: 11, color: T.muted }}>{user?.name} · {now.toLocaleDateString('id-ID',{weekday:'long',day:'numeric',month:'long'})}</div>
              </div>
            </div>
            {modal==='cuti' && <div style={{ background: T.greenLight, borderRadius: 10, padding: '10px 14px', marginBottom: 14, display: 'flex', justifyContent: 'space-between' }}><span style={{ fontSize: 12, color: T.green }}>Sisa hak cuti</span><span style={{ fontSize: 18, fontWeight: 800, color: T.green }}>{leaveBalance} hari</span></div>}
            {modal==='day_off' && <div style={{ background: T.amberLight, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 11, color: T.amber, lineHeight: 1.5 }}>🌴 Day Off mingguan — hanya Senin–Jumat, maks. 1x/minggu. Perlu persetujuan owner.</div>}
            {modal==='ctb' && <div style={{ background: T.purpleLight, borderRadius: 10, padding: '10px 14px', marginBottom: 14, fontSize: 11, color: T.purple, lineHeight: 1.5 }}>CTB digunakan saat saldo cuti habis. Tidak memotong saldo cuti.</div>}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 5 }}>Keterangan</div>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={modal==='sakit'?'Contoh: demam, flu...':'Jelaskan alasan...'} style={{ ...inputSt, resize: 'vertical' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: T.muted, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                Upload dokumen {modal==='sakit' && <span style={{ fontSize: 9, background: T.redLight, color: T.red, padding: '2px 7px', borderRadius: 20, fontWeight: 700 }}>WAJIB</span>}
                {modal !== 'sakit' && <span style={{ fontSize: 9, color: T.muted }}>(opsional)</span>}
              </div>
              <label style={{ display: 'block', border: `1.5px dashed ${docFile ? T.green : T.border}`, borderRadius: 10, padding: '14px', textAlign: 'center', cursor: 'pointer', background: docFile ? T.greenLight : T.bg }}>
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setDocFile(e.target.files[0])} />
                {docFile ? <div style={{ fontSize: 12, fontWeight: 700, color: T.green }}>✓ {docFile.name}</div> : <><div style={{ fontSize: 20 }}>📎</div><div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Tap untuk upload</div></>}
              </label>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => { setModal(null); setDocFile(null); setNote('') }} style={{ padding: '12px', background: T.surface, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Batal</button>
              <button onClick={() => submitLeave(modal)} disabled={submitting} style={{ padding: '12px', background: T.black, color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', opacity: submitting?.6:1 }}>
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
