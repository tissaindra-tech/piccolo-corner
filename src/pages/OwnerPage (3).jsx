import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabase.js'
import * as XLSX from 'xlsx'

const C = {
  esp: '#1C1208', lat: '#C4956A', crm: '#F5EFE6', foam: '#FBF7F2', mut: '#7A6A5A',
  ok: '#27500A', okBg: '#EAF3DE', okBd: '#97C459',
  dng: '#A32D2D', dngBg: '#FCEBEB', dngBd: '#F09595',
  inf: '#185FA5', infBg: '#E6F1FB', infBd: '#85B7EB',
  wrn: '#854F0B', wrnBg: '#FAEEDA', wrnBd: '#EF9F27',
  pur: '#3C3489', purBg: '#EEEDFE', purBd: '#AFA9EC',
}

function Badge({ status }) {
  const map = { hadir: [C.okBg, C.ok, 'Hadir'], sakit: [C.infBg, C.inf, 'Sakit'], cuti: [C.okBg, C.ok, 'Cuti'], ctb: [C.purBg, C.pur, 'CTB'], day_off: [C.wrnBg, C.wrn, 'Day Off'] }
  const [bg, color, label] = map[status] || ['#eee', '#888', status]
  return <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 20, background: bg, color }}>{label}</span>
}

function Card({ children, style = {} }) {
  return <div style={{ background: C.foam, border: '.5px solid #E0D4C3', borderRadius: 14, padding: '1rem 1.1rem', ...style }}>{children}</div>
}

function SectionTitle({ children }) {
  return <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', color: C.mut, marginBottom: '.75rem' }}>{children}</div>
}

// ─── TABS ────────────────────────────────────────────────────────────────────

