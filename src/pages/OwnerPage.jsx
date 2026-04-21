import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabase.js'
import * as XLSX from 'xlsx'

const T = {
  black: '#0D0D0D', white: '#FAFAF8', cream: '#F5F0E8',
  coral: '#E8674A', coralLight: '#FAE8E3',
  green: '#2D7A4F', greenLight: '#E0F0E8',
  amber: '#F0A500', amberLight: '#FDF3D9',
  purple: '#5B4FCF', purpleLight: '#ECEAFC',
  sage: '#7C9E8A', sageLight: '#D4E4DA',
  border: '#E8E4DC', surface: '#FFFFFF', muted: '#888',
  dng: '#C0392B', dngBg: '#FEE8E3',
  bg: '#F0EBE3',
}

function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })
}
function fmtDuration(inIso, outIso) {
  if (!inIso || !outIso) return null
  const diff = Math.round((new Date(outIso) - new Date(inIso)) / 60000)
  const h = Math.floor(diff / 60), m = diff % 60
  return h > 0 ? `${h}j ${m}m` : `${m}m`
}
function getSelfieOut(note) {
  if (!note) return null
  const match = note.match(/selfie_out:([^\|]+)/)
  return match ? match[1] : null
}

const statusMap = {
  hadir: { color: T.green, bg: T.greenLight, label: 'Hadir' },
  sakit: { color: T.purple, bg: T.purpleLight, label: 'Sakit' },
  cuti:  { color: T.green, bg: T.greenLight, label: 'Cuti' },
  ctb:   { color: '#8B5CF6', bg: '#F3EFFE', label: 'CTB' },
  day_off: { color: T.amber, bg: T.amberLight, label: 'Day Off' },
}

function StatusBadge({ status }) {
  const s = statusMap[status] || { color: T.muted, bg: '#eee', label: status }
  return <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 20, background: s.bg, color: s.color }}>{s.label}</span>
}

// ─── REQUEST NOTIFICATION PERMISSION ─────────────────────────────────────────
async function requestNotifPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function sendNotif(title, body, icon = '☕') {
  if (Notification.permission !== 'granted') return
  new Notification(`${icon} ${title}`, { body, icon: '/manifest.json' })
}

