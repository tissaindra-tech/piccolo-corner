// OwnerPage v2.0 - Program Insentif, Izin Tugas, Clock In/Out
import React, { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../hooks/useAuth.js'
import { supabase } from '../lib/supabase.js'
import * as XLSX from 'xlsx'

const T = {
  black:'#111111', white:'#FAFAF8', bg:'#F9FAFB',
  orange:'#F97316', orangeLight:'#FFF7ED',
  green:'#16A34A', greenLight:'#F0FDF4', greenBd:'#86EFAC',
  red:'#DC2626', redLight:'#FEF2F2', redBd:'#FECACA',
  blue:'#2563EB', blueLight:'#EFF6FF', blueBd:'#93C5FD',
  amber:'#D97706', amberLight:'#FFFBEB', amberBd:'#FCD34D',
  purple:'#7C3AED', purpleLight:'#F5F3FF', purpleBd:'#C4B5FD',
  border:'#E5E7EB', surface:'#FFFFFF', muted:'#9CA3AF',
  dng:'#C0392B', dngBg:'#FEF2F2',
}

function localDate(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function fmtTime(iso){
  if(!iso) return '—'
  return new Date(iso).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})
}
function fmtDur(inIso,outIso){
  if(!inIso||!outIso) return null
  const diff=Math.round((new Date(outIso)-new Date(inIso))/60000)
  return `${Math.floor(diff/60)}j ${diff%60}m`
}
function calcIncentiveRp(att){
  // Ontime ≤10:30 = +10.000 | Telat 1-5m = -2.000 | 6-30m = -6.000 | >30m = -10.000
  if(!att) return 0
  if(att.status!=='hadir') return 0
  if(att.is_excused) return 10000  // izin tugas = ontime penuh
  if(!att.is_late) return 10000
  const m=att.late_minutes||0
  if(m<=5) return -2000
  if(m<=30) return -6000
  return -10000
}
function fmtRp(val){
  const abs=Math.abs(val).toLocaleString('id-ID')
  return val>=0?`+Rp ${abs}`:`−Rp ${abs}`
}

const statusCfg={
  hadir:{color:T.green,bg:T.greenLight,bd:T.greenBd,label:'Hadir'},
  sakit:{color:T.blue,bg:T.blueLight,bd:T.blueBd,label:'Sakit'},
  cuti:{color:T.green,bg:T.greenLight,bd:T.greenBd,label:'Cuti'},
  ctb:{color:T.purple,bg:T.purpleLight,bd:T.purpleBd,label:'CTB'},
  day_off:{color:T.amber,bg:T.amberLight,bd:T.amberBd,label:'Day Off'},
}
function Badge({status,excused}){
  if(excused) return <span style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:T.blueLight,color:T.blue,border:`.5px solid ${T.blueBd}`}}>Izin Tugas</span>
  const s=statusCfg[status]||{color:T.muted,bg:'#F3F4F6',bd:T.border,label:status}
  return <span style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:s.bg,color:s.color,border:`.5px solid ${s.bd}`}}>{s.label}</span>
}

// ── NOTIFIKASI ─────────────────────────────────────────────────────────────
async function reqNotif(){
  if(!('Notification'in window)) return false
  if(Notification.permission==='granted') return true
  return (await Notification.requestPermission())==='granted'
}
function notify(title,body){
  if(Notification.permission!=='granted') return
  new Notification(`☕ ${title}`,{body})
}