function LogTab({ employees, today }) {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [selfieView, setSelfieView] = useState(null)
  const [error, setError] = useState(null)
  const [viewDate, setViewDate] = useState(today)

  useEffect(() => { fetchLogs(viewDate) }, [viewDate])

  async function fetchLogs(date) {
    setLoading(true)
    setError(null)
    try {
      // First try: filter by date
      const { data, error } = await supabase
        .from('attendance')
        .select('employee_id, date, check_in, check_out, status, is_late, late_minutes, gps_dist_in, doc_url, employees(name, role)')
        .eq('date', date)
        .order('check_in', { ascending: false })
      if (error) {
        setError(`Query error: ${error.message} (code: ${error.code})`)
        // Fallback: try without date filter to see ALL records
        const { data: all } = await supabase
          .from('attendance')
          .select('employee_id, date, check_in, check_out, status, is_late, late_minutes, gps_dist_in, doc_url, employees(name, role)')
          .order('check_in', { ascending: false })
          .limit(20)
        setLogs(all || [])
      } else {
        setLogs(data || [])
      }
    } catch(e) {
      setError(`Exception: ${e.message}`)
    }
    setLoading(false)
  }

  const stats = { hadir: 0, sakit: 0, cuti: 0, ctb: 0 }
  logs.forEach(l => { if (stats[l.status] !== undefined) stats[l.status]++ })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Selfie lightbox */}
      {selfieView && (
        <div onClick={() => setSelfieView(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
          <img src={selfieView} alt="selfie" style={{ maxWidth: '90vw', maxHeight: '80vh', borderRadius: 12, objectFit: 'contain' }} />
          <div style={{ color: '#fff', fontSize: 12, opacity: .7 }}>Tap untuk tutup</div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
        {[['Hadir', stats.hadir, C.ok], ['Sakit', stats.sakit, C.inf], ['Cuti', stats.cuti, C.ok], ['CTB', stats.ctb, C.pur]].map(([l, v, c]) => (
          <Card key={l} style={{ textAlign: 'center', padding: '.75rem' }}>
            <div style={{ fontSize: 10, color: C.mut, marginBottom: 4 }}>{l}</div>
            <div style={{ fontSize: 22, fontWeight: 500, color: c, fontFamily: 'Georgia,serif' }}>{v}</div>
          </Card>
        ))}
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SectionTitle style={{ margin: 0 }}>Log Absensi</SectionTitle>
            <input type="date" value={viewDate} onChange={e => setViewDate(e.target.value)}
              style={{ fontSize: 11, padding: '4px 8px', border: '.5px solid #C4A88A', borderRadius: 7, background: C.crm, color: C.esp, fontFamily: 'inherit' }} />
          </div>
          <button onClick={() => fetchLogs(viewDate)}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: `.5px solid #C4A88A`, background: 'transparent', color: C.mut, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↻ Refresh
          </button>
        </div>

        {loading && <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '1rem' }}>Memuat data...</div>}
        {!loading && error && (
          <div style={{ background: C.dngBg, border: `.5px solid ${C.dngBd}`, borderRadius: 8, padding: '10px 12px', fontSize: 11, color: C.dng, marginBottom: 8 }}>
            ⚠ Error: {error} — coba klik Refresh atau jalankan SQL migration dulu di Supabase
          </div>
        )}
        {!loading && logs.length === 0 && (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontSize: 12, color: C.mut, marginBottom: 6 }}>Belum ada data untuk tanggal ini</div>
            <div style={{ fontSize: 11, color: C.dng }}>Tanggal: {viewDate}</div>
          </div>
        )}
        {!loading && logs.map(l => (
          <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '.5px solid #F0E8DC' }}>
            <div style={{ width: 32, height: 32, borderRadius: '50%', background: C.lat, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, color: C.esp, flexShrink: 0 }}>
              {l.employees?.name?.split(' ').map(w => w[0]).join('').slice(0,2)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: C.esp }}>{l.employees?.name}</div>
              <div style={{ fontSize: 10, color: C.mut, display: 'flex', alignItems: 'center', gap: 6 }}>
                {l.employees?.role}
                {l.is_late && <span style={{ background: C.wrnBg, color: C.wrn, padding: '1px 5px', borderRadius: 4, fontSize: 9 }}>+{l.late_minutes}m terlambat</span>}
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: 11, color: C.mut, flexShrink: 0 }}>
              {l.check_in && <div>{new Date(l.check_in).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}</div>}
              {l.check_out && <div style={{ fontSize: 10 }}>↩ {new Date(l.check_out).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Makassar' })}</div>}
              {l.gps_dist_in != null && <div style={{ fontSize: 9, color: C.ok }}>{l.gps_dist_in}m GPS</div>}
            </div>
            {l.doc_url && l.doc_url.includes('selfie') && (
              <div onClick={() => setSelfieView(l.doc_url)}
                style={{ width: 32, height: 32, borderRadius: 6, overflow: 'hidden', cursor: 'pointer', border: `.5px solid ${C.okBd}`, flexShrink: 0 }}>
                <img src={l.doc_url} alt="selfie" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}
            <Badge status={l.status} />
          </div>
        ))}
      </Card>
    </div>
  )
}

function LeaveTab({ employees }) {
  const [requests, setRequests] = useState([])
  useEffect(() => { fetchRequests() }, [])
  async function fetchRequests() {
    const { data } = await supabase.from('leave_requests').select('*, employees(name,role)').eq('status','pending').order('created_at', { ascending: false })
    setRequests(data || [])
  }
  async function review(id, status, empId, type, days) {
    await supabase.from('leave_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    if (status === 'rejected' && type === 'cuti') {
      const emp = employees.find(e => e.id === empId)
      if (emp) await supabase.from('employees').update({ leave_balance: emp.leave_balance + days }).eq('id', empId)
    }
    fetchRequests()
  }

  return (
    <Card>
      <SectionTitle>Permintaan Menunggu Persetujuan</SectionTitle>
      {requests.length === 0 && <div style={{ fontSize: 12, color: C.mut, textAlign: 'center', padding: '1rem' }}>Tidak ada permintaan pending</div>}
      {requests.map(r => (
        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px', borderRadius: 9, background: C.crm, border: '.5px solid #EAE0D4', marginBottom: 6 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: C.lat, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 500, color: C.esp, flexShrink: 0 }}>
            {r.employees?.name?.split(' ').map(w => w[0]).join('').slice(0,2)}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 500, color: C.esp }}>{r.employees?.name}</div>
            <div style={{ fontSize: 10, color: C.mut }}>{r.type.toUpperCase()} · {new Date(r.date_start).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })} · {r.days} hari</div>
            {r.reason && <div style={{ fontSize: 10, color: C.mut, fontStyle: 'italic' }}>{r.reason}</div>}
          </div>
          {r.doc_url && <a href={r.doc_url} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: C.inf, textDecoration: 'none' }}>📎 Dok</a>}
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={() => review(r.id, 'approved', r.employee_id, r.type, r.days)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: `.5px solid ${C.okBd}`, background: C.okBg, color: C.ok, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>✓</button>
            <button onClick={() => review(r.id, 'rejected', r.employee_id, r.type, r.days)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: `.5px solid ${C.dngBd}`, background: C.dngBg, color: C.dng, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>✕</button>
          </div>
        </div>
      ))}
    </Card>
  )
}

