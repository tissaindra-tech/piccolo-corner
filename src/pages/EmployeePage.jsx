import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabase.js'
import { getCurrentPosition, getDistanceMeters, formatDistance } from '../lib/gps.js'

const C = {
  esp: '#1C1208', lat: '#C4956A', crm: '#F5EFE6', foam: '#FBF7F2', mut: '#7A6A5A',
  ok: '#27500A', okBg: '#EAF3DE', okBd: '#97C459',
  dng: '#A32D2D', dngBg: '#FCEBEB', dngBd: '#F09595',
  inf: '#185FA5', infBg: '#E6F1FB', infBd: '#85B7EB',
  wrn: '#854F0B', wrnBg: '#FAEEDA', wrnBd: '#EF9F27',
  pur: '#3C3489', purBg: '#EEEDFE', purBd: '#AFA9EC',
}

function badge(status) {
  const map = {
    hadir: { bg: C.okBg, color: C.ok, label: 'Hadir' },
    sakit: { bg: C.infBg, color: C.inf, label: 'Sakit' },
    cuti: { bg: C.okBg, color: C.ok, label: 'Cuti' },
    ctb: { bg: C.purBg, color: C.pur, label: 'CTB' },
    day_off: { bg: C.wrnBg, color: C.wrn, label: 'Day Off' },
  }
  return map[status] || { bg: '#eee', color: '#888', label: status }
}