// ── LOG TAB ────────────────────────────────────────────────────────────────
function LogTab({today,incentiveActive}){
  const [logs,setLogs]=useState([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState(null)
  const [viewDate,setViewDate]=useState(today)
  const [lightbox,setLightbox]=useState(null)
  const [excuseModal,setExcuseModal]=useState(null) // attendance record
  const [excuseReason,setExcuseReason]=useState('')
  const [excuseSaving,setExcuseSaving]=useState(false)

  useEffect(()=>{fetchLogs(viewDate)},[viewDate])

  useEffect(()=>{
    const ch=supabase.channel('att-rt')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'attendance'},async p=>{
        const {data:e}=await supabase.from('employees').select('name').eq('id',p.new.employee_id).single()
        notify('Karyawan Clock In',`${e?.name||'Karyawan'} baru saja absen masuk`)
        fetchLogs(viewDate)
      })
      .on('postgres_changes',{event:'UPDATE',schema:'public',table:'attendance'},p=>{
        if(p.new.check_out&&!p.old.check_out) notify('Karyawan Clock Out','Ada karyawan yang clock out')
        fetchLogs(viewDate)
      })
      .subscribe()
    const ch2=supabase.channel('gps-rt')
      .on('postgres_changes',{event:'INSERT',schema:'public',table:'gps_fraud_log'},async p=>{
        const {data:e}=await supabase.from('employees').select('name').eq('id',p.new.employee_id).single()
        notify('⚠ GPS Fraud',`${e?.name||'Karyawan'} coba absen dari luar area`)
      })
      .subscribe()
    return ()=>{supabase.removeChannel(ch);supabase.removeChannel(ch2)}
  },[viewDate])

  async function fetchLogs(date){
    setLoading(true);setError(null)
    try{
      const {data,error}=await supabase.from('attendance')
        .select('*,employees!employee_id(name,role,photo_url,incentive_enabled)')
        .eq('date',date)
        .order('check_in',{ascending:false,nullsFirst:false})
      if(error) throw error
      setLogs(data||[])
    }catch(e){setError(e.message)}
    setLoading(false)
  }

  async function giveExcuse(attId){
    setExcuseSaving(true)
    await supabase.from('attendance').update({
      is_excused:true,
      excuse_reason:excuseReason,
      excused_at:new Date().toISOString(),
      excused_by:'owner',
      is_late:false,
      late_minutes:0,
    }).eq('id',attId)
    setExcuseSaving(false);setExcuseModal(null);setExcuseReason('')
    fetchLogs(viewDate)
  }

  const stats={hadir:0,sakit:0,cuti:0,day_off:0,ctb:0,total_rp:0}
  logs.forEach(l=>{
    if(stats[l.status]!==undefined) stats[l.status]++
    if(l.employees?.incentive_enabled!==false) stats.total_rp+=calcIncentiveRp(l)
  })

  const inp={fontSize:13,padding:'8px 11px',border:`.5px solid ${T.border}`,borderRadius:9,background:T.bg,color:T.black,fontFamily:'inherit',width:'100%'}

  return(
    <div style={{padding:'0 0 80px'}}>
      {/* Lightbox */}
      {lightbox&&<div onClick={()=>setLightbox(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.9)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:10}}>
        <img src={lightbox} alt="" style={{maxWidth:'92vw',maxHeight:'82vh',borderRadius:14,objectFit:'contain'}}/>
        <div style={{color:'#fff',fontSize:12,opacity:.6}}>Tap untuk tutup</div>
      </div>}

      {/* Excuse Modal */}
      {excuseModal&&<div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.55)',zIndex:1000,display:'flex',alignItems:'flex-end'}}>
        <div style={{background:T.surface,borderRadius:'20px 20px 0 0',padding:20,width:'100%',maxHeight:'85vh',overflowY:'auto'}}>
          <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:14}}>
            <div style={{width:40,height:40,borderRadius:12,background:T.blueLight,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>📋</div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:T.black}}>Beri Izin Tugas</div>
              <div style={{fontSize:11,color:T.muted}}>{excuseModal.employees?.name} · {viewDate}</div>
            </div>
          </div>
          <div style={{background:T.redLight,border:`.5px solid ${T.redBd}`,borderRadius:10,padding:'9px 12px',marginBottom:14,fontSize:12,color:T.red}}>
            Clock in {fmtTime(excuseModal.check_in)} · Terlambat {excuseModal.late_minutes} menit → saat ini {fmtRp(calcIncentiveRp(excuseModal))}
          </div>
          <div style={{background:T.blueLight,border:`.5px solid ${T.blueBd}`,borderRadius:10,padding:'9px 12px',marginBottom:14,fontSize:12,color:T.blue,lineHeight:1.6}}>
            ✓ Setelah diberi izin → dihitung <strong>Ontime</strong> → insentif berubah menjadi <strong>+Rp 10.000</strong>
          </div>
          <div style={{marginBottom:12}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:5}}>Alasan tugas (wajib diisi)</div>
            <textarea value={excuseReason} onChange={e=>setExcuseReason(e.target.value)} rows={3}
              placeholder="Contoh: Belanja kebutuhan cafe di pasar atas permintaan owner..."
              style={{...inp,resize:'vertical'}}/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
            <button onClick={()=>{setExcuseModal(null);setExcuseReason('')}}
              style={{padding:12,background:T.bg,color:T.black,border:`.5px solid ${T.border}`,borderRadius:10,fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>Batal</button>
            <button onClick={()=>giveExcuse(excuseModal.id)} disabled={excuseSaving||!excuseReason.trim()}
              style={{padding:12,background:T.black,color:'#fff',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:(excuseSaving||!excuseReason.trim())?.6:1}}>
              {excuseSaving?'Menyimpan...':'✓ Beri Izin'}
            </button>
          </div>
        </div>
      </div>}

      {/* Stats */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:6,padding:'14px 14px 0'}}>
        {[['Hadir',stats.hadir,T.green],['Sakit',stats.sakit,T.blue],['Cuti',stats.cuti,T.green],['Day Off',stats.day_off,T.amber],['CTB',stats.ctb,T.purple]].map(([l,v,c])=>(
          <div key={l} style={{background:T.surface,borderRadius:12,padding:'9px 6px',border:`.5px solid ${T.border}`,textAlign:'center'}}>
            <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.06em',color:T.muted,marginBottom:3}}>{l}</div>
            <div style={{fontSize:20,fontWeight:800,color:c}}>{v}</div>
          </div>
        ))}
      </div>

      {/* Total insentif hari ini — hanya tampil kalau program aktif */}
      {incentiveActive && <div style={{margin:'8px 14px 0',background:stats.total_rp>=0?T.greenLight:T.redLight,border:`.5px solid ${stats.total_rp>=0?T.greenBd:T.redBd}`,borderRadius:10,padding:'8px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{fontSize:11,color:stats.total_rp>=0?T.green:T.red}}>Total insentif karyawan hari ini</div>
        <div style={{fontSize:14,fontWeight:800,color:stats.total_rp>=0?T.green:T.red}}>{fmtRp(stats.total_rp)}</div>
      </div>}

      {/* Filter */}
      <div style={{display:'flex',alignItems:'center',gap:8,padding:'10px 14px 0'}}>
        <div style={{fontSize:10,fontWeight:700,textTransform:'uppercase',letterSpacing:'.1em',color:T.muted}}>Log</div>
        <input type="date" value={viewDate} onChange={e=>setViewDate(e.target.value)}
          style={{fontSize:12,padding:'5px 9px',border:`.5px solid ${T.border}`,borderRadius:8,background:T.bg,color:T.black,fontFamily:'inherit',fontWeight:600}}/>
        <button onClick={()=>fetchLogs(viewDate)}
          style={{marginLeft:'auto',fontSize:11,padding:'5px 12px',borderRadius:8,border:`.5px solid ${T.border}`,background:T.surface,color:T.muted,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
          ↻
        </button>
      </div>

      {/* Log list */}
      <div style={{padding:'10px 14px 0',display:'flex',flexDirection:'column',gap:8}}>
        {loading&&<div style={{textAlign:'center',padding:'2rem',fontSize:13,color:T.muted}}>Memuat...</div>}
        {!loading&&error&&<div style={{background:T.dngBg,borderRadius:12,padding:12,fontSize:12,color:T.dng}}>⚠ {error}</div>}
        {!loading&&!error&&logs.length===0&&(
          <div style={{textAlign:'center',padding:'2rem',background:T.surface,borderRadius:16,border:`.5px solid ${T.border}`}}>
            <div style={{fontSize:28,marginBottom:8}}>📋</div>
            <div style={{fontSize:13,fontWeight:600,color:T.black}}>Tidak ada data untuk {viewDate}</div>
          </div>
        )}
        {!loading&&logs.map(l=>{
          const selfieIn=l.doc_url&&l.doc_url.includes('selfie')?l.doc_url:null
          const selfieOut=l.note?.match(/selfie_out:([^\|]+)/)?.[1]||null
          const dur=fmtDur(l.check_in,l.check_out)
          const rp=calcIncentiveRp(l)
          const inProg=l.employees?.incentive_enabled!==false
          return(
            <div key={l.id} style={{background:T.surface,borderRadius:18,border:`.5px solid ${T.border}`,overflow:'hidden'}}>
              {/* Top */}
              <div style={{display:'flex',alignItems:'center',gap:10,padding:'11px 14px 10px',borderBottom:`.5px solid ${T.border}`}}>
                <div style={{width:36,height:36,borderRadius:'50%',background:'#D1D5DB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#fff',flexShrink:0,overflow:'hidden',border:`.5px solid ${T.border}`}}>
                  {l.employees?.photo_url?<img src={l.employees.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:l.employees?.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:13,fontWeight:700,color:T.black}}>{l.employees?.name}</div>
                  <div style={{fontSize:10,color:T.muted,display:'flex',alignItems:'center',gap:5,flexWrap:'wrap'}}>
                    {l.employees?.role}
                    {l.is_late&&!l.is_excused&&<span style={{background:T.amberLight,color:T.amber,fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:20}}>+{l.late_minutes}m terlambat</span>}
                    {l.is_excused&&<span style={{background:T.blueLight,color:T.blue,fontSize:9,fontWeight:700,padding:'1px 5px',borderRadius:20}}>Izin Tugas</span>}
                    {!inProg&&<span style={{background:'#F3F4F6',color:T.muted,fontSize:9,padding:'1px 5px',borderRadius:20}}>Tidak ikut program</span>}
                  </div>
                </div>
                <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4}}>
                  <Badge status={l.status} excused={l.is_excused}/>
                  {incentiveActive&&inProg&&l.status==='hadir'&&(
                    <div style={{fontSize:11,fontWeight:700,color:rp>=0?T.green:T.red}}>{fmtRp(rp)}</div>
                  )}
                </div>
              </div>

              {/* Clock detail */}
              {l.status==='hadir'&&(
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:0}}>
                  <div style={{padding:'9px 12px',borderRight:`.5px solid ${T.border}`}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:T.muted,marginBottom:3}}>Clock In</div>
                    <div style={{fontSize:15,fontWeight:800,color:T.black}}>{fmtTime(l.check_in)}</div>
                    {l.gps_dist_in!=null&&<div style={{fontSize:9,color:T.green,marginTop:1}}>📍{l.gps_dist_in}m</div>}
                  </div>
                  <div style={{padding:'9px 12px',borderRight:`.5px solid ${T.border}`}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:T.muted,marginBottom:3}}>Clock Out</div>
                    <div style={{fontSize:15,fontWeight:800,color:l.check_out?T.black:'#CCC'}}>{fmtTime(l.check_out)}</div>
                    {l.gps_dist_out!=null&&<div style={{fontSize:9,color:T.green,marginTop:1}}>📍{l.gps_dist_out}m</div>}
                  </div>
                  <div style={{padding:'9px 12px'}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:'uppercase',letterSpacing:'.07em',color:T.muted,marginBottom:3}}>Durasi</div>
                    <div style={{fontSize:15,fontWeight:800,color:dur?T.purple:'#CCC'}}>{dur||'—'}</div>
                  </div>
                </div>
              )}

              {/* Izin tugas info */}
              {l.is_excused&&l.excuse_reason&&(
                <div style={{margin:'0 12px 8px',background:T.blueLight,borderRadius:9,padding:'7px 10px',borderLeft:`3px solid ${T.blue}`,fontSize:10,color:T.blue,lineHeight:1.5}}>
                  <strong>Izin Tugas:</strong> {l.excuse_reason}
                </div>
              )}

              {/* Selfies */}
              {(selfieIn||selfieOut)&&(
                <div style={{display:'flex',gap:8,padding:'9px 14px',borderTop:`.5px solid ${T.border}`,background:T.bg}}>
                  {selfieIn&&<div onClick={()=>setLightbox(selfieIn)} style={{cursor:'pointer'}}>
                    <div style={{fontSize:9,fontWeight:600,color:T.muted,marginBottom:3}}>Selfie Masuk</div>
                    <img src={selfieIn} alt="" style={{width:48,height:48,borderRadius:9,objectFit:'cover',border:`.5px solid ${T.border}`}}/>
                  </div>}
                  {selfieOut&&<div onClick={()=>setLightbox(selfieOut)} style={{cursor:'pointer'}}>
                    <div style={{fontSize:9,fontWeight:600,color:T.muted,marginBottom:3}}>Selfie Keluar</div>
                    <img src={selfieOut} alt="" style={{width:48,height:48,borderRadius:9,objectFit:'cover',border:`.5px solid ${T.border}`}}/>
                  </div>}
                </div>
              )}

              {/* Beri Izin button */}
              {incentiveActive&&l.status==='hadir'&&l.is_late&&!l.is_excused&&(
                <div style={{padding:'8px 12px',borderTop:`.5px solid ${T.border}`}}>
                  <button onClick={()=>{setExcuseModal(l);setExcuseReason('')}}
                    style={{fontSize:11,fontWeight:700,padding:'7px 14px',borderRadius:8,border:`.5px solid ${T.blueBd}`,background:T.blueLight,color:T.blue,cursor:'pointer',fontFamily:'inherit'}}>
                    + Beri Izin Tugas
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── LEAVE TAB ──────────────────────────────────────────────────────────────
function LeaveTab({employees}){
  const [reqs,setReqs]=useState([])
  const [saving,setSaving]=useState(null)
  useEffect(()=>{fetch()},[])
  async function fetch(){
    const {data}=await supabase.from('leave_requests').select('*,employees!employee_id(name,role)').eq('status','pending').order('created_at',{ascending:false})
    setReqs(data||[])
  }
  async function review(id,status,empId,type,days){
    setSaving(id)
    await supabase.from('leave_requests').update({status,reviewed_at:new Date().toISOString()}).eq('id',id)
    if(status==='rejected'&&type==='cuti'){
      const emp=employees.find(e=>e.id===empId)
      if(emp) await supabase.from('employees').update({leave_balance:emp.leave_balance+days}).eq('id',empId)
    }
    setSaving(null);fetch()
  }
  const ico={cuti:'📅',sakit:'💊',day_off:'🌴',ctb:'📋'}
  return(
    <div style={{padding:'14px 14px 80px',display:'flex',flexDirection:'column',gap:8}}>
      {reqs.length===0&&<div style={{textAlign:'center',padding:'3rem',background:T.surface,borderRadius:18,border:`.5px solid ${T.border}`}}>
        <div style={{fontSize:32,marginBottom:8}}>✅</div>
        <div style={{fontSize:14,fontWeight:700,color:T.black}}>Semua sudah diproses</div>
      </div>}
      {reqs.map(r=>(
        <div key={r.id} style={{background:T.surface,borderRadius:16,border:`.5px solid ${T.border}`,overflow:'hidden'}}>
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px'}}>
            <div style={{width:38,height:38,borderRadius:11,background:T.amberLight,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{ico[r.type]||'📋'}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:700,color:T.black}}>{r.employees?.name}</div>
              <div style={{fontSize:10,color:T.muted}}>{r.employees?.role} · {r.type.toUpperCase()} · {new Date(r.date_start).toLocaleDateString('id-ID',{day:'numeric',month:'short'})}</div>
              {r.reason&&<div style={{fontSize:11,color:T.muted,marginTop:2,fontStyle:'italic'}}>{r.reason}</div>}
            </div>
            {r.doc_url&&<a href={r.doc_url} target="_blank" rel="noreferrer" style={{fontSize:10,color:T.purple,fontWeight:700,textDecoration:'none'}}>📎</a>}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',borderTop:`.5px solid ${T.border}`}}>
            <button onClick={()=>review(r.id,'rejected',r.employee_id,r.type,r.days)} disabled={saving===r.id}
              style={{padding:11,background:T.dngBg,color:T.dng,border:'none',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',borderRight:`.5px solid ${T.border}`}}>✕ Tolak</button>
            <button onClick={()=>review(r.id,'approved',r.employee_id,r.type,r.days)} disabled={saving===r.id}
              style={{padding:11,background:T.greenLight,color:T.green,border:'none',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{saving===r.id?'...':'✓ Setujui'}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── EMPLOYEES TAB ──────────────────────────────────────────────────────────
function EmployeesTab({employees,onRefresh}){
  const [form,setForm]=useState({name:'',role:'',phone:'',pin:'',shift:'',leave_balance:12})
  const [adding,setAdding]=useState(false)
  const [saving,setSaving]=useState(false)
  const [editingId,setEditingId]=useState(null)
  const [editForm,setEditForm]=useState({})
  const [uploadingId,setUploadingId]=useState(null)
  const inp={width:'100%',padding:'9px 11px',border:`.5px solid ${T.border}`,borderRadius:9,fontSize:12,background:T.bg,color:T.black,fontFamily:'inherit'}

  async function addEmp(){
    setSaving(true)
    await supabase.from('employees').insert({...form,leave_balance:parseInt(form.leave_balance),incentive_enabled:true})
    setSaving(false);setAdding(false);setForm({name:'',role:'',phone:'',pin:'',shift:'',leave_balance:12});onRefresh()
  }
  function startEdit(emp){setEditingId(emp.id);setEditForm({name:emp.name,role:emp.role,phone:emp.phone,pin:'',shift:emp.shift||'',leave_balance:emp.leave_balance,incentive_enabled:emp.incentive_enabled!==false})}
  async function saveEdit(id){
    setSaving(true)
    const u={name:editForm.name,role:editForm.role,phone:editForm.phone,shift:editForm.shift,leave_balance:parseInt(editForm.leave_balance),incentive_enabled:editForm.incentive_enabled}
    if(editForm.pin?.length>=4) u.pin=editForm.pin
    await supabase.from('employees').update(u).eq('id',id)
    setSaving(false);setEditingId(null);onRefresh()
  }
  async function toggleIncentive(id,current){
    await supabase.from('employees').update({incentive_enabled:!current}).eq('id',id)
    onRefresh()
  }
  async function delEmp(id,name){
    if(!window.confirm(`Hapus "${name}"? Data absensi tetap tersimpan.`)) return
    await supabase.from('employees').delete().eq('id',id);onRefresh()
  }
  async function uploadFile(empId,file,type){
    if(!file) return
    setUploadingId(empId+type)
    const ext=file.name.split('.').pop()
    const {data}=await supabase.storage.from('documents').upload(`${type}/${empId}_${Date.now()}.${ext}`,file,{upsert:true})
    if(data){const {data:u}=supabase.storage.from('documents').getPublicUrl(data.path);await supabase.from('employees').update({[type==='ktp'?'ktp_url':'photo_url']:u.publicUrl}).eq('id',empId);onRefresh()}
    setUploadingId(null)
  }

  return(
    <div style={{padding:'14px 14px 80px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
        <div style={{fontSize:11,fontWeight:700,color:T.muted}}>KARYAWAN ({employees.filter(e=>!e.is_owner).length})</div>
        <button onClick={()=>{setAdding(!adding);setEditingId(null)}}
          style={{padding:'7px 14px',background:T.black,color:'#fff',border:'none',borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{adding?'Batal':'+ Tambah'}</button>
      </div>

      {adding&&<div style={{background:T.surface,borderRadius:16,padding:14,marginBottom:10,border:`.5px solid ${T.border}`}}>
        <div style={{fontSize:12,fontWeight:700,color:T.black,marginBottom:10}}>Tambah Karyawan Baru</div>
        {[['name','Nama Lengkap'],['role','Jabatan'],['shift','Shift (opsional)']].map(([k,l])=>(
          <div key={k} style={{marginBottom:8}}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>{l}</div><input value={form[k]} onChange={e=>setForm(f=>({...f,[k]:e.target.value}))} style={inp}/></div>
        ))}
        <div style={{marginBottom:8}}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Nomor HP</div><input type="tel" inputMode="numeric" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="08xxxxxxxxxx" style={inp}/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
          <div><div style={{fontSize:11,color:T.muted,marginBottom:3}}>PIN (4–6 angka)</div><input type="text" inputMode="numeric" maxLength={6} value={form.pin} onChange={e=>setForm(f=>({...f,pin:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="123456" style={{...inp,letterSpacing:'.15em',fontWeight:700}}/></div>
          <div><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Hak Cuti (hari)</div><input type="number" value={form.leave_balance} onChange={e=>setForm(f=>({...f,leave_balance:e.target.value}))} min={0} max={30} style={inp}/></div>
        </div>
        <button onClick={addEmp} disabled={saving||!form.name||!form.phone||form.pin.length<4}
          style={{width:'100%',padding:11,background:T.black,color:'#fff',border:'none',borderRadius:10,fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:(saving||!form.name||!form.phone||form.pin.length<4)?.5:1}}>
          {saving?'Menyimpan...':'Simpan Karyawan'}
        </button>
      </div>}

      <div style={{display:'flex',flexDirection:'column',gap:7}}>
        {employees.filter(e=>!e.is_owner).map(emp=>(
          <div key={emp.id}>
            {editingId===emp.id?(
              <div style={{background:T.purpleLight,borderRadius:16,padding:14,border:`.5px solid ${T.purpleBd}`}}>
                <div style={{fontSize:12,fontWeight:700,color:T.purple,marginBottom:10}}>Edit: {emp.name}</div>
                {[['name','Nama'],['role','Jabatan'],['shift','Shift']].map(([k,l])=>(
                  <div key={k} style={{marginBottom:8}}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>{l}</div><input value={editForm[k]||''} onChange={e=>setEditForm(f=>({...f,[k]:e.target.value}))} style={inp}/></div>
                ))}
                <div style={{marginBottom:8}}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Nomor HP</div><input type="tel" inputMode="numeric" value={editForm.phone||''} onChange={e=>setEditForm(f=>({...f,phone:e.target.value}))} style={inp}/></div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                  <div><div style={{fontSize:11,color:T.muted,marginBottom:3}}>PIN Baru (kosongkan jika tidak ubah)</div><input type="text" inputMode="numeric" maxLength={6} value={editForm.pin||''} onChange={e=>setEditForm(f=>({...f,pin:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="angka baru" style={{...inp,letterSpacing:'.15em',fontWeight:700}}/></div>
                  <div><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Hak Cuti</div><input type="number" value={editForm.leave_balance||0} onChange={e=>setEditForm(f=>({...f,leave_balance:e.target.value}))} min={0} max={30} style={inp}/></div>
                </div>

                {/* Program Insentif Toggle */}
                <div style={{background:'rgba(255,255,255,.6)',borderRadius:10,padding:'10px 12px',marginBottom:10,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div>
                    <div style={{fontSize:12,fontWeight:600,color:T.black}}>Program Insentif</div>
                    <div style={{fontSize:10,color:T.muted}}>Ikut program bonus & potongan</div>
                  </div>
                  <button onClick={()=>setEditForm(f=>({...f,incentive_enabled:!f.incentive_enabled}))}
                    style={{width:44,height:24,borderRadius:12,border:'none',cursor:'pointer',position:'relative',background:editForm.incentive_enabled?T.black:'#D1D5DB',transition:'background .2s',flexShrink:0}}>
                    <div style={{width:16,height:16,borderRadius:'50%',background:'#fff',position:'absolute',top:4,left:editForm.incentive_enabled?24:4,transition:'left .2s'}}/>
                  </button>
                </div>

                {/* Upload dokumen */}
                <div style={{background:'rgba(255,255,255,.6)',borderRadius:10,padding:'10px 12px',marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:600,color:T.black,marginBottom:8}}>Upload Dokumen</div>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
                    {[['ktp','Foto KTP','ktp_url'],['photos','Foto Profil','photo_url']].map(([type,lbl,field])=>(
                      <div key={type}>
                        <div style={{fontSize:10,color:T.muted,marginBottom:3}}>{lbl}</div>
                        {emp[field]&&<a href={emp[field]} target="_blank" rel="noreferrer" style={{fontSize:10,color:T.green,display:'block',marginBottom:3}}>✓ Lihat →</a>}
                        <label style={{display:'block',padding:'6px 9px',background:T.bg,border:`.5px dashed ${T.border}`,borderRadius:8,cursor:'pointer',fontSize:10,color:T.muted,textAlign:'center'}}>
                          <input type="file" accept="image/*,.pdf" style={{display:'none'}} onChange={e=>uploadFile(emp.id,e.target.files[0],type)}/>
                          {uploadingId===emp.id+type?'⏳...':'📤 Upload'}
                        </label>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{display:'flex',gap:7}}>
                  <button onClick={()=>setEditingId(null)} style={{flex:1,padding:10,background:T.bg,color:T.black,border:`.5px solid ${T.border}`,borderRadius:9,fontSize:12,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Batal</button>
                  <button onClick={()=>saveEdit(emp.id)} disabled={saving} style={{flex:2,padding:10,background:T.black,color:'#fff',border:'none',borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                    {saving?'Menyimpan...':'✓ Simpan'}
                  </button>
                </div>
              </div>
            ):(
              <div style={{background:T.surface,borderRadius:14,border:`.5px solid ${T.border}`,display:'flex',alignItems:'center',gap:9,padding:'11px 13px'}}>
                <div style={{width:38,height:38,borderRadius:'50%',background:'#D1D5DB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:12,fontWeight:700,color:'#fff',flexShrink:0,overflow:'hidden'}}>
                  {emp.photo_url?<img src={emp.photo_url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/>:emp.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.black,display:'flex',alignItems:'center',gap:5}}>
                    {emp.name}
                    {emp.ktp_url&&<span style={{fontSize:9,background:T.greenLight,color:T.green,padding:'1px 5px',borderRadius:4,fontWeight:600}}>KTP✓</span>}
                    {emp.incentive_enabled===false&&<span style={{fontSize:9,background:'#F3F4F6',color:T.muted,padding:'1px 5px',borderRadius:4}}>Non-program</span>}
                  </div>
                  <div style={{fontSize:10,color:T.muted}}>{emp.role} · {emp.phone} · Cuti: {emp.leave_balance}hr{emp.shift?` · ${emp.shift}`:''}</div>
                </div>
                <div style={{display:'flex',gap:5,flexShrink:0}}>
                  <button onClick={()=>{startEdit(emp);setAdding(false)}} style={{fontSize:11,padding:'4px 9px',borderRadius:7,border:`.5px solid ${T.purpleBd}`,background:T.purpleLight,color:T.purple,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>✏️</button>
                  <button onClick={()=>delEmp(emp.id,emp.name)} style={{fontSize:11,padding:'4px 9px',borderRadius:7,border:`.5px solid ${T.redBd}`,background:T.redLight,color:T.red,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>🗑</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── REPORT TAB ─────────────────────────────────────────────────────────────
function ReportTab({employees}){
  const [month,setMonth]=useState(localDate().slice(0,7))
  const [data,setData]=useState([])
  const [loading,setLoading]=useState(false)
  useEffect(()=>{fetchReport()},[month])

  function calcEmpRp(atts,incentive_enabled){
    if(!incentive_enabled) return null
    let total=0
    atts.forEach(a=>{ total+=calcIncentiveRp(a) })
    return total
  }

  async function fetchReport(){
    setLoading(true)
    const {data:rows}=await supabase.from('attendance').select('*,employees!employee_id(name,role,leave_balance,incentive_enabled)').gte('date',month+'-01').lte('date',month+'-31')
    const grouped={};const empAtts={}
    ;(rows||[]).forEach(r=>{
      const id=r.employee_id
      if(!grouped[id]){
        grouped[id]={name:r.employees?.name,role:r.employees?.role,leave_balance:r.employees?.leave_balance,incentive_enabled:r.employees?.incentive_enabled!==false,hadir:0,sakit:0,cuti:0,ctb:0,day_off:0,terlambat:0,izin_tugas:0,total_dur_min:0}
        empAtts[id]=[]
      }
      empAtts[id].push(r)
      if(r.status==='hadir'){grouped[id].hadir++;const d=r.check_in&&r.check_out?Math.round((new Date(r.check_out)-new Date(r.check_in))/60000):0;grouped[id].total_dur_min+=d}
      if(r.status==='sakit') grouped[id].sakit++
      if(r.status==='cuti') grouped[id].cuti++
      if(r.status==='ctb') grouped[id].ctb++
      if(r.status==='day_off') grouped[id].day_off++
      if(r.is_late&&!r.is_excused) grouped[id].terlambat++
      if(r.is_excused) grouped[id].izin_tugas++
    })
    Object.keys(grouped).forEach(id=>{
      grouped[id].total_rp=calcEmpRp(empAtts[id]||[],grouped[id].incentive_enabled)
    })
    setData(Object.values(grouped));setLoading(false)
  }

  function exportExcel(){
    const ws1=[
      ['LAPORAN KEHADIRAN & INSENTIF — PICCOLO CORNER — '+month],
      ['Sistem: Ontime ≤10:30 (+Rp10.000) | Telat 1-5m (-Rp2.000) | 6-30m (-Rp6.000) | >30m/setelah 11:00 (-Rp10.000 potong gaji)'],
      [],
      ['Nama','Jabatan','Program','Hadir','Terlambat','Izin Tugas','Sakit','Cuti','Day Off','CTB','% Hadir','Rata2 Kerja','Insentif (Rp)','Sisa Cuti'],
      ...data.map(d=>{
        const total=d.hadir+d.sakit+d.cuti+d.ctb+d.day_off
        const pct=total>0?Math.round((d.hadir/total)*100)+'%':'0%'
        const avg=d.hadir>0?`${Math.floor(d.total_dur_min/d.hadir/60)}j${d.total_dur_min/d.hadir%60|0}m`:'—'
        const rp=d.total_rp
        const rpStr=rp===null?'Tidak ikut':rp>=0?'Rp '+rp.toLocaleString('id-ID'):'−Rp '+Math.abs(rp).toLocaleString('id-ID')
        return[d.name,d.role,d.incentive_enabled?'Ikut':'Tidak ikut',d.hadir,d.terlambat,d.izin_tugas,d.sakit,d.cuti,d.day_off,d.ctb,pct,avg,rpStr,(d.leave_balance||0)+' hari']
      })
    ]
    const wb=XLSX.utils.book_new()
    const ws=XLSX.utils.aoa_to_sheet(ws1)
    ws['!cols']=[{wch:22},{wch:14},{wch:12},{wch:8},{wch:10},{wch:12},{wch:8},{wch:8},{wch:10},{wch:8},{wch:9},{wch:12},{wch:18},{wch:12}]
    XLSX.utils.book_append_sheet(wb,ws,'Rekap Kehadiran')

    const sorted=[...data].filter(d=>d.incentive_enabled).sort((a,b)=>(b.total_rp||0)-(a.total_rp||0))
    const ws2=[
      ['RANKING INSENTIF — '+month],
      ['Ontime maks 26 hari = Rp 260.000 bonus | Terlambat >30 mnt = −Rp 10.000 potong gaji'],
      [],
      ['Ranking','Nama','Jabatan','Hadir Ontime','Terlambat','Izin Tugas','Insentif (Rp)','Status'],
      ...sorted.map((d,i)=>{
        const rp=d.total_rp||0
        const rpStr=rp>=0?'Rp '+rp.toLocaleString('id-ID'):'−Rp '+Math.abs(rp).toLocaleString('id-ID')
        const status=rp>=200000?'Bonus Penuh':rp>=100000?'Bonus Sebagian':rp>=0?'Netral':'Kena Potongan'
        return['#'+(i+1),d.name,d.role,d.hadir-d.terlambat+d.izin_tugas,d.terlambat,d.izin_tugas,rpStr,status]
      })
    ]
    const ws2s=XLSX.utils.aoa_to_sheet(ws2)
    ws2s['!cols']=[{wch:10},{wch:22},{wch:14},{wch:14},{wch:12},{wch:12},{wch:18},{wch:16}]
    XLSX.utils.book_append_sheet(wb,ws2s,'Ranking Insentif')
    XLSX.writeFile(wb,`Piccolo_Corner_Laporan_${month}.xlsx`)
  }

  return(
    <div style={{padding:'14px 14px 80px'}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12}}>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
          style={{padding:'7px 11px',border:`.5px solid ${T.border}`,borderRadius:9,fontSize:13,background:T.bg,color:T.black,fontFamily:'inherit',fontWeight:600}}/>
        <button onClick={exportExcel}
          style={{display:'flex',alignItems:'center',gap:5,padding:'8px 14px',background:'#1D6F42',color:'#fff',border:'none',borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          ↓ Excel
        </button>
      </div>
      {loading&&<div style={{textAlign:'center',padding:'2rem',color:T.muted,fontSize:13}}>Memuat...</div>}
      <div style={{display:'flex',flexDirection:'column',gap:7}}>
        {data.map((d,i)=>{
          const total=d.hadir+d.sakit+d.cuti+d.ctb+d.day_off
          const pct=total>0?Math.round((d.hadir/total)*100):0
          const avgMin=d.hadir>0?Math.round(d.total_dur_min/d.hadir):0
          const avgStr=avgMin>0?`${Math.floor(avgMin/60)}j${avgMin%60}m`:'—'
          const rp=d.total_rp
          return(
            <div key={i} style={{background:T.surface,borderRadius:16,border:`.5px solid ${T.border}`,overflow:'hidden'}}>
              <div style={{display:'flex',alignItems:'center',gap:9,padding:'11px 13px',borderBottom:`.5px solid ${T.border}`}}>
                <div style={{width:34,height:34,borderRadius:'50%',background:'#D1D5DB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>
                  {d.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.black,display:'flex',alignItems:'center',gap:5}}>
                    {d.name}
                    {!d.incentive_enabled&&<span style={{fontSize:9,background:'#F3F4F6',color:T.muted,padding:'1px 5px',borderRadius:4}}>Non-program</span>}
                  </div>
                  <div style={{fontSize:10,color:T.muted}}>{d.role}</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:17,fontWeight:800,color:pct>=90?T.green:pct>=75?T.amber:T.red}}>{pct}%</div>
                  <div style={{fontSize:9,color:T.muted}}>kehadiran</div>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',borderBottom:`.5px solid ${T.border}`}}>
                {[['Hadir',d.hadir,T.green],['Telat',d.terlambat,T.amber],['Izin',d.izin_tugas,T.blue],['Sakit',d.sakit,T.blue],['CTB',d.ctb,T.purple]].map(([l,v,c])=>(
                  <div key={l} style={{padding:'7px 4px',textAlign:'center',borderRight:`.5px solid ${T.border}`}}>
                    <div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>{l}</div>
                    <div style={{fontSize:15,fontWeight:800,color:v>0?c:T.muted}}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',padding:'8px 12px',gap:4}}>
                <div><div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Rata2 kerja</div><div style={{fontSize:12,fontWeight:700,color:T.purple}}>{avgStr}</div></div>
                <div><div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Insentif</div>
                  <div style={{fontSize:12,fontWeight:700,color:rp===null?T.muted:rp>=0?T.green:T.red}}>
                    {rp===null?'—':rp>=0?'Rp '+rp.toLocaleString('id-ID'):'−Rp '+Math.abs(rp).toLocaleString('id-ID')}
                  </div>
                </div>
                <div><div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Sisa cuti</div><div style={{fontSize:12,fontWeight:700,color:T.green}}>{d.leave_balance||0} hr</div></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── QUOTES TAB ─────────────────────────────────────────────────────────────
function QuotesTab(){
  const [quotes,setQuotes]=useState([])
  const [newText,setNewText]=useState('')
  const [newAuthor,setNewAuthor]=useState('')
  const [adding,setAdding]=useState(false)
  const [saving,setSaving]=useState(false)
  const [aiLoading,setAiLoading]=useState(false)
  useEffect(()=>{fetchQ()},[])
  async function fetchQ(){const {data}=await supabase.from('quotes').select('*').order('created_at',{ascending:false});setQuotes(data||[])}
  async function addQ(){
    if(!newText.trim()) return
    setSaving(true)
    await supabase.from('quotes').insert({text:newText.trim(),author:newAuthor.trim()||'Piccolo Corner',is_active:true})
    setNewText('');setNewAuthor('');setAdding(false);setSaving(false);fetchQ()
  }
  async function toggleQ(id,cur){await supabase.from('quotes').update({is_active:!cur}).eq('id',id);fetchQ()}
  async function delQ(id){if(!window.confirm('Hapus quote ini?')) return;await supabase.from('quotes').delete().eq('id',id);fetchQ()}
  async function generateAI(){
    setAiLoading(true)
    try{
      const themes=['semangat kerja di cafe untuk barista dan pelayan','pelayanan pelanggan yang tulus','kebersamaan tim cafe','motivasi kerja keras pagi hari']
      const theme=themes[Math.floor(Math.random()*themes.length)]
      const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:200,messages:[{role:'user',content:`Buatkan 1 quote motivasi singkat bahasa Indonesia untuk karyawan cafe tentang: ${theme}. Max 2 kalimat, inspiratif, boleh ada emoji. Hanya teks quote saja, tanpa tanda kutip.`}]})})
      const d=await r.json()
      const txt=d.content?.[0]?.text?.trim()
      if(txt){setNewText(txt);setNewAuthor('AI · Piccolo Corner');setAdding(true)}
    }catch(e){}
    setAiLoading(false)
  }
  const inp={width:'100%',padding:'9px 11px',border:`.5px solid ${T.border}`,borderRadius:9,fontSize:12,background:T.bg,color:T.black,fontFamily:'inherit'}
  return(
    <div style={{padding:'14px 14px 80px'}}>
      <div style={{display:'flex',gap:7,marginBottom:12,flexWrap:'wrap'}}>
        <button onClick={()=>{setAdding(!adding);setNewText('');setNewAuthor('')}} style={{padding:'8px 14px',background:T.black,color:'#fff',border:'none',borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>{adding?'Batal':'+ Tulis Quote'}</button>
        <button onClick={generateAI} disabled={aiLoading} style={{padding:'8px 14px',background:T.purpleLight,color:T.purple,border:`.5px solid ${T.purpleBd}`,borderRadius:9,fontSize:12,fontWeight:700,cursor:aiLoading?'not-allowed':'pointer',fontFamily:'inherit',opacity:aiLoading?.7:1}}>
          {aiLoading?'⏳ AI menulis...':'✨ Generate AI'}
        </button>
      </div>
      <div style={{background:T.amberLight,borderRadius:11,padding:'9px 13px',fontSize:11,color:T.amber,marginBottom:12,lineHeight:1.6}}>
        💡 Quote aktif tampil bergiliran di header app karyawan setiap hari.
      </div>
      {adding&&<div style={{background:T.surface,borderRadius:16,padding:14,marginBottom:12,border:`.5px solid ${T.border}`}}>
        <div style={{fontSize:12,fontWeight:700,color:T.black,marginBottom:10}}>Quote Baru</div>
        <div style={{marginBottom:8}}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Teks Quote</div><textarea value={newText} onChange={e=>setNewText(e.target.value)} rows={3} placeholder="Tulis quote inspiratif..." style={{...inp,resize:'vertical'}}/></div>
        <div style={{marginBottom:10}}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Sumber (opsional)</div><input value={newAuthor} onChange={e=>setNewAuthor(e.target.value)} placeholder="Piccolo Corner" style={inp}/></div>
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
          <button onClick={()=>{setAdding(false);setNewText('');setNewAuthor('')}} style={{padding:10,background:T.bg,color:T.black,border:`.5px solid ${T.border}`,borderRadius:9,fontSize:12,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>Batal</button>
          <button onClick={addQ} disabled={saving||!newText.trim()} style={{padding:10,background:T.black,color:'#fff',border:'none',borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:(saving||!newText.trim())?.5:1}}>{saving?'Menyimpan...':'✓ Simpan'}</button>
        </div>
      </div>}
      <div style={{display:'flex',flexDirection:'column',gap:7}}>
        {quotes.length===0&&<div style={{textAlign:'center',padding:'2rem',background:T.surface,borderRadius:16,border:`.5px solid ${T.border}`}}><div style={{fontSize:28,marginBottom:8}}>💬</div><div style={{fontSize:13,color:T.muted}}>Belum ada quote</div></div>}
        {quotes.map(q=>(
          <div key={q.id} style={{background:T.surface,borderRadius:14,border:`.5px solid ${T.border}`,overflow:'hidden',opacity:q.is_active?1:.55}}>
            <div style={{padding:'12px 14px',display:'flex',gap:9,alignItems:'flex-start'}}>
              <div style={{fontSize:16,flexShrink:0}}>💬</div>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:500,color:T.black,lineHeight:1.6,marginBottom:4}}>{q.text}</div>
                {q.author&&<div style={{fontSize:10,color:T.muted}}>— {q.author}</div>}
              </div>
            </div>
            <div style={{display:'flex',borderTop:`.5px solid ${T.border}`}}>
              <button onClick={()=>toggleQ(q.id,q.is_active)} style={{flex:1,padding:9,border:'none',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',borderRight:`.5px solid ${T.border}`,background:q.is_active?T.greenLight:T.amberLight,color:q.is_active?T.green:T.amber}}>
                {q.is_active?'👁 Tampil':'🙈 Hidden'}
              </button>
              <button onClick={()=>delQ(q.id)} style={{padding:'9px 16px',border:'none',background:T.redLight,color:T.red,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>🗑</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── SETTINGS TAB ────────────────────────────────────────────────────────────
function SettingsTab({settings:init,onSave}){
  const [form,setForm]=useState(init)
  const [saving,setSaving]=useState(false)
  const [saved,setSaved]=useState(false)
  const [mapReady,setMapReady]=useState(false)
  const mapRef=useRef(null)
  const mapInstanceRef=useRef(null)
  const markerRef=useRef(null)
  useEffect(()=>setForm(init),[init])
  useEffect(()=>{
    if(!mapReady) return
    const L=window.L
    if(!L||mapInstanceRef.current) return
    const lat=parseFloat(form.cafe_lat)||-8.7162,lng=parseFloat(form.cafe_lng)||115.2108
    const map=L.map(mapRef.current,{center:[lat,lng],zoom:17})
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OSM'}).addTo(map)
    const icon=L.divIcon({html:'<div style="background:#111;width:14px;height:14px;border-radius:50%;border:3px solid #F97316;"></div>',iconSize:[14,14],iconAnchor:[7,7],className:''})
    const marker=L.marker([lat,lng],{icon,draggable:true}).addTo(map)
    marker.on('dragend',e=>{const p=e.target.getLatLng();setForm(f=>({...f,cafe_lat:parseFloat(p.lat.toFixed(6)),cafe_lng:parseFloat(p.lng.toFixed(6))}))})
    map.on('click',e=>{marker.setLatLng(e.latlng);setForm(f=>({...f,cafe_lat:parseFloat(e.latlng.lat.toFixed(6)),cafe_lng:parseFloat(e.latlng.lng.toFixed(6))}))})
    mapInstanceRef.current=map;markerRef.current=marker
    return ()=>{if(mapInstanceRef.current){mapInstanceRef.current.remove();mapInstanceRef.current=null}}
  },[mapReady])
  function loadMap(){
    if(window.L){setMapReady(true);return}
    const lnk=document.createElement('link');lnk.rel='stylesheet';lnk.href='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';document.head.appendChild(lnk)
    const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';s.onload=()=>setMapReady(true);document.head.appendChild(s)
  }
  function locateMe(){
    navigator.geolocation?.getCurrentPosition(p=>{
      const {latitude:lat,longitude:lng}=p.coords
      setForm(f=>({...f,cafe_lat:parseFloat(lat.toFixed(6)),cafe_lng:parseFloat(lng.toFixed(6))}))
      if(mapInstanceRef.current&&markerRef.current){mapInstanceRef.current.setView([lat,lng],18);markerRef.current.setLatLng([lat,lng])}
    })
  }
  async function save(){
    setSaving(true)
    await supabase.from('work_settings').update({...form,updated_at:new Date().toISOString()}).eq('id',1)
    setSaving(false);setSaved(true);onSave(form);setTimeout(()=>setSaved(false),3000)
  }
  const inp={width:'100%',padding:'9px 11px',border:`.5px solid ${T.border}`,borderRadius:9,fontSize:13,background:T.bg,color:T.black,fontFamily:'inherit'}
  return(
    <div style={{padding:'14px 14px 80px',display:'flex',flexDirection:'column',gap:9}}>
      {/* PROGRAM INSENTIF TOGGLE */}
      <div style={{background:form.incentive_program_active ? '#F0FDF4' : '#F9FAFB',borderRadius:16,padding:14,border:`.5px solid ${form.incentive_program_active ? '#86EFAC' : T.border}`}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:form.incentive_program_active?10:0}}>
          <div style={{flex:1}}>
            <div style={{fontSize:13,fontWeight:700,color:T.black,display:'flex',alignItems:'center',gap:8}}>
              Program Insentif Kehadiran
              <span style={{fontSize:10,fontWeight:700,padding:'2px 9px',borderRadius:20,background:form.incentive_program_active?'#DCFCE7':'#F3F4F6',color:form.incentive_program_active?T.green:T.muted}}>
                {form.incentive_program_active ? '● AKTIF' : '○ NONAKTIF'}
              </span>
            </div>
            <div style={{fontSize:11,color:T.muted,marginTop:3,lineHeight:1.5}}>
              {form.incentive_program_active 
                ? 'Program berjalan — karyawan bisa melihat insentif & leaderboard' 
                : 'Program belum aktif — tidak ada yang tampil ke karyawan'}
            </div>
          </div>
          <button onClick={()=>setForm(f=>({...f,incentive_program_active:!f.incentive_program_active}))}
            style={{width:52,height:28,borderRadius:14,border:'none',cursor:'pointer',position:'relative',flexShrink:0,marginLeft:12,
              background:form.incentive_program_active?T.green:'#D1D5DB',transition:'background .25s'}}>
            <div style={{width:20,height:20,borderRadius:'50%',background:'#fff',position:'absolute',top:4,
              left:form.incentive_program_active?28:4,transition:'left .25s'}}/>
          </button>
        </div>
        {form.incentive_program_active && (
          <div style={{background:'#DCFCE7',borderRadius:10,padding:'8px 12px',fontSize:11,color:'#166534',lineHeight:1.6}}>
            ✓ Ontime ≤10:30 = +Rp 10.000/hari<br/>
            ✓ Maks bonus per bulan = Rp 260.000<br/>
            ✓ Telat setelah 11:00 = −Rp 10.000 (potong gaji)
          </div>
        )}
        {!form.incentive_program_active && (
          <div style={{marginTop:8,background:'#FEF9C3',borderRadius:10,padding:'8px 12px',fontSize:11,color:'#92400E',lineHeight:1.6}}>
            ⚠ Aktifkan setelah ada kesepakatan dengan seluruh karyawan.
          </div>
        )}
      </div>

      <div style={{background:T.surface,borderRadius:16,padding:14,border:`.5px solid ${T.border}`}}>
        <div style={{fontSize:12,fontWeight:700,color:T.black,marginBottom:10}}>Pesan Notifikasi Jam Masuk (10:00)</div>
        <textarea value={form.notif_message||''} onChange={e=>setForm(f=>({...f,notif_message:e.target.value}))} rows={3} placeholder="Selamat pagi! Yuk segera absen 💪" style={{...inp,resize:'vertical',lineHeight:1.6}}/>
        <div style={{fontSize:10,color:T.muted,marginTop:3}}>{(form.notif_message||'').length} karakter</div>
      </div>
      <div style={{background:T.surface,borderRadius:16,padding:14,border:`.5px solid ${T.border}`}}>
        <div style={{fontSize:12,fontWeight:700,color:T.black,marginBottom:10}}>Jam & Operasional</div>
        {[['open_time','Jam Buka','time'],['close_time','Jam Tutup','time'],['late_tolerance_minutes','Toleransi Terlambat (menit)','number'],['gps_radius_meters','Radius GPS (meter)','number'],['doc_upload_deadline_days','Batas Upload Dokter (hari)','number']].map(([k,l,t])=>(
          <div key={k} style={{marginBottom:9}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:3}}>{l}</div>
            <input type={t} value={form[k]||''} step={1} onChange={e=>setForm(f=>({...f,[k]:t==='number'?parseFloat(e.target.value)||e.target.value:e.target.value}))} style={{...inp,width:t==='number'?130:160}}/>
          </div>
        ))}
      </div>
      <div style={{background:T.surface,borderRadius:16,padding:14,border:`.5px solid ${T.border}`}}>
        <div style={{fontSize:12,fontWeight:700,color:T.black,marginBottom:8}}>Lokasi Cafe</div>
        <div style={{display:'flex',gap:7,marginBottom:9,flexWrap:'wrap'}}>
          <button onClick={loadMap} style={{padding:'8px 14px',background:T.black,color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>🗺 Buka Peta</button>
          <button onClick={locateMe} style={{padding:'8px 14px',background:T.greenLight,color:T.green,border:`.5px solid ${T.greenBd}`,borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>📍 Lokasi Saya</button>
        </div>
        {mapReady&&<div ref={mapRef} style={{width:'100%',height:220,borderRadius:10,overflow:'hidden',border:`.5px solid ${T.border}`,marginBottom:9}}/>}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:7}}>
          {[['cafe_lat','Latitude'],['cafe_lng','Longitude']].map(([k,l])=>(
            <div key={k}><div style={{fontSize:11,color:T.muted,marginBottom:3}}>{l}</div><input type="number" value={form[k]||''} step={0.000001} onChange={e=>setForm(f=>({...f,[k]:parseFloat(e.target.value)}))} style={inp}/></div>
          ))}
        </div>
        {form.cafe_lat&&form.cafe_lng&&<div style={{marginTop:7,fontSize:11,color:T.green,background:T.greenLight,borderRadius:8,padding:'5px 9px'}}>✓ {parseFloat(form.cafe_lat).toFixed(6)}, {parseFloat(form.cafe_lng).toFixed(6)}</div>}
      </div>
      <div style={{display:'flex',alignItems:'center',gap:9}}>
        <button onClick={save} disabled={saving} style={{flex:1,padding:12,background:T.black,color:'#fff',border:'none',borderRadius:11,fontSize:14,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:saving?.6:1}}>
          {saving?'Menyimpan...':'✓ Simpan Semua'}
        </button>
        {saved&&<span style={{fontSize:12,color:T.green,fontWeight:700}}>✓ Tersimpan!</span>}
      </div>
    </div>
  )
}

// ── MAIN OWNER PAGE ─────────────────────────────────────────────────────────
export default function OwnerPage(){
  const user=useAuthStore(s=>s.user)
  const logout=useAuthStore(s=>s.logout)
  const navigate=useNavigate()
  const [tab,setTab]=useState('log')
  const [employees,setEmployees]=useState([])
  const [settings,setSettings]=useState({})
  const [notifOn,setNotifOn]=useState(false)
  const [pendingCount,setPendingCount]=useState(0)
  const today=localDate()

  useEffect(()=>{fetchAll();initNotif()},[])
  async function initNotif(){const ok=await reqNotif();setNotifOn(ok)}
  async function fetchAll(){
    const {data:emps}=await supabase.from('employees').select('*').order('name')
    if(emps) setEmployees(emps)
    const {data:s}=await supabase.from('work_settings').select('*').eq('id',1).single()
    if(s) setSettings(s)
    const {count}=await supabase.from('leave_requests').select('*',{count:'exact',head:true}).eq('status','pending')
    setPendingCount(count||0)
  }

  const tabs=[
    {key:'log',label:'Log',icon:'📋'},
    {key:'leave',label:'Persetujuan',icon:'✅',badge:pendingCount},
    {key:'employees',label:'Karyawan',icon:'👥'},
    {key:'report',label:'Laporan',icon:'📊'},
    {key:'quotes',label:'Quotes',icon:'💬'},
    {key:'settings',label:'Pengaturan',icon:'⚙️'},
  ]

  return(
    <div style={{minHeight:'100vh',background:T.bg,fontFamily:"'Inter',-apple-system,sans-serif",display:'flex',flexDirection:'column'}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');`}</style>
      <div style={{background:T.black,padding:'13px 16px 0',flexShrink:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14}}>
          <div style={{display:'flex',alignItems:'center',gap:9}}>
            <div style={{width:34,height:34,background:T.orange,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17}}>☕</div>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:T.white,letterSpacing:'-.01em'}}>Piccolo Corner</div>
              <div style={{fontSize:9,color:T.orange,letterSpacing:'.1em',textTransform:'uppercase',fontWeight:700}}>Owner Dashboard</div>
            </div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:7}}>
            <button onClick={async()=>{const ok=await reqNotif();setNotifOn(ok)}}
              style={{width:32,height:32,borderRadius:9,background:notifOn?'#1A2E20':'#1A1A1A',border:'none',cursor:'pointer',fontSize:15}}>
              {notifOn?'🔔':'🔕'}
            </button>
            <button onClick={()=>{logout();navigate('/login')}}
              style={{padding:'6px 12px',background:'transparent',border:'.5px solid #333',borderRadius:7,color:'#888',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
              Keluar
            </button>
          </div>
        </div>
        <div style={{display:'flex',gap:2,overflowX:'auto',paddingBottom:0}}>
          {tabs.map(t=>(
            <button key={t.key} onClick={()=>setTab(t.key)}
              style={{display:'flex',alignItems:'center',gap:4,padding:'8px 12px',borderRadius:'9px 9px 0 0',border:'none',cursor:'pointer',fontFamily:'inherit',fontWeight:700,fontSize:11,whiteSpace:'nowrap',position:'relative',
                background:tab===t.key?T.bg:'transparent',color:tab===t.key?T.black:'#666'}}>
              <span style={{fontSize:13}}>{t.icon}</span>{t.label}
              {t.badge>0&&<span style={{position:'absolute',top:3,right:3,width:15,height:15,borderRadius:'50%',background:T.orange,color:'#fff',fontSize:9,fontWeight:800,display:'flex',alignItems:'center',justifyContent:'center'}}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>
      <div style={{flex:1,overflowY:'auto'}}>
        {tab==='log'&&<LogTab today={today} incentiveActive={settings.incentive_program_active}/>}
        {tab==='leave'&&<LeaveTab employees={employees}/>}
        {tab==='employees'&&<EmployeesTab employees={employees} onRefresh={fetchAll}/>}
        {tab==='report'&&<ReportTab employees={employees}/>}
        {tab==='quotes'&&<QuotesTab/>}
        {tab==='settings'&&<SettingsTab settings={settings} onSave={s=>setSettings(s)}/>}
      </div>
    </div>
  )
}