// ─── LOG TAB ─────────────────────────────────────────────────────────────────
function LogTab({ today }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewDate, setViewDate] = useState(today)
  const [lightbox, setLightbox] = useState(null)
  const prevCountRef = useRef(0)

  useEffect(() => { fetchLogs(viewDate) }, [viewDate])

  useEffect(() => {
    const channel = supabase.channel('attendance-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'attendance' }, async payload => {
        const { data: emp } = await supabase.from('employees').select('name,role').eq('id', payload.new.employee_id).single()
        sendNotif('Karyawan Check In', `${emp?.name || 'Karyawan'} baru saja absen masuk`, '✅')
        fetchLogs(viewDate)
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'attendance' }, payload => {
        if (payload.new.check_out && !payload.old.check_out) {
          sendNotif('Karyawan Check Out', 'Ada karyawan yang check out', '👋')
        }
        fetchLogs(viewDate)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [viewDate])

  useEffect(() => {
    const channel = supabase.channel('gps-fraud')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'gps_fraud_log' }, async payload => {
        const { data: emp } = await supabase.from('employees').select('name').eq('id', payload.new.employee_id).single()
        sendNotif('⚠ GPS Fraud', `${emp?.name || 'Karyawan'} coba absen dari luar area (${payload.new.distance_m}m)`, '🚨')
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  async function fetchLogs(date) {
    setLoading(true); setError(null)
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('*, employees!employee_id(name, role, photo_url)')
        .eq('date', date)
        .order('check_in', { ascending: false, nullsFirst: false })
      if (error) throw error
      setLogs(data || [])
      const newHadir = (data || []).filter(l => l.status === 'hadir').length
      if (newHadir > prevCountRef.current && prevCountRef.current > 0) {
        sendNotif('Update Kehadiran', `${newHadir} karyawan sudah hadir hari ini`)
      }
      prevCountRef.current = newHadir
    } catch(e) { setError(e.message) }
    setLoading(false)
  }

  const stats = { hadir: 0, sakit: 0, cuti: 0, day_off: 0, ctb: 0 }
  logs.forEach(l => { if (stats[l.status] !== undefined) stats[l.status]++ })

  return (
    <div style={{ padding: '0 0 80px' }}>
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.92)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
          <img src={lightbox} alt="" style={{ maxWidth: '92vw', maxHeight: '82vh', borderRadius: 16, objectFit: 'contain' }} />
          <div style={{ color: '#fff', fontSize: 12, opacity: .6 }}>Tap untuk tutup</div>
        </div>
      )}

      {/* Stat row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, padding: '14px 14px 0' }}>
        {[['Hadir', stats.hadir, T.green], ['Sakit', stats.sakit, T.purple], ['Cuti', stats.cuti, '#27964A'], ['Day Off', stats.day_off, T.amber], ['CTB', stats.ctb, '#8B5CF6']].map(([l,v,c]) => (
          <div key={l} style={{ background: T.surface, borderRadius: 14, padding: '10px 6px', border: `.5px solid ${T.border}`, textAlign: 'center' }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: T.muted, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c }}>{v}</div>
          </div>
        ))}
      </div>

      {/* Date filter + refresh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 0' }}>
        <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: T.muted }}>Log Absensi</div>
        <input type="date" value={viewDate} onChange={e => setViewDate(e.target.value)}
          style={{ fontSize: 12, padding: '5px 10px', border: `.5px solid ${T.border}`, borderRadius: 8, background: T.cream, color: T.black, fontFamily: 'inherit', fontWeight: 600 }} />
        <button onClick={() => fetchLogs(viewDate)} style={{ marginLeft: 'auto', fontSize: 11, padding: '6px 14px', borderRadius: 8, border: `.5px solid ${T.border}`, background: T.surface, color: T.muted, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>↻ Refresh</button>
      </div>

      {/* Log list */}
      <div style={{ padding: '10px 14px 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && <div style={{ textAlign: 'center', padding: '2rem', fontSize: 13, color: T.muted }}>Memuat data...</div>}
        {!loading && error && <div style={{ background: T.dngBg, borderRadius: 12, padding: '12px', fontSize: 12, color: T.dng }}>⚠ {error}</div>}
        {!loading && !error && logs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem 1rem', background: T.surface, borderRadius: 16, border: `.5px solid ${T.border}` }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.black, marginBottom: 4 }}>Tidak ada data</div>
            <div style={{ fontSize: 12, color: T.muted }}>Belum ada absensi untuk {viewDate}</div>
          </div>
        )}

        {!loading && logs.map(l => {
          const selfieIn = l.doc_url && l.doc_url.includes('selfie') ? l.doc_url : null
          const selfieOut = getSelfieOut(l.note)
          const dur = fmtDuration(l.check_in, l.check_out)
          const st = statusMap[l.status] || { color: T.muted, bg: '#eee', label: l.status }

          return (
            <div key={l.id} style={{ background: T.surface, borderRadius: 18, border: `.5px solid ${T.border}`, overflow: 'hidden' }}>
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px 10px', borderBottom: `.5px solid ${T.border}` }}>
                <div style={{ width: 38, height: 38, borderRadius: '50%', background: T.sage, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: T.white, flexShrink: 0, overflow: 'hidden', border: `2px solid ${T.border}` }}>
                  {l.employees?.photo_url
                    ? <img src={l.employees.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : l.employees?.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.black }}>{l.employees?.name}</div>
                  <div style={{ fontSize: 10, color: T.muted, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {l.employees?.role}
                    {l.is_late && <span style={{ background: T.amberLight, color: '#8B5800', fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20 }}>+{l.late_minutes}m terlambat</span>}
                    {l.status === 'ctb' && l.note === 'Otomatis — tidak ada catatan kehadiran' && <span style={{ background: T.dngBg, color: T.dng, fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 20 }}>auto</span>}
                  </div>
                </div>
                <StatusBadge status={l.status} />
              </div>

              {/* Detail row */}
              {l.status === 'hadir' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0 }}>
                  <div style={{ padding: '10px 14px', borderRight: `.5px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: T.muted, marginBottom: 4 }}>Clock In</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: T.black }}>{fmtTime(l.check_in)}</div>
                    {l.gps_dist_in != null && <div style={{ fontSize: 9, color: T.green, marginTop: 2 }}>📍 {l.gps_dist_in}m</div>}
                  </div>
                  <div style={{ padding: '10px 14px', borderRight: `.5px solid ${T.border}` }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: T.muted, marginBottom: 4 }}>Clock Out</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: l.check_out ? T.black : '#CCC' }}>{fmtTime(l.check_out)}</div>
                    {l.gps_dist_out != null && <div style={{ fontSize: 9, color: T.green, marginTop: 2 }}>📍 {l.gps_dist_out}m</div>}
                  </div>
                  <div style={{ padding: '10px 14px' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.07em', color: T.muted, marginBottom: 4 }}>Durasi</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: dur ? T.purple : '#CCC' }}>{dur || '—'}</div>
                    <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>kerja</div>
                  </div>
                </div>
              )}

              {/* Selfie row */}
              {(selfieIn || selfieOut) && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: `.5px solid ${T.border}`, background: T.cream }}>
                  {selfieIn && (
                    <div onClick={() => setLightbox(selfieIn)} style={{ cursor: 'pointer' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: T.muted, marginBottom: 4 }}>Selfie Masuk</div>
                      <img src={selfieIn} alt="in" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: `.5px solid ${T.border}` }} />
                    </div>
                  )}
                  {selfieOut && (
                    <div onClick={() => setLightbox(selfieOut)} style={{ cursor: 'pointer' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: T.muted, marginBottom: 4 }}>Selfie Keluar</div>
                      <img src={selfieOut} alt="out" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', border: `.5px solid ${T.border}` }} />
                    </div>
                  )}
                  {l.doc_url && !selfieIn && (
                    <div>
                      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: T.muted, marginBottom: 4 }}>Dokumen</div>
                      <a href={l.doc_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.purple, fontWeight: 600, textDecoration: 'none' }}>📎 Lihat →</a>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── LEAVE TAB ────────────────────────────────────────────────────────────────
function LeaveTab({ employees }) {
  const [requests, setRequests] = useState([])
  const [saving, setSaving] = useState(null)
  useEffect(() => { fetchRequests() }, [])

  async function fetchRequests() {
    const { data } = await supabase.from('leave_requests').select('*, employees!employee_id(name,role)').eq('status','pending').order('created_at', { ascending: false })
    setRequests(data || [])
  }
  async function review(id, status, empId, type, days) {
    setSaving(id)
    await supabase.from('leave_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    if (status === 'rejected' && type === 'cuti') {
      const emp = employees.find(e => e.id === empId)
      if (emp) await supabase.from('employees').update({ leave_balance: emp.leave_balance + days }).eq('id', empId)
    }
    setSaving(null); fetchRequests()
  }

  const typeIcon = { cuti: '📅', sakit: '💊', day_off: '🌴', ctb: '📋' }

  return (
    <div style={{ padding: '14px 14px 80px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {requests.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', background: T.surface, borderRadius: 20, border: `.5px solid ${T.border}` }}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>✅</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.black }}>Semua sudah disetujui</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Tidak ada permintaan pending</div>
        </div>
      )}
      {requests.map(r => (
        <div key={r.id} style={{ background: T.surface, borderRadius: 18, border: `.5px solid ${T.border}`, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
            <div style={{ width: 40, height: 40, borderRadius: 12, background: T.amberLight, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
              {typeIcon[r.type] || '📋'}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: T.black }}>{r.employees?.name}</div>
              <div style={{ fontSize: 10, color: T.muted }}>{r.employees?.role} · {r.type.toUpperCase()} · {new Date(r.date_start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}</div>
              {r.reason && <div style={{ fontSize: 11, color: T.muted, marginTop: 2, fontStyle: 'italic' }}>{r.reason}</div>}
            </div>
            {r.doc_url && <a href={r.doc_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: T.purple, fontWeight: 700, textDecoration: 'none' }}>📎 Dok</a>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: `.5px solid ${T.border}` }}>
            <button onClick={() => review(r.id, 'rejected', r.employee_id, r.type, r.days)} disabled={saving === r.id}
              style={{ padding: '12px', background: T.dngBg, color: T.dng, border: 'none', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', borderRight: `.5px solid ${T.border}` }}>
              ✕ Tolak
            </button>
            <button onClick={() => review(r.id, 'approved', r.employee_id, r.type, r.days)} disabled={saving === r.id}
              style={{ padding: '12px', background: T.greenLight, color: T.green, border: 'none', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
              {saving === r.id ? '...' : '✓ Setujui'}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── EMPLOYEES TAB ────────────────────────────────────────────────────────────
function EmployeesTab({ employees, onRefresh }) {
  const [form, setForm] = useState({ name: '', role: '', phone: '', pin: '', shift: '', leave_balance: 12 })
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [uploadingId, setUploadingId] = useState(null)

  const inputSt = { width: '100%', padding: '10px 12px', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, background: T.cream, color: T.black, fontFamily: 'inherit' }
  const pinSt = { ...inputSt, letterSpacing: '.2em', fontWeight: 700 }

  async function addEmployee() {
    setSaving(true)
    await supabase.from('employees').insert({ ...form, leave_balance: parseInt(form.leave_balance) })
    setSaving(false); setAdding(false); setForm({ name: '', role: '', phone: '', pin: '', shift: '', leave_balance: 12 }); onRefresh()
  }
  function startEdit(emp) {
    setEditingId(emp.id)
    setEditForm({ name: emp.name, role: emp.role, phone: emp.phone, pin: '', shift: emp.shift || '', leave_balance: emp.leave_balance })
  }
  async function saveEdit(empId) {
    setSaving(true)
    const u = { name: editForm.name, role: editForm.role, phone: editForm.phone, shift: editForm.shift, leave_balance: parseInt(editForm.leave_balance) }
    if (editForm.pin?.length >= 4) u.pin = editForm.pin
    await supabase.from('employees').update(u).eq('id', empId)
    setSaving(false); setEditingId(null); onRefresh()
  }
  async function deleteEmployee(id, name) {
    if (!window.confirm(`Hapus "${name}"? Data absensi tetap tersimpan.`)) return
    await supabase.from('employees').delete().eq('id', id); onRefresh()
  }
  async function uploadFile(empId, file, type) {
    if (!file) return
    setUploadingId(empId + type)
    const ext = file.name.split('.').pop()
    const { data } = await supabase.storage.from('documents').upload(`${type}/${empId}_${Date.now()}.${ext}`, file, { upsert: true })
    if (data) {
      const { data: u } = supabase.storage.from('documents').getPublicUrl(data.path)
      await supabase.from('employees').update({ [type === 'ktp' ? 'ktp_url' : 'photo_url']: u.publicUrl }).eq('id', empId)
      onRefresh()
    }
    setUploadingId(null)
  }

  return (
    <div style={{ padding: '14px 14px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: T.muted }}>KARYAWAN ({employees.filter(e => !e.is_owner).length})</div>
        <button onClick={() => { setAdding(!adding); setEditingId(null) }}
          style={{ padding: '8px 16px', background: T.black, color: T.white, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {adding ? 'Batal' : '+ Tambah'}
        </button>
      </div>

      {adding && (
        <div style={{ background: T.surface, borderRadius: 18, padding: '16px', marginBottom: 12, border: `.5px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.black, marginBottom: 12 }}>Tambah Karyawan Baru</div>
          {[['name','Nama Lengkap','text'],['role','Jabatan','text'],['shift','Shift (opsional)','text']].map(([k,lbl,t]) => (
            <div key={k} style={{ marginBottom: 8 }}><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>{lbl}</label>
              <input type={t} value={form[k]} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} style={inputSt} /></div>
          ))}
          <div style={{ marginBottom: 8 }}><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>Nomor HP</label>
            <input type="tel" inputMode="numeric" value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} placeholder="08xxxxxxxxxx" style={inputSt} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            <div><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>PIN (4–6 angka)</label>
              <input type="text" inputMode="numeric" maxLength={6} value={form.pin} onChange={e => setForm(f=>({...f,pin:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="123456" style={pinSt} /></div>
            <div><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>Hak Cuti (hari)</label>
              <input type="number" value={form.leave_balance} onChange={e => setForm(f=>({...f,leave_balance:e.target.value}))} min={0} max={30} style={inputSt} /></div>
          </div>
          <button onClick={addEmployee} disabled={saving || !form.name || !form.phone || form.pin.length < 4}
            style={{ width: '100%', padding: '12px', background: T.black, color: T.white, border: 'none', borderRadius: 12, fontSize: 13, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: (saving||!form.name||!form.phone||form.pin.length<4)?.5:1 }}>
            {saving ? 'Menyimpan...' : 'Simpan Karyawan'}
          </button>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {employees.filter(e => !e.is_owner).map(emp => (
          <div key={emp.id}>
            {editingId === emp.id ? (
              <div style={{ background: T.purpleLight, borderRadius: 18, padding: '14px', border: `.5px solid ${T.purpleLight}` }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: T.purple, marginBottom: 12 }}>Edit: {emp.name}</div>
                {[['name','Nama'],['role','Jabatan'],['shift','Shift']].map(([k,lbl]) => (
                  <div key={k} style={{ marginBottom: 8 }}><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>{lbl}</label>
                    <input value={editForm[k]||''} onChange={e => setEditForm(f=>({...f,[k]:e.target.value}))} style={inputSt} /></div>
                ))}
                <div style={{ marginBottom: 8 }}><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>Nomor HP</label>
                  <input type="tel" inputMode="numeric" value={editForm.phone||''} onChange={e => setEditForm(f=>({...f,phone:e.target.value}))} style={inputSt} /></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>PIN Baru (kosongkan jika tidak ubah)</label>
                    <input type="text" inputMode="numeric" maxLength={6} value={editForm.pin||''} onChange={e => setEditForm(f=>({...f,pin:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="angka baru" style={pinSt} /></div>
                  <div><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>Hak Cuti</label>
                    <input type="number" value={editForm.leave_balance||0} onChange={e => setEditForm(f=>({...f,leave_balance:e.target.value}))} min={0} max={30} style={inputSt} /></div>
                </div>
                <div style={{ background: T.surface, borderRadius: 10, padding: '10px', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: T.black, marginBottom: 8 }}>Upload Dokumen</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {[['ktp','Foto KTP','ktp_url'],['photos','Foto Profil','photo_url']].map(([type,lbl,field]) => (
                      <div key={type}>
                        <div style={{ fontSize: 10, color: T.muted, marginBottom: 4 }}>{lbl}</div>
                        {emp[field] && <a href={emp[field]} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: T.green, display: 'block', marginBottom: 4 }}>✓ Lihat →</a>}
                        <label style={{ display: 'block', padding: '7px 10px', background: T.cream, border: `.5px dashed ${T.border}`, borderRadius: 8, cursor: 'pointer', fontSize: 10, color: T.muted, textAlign: 'center' }}>
                          <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => uploadFile(emp.id, e.target.files[0], type)} />
                          {uploadingId === emp.id+type ? '⏳...' : '📤 Upload'}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => setEditingId(null)} style={{ flex: 1, padding: '11px', background: T.cream, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>Batal</button>
                  <button onClick={() => saveEdit(emp.id)} disabled={saving} style={{ flex: 2, padding: '11px', background: T.black, color: T.white, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {saving ? 'Menyimpan...' : '✓ Simpan'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ background: T.surface, borderRadius: 16, border: `.5px solid ${T.border}`, display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px' }}>
                <div style={{ width: 40, height: 40, borderRadius: '50%', background: T.sage, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: T.white, flexShrink: 0, overflow: 'hidden' }}>
                  {emp.photo_url ? <img src={emp.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : emp.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.black, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {emp.name}
                    {emp.ktp_url && <span style={{ fontSize: 9, background: T.greenLight, color: T.green, padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>KTP ✓</span>}
                  </div>
                  <div style={{ fontSize: 10, color: T.muted }}>{emp.role} · {emp.phone} · Cuti: {emp.leave_balance}hr{emp.shift ? ` · ${emp.shift}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { startEdit(emp); setAdding(false) }} style={{ fontSize: 11, padding: '5px 11px', borderRadius: 8, border: `.5px solid ${T.purpleLight}`, background: T.purpleLight, color: T.purple, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>✏️</button>
                  <button onClick={() => deleteEmployee(emp.id, emp.name)} style={{ fontSize: 11, padding: '5px 11px', borderRadius: 8, border: `.5px solid ${T.dngBg}`, background: T.dngBg, color: T.dng, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700 }}>🗑</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── REPORT TAB ───────────────────────────────────────────────────────────────
function ReportTab({ employees }) {
  const [month, setMonth] = useState(localDate().slice(0,7))
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  useEffect(() => { fetchReport() }, [month])

  async function fetchReport() {
    setLoading(true)
    const { data: rows } = await supabase.from('attendance').select('*, employees!employee_id(name,role,leave_balance)').gte('date', month+'-01').lte('date', month+'-31')
    const grouped = {}
    ;(rows||[]).forEach(r => {
      const id = r.employee_id
      if (!grouped[id]) grouped[id] = { name: r.employees?.name, role: r.employees?.role, leave_balance: r.employees?.leave_balance, hadir: 0, sakit: 0, cuti: 0, ctb: 0, day_off: 0, terlambat: 0, total_dur_min: 0 }
      if (r.status === 'hadir') { grouped[id].hadir++; const d = r.check_in && r.check_out ? Math.round((new Date(r.check_out)-new Date(r.check_in))/60000) : 0; grouped[id].total_dur_min += d }
      if (r.status === 'sakit') grouped[id].sakit++
      if (r.status === 'cuti') grouped[id].cuti++
      if (r.status === 'ctb') grouped[id].ctb++
      if (r.status === 'day_off') grouped[id].day_off++
      if (r.is_late) grouped[id].terlambat++
    })
    setData(Object.values(grouped)); setLoading(false)
  }

  function exportExcel() {
    const ws_data = [
      ['Laporan Kehadiran — Piccolo Corner — ' + month], [],
      ['Nama', 'Jabatan', 'Hadir', 'Terlambat', 'Sakit', 'Cuti', 'Day Off', 'CTB', '% Hadir', 'Sisa Cuti'],
      ...data.map(d => {
        const total = d.hadir + d.sakit + d.cuti + d.ctb + d.day_off
        const pct = total > 0 ? Math.round((d.hadir/total)*100)+'%' : '0%'
        return [d.name, d.role, d.hadir, d.terlambat, d.sakit, d.cuti, d.day_off, d.ctb, pct, (d.leave_balance||0)+' hari']
      })
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(ws_data)
    ws['!cols'] = [{wch:20},{wch:15},{wch:8},{wch:10},{wch:8},{wch:8},{wch:10},{wch:8},{wch:10},{wch:10}]
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Bulanan')
    XLSX.writeFile(wb, `Piccolo_Corner_Absensi_${month}.xlsx`)
  }

  return (
    <div style={{ padding: '14px 14px 80px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <input type="month" value={month} onChange={e => setMonth(e.target.value)}
          style={{ padding: '8px 12px', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, background: T.cream, color: T.black, fontFamily: 'inherit', fontWeight: 600 }} />
        <button onClick={exportExcel} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: '#1D6F42', color: '#fff', border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          ↓ Excel
        </button>
      </div>
      {loading && <div style={{ textAlign: 'center', padding: '2rem', color: T.muted, fontSize: 13 }}>Memuat...</div>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {data.map((d,i) => {
          const total = d.hadir + d.sakit + d.cuti + d.ctb + d.day_off
          const pct = total > 0 ? Math.round((d.hadir/total)*100) : 0
          const avgH = d.hadir > 0 ? Math.round(d.total_dur_min/d.hadir) : 0
          const avgStr = avgH > 0 ? `${Math.floor(avgH/60)}j${avgH%60}m` : '—'
          return (
            <div key={i} style={{ background: T.surface, borderRadius: 18, border: `.5px solid ${T.border}`, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `.5px solid ${T.border}` }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: T.sage, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: T.white, flexShrink: 0 }}>
                  {d.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 800, color: T.black }}>{d.name}</div>
                  <div style={{ fontSize: 10, color: T.muted }}>{d.role}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: pct>=90?T.green:pct>=75?T.amber:T.dng }}>{pct}%</div>
                  <div style={{ fontSize: 9, color: T.muted }}>kehadiran</div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderBottom: `.5px solid ${T.border}` }}>
                {[['Hadir',d.hadir,T.green],['Sakit',d.sakit,T.purple],['Cuti',d.cuti,'#27964A'],['Day Off',d.day_off,T.amber],['CTB',d.ctb,'#8B5CF6']].map(([l,v,c]) => (
                  <div key={l} style={{ padding: '8px 4px', textAlign: 'center', borderRight: `.5px solid ${T.border}` }}>
                    <div style={{ fontSize: 8, color: T.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: v>0?c:T.muted }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', padding: '8px 14px' }}>
                {[['Terlambat',d.terlambat+'x',T.amber],['Rata-rata kerja',avgStr,T.purple],['Sisa cuti',(d.leave_balance||0)+' hr',T.green]].map(([l,v,c]) => (
                  <div key={l}>
                    <div style={{ fontSize: 8, color: T.muted, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div>
                    <div style={{ fontSize: 13, fontWeight: 800, color: c }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── SETTINGS TAB ─────────────────────────────────────────────────────────────
function SettingsTab({ settings: init, onSave }) {
  const [form, setForm] = useState(init)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  useEffect(() => setForm(init), [init])

  useEffect(() => {
    if (!mapReady) return
    const L = window.L
    if (!L || mapInstanceRef.current) return
    const lat = parseFloat(form.cafe_lat) || -8.7162
    const lng = parseFloat(form.cafe_lng) || 115.2108
    const map = L.map(mapRef.current, { center: [lat, lng], zoom: 17 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map)
    const icon = L.divIcon({ html: '<div style="background:#0D0D0D;width:16px;height:16px;border-radius:50%;border:3px solid #E8674A;"></div>', iconSize: [16,16], iconAnchor: [8,8], className: '' })
    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
    marker.on('dragend', e => { const p = e.target.getLatLng(); setForm(f => ({...f, cafe_lat: parseFloat(p.lat.toFixed(6)), cafe_lng: parseFloat(p.lng.toFixed(6))})) })
    map.on('click', e => { marker.setLatLng(e.latlng); setForm(f => ({...f, cafe_lat: parseFloat(e.latlng.lat.toFixed(6)), cafe_lng: parseFloat(e.latlng.lng.toFixed(6))})) })
    mapInstanceRef.current = map; markerRef.current = marker
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null } }
  }, [mapReady])

  function loadMap() {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'; document.head.appendChild(link)
    const script = document.createElement('script'); script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'; script.onload = () => setMapReady(true); document.head.appendChild(script)
  }
  function locateMe() {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      setForm(f => ({...f, cafe_lat: parseFloat(lat.toFixed(6)), cafe_lng: parseFloat(lng.toFixed(6))}))
      if (mapInstanceRef.current && markerRef.current) { mapInstanceRef.current.setView([lat,lng],18); markerRef.current.setLatLng([lat,lng]) }
    })
  }
  async function save() {
    setSaving(true)
    await supabase.from('work_settings').update({...form, updated_at: new Date().toISOString()}).eq('id',1)
    setSaving(false); setSaved(true); onSave(form); setTimeout(() => setSaved(false), 3000)
  }

  const inputSt = { width: '100%', padding: '10px 12px', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, background: T.cream, color: T.black, fontFamily: 'inherit' }

  return (
    <div style={{ padding: '14px 14px 80px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      <div style={{ background: T.surface, borderRadius: 18, padding: '16px', border: `.5px solid ${T.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.black, marginBottom: 4 }}>🔔 Pesan Notifikasi Jam Masuk</div>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 12, lineHeight: 1.5 }}>
          Pesan ini dikirim ke HP karyawan tepat jam 10:00 setiap hari (jika app sedang terbuka).
        </div>
        <textarea
          value={form.notif_message || ''}
          onChange={e => setForm(f => ({ ...f, notif_message: e.target.value }))}
          rows={3}
          placeholder="Contoh: Selamat pagi! Yuk segera absen dan mulai hari yang produktif 💪"
          style={{ ...inputSt, resize: 'vertical', lineHeight: 1.6 }}
        />
        <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
          {(form.notif_message || '').length} karakter · disarankan max 100 karakter agar terbaca penuh di HP
        </div>
      </div>

      <div style={{ background: T.surface, borderRadius: 18, padding: '16px', border: `.5px solid ${T.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.black, marginBottom: 12 }}>Jam Operasional</div>
        {[['open_time','Jam Buka','time'],['close_time','Jam Tutup','time'],['late_tolerance_minutes','Toleransi Terlambat (menit)','number'],['gps_radius_meters','Radius GPS (meter)','number'],['doc_upload_deadline_days','Batas Upload Dokter (hari)','number']].map(([k,lbl,t]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 4 }}>{lbl}</label>
            <input type={t} value={form[k]||''} step={1} onChange={e => setForm(f => ({...f,[k]: t==='number'?parseFloat(e.target.value)||e.target.value:e.target.value}))}
              style={{ ...inputSt, width: t==='number'?120:160 }} />
          </div>
        ))}
      </div>

      <div style={{ background: T.surface, borderRadius: 18, padding: '16px', border: `.5px solid ${T.border}` }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: T.black, marginBottom: 8 }}>Lokasi Cafe</div>
        <div style={{ background: T.purpleLight, borderRadius: 10, padding: '8px 12px', fontSize: 11, color: T.purple, marginBottom: 12, lineHeight: 1.5 }}>
          Klik "Buka Peta" lalu geser pin ke lokasi cafe, atau klik "Lokasi Saya" jika sedang di cafe.
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button onClick={loadMap} style={{ padding: '9px 16px', background: T.black, color: T.white, border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>🗺 Buka Peta</button>
          <button onClick={locateMe} style={{ padding: '9px 16px', background: T.greenLight, color: T.green, border: `.5px solid ${T.greenLight}`, borderRadius: 9, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>📍 Lokasi Saya</button>
        </div>
        {mapReady && <div ref={mapRef} style={{ width: '100%', height: 240, borderRadius: 12, overflow: 'hidden', border: `.5px solid ${T.border}`, marginBottom: 10 }} />}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {[['cafe_lat','Latitude'],['cafe_lng','Longitude']].map(([k,lbl]) => (
            <div key={k}><label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 3 }}>{lbl}</label>
              <input type="number" value={form[k]||''} step={0.000001} onChange={e => setForm(f=>({...f,[k]:parseFloat(e.target.value)}))} style={inputSt} /></div>
          ))}
        </div>
        {form.cafe_lat && form.cafe_lng && <div style={{ marginTop: 8, fontSize: 11, color: T.green, background: T.greenLight, borderRadius: 8, padding: '6px 10px' }}>✓ {parseFloat(form.cafe_lat).toFixed(6)}, {parseFloat(form.cafe_lng).toFixed(6)}</div>}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving} style={{ flex: 1, padding: '13px', background: T.black, color: T.white, border: 'none', borderRadius: 12, fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: saving?.6:1 }}>
          {saving ? 'Menyimpan...' : '✓ Simpan Pengaturan'}
        </button>
        {saved && <span style={{ fontSize: 12, color: T.green, fontWeight: 700 }}>✓ Tersimpan!</span>}
      </div>
    </div>
  )
}


// ─── QUOTES TAB ───────────────────────────────────────────────────────────────
function QuotesTab() {
  const [quotes, setQuotes] = useState([])
  const [newText, setNewText] = useState('')
  const [newAuthor, setNewAuthor] = useState('')
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => { fetchQuotes() }, [])

  async function fetchQuotes() {
    const { data } = await supabase.from('quotes').select('*').order('created_at', { ascending: false })
    setQuotes(data || [])
  }

  async function addQuote() {
    if (!newText.trim()) return
    setSaving(true)
    await supabase.from('quotes').insert({ text: newText.trim(), author: newAuthor.trim() || 'Piccolo Corner', is_active: true })
    setNewText(''); setNewAuthor(''); setAdding(false)
    setSaving(false); fetchQuotes()
  }

  async function toggleQuote(id, current) {
    await supabase.from('quotes').update({ is_active: !current }).eq('id', id)
    fetchQuotes()
  }

  async function deleteQuote(id) {
    if (!window.confirm('Hapus quote ini?')) return
    await supabase.from('quotes').delete().eq('id', id)
    fetchQuotes()
  }

  async function generateAIQuote() {
    setAiLoading(true)
    try {
      const themes = [
        'semangat kerja di cafe / restoran untuk barista dan pelayan',
        'pelayanan pelanggan yang tulus dan ramah',
        'kebersamaan tim kerja cafe',
        'kebanggaan menjadi bagian dari Piccolo Corner Bali',
        'motivasi kerja keras di pagi hari',
      ]
      const theme = themes[Math.floor(Math.random() * themes.length)]
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{
            role: 'user',
            content: `Buatkan 1 quote motivasi singkat dalam bahasa Indonesia untuk karyawan cafe tentang: ${theme}. 
Quote harus: singkat (max 2 kalimat), inspiratif, positif, bisa ada emoji yang relevan.
Format response: hanya teks quote saja, tanpa tanda kutip, tanpa penjelasan tambahan.`
          }]
        })
      })
      const data = await response.json()
      const generated = data.content?.[0]?.text?.trim()
      if (generated) {
        setNewText(generated)
        setNewAuthor('AI · Piccolo Corner')
        setAdding(true)
      }
    } catch(e) {
      console.error('AI error:', e)
    }
    setAiLoading(false)
  }

  const inputSt = { width: '100%', padding: '10px 12px', border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 13, background: T.cream, color: T.black, fontFamily: 'inherit' }

  return (
    <div style={{ padding: '14px 14px 80px' }}>
      {/* Header actions */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => { setAdding(!adding); setNewText(''); setNewAuthor('') }}
          style={{ padding: '9px 16px', background: T.black, color: T.white, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
          {adding ? 'Batal' : '+ Tulis Quote'}
        </button>
        <button onClick={generateAIQuote} disabled={aiLoading}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', background: T.purpleLight, color: T.purple, border: `.5px solid ${T.purple}22`, borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: aiLoading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: aiLoading ? .7 : 1 }}>
          {aiLoading ? '⏳ AI sedang menulis...' : '✨ Generate AI Quote'}
        </button>
      </div>

      {/* Info */}
      <div style={{ background: T.amberLight, borderRadius: 12, padding: '10px 14px', fontSize: 11, color: '#8B5800', marginBottom: 14, lineHeight: 1.6 }}>
        💡 Quote yang <strong>aktif</strong> akan muncul bergiliran di header app karyawan setiap hari. Quote yang di-<strong>hide</strong> tidak tampil tapi tersimpan.
      </div>

      {/* Add form */}
      {adding && (
        <div style={{ background: T.surface, borderRadius: 18, padding: '16px', marginBottom: 14, border: `.5px solid ${T.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: T.black, marginBottom: 12 }}>
            {newText && newAuthor?.includes('AI') ? '✨ Quote dari AI — edit jika perlu' : 'Tulis Quote Baru'}
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 4 }}>Teks Quote</label>
            <textarea value={newText} onChange={e => setNewText(e.target.value)} rows={3}
              placeholder="Contoh: Setiap cangkir kopi yang kamu buat adalah karya seni. Berikan yang terbaik! ☕"
              style={{ ...inputSt, resize: 'vertical' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 11, color: T.muted, display: 'block', marginBottom: 4 }}>Sumber / Penulis (opsional)</label>
            <input value={newAuthor} onChange={e => setNewAuthor(e.target.value)} placeholder="Piccolo Corner" style={inputSt} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <button onClick={() => { setAdding(false); setNewText(''); setNewAuthor('') }}
              style={{ padding: '11px', background: T.cream, color: T.black, border: `.5px solid ${T.border}`, borderRadius: 10, fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Batal</button>
            <button onClick={addQuote} disabled={saving || !newText.trim()}
              style={{ padding: '11px', background: T.black, color: T.white, border: 'none', borderRadius: 10, fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', opacity: (saving || !newText.trim()) ? .5 : 1 }}>
              {saving ? 'Menyimpan...' : '✓ Simpan & Aktifkan'}
            </button>
          </div>
        </div>
      )}

      {/* Quote list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {quotes.length === 0 && (
          <div style={{ textAlign: 'center', padding: '3rem', background: T.surface, borderRadius: 18, border: `.5px solid ${T.border}` }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: T.black }}>Belum ada quote</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>Tambah manual atau generate dengan AI</div>
          </div>
        )}
        {quotes.map(q => (
          <div key={q.id} style={{ background: T.surface, borderRadius: 16, border: `.5px solid ${T.border}`, overflow: 'hidden', opacity: q.is_active ? 1 : .55 }}>
            <div style={{ padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{ fontSize: 20, flexShrink: 0, marginTop: 2 }}>💬</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: T.black, lineHeight: 1.6, marginBottom: 6 }}>{q.text}</div>
                  {q.author && <div style={{ fontSize: 10, color: T.muted, fontWeight: 600 }}>— {q.author}</div>}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', borderTop: `.5px solid ${T.border}` }}>
              <button onClick={() => toggleQuote(q.id, q.is_active)}
                style={{ flex: 1, padding: '10px', border: 'none', fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', borderRight: `.5px solid ${T.border}`,
                  background: q.is_active ? T.greenLight : T.amberLight, color: q.is_active ? T.green : '#8B5800' }}>
                {q.is_active ? '👁 Tampil' : '🙈 Hidden'}
              </button>
              <button onClick={() => deleteQuote(q.id)}
                style={{ padding: '10px 20px', border: 'none', background: T.dngBg, color: T.dng, fontSize: 11, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                🗑 Hapus
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── MAIN OWNER PAGE ──────────────────────────────────────────────────────────
export default function OwnerPage() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const [tab, setTab] = useState('log')
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({})
  const [notifOn, setNotifOn] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const today = localDate()

  useEffect(() => { fetchAll(); initNotif() }, [])

  async function initNotif() {
    const ok = await requestNotifPermission()
    setNotifOn(ok)
  }
  async function fetchAll() {
    const { data: emps } = await supabase.from('employees').select('*').order('name')
    if (emps) setEmployees(emps)
    const { data: s } = await supabase.from('work_settings').select('*').eq('id',1).single()
    if (s) setSettings(s)
    const { count } = await supabase.from('leave_requests').select('*', {count:'exact',head:true}).eq('status','pending')
    setPendingCount(count || 0)
  }

  const tabs = [
    { key: 'log', label: 'Log', icon: '📋' },
    { key: 'leave', label: 'Persetujuan', icon: '✅', badge: pendingCount },
    { key: 'employees', label: 'Karyawan', icon: '👥' },
    { key: 'report', label: 'Laporan', icon: '📊' },
    { key: 'quotes', label: 'Quotes', icon: '💬' },
    { key: 'settings', label: 'Pengaturan', icon: '⚙️' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: "'Plus Jakarta Sans', -apple-system, sans-serif", display: 'flex', flexDirection: 'column' }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');`}</style>

      {/* HEADER */}
      <div style={{ background: T.black, padding: '14px 18px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: T.coral, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>☕</div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: T.white, letterSpacing: '-.01em' }}>Piccolo Corner</div>
              <div style={{ fontSize: 9, color: T.coral, letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>Owner Dashboard</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button onClick={async () => { const ok = await requestNotifPermission(); setNotifOn(ok) }}
              title={notifOn ? 'Notifikasi aktif' : 'Aktifkan notifikasi'}
              style={{ width: 34, height: 34, borderRadius: 10, background: notifOn ? '#1A2E20' : '#1A1A1A', border: 'none', cursor: 'pointer', fontSize: 16 }}>
              {notifOn ? '🔔' : '🔕'}
            </button>
            <button onClick={() => { logout(); navigate('/login') }}
              style={{ padding: '7px 14px', background: 'transparent', border: `.5px solid #333`, borderRadius: 8, color: '#888', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
              Keluar
            </button>
          </div>
        </div>

        {/* Nav tabs */}
        <div style={{ display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 0 }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '9px 14px', borderRadius: '10px 10px 0 0', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', position: 'relative', transition: 'all .15s',
                background: tab === t.key ? T.bg : 'transparent',
                color: tab === t.key ? T.black : '#666' }}>
              <span style={{ fontSize: 14 }}>{t.icon}</span>
              {t.label}
              {t.badge > 0 && <span style={{ position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: '50%', background: T.coral, color: T.white, fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'log' && <LogTab today={today} />}
        {tab === 'leave' && <LeaveTab employees={employees} />}
        {tab === 'employees' && <EmployeesTab employees={employees} onRefresh={fetchAll} />}
        {tab === 'report' && <ReportTab employees={employees} />}
        {tab === 'quotes' && <QuotesTab />}
        {tab === 'settings' && <SettingsTab settings={settings} onSave={s => setSettings(s)} />}
      </div>
    </div>
  )
}