export default function EmployeePage() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  const [gpsState, setGpsState] = useState('idle')
  const [gpsInfo, setGpsInfo] = useState(null)
  const [settings, setSettings] = useState({ cafe_lat: -8.6786, cafe_lng: 115.2115, gps_radius_meters: 100, open_time: '10:00', close_time: '20:00', late_tolerance_minutes: 15 })
  const [todayRecord, setTodayRecord] = useState(null)
  const [history, setHistory] = useState([])
  const [modal, setModal] = useState(null)
  const [docFile, setDocFile] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [scanStep, setScanStep] = useState('gps')
  const [leaveBalance, setLeaveBalance] = useState(user?.leave_balance || 0)
  const [selfieData, setSelfieData] = useState(null)
  const [selfieConfirmed, setSelfieConfirmed] = useState(false)
  const [pendingAction, setPendingAction] = useState(null)

  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  useEffect(() => { fetchSettings(); fetchToday(); fetchHistory() }, [])

  async function fetchSettings() {
    const { data } = await supabase.from('work_settings').select('*').eq('id', 1).single()
    if (data) setSettings(data)
  }

  async function fetchToday() {
    const today = new Date().toISOString().split('T')[0]
    const { data } = await supabase.from('attendance').select('*').eq('employee_id', user.id).eq('date', today).single()
    setTodayRecord(data || null)
  }

  async function fetchHistory() {
    const { data } = await supabase.from('attendance').select('*').eq('employee_id', user.id).order('date', { ascending: false }).limit(7)
    setHistory(data || [])
    const { data: emp } = await supabase.from('employees').select('leave_balance').eq('id', user.id).single()
    if (emp) setLeaveBalance(emp.leave_balance)
  }

  async function checkGPS() {
    setGpsState('checking')
    setScanStep('gps')
    setSelfieData(null)
    setSelfieConfirmed(false)
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
        setScanStep('ready')
      }
    } catch (e) {
      setGpsState('blocked')
      setGpsInfo({ error: e.message })
    }
  }

  async function startCamera(action) {
    setPendingAction(action)
    setScanStep('selfie')
    setSelfieData(null)
    setSelfieConfirmed(false)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (e) {
      showToast('error', 'Izin kamera ditolak — aktifkan kamera di browser')
      setScanStep('ready')
    }
  }

  function takeSelfie() {
    if (!videoRef.current) return
    const canvas = canvasRef.current
    const video = videoRef.current
    canvas.width = video.videoWidth || 480
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    setSelfieData(dataUrl)
    stopCamera()
  }

  function retakeSelfie() {
    setSelfieData(null)
    setSelfieConfirmed(false)
    startCamera(pendingAction)
  }

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  async function uploadSelfie(dataUrl, prefix) {
    try {
      const blob = await fetch(dataUrl).then(r => r.blob())
      const path = `selfies/${user.id}/${prefix}_${Date.now()}.jpg`
      const { data } = await supabase.storage.from('documents').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
      if (data) {
        const { data: url } = supabase.storage.from('documents').getPublicUrl(path)
        return url.publicUrl
      }
    } catch (e) { return null }
    return null
  }

  async function confirmSelfieAndSubmit() {
    if (!selfieData) return
    setSelfieConfirmed(true)
    setSubmitting(true)

    const selfieUrl = await uploadSelfie(selfieData, pendingAction)
    const now = new Date()
    const today = now.toISOString().split('T')[0]

    if (pendingAction === 'checkin') {
      const [oh, om] = settings.open_time.split(':').map(Number)
      const openMs = oh * 60 + om
      const nowMs = now.getHours() * 60 + now.getMinutes()
      const isLate = nowMs > openMs + settings.late_tolerance_minutes
      const lateMinutes = isLate ? nowMs - openMs : 0
      const { error } = await supabase.from('attendance').upsert({
        employee_id: user.id, date: today,
        check_in: now.toISOString(), status: 'hadir',
        gps_lat_in: gpsInfo.lat, gps_lng_in: gpsInfo.lng, gps_dist_in: gpsInfo.dist,
        is_late: isLate, late_minutes: lateMinutes,
        doc_url: selfieUrl,
      }, { onConflict: 'employee_id,date' })
      setSubmitting(false)
      if (!error) { showToast('ok', isLate ? `✓ Check In — Terlambat ${lateMinutes} menit` : '✓ Check In berhasil tercatat'); fetchToday(); fetchHistory(); setScanStep('done') }
      else showToast('error', 'Gagal check in — coba lagi')

    } else if (pendingAction === 'checkout') {
      const { error } = await supabase.from('attendance').update({
        check_out: now.toISOString(),
        gps_lat_out: gpsInfo.lat, gps_lng_out: gpsInfo.lng, gps_dist_out: gpsInfo.dist,
        note: selfieUrl ? (todayRecord?.note || '') + `|selfie_out:${selfieUrl}` : todayRecord?.note,
      }).eq('id', todayRecord.id)
      setSubmitting(false)
      if (!error) { showToast('ok', '← Check Out berhasil tercatat'); fetchToday(); fetchHistory(); setScanStep('done') }
      else showToast('error', 'Gagal check out — coba lagi')
    }

    setSelfieData(null)
    setSelfieConfirmed(false)
    setPendingAction(null)
  }

  async function submitLeave(type) {
    setSubmitting(true)
    const today = new Date().toISOString().split('T')[0]
    let docUrl = null
    if (docFile) {
      const ext = docFile.name.split('.').pop()
      const path = `docs/${user.id}/${Date.now()}.${ext}`
      const { data: up } = await supabase.storage.from('documents').upload(path, docFile)
      if (up) { const { data: url } = supabase.storage.from('documents').getPublicUrl(path); docUrl = url.publicUrl }
    }
    if (type === 'cuti' || type === 'ctb') {
      await supabase.from('leave_requests').insert({ employee_id: user.id, type, date_start: today, date_end: today, days: 1, reason: note, status: 'pending' })
    }
    await supabase.from('attendance').upsert({
      employee_id: user.id, date: today, status: type,
      note, doc_url: docUrl, doc_status: docUrl ? 'pending' : null,
    }, { onConflict: 'employee_id,date' })
    if (type === 'cuti') await supabase.from('employees').update({ leave_balance: Math.max(0, leaveBalance - 1) }).eq('id', user.id)
    setSubmitting(false); setModal(null); setDocFile(null); setNote('')
    fetchToday(); fetchHistory()
    showToast('ok', `${type === 'sakit' ? 'Sakit' : type === 'cuti' ? 'Cuti' : 'CTB'} berhasil dicatat${docUrl ? ' + dokumen diupload' : ''}`)
  }

  function showToast(type, msg) { setToast({ type, msg }); setTimeout(() => setToast(null), 4000) }

  const now = new Date()
  const timeStr = now.toTimeString().slice(0, 5)
  const dateStr = now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const canCheckIn = gpsState === 'ok' && !todayRecord?.check_in
  const canCheckOut = gpsState === 'ok' && todayRecord?.check_in && !todayRecord?.check_out

  return (
    <div style={{ minHeight: '100vh', background: '#1C1208', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: C.esp, padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, background: C.lat, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>☕</div>
          <div>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: 13, color: C.crm }}>Piccolo Corner</div>
            <div style={{ fontSize: 9, color: C.lat, letterSpacing: '.07em', textTransform: 'uppercase' }}>Absensi Karyawan</div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 18, fontWeight: 500, color: C.crm }}>{timeStr}</div>
          <div style={{ fontSize: 9, color: C.lat }}>{dateStr}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {/* Employee info */}
        <div style={{ background: C.esp, borderRadius: 12, padding: '10px 14px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <label style={{ position: 'relative', cursor: 'pointer', flexShrink: 0 }}>
            <div style={{ width: 42, height: 42, borderRadius: '50%', background: C.lat, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, color: C.esp, overflow: 'hidden', border: `2px solid ${C.lat}` }}>
              {user?.photo_url
                ? <img src={user.photo_url} alt="profil" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
              }
            </div>
            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 16, height: 16, background: C.lat, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, border: `1.5px solid ${C.esp}` }}>📷</div>
            <input type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={async e => {
              const file = e.target.files[0]
              if (!file) return
              const path = `photos/${user.id}_${Date.now()}.${file.name.split('.').pop()}`
              const { data } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
              if (data) {
                const { data: url } = supabase.storage.from('documents').getPublicUrl(path)
                await supabase.from('employees').update({ photo_url: url.publicUrl }).eq('id', user.id)
                useAuthStore.getState().refreshUser()
              }
            }} />
          </label>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.crm }}>{user?.name}</div>
            <div style={{ fontSize: 10, color: C.lat }}>{user?.role}{user?.shift ? ` · Shift ${user.shift}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: C.lat, marginBottom: 2 }}>Sisa cuti</div>
            <div style={{ fontSize: 16, fontWeight: 500, color: leaveBalance <= 3 ? '#EF9F27' : C.okBd }}>{leaveBalance} hari</div>
          </div>
        </div>

        {/* Today status */}
        {todayRecord && (
          <div style={{ background: C.okBg, border: `.5px solid ${C.okBd}`, borderRadius: 10, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: C.ok, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Hari ini: <strong>{badge(todayRecord.status).label}</strong></span>
            <span>
              {todayRecord.check_in && `Masuk ${new Date(todayRecord.check_in).toTimeString().slice(0,5)}`}
              {todayRecord.check_out && ` · Keluar ${new Date(todayRecord.check_out).toTimeString().slice(0,5)}`}
            </span>
          </div>
        )}

        {/* GPS Bar */}
        <div style={{ borderRadius: 10, padding: '8px 12px', marginBottom: 10, border: '.5px solid', display: 'flex', alignItems: 'center', gap: 8,
          background: gpsState === 'ok' ? C.okBg : gpsState === 'blocked' ? C.dngBg : gpsState === 'checking' ? C.infBg : C.wrnBg,
          borderColor: gpsState === 'ok' ? C.okBd : gpsState === 'blocked' ? C.dngBd : gpsState === 'checking' ? C.infBd : C.wrnBd,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: gpsState === 'ok' ? C.okBd : gpsState === 'blocked' ? C.dngBd : gpsState === 'checking' ? C.infBd : C.wrnBd }} />
          <div style={{ flex: 1, fontSize: 11, fontWeight: 500, color: gpsState === 'ok' ? C.ok : gpsState === 'blocked' ? C.dng : gpsState === 'checking' ? C.inf : C.wrn }}>
            {gpsState === 'idle' && 'Belum cek lokasi'}
            {gpsState === 'checking' && 'Mendeteksi lokasi GPS...'}
            {gpsState === 'ok' && `✓ Lokasi valid — ${formatDistance(gpsInfo?.dist)} dari Piccolo Corner`}
            {gpsState === 'blocked' && (gpsInfo?.error || `Di luar radius — ${formatDistance(gpsInfo?.dist)} (batas ${settings.gps_radius_meters}m)`)}
          </div>
          {gpsState !== 'checking' && (
            <button onClick={checkGPS} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: '.5px solid', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500, background: 'transparent',
              color: gpsState === 'ok' ? C.ok : gpsState === 'blocked' ? C.dng : C.wrn,
              borderColor: gpsState === 'ok' ? C.okBd : gpsState === 'blocked' ? C.dngBd : C.wrnBd }}>
              {gpsState === 'idle' ? 'Cek GPS' : '↻ Ulang'}
            </button>
          )}
        </div>

        {/* GPS Blocked */}
        {gpsState === 'blocked' && (
          <div style={{ background: C.dngBg, border: `.5px solid ${C.dngBd}`, borderRadius: 12, padding: '16px', marginBottom: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📍</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.dng, marginBottom: 4 }}>Absensi tidak dapat dilakukan</div>
            <div style={{ fontSize: 11, color: C.dng, opacity: .8, lineHeight: 1.5 }}>Anda berada di luar area Piccolo Corner.</div>
          </div>
        )}

        {/* MAIN SCAN AREA */}
        {gpsState === 'ok' && (
          <div style={{ background: C.crm, border: `.5px solid #E0D4C3`, borderRadius: 12, padding: 14, marginBottom: 10 }}>

            {/* Step: Ready — choose action */}
            {scanStep === 'ready' && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 11, color: C.mut, textAlign: 'center', lineHeight: 1.5 }}>
                  📸 Selfie wajib untuk verifikasi kehadiran
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                  <button disabled={!canCheckIn} onClick={() => startCamera('checkin')}
                    style={{ padding: '10px', background: canCheckIn ? C.esp : '#ccc', color: canCheckIn ? C.crm : '#888', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: canCheckIn ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    📷 Check In
                  </button>
                  <button disabled={!canCheckOut} onClick={() => startCamera('checkout')}
                    style={{ padding: '10px', background: canCheckOut ? C.crm : '#f5f5f5', color: canCheckOut ? C.esp : '#aaa', border: `.5px solid ${canCheckOut ? '#C4A88A' : '#ddd'}`, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: canCheckOut ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    📷 Check Out
                  </button>
                </div>
                {!canCheckIn && !canCheckOut && todayRecord && (
                  <div style={{ fontSize: 11, color: C.ok, textAlign: 'center' }}>✓ Absensi hari ini sudah selesai</div>
                )}
              </div>
            )}

            {/* Step: Camera / Selfie capture */}
            {scanStep === 'selfie' && !selfieData && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ background: C.infBg, border: `.5px solid ${C.infBd}`, borderRadius: 8, padding: '6px 12px', fontSize: 11, color: C.inf, textAlign: 'center' }}>
                  {pendingAction === 'checkin' ? '📷 Ambil selfie untuk Check In' : '📷 Ambil selfie untuk Check Out'}
                </div>
                <div style={{ position: 'relative', width: '100%', maxWidth: 280, borderRadius: 12, overflow: 'hidden', border: `2px solid ${C.lat}`, aspectRatio: '1' }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                  {/* Face guide overlay */}
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                    <div style={{ width: '65%', aspectRatio: '3/4', border: '2px solid rgba(196,149,106,0.7)', borderRadius: '50%' }} />
                  </div>
                  <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: 'rgba(255,255,255,0.8)' }}>
                    Posisikan wajah di dalam lingkaran
                  </div>
                </div>
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button onClick={() => { stopCamera(); setScanStep('ready'); setPendingAction(null) }}
                    style={{ flex: 1, padding: '9px', background: C.crm, color: C.mut, border: `.5px solid #C4A88A`, borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Batal
                  </button>
                  <button onClick={takeSelfie}
                    style={{ flex: 2, padding: '9px', background: C.esp, color: C.crm, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                    📸 Ambil Foto
                  </button>
                </div>
              </div>
            )}

            {/* Step: Selfie preview — confirm or retake */}
            {scanStep === 'selfie' && selfieData && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.cof }}>Pastikan wajah terlihat jelas</div>
                <div style={{ position: 'relative', width: '100%', maxWidth: 280, borderRadius: 12, overflow: 'hidden', border: `2px solid ${C.okBd}`, aspectRatio: '1' }}>
                  <img src={selfieData} alt="selfie" style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
                  <div style={{ position: 'absolute', top: 8, right: 8, background: C.okBg, color: C.ok, fontSize: 10, padding: '3px 8px', borderRadius: 20, fontWeight: 500 }}>
                    ✓ Foto diambil
                  </div>
                </div>
                <div style={{ background: C.wrnBg, border: `.5px solid ${C.wrnBd}`, borderRadius: 8, padding: '7px 12px', fontSize: 11, color: C.wrn, textAlign: 'center', width: '100%' }}>
                  ⚠ Foto ini akan dilihat oleh Owner sebagai bukti kehadiran Anda
                </div>
                <div style={{ display: 'flex', gap: 8, width: '100%' }}>
                  <button onClick={retakeSelfie} disabled={submitting}
                    style={{ flex: 1, padding: '9px', background: C.crm, color: C.mut, border: `.5px solid #C4A88A`, borderRadius: 8, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    🔄 Foto Ulang
                  </button>
                  <button onClick={confirmSelfieAndSubmit} disabled={submitting}
                    style={{ flex: 2, padding: '9px', background: C.esp, color: C.crm, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: submitting ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: submitting ? .6 : 1 }}>
                    {submitting ? 'Menyimpan...' : pendingAction === 'checkin' ? '✓ Konfirmasi Check In' : '✓ Konfirmasi Check Out'}
                  </button>
                </div>
              </div>
            )}

            {/* Step: Done */}
            {scanStep === 'done' && (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.ok }}>Absensi tercatat!</div>
                <div style={{ fontSize: 11, color: C.mut, marginTop: 4 }}>Selfie tersimpan sebagai bukti kehadiran</div>
                <button onClick={() => setScanStep('ready')} style={{ marginTop: 10, fontSize: 11, color: C.mut, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>
                  Absen lagi
                </button>
              </div>
            )}
          </div>
        )}

        {/* Status buttons — always available (no GPS needed) */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.08em', color: C.mut, marginBottom: 6 }}>Catat ketidakhadiran (dari mana saja)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 7 }}>
            {[
              { key: 'sakit', label: '+ Sakit', bg: C.infBg, color: C.inf, bd: C.infBd },
              { key: 'cuti', label: '◎ Cuti', bg: C.okBg, color: C.ok, bd: C.okBd },
              { key: 'ctb', label: '◈ CTB', bg: C.purBg, color: C.pur, bd: C.purBd },
            ].map(b => (
              <button key={b.key} onClick={() => setModal(b.key)} disabled={!!todayRecord}
                style={{ padding: '9px 6px', borderRadius: 9, border: `.5px solid ${b.bd}`, fontSize: 11, fontWeight: 500,
                  background: todayRecord ? '#f5f5f5' : b.bg, color: todayRecord ? '#aaa' : b.color,
                  cursor: todayRecord ? 'not-allowed' : 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>
                {b.label}
              </button>
            ))}
          </div>
          {todayRecord && <div style={{ fontSize: 10, color: C.mut, marginTop: 5, textAlign: 'center' }}>Sudah ada catatan kehadiran hari ini</div>}
        </div>

        {/* History */}
        <div style={{ background: C.foam, border: '.5px solid #E0D4C3', borderRadius: 12, padding: '10px 12px' }}>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.08em', color: C.mut, marginBottom: 8 }}>Riwayat 7 hari terakhir</div>
          {history.length === 0 && <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '10px 0' }}>Belum ada riwayat</div>}
          {history.map(h => {
            const b = badge(h.status)
            return (
              <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '.5px solid #F0E8DC' }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: b.color, flexShrink: 0 }} />
                <div style={{ flex: 1, fontSize: 11, color: C.cof }}>
                  {new Date(h.date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}
                </div>
                {h.check_in && <div style={{ fontSize: 10, color: C.mut }}>{new Date(h.check_in).toTimeString().slice(0,5)}</div>}
                <span style={{ fontSize: 9, padding: '2px 8px', borderRadius: 20, background: b.bg, color: b.color }}>{b.label}{h.is_late ? ` +${h.late_minutes}m` : ''}</span>
              </div>
            )
          })}
        </div>

        <button onClick={() => { stopCamera(); logout(); navigate('/login') }}
          style={{ width: '100%', marginTop: 12, padding: '10px', background: 'transparent', border: `.5px solid #C4A88A`, borderRadius: 9, fontSize: 12, color: C.mut, cursor: 'pointer', fontFamily: 'inherit' }}>
          Keluar
        </button>
      </div>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', width: 'calc(100% - 2rem)', maxWidth: 380,
          background: toast.type === 'ok' ? C.okBg : C.dngBg, border: `.5px solid ${toast.type === 'ok' ? C.okBd : C.dngBd}`,
          borderRadius: 10, padding: '10px 14px', fontSize: 12, color: toast.type === 'ok' ? C.ok : C.dng, zIndex: 999, textAlign: 'center' }}>
          {toast.msg}
        </div>
      )}

      {/* Modal: Sakit / Cuti / CTB */}
      {modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,18,8,.6)', display: 'flex', alignItems: 'flex-end', zIndex: 1000 }}>
          <div style={{ background: C.foam, borderRadius: '20px 20px 0 0', padding: '1.5rem', width: '100%', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: modal === 'sakit' ? C.infBg : modal === 'cuti' ? C.okBg : C.purBg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>
                {modal === 'sakit' ? '🏥' : modal === 'cuti' ? '📅' : '📋'}
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 500, color: C.esp, fontFamily: 'Georgia,serif' }}>
                  Catat {modal === 'sakit' ? 'Sakit' : modal === 'cuti' ? 'Cuti' : 'Cuti Tidak Berbayar'}
                </div>
                <div style={{ fontSize: 11, color: C.mut }}>{user?.name} · {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
              </div>
            </div>

            {modal === 'cuti' && (
              <div style={{ background: C.okBg, border: `.5px solid ${C.okBd}`, borderRadius: 9, padding: '8px 12px', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: C.ok }}>Sisa hak cuti</span>
                <span style={{ fontSize: 18, fontWeight: 500, color: C.ok, fontFamily: 'Georgia,serif' }}>{leaveBalance} hari</span>
              </div>
            )}

            {modal === 'ctb' && (
              <div style={{ background: C.purBg, border: `.5px solid ${C.purBd}`, borderRadius: 9, padding: '8px 12px', marginBottom: '1rem', fontSize: 11, color: C.pur, lineHeight: 1.5 }}>
                Cuti Tidak Berbayar digunakan saat saldo cuti habis. Tidak memotong saldo cuti.
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.mut, marginBottom: 5, display: 'block' }}>Keterangan</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                placeholder={modal === 'sakit' ? 'Contoh: demam, flu...' : 'Jelaskan alasan...'}
                style={{ width: '100%', padding: '9px 12px', border: '.5px solid #C4A88A', borderRadius: 9, fontSize: 13, background: C.crm, color: C.esp, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.mut, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                {modal === 'sakit' ? 'Upload surat dokter / resep obat' : 'Upload surat (opsional)'}
                {modal === 'sakit' && <span style={{ fontSize: 9, background: C.dngBg, color: C.dng, padding: '2px 7px', borderRadius: 20, fontWeight: 500 }}>WAJIB</span>}
              </label>
              <label style={{ display: 'block', border: `1.5px dashed ${docFile ? C.okBd : '#C4A88A'}`, borderRadius: 10, padding: '14px', textAlign: 'center', cursor: 'pointer', background: docFile ? C.okBg : C.crm }}>
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setDocFile(e.target.files[0])} />
                {docFile ? <div style={{ fontSize: 12, color: C.ok }}>✓ {docFile.name}</div> : (
                  <><div style={{ fontSize: 20, marginBottom: 4 }}>📎</div>
                  <div style={{ fontSize: 12, color: C.mut }}>Klik untuk upload foto / PDF</div></>
                )}
              </label>
            </div>

            {modal === 'sakit' && (
              <div style={{ background: C.infBg, border: `.5px solid ${C.infBd}`, borderRadius: 8, padding: '8px 12px', fontSize: 11, color: C.inf, marginBottom: '1rem', lineHeight: 1.5 }}>
                Dokumen bisa menyusul maksimal 3 hari kerja.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => { setModal(null); setDocFile(null); setNote('') }}
                style={{ padding: '11px', background: C.crm, color: C.mut, border: '.5px solid #C4A88A', borderRadius: 9, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Batal
              </button>
              <button onClick={() => submitLeave(modal)} disabled={submitting}
                style={{ padding: '11px', background: C.esp, color: C.crm, border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                {submitting ? 'Menyimpan...' : 'Simpan'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
