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

  const [gpsState, setGpsState] = useState('idle') // idle|checking|ok|blocked
  const [gpsInfo, setGpsInfo] = useState(null)
  const [settings, setSettings] = useState({ cafe_lat: -8.6786, cafe_lng: 115.2115, gps_radius_meters: 100, open_time: '10:00', close_time: '20:00', late_tolerance_minutes: 15 })
  const [todayRecord, setTodayRecord] = useState(null)
  const [history, setHistory] = useState([])
  const [modal, setModal] = useState(null) // null | 'sakit' | 'cuti' | 'ctb'
  const [docFile, setDocFile] = useState(null)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState(null)
  const [scanStep, setScanStep] = useState('gps') // gps|ready|scanning|done
  const [leaveBalance, setLeaveBalance] = useState(user?.leave_balance || 0)
  const videoRef = useRef(null)
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

  async function startCamera() {
    setScanStep('scanning')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) videoRef.current.srcObject = stream
    } catch (e) {
      showToast('error', 'Izin kamera ditolak — aktifkan kamera di browser')
      setScanStep('ready')
    }
  }

  function stopCamera() {
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null }
  }

  async function doCheckIn() {
    if (!gpsInfo?.valid) return
    setSubmitting(true)
    stopCamera()
    const now = new Date()
    const [oh, om] = settings.open_time.split(':').map(Number)
    const openMs = oh * 60 + om
    const nowMs = now.getHours() * 60 + now.getMinutes()
    const isLate = nowMs > openMs + settings.late_tolerance_minutes
    const lateMinutes = isLate ? nowMs - openMs : 0
    const today = now.toISOString().split('T')[0]
    const { error } = await supabase.from('attendance').upsert({
      employee_id: user.id, date: today,
      check_in: now.toISOString(), status: 'hadir',
      gps_lat_in: gpsInfo.lat, gps_lng_in: gpsInfo.lng, gps_dist_in: gpsInfo.dist,
      is_late: isLate, late_minutes: lateMinutes,
    }, { onConflict: 'employee_id,date' })
    setSubmitting(false)
    if (!error) { showToast('ok', isLate ? `Check In berhasil — Terlambat ${lateMinutes} menit` : '✓ Check In berhasil'); fetchToday(); fetchHistory(); setScanStep('done') }
    else showToast('error', 'Gagal check in — coba lagi')
  }

  async function doCheckOut() {
    if (!gpsInfo?.valid || !todayRecord) return
    setSubmitting(true)
    stopCamera()
    const { error } = await supabase.from('attendance').update({
      check_out: new Date().toISOString(),
      gps_lat_out: gpsInfo.lat, gps_lng_out: gpsInfo.lng, gps_dist_out: gpsInfo.dist,
    }).eq('id', todayRecord.id)
    setSubmitting(false)
    if (!error) { showToast('ok', '← Check Out berhasil tercatat'); fetchToday(); fetchHistory(); setScanStep('done') }
    else showToast('error', 'Gagal check out — coba lagi')
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

  function showToast(type, msg) {
    setToast({ type, msg })
    setTimeout(() => setToast(null), 4000)
  }

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
          <div style={{ width: 38, height: 38, borderRadius: '50%', background: C.lat, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 500, color: C.esp, flexShrink: 0 }}>
            {user?.name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.crm }}>{user?.name}</div>
            <div style={{ fontSize: 10, color: C.lat }}>{user?.role} {user?.shift ? `· Shift ${user.shift}` : ''}</div>
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

        {/* GPS Status Bar */}
        <div style={{ borderRadius: 10, padding: '8px 12px', marginBottom: 10, border: '.5px solid', display: 'flex', alignItems: 'center', gap: 8,
          background: gpsState === 'ok' ? C.okBg : gpsState === 'blocked' ? C.dngBg : gpsState === 'checking' ? C.infBg : C.wrnBg,
          borderColor: gpsState === 'ok' ? C.okBd : gpsState === 'blocked' ? C.dngBd : gpsState === 'checking' ? C.infBd : C.wrnBd,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: gpsState === 'ok' ? C.okBd : gpsState === 'blocked' ? C.dngBd : gpsState === 'checking' ? C.infBd : C.wrnBd }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: gpsState === 'ok' ? C.ok : gpsState === 'blocked' ? C.dng : gpsState === 'checking' ? C.inf : C.wrn }}>
              {gpsState === 'idle' && 'Belum cek lokasi'}
              {gpsState === 'checking' && 'Mendeteksi lokasi GPS...'}
              {gpsState === 'ok' && `✓ Lokasi valid — ${formatDistance(gpsInfo?.dist)} dari Piccolo Corner`}
              {gpsState === 'blocked' && (gpsInfo?.error || `Di luar radius — ${formatDistance(gpsInfo?.dist)} dari cafe (batas ${settings.gps_radius_meters} m)`)}
            </div>
          </div>
          {gpsState !== 'checking' && (
            <button onClick={checkGPS} style={{ fontSize: 10, padding: '3px 10px', borderRadius: 6, border: `.5px solid`, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500,
              background: 'transparent', color: gpsState === 'ok' ? C.ok : gpsState === 'blocked' ? C.dng : C.wrn,
              borderColor: gpsState === 'ok' ? C.okBd : gpsState === 'blocked' ? C.dngBd : C.wrnBd,
            }}>
              {gpsState === 'idle' ? 'Cek GPS' : '↻ Ulang'}
            </button>
          )}
        </div>

        {/* Camera / Scan Area */}
        {gpsState === 'ok' && (
          <div style={{ background: C.crm, border: `.5px solid #E0D4C3`, borderRadius: 12, padding: 14, marginBottom: 10, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
            {scanStep === 'ready' && (
              <>
                <div style={{ width: 90, height: 90, borderRadius: '50%', border: `2px solid ${C.lat}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36 }}>🧑</div>
                <div style={{ fontSize: 11, color: C.mut, textAlign: 'center' }}>Klik kamera untuk verifikasi wajah</div>
                <button onClick={startCamera} style={{ padding: '8px 20px', background: C.esp, color: C.crm, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                  Aktifkan Kamera
                </button>
              </>
            )}
            {scanStep === 'scanning' && (
              <>
                <div style={{ position: 'relative', width: 180, height: 135, borderRadius: 10, overflow: 'hidden', border: `2px solid ${C.lat}` }}>
                  <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <div style={{ position: 'absolute', inset: 0, border: `2px solid ${C.lat}`, borderRadius: 10, pointerEvents: 'none' }} />
                </div>
                <div style={{ fontSize: 11, color: C.mut }}>Hadapkan wajah ke kamera</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, width: '100%' }}>
                  <button disabled={!canCheckIn || submitting} onClick={doCheckIn}
                    style={{ padding: '9px', background: canCheckIn ? C.esp : '#ccc', color: canCheckIn ? C.crm : '#888', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: canCheckIn ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    {submitting ? '...' : '✓ Check In'}
                  </button>
                  <button disabled={!canCheckOut || submitting} onClick={doCheckOut}
                    style={{ padding: '9px', background: canCheckOut ? C.crm : '#f5f5f5', color: canCheckOut ? C.esp : '#aaa', border: `.5px solid ${canCheckOut ? '#C4A88A' : '#ddd'}`, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: canCheckOut ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                    {submitting ? '...' : '← Check Out'}
                  </button>
                </div>
              </>
            )}
            {scanStep === 'done' && (
              <div style={{ textAlign: 'center', padding: '1rem 0' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: C.ok }}>Absensi tercatat!</div>
                <button onClick={() => setScanStep('ready')} style={{ marginTop: 10, fontSize: 11, color: C.mut, background: 'transparent', border: 'none', cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' }}>Absen lagi</button>
              </div>
            )}
          </div>
        )}

        {/* Blocked overlay */}
        {gpsState === 'blocked' && (
          <div style={{ background: C.dngBg, border: `.5px solid ${C.dngBd}`, borderRadius: 12, padding: '16px', marginBottom: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>📍</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.dng, marginBottom: 4 }}>Absensi tidak dapat dilakukan</div>
            <div style={{ fontSize: 11, color: C.dng, opacity: .8, lineHeight: 1.5 }}>Anda berada di luar area Piccolo Corner. Harap datang ke lokasi cafe untuk absen.</div>
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
                style={{ padding: '9px 6px', borderRadius: 9, border: `.5px solid ${b.bd}`, fontSize: 11, fontWeight: 500, background: todayRecord ? '#f5f5f5' : b.bg, color: todayRecord ? '#aaa' : b.color, cursor: todayRecord ? 'not-allowed' : 'pointer', fontFamily: 'inherit', textAlign: 'center' }}>
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

        {/* Logout */}
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
                Cuti Tidak Berbayar digunakan saat saldo cuti habis. Hari CTB tidak dibayar dan tidak memotong saldo cuti.
              </div>
            )}

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.mut, marginBottom: 5, display: 'block' }}>Keterangan</label>
              <textarea value={note} onChange={e => setNote(e.target.value)} rows={3} placeholder={modal === 'sakit' ? 'Contoh: demam, flu, sakit kepala...' : 'Jelaskan alasan...'}
                style={{ width: '100%', padding: '9px 12px', border: '.5px solid #C4A88A', borderRadius: 9, fontSize: 13, background: C.crm, color: C.esp, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: 12, fontWeight: 500, color: C.mut, marginBottom: 5, display: 'flex', alignItems: 'center', gap: 6 }}>
                {modal === 'sakit' ? 'Upload surat dokter / resep obat' : 'Upload surat (opsional)'}
                {modal === 'sakit' && <span style={{ fontSize: 9, background: C.dngBg, color: C.dng, padding: '2px 7px', borderRadius: 20, fontWeight: 500 }}>WAJIB</span>}
              </label>
              <label style={{ display: 'block', border: `1.5px dashed ${docFile ? C.okBd : '#C4A88A'}`, borderRadius: 10, padding: '14px', textAlign: 'center', cursor: 'pointer', background: docFile ? C.okBg : C.crm }}>
                <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => setDocFile(e.target.files[0])} />
                {docFile ? (
                  <div style={{ fontSize: 12, color: C.ok }}>✓ {docFile.name}</div>
                ) : (
                  <>
                    <div style={{ fontSize: 20, marginBottom: 4 }}>📎</div>
                    <div style={{ fontSize: 12, color: C.mut }}>Klik untuk upload foto / PDF</div>
                    <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>JPG, PNG, PDF · maks. 5 MB</div>
                  </>
                )}
              </label>
            </div>

            {modal === 'sakit' && (
              <div style={{ background: C.infBg, border: `.5px solid ${C.infBd}`, borderRadius: 8, padding: '8px 12px', fontSize: 11, color: C.inf, marginBottom: '1rem', lineHeight: 1.5 }}>
                Dokumen bisa dikirim menyusul maksimal 3 hari kerja. Tanpa dokumen, status akan terkunci sebagai CTB.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button onClick={() => { setModal(null); setDocFile(null); setNote('') }}
                style={{ padding: '11px', background: C.crm, color: C.mut, border: '.5px solid #C4A88A', borderRadius: 9, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
                Batal
              </button>
              <button onClick={() => submitLeave(modal)}
                disabled={(modal === 'sakit' && !docFile && false) || submitting}
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