function EmployeesTab({ employees, onRefresh }) {
  const [form, setForm] = useState({ name: '', role: '', phone: '', pin: '', shift: '', leave_balance: 12 })
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [uploadingId, setUploadingId] = useState(null)

  async function addEmployee() {
    setSaving(true)
    if (!form.name || !form.phone || form.pin.length < 4) { setSaving(false); return }
    await supabase.from('employees').insert({ ...form, leave_balance: parseInt(form.leave_balance) })
    setSaving(false); setAdding(false)
    setForm({ name: '', role: '', phone: '', pin: '', shift: '', leave_balance: 12 })
    onRefresh()
  }

  function startEdit(emp) {
    setEditingId(emp.id)
    setEditForm({ name: emp.name, role: emp.role, phone: emp.phone, pin: '', shift: emp.shift || '', leave_balance: emp.leave_balance })
  }

  async function saveEdit(empId) {
    setSaving(true)
    const updates = { name: editForm.name, role: editForm.role, phone: editForm.phone, shift: editForm.shift, leave_balance: parseInt(editForm.leave_balance) }
    if (editForm.pin && editForm.pin.length >= 4) updates.pin = editForm.pin
    await supabase.from('employees').update(updates).eq('id', empId)
    setSaving(false); setEditingId(null); onRefresh()
  }

  async function deleteEmployee(empId, empName) {
    if (!window.confirm(`Hapus karyawan "${empName}"? Data absensi tetap tersimpan.`)) return
    await supabase.from('employees').delete().eq('id', empId)
    onRefresh()
  }

  async function uploadFile(empId, file, type) {
    if (!file) return
    setUploadingId(empId + type)
    const ext = file.name.split('.').pop()
    const path = `${type}/${empId}_${Date.now()}.${ext}`
    const { data, error } = await supabase.storage.from('documents').upload(path, file, { upsert: true })
    if (data) {
      const { data: url } = supabase.storage.from('documents').getPublicUrl(path)
      const field = type === 'ktp' ? 'ktp_url' : 'photo_url'
      await supabase.from('employees').update({ [field]: url.publicUrl }).eq('id', empId)
      onRefresh()
    }
    setUploadingId(null)
  }

  const inputStyle = { width: '100%', padding: '7px 10px', border: '.5px solid #C4A88A', borderRadius: 7, fontSize: 12, background: '#fff', color: C.esp, fontFamily: 'inherit' }
  const pinInputStyle = { ...inputStyle, letterSpacing: '0.2em', fontWeight: 500 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
          <div style={{ fontSize: 10, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.1em', color: C.mut }}>
            Data Karyawan ({employees.filter(e => !e.is_owner).length})
          </div>
          <button onClick={() => { setAdding(!adding); setEditingId(null) }}
            style={{ fontSize: 11, padding: '5px 12px', borderRadius: 7, border: 'none', background: C.esp, color: C.crm, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
            {adding ? 'Batal' : '+ Tambah'}
          </button>
        </div>

        {adding && (
          <div style={{ background: C.crm, borderRadius: 10, padding: '12px', marginBottom: '1rem', border: '.5px solid #E0D4C3' }}>
            <div style={{ fontSize: 11, fontWeight: 500, color: C.esp, marginBottom: 10 }}>Tambah Karyawan Baru</div>
            {[['name','Nama Lengkap','text'],['role','Jabatan','text'],['shift','Shift (opsional)','text']].map(([k, lbl, t]) => (
              <div key={k} style={{ marginBottom: 8 }}>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>{lbl}</label>
                <input type={t} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} style={inputStyle} />
              </div>
            ))}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Nomor HP</label>
              <input type="tel" inputMode="numeric" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="08xxxxxxxxxx" style={inputStyle} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              <div>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>PIN (4–6 angka) <span style={{ color: C.dng }}>*</span></label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={form.pin}
                  onChange={e => { const v = e.target.value.replace(/[^0-9]/g,''); setForm(f => ({ ...f, pin: v })) }}
                  placeholder="contoh: 123456"
                  style={pinInputStyle}
                />
                <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>Ketik angka saja</div>
              </div>
              <div>
                <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Hak Cuti (hari/tahun)</label>
                <input type="number" inputMode="numeric" value={form.leave_balance} onChange={e => setForm(f => ({ ...f, leave_balance: e.target.value }))} min={0} max={30} style={inputStyle} />
              </div>
            </div>
            <button onClick={addEmployee} disabled={saving || !form.name || !form.phone || form.pin.length < 4}
              style={{ padding: '8px 16px', background: form.name && form.phone && form.pin.length >= 4 ? C.esp : '#ccc', color: C.crm, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
              {saving ? 'Menyimpan...' : 'Simpan Karyawan'}
            </button>
          </div>
        )}

        {employees.filter(e => !e.is_owner).map(emp => (
          <div key={emp.id} style={{ borderBottom: '.5px solid #F0E8DC' }}>
            {editingId === emp.id ? (
              <div style={{ background: C.infBg, border: `.5px solid ${C.infBd}`, borderRadius: 10, padding: '12px', margin: '6px 0' }}>
                <div style={{ fontSize: 11, fontWeight: 500, color: C.inf, marginBottom: 10 }}>Edit Data: {emp.name}</div>
                {[['name','Nama Lengkap','text'],['role','Jabatan','text'],['shift','Shift (opsional)','text']].map(([k, lbl, t]) => (
                  <div key={k} style={{ marginBottom: 8 }}>
                    <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>{lbl}</label>
                    <input type={t} value={editForm[k] || ''} onChange={e => setEditForm(f => ({ ...f, [k]: e.target.value }))} style={inputStyle} />
                  </div>
                ))}
                <div style={{ marginBottom: 8 }}>
                  <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Nomor HP</label>
                  <input type="tel" inputMode="numeric" value={editForm.phone || ''} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} style={inputStyle} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>PIN Baru (kosongkan jika tidak ubah)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={6}
                      value={editForm.pin || ''}
                      onChange={e => { const v = e.target.value.replace(/[^0-9]/g,''); setEditForm(f => ({ ...f, pin: v })) }}
                      placeholder="angka baru..."
                      style={pinInputStyle}
                    />
                    <div style={{ fontSize: 10, color: C.mut, marginTop: 2 }}>Ketik angka saja</div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 3 }}>Hak Cuti (hari/tahun)</label>
                    <input type="number" inputMode="numeric" value={editForm.leave_balance || 0} onChange={e => setEditForm(f => ({ ...f, leave_balance: e.target.value }))} min={0} max={30} style={inputStyle} />
                  </div>
                </div>

                <div style={{ marginBottom: 10, padding: '10px', background: 'rgba(255,255,255,0.6)', borderRadius: 8, border: '.5px solid #C4A88A' }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: C.esp, marginBottom: 8 }}>📎 Upload Dokumen Karyawan</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div>
                      <label style={{ fontSize: 10, color: C.mut, display: 'block', marginBottom: 4 }}>Foto KTP</label>
                      {emp.ktp_url && (
                        <a href={emp.ktp_url} target="_blank" rel="noreferrer"
                          style={{ display: 'block', fontSize: 10, color: C.ok, marginBottom: 4, textDecoration: 'none' }}>
                          ✓ Lihat KTP →
                        </a>
                      )}
                      <label style={{ display: 'block', padding: '6px 10px', background: emp.ktp_url ? C.okBg : C.crm, border: `.5px dashed ${emp.ktp_url ? C.okBd : '#C4A88A'}`, borderRadius: 7, cursor: 'pointer', fontSize: 10, color: emp.ktp_url ? C.ok : C.mut, textAlign: 'center' }}>
                        <input type="file" accept="image/*,.pdf" style={{ display: 'none' }} onChange={e => uploadFile(emp.id, e.target.files[0], 'ktp')} />
                        {uploadingId === emp.id + 'ktp' ? '⏳ Upload...' : emp.ktp_url ? '🔄 Ganti KTP' : '📤 Upload KTP'}
                      </label>
                    </div>
                    <div>
                      <label style={{ fontSize: 10, color: C.mut, display: 'block', marginBottom: 4 }}>Foto Profil</label>
                      {emp.photo_url && (
                        <img src={emp.photo_url} alt="foto" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', display: 'block', marginBottom: 4, border: `.5px solid ${C.okBd}` }} />
                      )}
                      <label style={{ display: 'block', padding: '6px 10px', background: emp.photo_url ? C.okBg : C.crm, border: `.5px dashed ${emp.photo_url ? C.okBd : '#C4A88A'}`, borderRadius: 7, cursor: 'pointer', fontSize: 10, color: emp.photo_url ? C.ok : C.mut, textAlign: 'center' }}>
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => uploadFile(emp.id, e.target.files[0], 'photos')} />
                        {uploadingId === emp.id + 'photos' ? '⏳ Upload...' : emp.photo_url ? '🔄 Ganti Foto' : '📤 Upload Foto'}
                      </label>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 7 }}>
                  <button onClick={() => setEditingId(null)}
                    style={{ padding: '7px 14px', background: 'transparent', color: C.mut, border: '.5px solid #C4A88A', borderRadius: 7, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Batal
                  </button>
                  <button onClick={() => saveEdit(emp.id)} disabled={saving}
                    style={{ flex: 1, padding: '7px 14px', background: C.esp, color: C.crm, border: 'none', borderRadius: 7, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
                    {saving ? 'Menyimpan...' : '✓ Simpan Perubahan'}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: '#8B9E7E', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 500, color: '#fff', flexShrink: 0, overflow: 'hidden' }}>
                  {emp.photo_url
                    ? <img src={emp.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : emp.name?.split(' ').map(w => w[0]).join('').slice(0,2)
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: C.esp, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {emp.name}
                    {emp.ktp_url && <span style={{ fontSize: 9, background: C.okBg, color: C.ok, padding: '1px 5px', borderRadius: 4 }}>KTP ✓</span>}
                  </div>
                  <div style={{ fontSize: 10, color: C.mut }}>{emp.role} · {emp.phone} · Cuti: {emp.leave_balance} hr{emp.shift ? ` · ${emp.shift}` : ''}</div>
                </div>
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  <button onClick={() => { startEdit(emp); setAdding(false) }}
                    style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: `.5px solid ${C.infBd}`, background: C.infBg, color: C.inf, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                    ✏️ Edit
                  </button>
                  <button onClick={() => deleteEmployee(emp.id, emp.name)}
                    style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: `.5px solid ${C.dngBd}`, background: C.dngBg, color: C.dng, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 500 }}>
                    🗑
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </Card>
    </div>
  )
}


function ReportTab({ employees }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0,7))
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { fetchReport() }, [month])

  async function fetchReport() {
    setLoading(true)
    const start = month + '-01'
    const end = month + '-31'
    const { data: rows } = await supabase.from('attendance').select('*, employees(name,role,leave_balance)').gte('date', start).lte('date', end)
    // Group by employee
    const grouped = {}
    ;(rows || []).forEach(r => {
      const id = r.employee_id
      if (!grouped[id]) grouped[id] = { name: r.employees?.name, role: r.employees?.role, leave_balance: r.employees?.leave_balance, hadir: 0, sakit: 0, cuti: 0, ctb: 0, terlambat: 0 }
      if (r.status === 'hadir') grouped[id].hadir++
      if (r.status === 'sakit') grouped[id].sakit++
      if (r.status === 'cuti') grouped[id].cuti++
      if (r.status === 'ctb') grouped[id].ctb++
      if (r.is_late) grouped[id].terlambat++
    })
    setData(Object.values(grouped))
    setLoading(false)
  }

  function exportExcel() {
    const ws_data = [
      ['Laporan Kehadiran — Piccolo Corner — ' + month],
      [],
      ['Nama', 'Jabatan', 'Hadir', 'Terlambat', 'Sakit', 'Cuti', 'CTB', '% Hadir', 'Sisa Cuti'],
      ...data.map(d => {
        const total = d.hadir + d.sakit + d.cuti + d.ctb
        const pct = total > 0 ? Math.round((d.hadir / total) * 100) + '%' : '0%'
        return [d.name, d.role, d.hadir, d.terlambat, d.sakit, d.cuti, d.ctb, pct, d.leave_balance + ' hari']
      })
    ]
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet(ws_data)
    ws['!cols'] = [{ wch: 20 }, { wch: 15 }, { wch: 8 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 8 }, { wch: 10 }, { wch: 10 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Rekap Bulanan')
    XLSX.writeFile(wb, `Piccolo_Corner_Absensi_${month}.xlsx`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <div>
            <SectionTitle style={{ marginBottom: 2 }}>Laporan Bulanan</SectionTitle>
            <input type="month" value={month} onChange={e => setMonth(e.target.value)}
              style={{ padding: '6px 10px', border: '.5px solid #C4A88A', borderRadius: 8, fontSize: 12, background: C.crm, color: C.esp, fontFamily: 'inherit' }} />
          </div>
          <button onClick={exportExcel} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: '#1D6F42', color: '#fff', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            ↓ Export Excel
          </button>
        </div>
        {loading && <div style={{ textAlign: 'center', padding: '1rem', fontSize: 12, color: C.mut }}>Memuat data...</div>}
        {!loading && data.length === 0 && <div style={{ textAlign: 'center', padding: '1rem', fontSize: 12, color: C.mut }}>Tidak ada data untuk bulan ini</div>}
        {!loading && data.map((d, i) => {
          const total = d.hadir + d.sakit + d.cuti + d.ctb
          const pct = total > 0 ? Math.round((d.hadir / total) * 100) : 0
          return (
            <div key={i} style={{ padding: '8px 0', borderBottom: '.5px solid #F0E8DC' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                <div style={{ fontSize: 12, fontWeight: 500, color: C.esp, flex: 1 }}>{d.name}</div>
                <div style={{ fontSize: 10, color: C.mut }}>{d.role}</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: pct >= 90 ? C.ok : pct >= 75 ? C.wrn : C.dng }}>{pct}%</div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[['Hadir', d.hadir, C.ok], ['Tlmbt', d.terlambat, C.wrn], ['Sakit', d.sakit, C.inf], ['Cuti', d.cuti, C.ok], ['CTB', d.ctb, C.pur]].map(([l, v, c]) => (
                  <span key={l} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: '#F0EDE8', color: C.mut }}>{l}: <strong style={{ color: c }}>{v}</strong></span>
                ))}
                <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: d.leave_balance <= 3 ? C.wrnBg : C.okBg, color: d.leave_balance <= 3 ? C.wrn : C.ok }}>Cuti: {d.leave_balance} hr</span>
              </div>
            </div>
          )
        })}
      </Card>
    </div>
  )
}

function SettingsTab({ settings, onSave }) {
  const [form, setForm] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)
  const markerRef = useRef(null)
  useEffect(() => setForm(settings), [settings])

  useEffect(() => {
    if (!mapReady) return
    const L = window.L
    if (!L || mapInstanceRef.current) return
    const lat = parseFloat(form.cafe_lat) || -8.6786
    const lng = parseFloat(form.cafe_lng) || 115.2115
    const map = L.map(mapRef.current, { center: [lat, lng], zoom: 17 })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map)
    const icon = L.divIcon({
      html: '<div style="background:#1C1208;width:16px;height:16px;border-radius:50%;border:3px solid #C4956A;"></div>',
      iconSize: [16, 16], iconAnchor: [8, 8], className: ''
    })
    const marker = L.marker([lat, lng], { icon, draggable: true }).addTo(map)
    marker.on('dragend', e => {
      const pos = e.target.getLatLng()
      setForm(f => ({ ...f, cafe_lat: parseFloat(pos.lat.toFixed(6)), cafe_lng: parseFloat(pos.lng.toFixed(6)) }))
    })
    map.on('click', e => {
      marker.setLatLng(e.latlng)
      setForm(f => ({ ...f, cafe_lat: parseFloat(e.latlng.lat.toFixed(6)), cafe_lng: parseFloat(e.latlng.lng.toFixed(6)) }))
    })
    mapInstanceRef.current = map
    markerRef.current = marker
    return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null } }
  }, [mapReady])

  function loadMap() {
    if (window.L) { setMapReady(true); return }
    const link = document.createElement('link')
    link.rel = 'stylesheet'; link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
    document.head.appendChild(link)
    const script = document.createElement('script')
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    script.onload = () => setMapReady(true)
    document.head.appendChild(script)
  }

  function locateMe() {
    if (!navigator.geolocation) return alert('GPS tidak tersedia')
    navigator.geolocation.getCurrentPosition(pos => {
      const { latitude: lat, longitude: lng } = pos.coords
      setForm(f => ({ ...f, cafe_lat: parseFloat(lat.toFixed(6)), cafe_lng: parseFloat(lng.toFixed(6)) }))
      if (mapInstanceRef.current && markerRef.current) {
        mapInstanceRef.current.setView([lat, lng], 18)
        markerRef.current.setLatLng([lat, lng])
      }
    }, () => alert('Izin GPS ditolak'))
  }

  async function save() {
    setSaving(true)
    await supabase.from('work_settings').update({ ...form, updated_at: new Date().toISOString() }).eq('id', 1)
    setSaving(false); setSaved(true); onSave(form)
    setTimeout(() => setSaved(false), 3000)
  }

  const fields = [
    ['open_time', 'Jam Buka', 'time'],
    ['close_time', 'Jam Tutup', 'time'],
    ['late_tolerance_minutes', 'Toleransi Terlambat (menit)', 'number'],
    ['gps_radius_meters', 'Radius GPS (meter)', 'number'],
    ['doc_upload_deadline_days', 'Batas Upload Dokter (hari)', 'number'],
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <Card>
        <SectionTitle>Jam & Operasional</SectionTitle>
        {fields.map(([k, lbl, t]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: C.mut, display: 'block', marginBottom: 4 }}>{lbl}</label>
            <input type={t} value={form[k] || ''} min={1} step={1}
              onChange={e => setForm(f => ({ ...f, [k]: t === 'number' ? parseFloat(e.target.value) || e.target.value : e.target.value }))}
              style={{ padding: '8px 12px', border: '.5px solid #C4A88A', borderRadius: 8, fontSize: 13, background: C.crm, color: C.esp, fontFamily: 'inherit', width: t === 'number' ? 120 : 140 }} />
          </div>
        ))}
      </Card>

      <Card>
        <SectionTitle>Lokasi Cafe — Titik GPS</SectionTitle>
        <div style={{ background: C.infBg, border: `.5px solid ${C.infBd}`, borderRadius: 9, padding: '8px 12px', fontSize: 11, color: C.inf, marginBottom: 12, lineHeight: 1.5 }}>
          Klik <strong>"Buka Peta"</strong> → geser pin ke lokasi cafe → koordinat otomatis tersimpan. Atau klik <strong>"Lokasi Saya"</strong> jika sedang di cafe.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <button onClick={loadMap}
            style={{ padding: '8px 14px', background: C.esp, color: C.crm, border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            🗺 Buka Peta
          </button>
          <button onClick={locateMe}
            style={{ padding: '8px 14px', background: C.okBg, color: C.ok, border: `.5px solid ${C.okBd}`, borderRadius: 8, fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
            📍 Lokasi Saya (jika di cafe)
          </button>
        </div>

        {mapReady && (
          <div ref={mapRef} style={{ width: '100%', height: 280, borderRadius: 10, border: `.5px solid #E0D4C3`, marginBottom: 10, overflow: 'hidden' }} />
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 4 }}>Latitude</label>
            <input type="number" value={form.cafe_lat || ''} step={0.000001}
              onChange={e => {
                const v = parseFloat(e.target.value)
                setForm(f => ({ ...f, cafe_lat: v }))
                if (mapInstanceRef.current && markerRef.current && !isNaN(v)) {
                  markerRef.current.setLatLng([v, form.cafe_lng])
                  mapInstanceRef.current.setView([v, form.cafe_lng])
                }
              }}
              style={{ width: '100%', padding: '8px 10px', border: `.5px solid #C4A88A`, borderRadius: 8, fontSize: 12, background: C.crm, color: C.esp, fontFamily: 'inherit' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, color: C.mut, display: 'block', marginBottom: 4 }}>Longitude</label>
            <input type="number" value={form.cafe_lng || ''} step={0.000001}
              onChange={e => {
                const v = parseFloat(e.target.value)
                setForm(f => ({ ...f, cafe_lng: v }))
                if (mapInstanceRef.current && markerRef.current && !isNaN(v)) {
                  markerRef.current.setLatLng([form.cafe_lat, v])
                  mapInstanceRef.current.setView([form.cafe_lat, v])
                }
              }}
              style={{ width: '100%', padding: '8px 10px', border: `.5px solid #C4A88A`, borderRadius: 8, fontSize: 12, background: C.crm, color: C.esp, fontFamily: 'inherit' }} />
          </div>
        </div>

        {form.cafe_lat && form.cafe_lng && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.ok, background: C.okBg, border: `.5px solid ${C.okBd}`, borderRadius: 7, padding: '6px 10px' }}>
            ✓ Koordinat: {parseFloat(form.cafe_lat).toFixed(6)}, {parseFloat(form.cafe_lng).toFixed(6)}
          </div>
        )}
      </Card>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={save} disabled={saving}
          style={{ padding: '10px 22px', background: C.esp, color: C.crm, border: 'none', borderRadius: 9, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit' }}>
          {saving ? 'Menyimpan...' : '✓ Simpan Semua Pengaturan'}
        </button>
        {saved && <span style={{ fontSize: 12, color: C.ok }}>✓ Tersimpan!</span>}
      </div>
    </div>
  )
}


// ─── MAIN OWNER PAGE ─────────────────────────────────────────────────────────
export default function OwnerPage() {
  const user = useAuthStore(s => s.user)
  const logout = useAuthStore(s => s.logout)
  const navigate = useNavigate()
  const [tab, setTab] = useState('log')
  const [employees, setEmployees] = useState([])
  const [settings, setSettings] = useState({})
  const today = (() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()

  useEffect(() => { fetchAll() }, [])
  async function fetchAll() {
    const { data: emps } = await supabase.from('employees').select('*').order('name')
    if (emps) setEmployees(emps)
    const { data: s } = await supabase.from('work_settings').select('*').eq('id', 1).single()
    if (s) setSettings(s)
  }

  const tabs = [['log', 'Log Harian'], ['leave', 'Persetujuan'], ['employees', 'Karyawan'], ['report', 'Laporan'], ['settings', 'Pengaturan']]

  return (
    <div style={{ minHeight: '100vh', background: '#E8E2D8', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ background: C.esp, padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: C.lat, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15 }}>☕</div>
          <div>
            <div style={{ fontFamily: 'Georgia,serif', fontSize: 13, color: C.crm }}>Piccolo Corner</div>
            <div style={{ fontSize: 9, color: C.lat, letterSpacing: '.07em', textTransform: 'uppercase' }}>Owner Dashboard</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: C.lat, fontFamily: 'Georgia,serif' }}>👑 {user?.name}</span>
          <button onClick={() => { logout(); navigate('/login') }}
            style={{ fontSize: 10, padding: '4px 10px', background: 'transparent', border: `.5px solid rgba(196,149,106,.5)`, borderRadius: 6, color: C.lat, cursor: 'pointer', fontFamily: 'inherit' }}>
            Keluar
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: C.foam, borderBottom: '.5px solid #E0D4C3', padding: '6px 12px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {tabs.map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: tab === key ? 500 : 400, whiteSpace: 'nowrap',
              background: tab === key ? C.esp : 'transparent', color: tab === key ? C.crm : C.mut }}>
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px', maxWidth: 900, width: '100%', margin: '0 auto' }}>
        {tab === 'log' && <LogTab employees={employees} today={today} />}
        {tab === 'leave' && <LeaveTab employees={employees} />}
        {tab === 'employees' && <EmployeesTab employees={employees} onRefresh={fetchAll} />}
        {tab === 'report' && <ReportTab employees={employees} />}
        {tab === 'settings' && <SettingsTab settings={settings} onSave={s => setSettings(s)} />}
      </div>
    </div>
  )
}
