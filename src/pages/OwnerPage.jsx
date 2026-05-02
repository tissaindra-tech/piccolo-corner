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
  if(!iso) return '--'
  return new Date(iso).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Makassar'})
}
function fmtDur(inIso,outIso){
  if(!inIso||!outIso) return null
  const diff=Math.round((new Date(outIso)-new Date(inIso))/60000)
  return `${Math.floor(diff/60)}j ${diff%60}m`
}
function calcIncentiveRp(att){
  // Ontime <=10:30 = +10.000 | Telat 1-5m = -2.000 | 6-30m = -6.000 | >30m = -10.000
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
  return val>=0?`+Rp ${abs}`:`-Rp ${abs}`
}

// ===== HELPER GAJI =====
// Format rupiah biasa tanpa tanda + / -
function rp(n){return 'Rp '+(n||0).toLocaleString('id-ID')}

// Hitung total tunjangan dari array tunjangan
// tunjangan format: [{nama:"Makan",nominal:400000},...]
function totalTunjangan(tunj){
  if(!Array.isArray(tunj)) return 0
  return tunj.reduce((sum,t)=>sum+(parseInt(t.nominal)||0),0)
}

// Hitung gaji bulanan lengkap untuk satu karyawan
// emp: data karyawan (gaji_pokok, tunjangan, incentive_enabled)
// atts: array data attendance bulan tsb
// potongans: array potongan_gaji bulan tsb
function calcGajiBulanan(emp,atts,potongans){
  const pokok=parseInt(emp?.gaji_pokok)||0
  const tunj_total=totalTunjangan(emp?.tunjangan)
  let insentif=0
  if(emp?.incentive_enabled!==false){
    (atts||[]).forEach(a=>{insentif+=calcIncentiveRp(a)})
  }
  const potongan_total=(potongans||[]).reduce((s,p)=>s+(parseInt(p.nominal)||0),0)
  const total_pendapatan=pokok+tunj_total+(insentif>0?insentif:0)
  const total_potongan=potongan_total+(insentif<0?Math.abs(insentif):0)
  const gaji_bersih=total_pendapatan-total_potongan
  return {pokok,tunj_total,insentif,potongan_total,total_pendapatan,total_potongan,gaji_bersih}
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

// -- NOTIFIKASI -------------------------------------------------------------
async function reqNotif(){
  if(!('Notification'in window)) return false
  if(Notification.permission==='granted') return true
  return (await Notification.requestPermission())==='granted'
}
function notify(title,body){
  if(Notification.permission!=='granted') return
  new Notification(`☕ ${title}`,{body})
}

// -- LOG TAB ----------------------------------------------------------------
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
              <div style={{fontSize:11,color:T.muted}}>{excuseModal.employees?.name} . {viewDate}</div>
            </div>
          </div>
          <div style={{background:T.redLight,border:`.5px solid ${T.redBd}`,borderRadius:10,padding:'9px 12px',marginBottom:14,fontSize:12,color:T.red}}>
            Clock in {fmtTime(excuseModal.check_in)} . Terlambat {excuseModal.late_minutes} menit -> saat ini {fmtRp(calcIncentiveRp(excuseModal))}
          </div>
          <div style={{background:T.blueLight,border:`.5px solid ${T.blueBd}`,borderRadius:10,padding:'9px 12px',marginBottom:14,fontSize:12,color:T.blue,lineHeight:1.6}}>
            ✓ Setelah diberi izin -> dihitung <strong>Ontime</strong> -> insentif berubah menjadi <strong>+Rp 10.000</strong>
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

      {/* Total insentif hari ini -- hanya tampil kalau program aktif */}
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
          ~
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
                    <div style={{fontSize:15,fontWeight:800,color:dur?T.purple:'#CCC'}}>{dur||'--'}</div>
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

// -- LEAVE TAB --------------------------------------------------------------
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
              <div style={{fontSize:10,color:T.muted}}>{r.employees?.role} . {r.type.toUpperCase()} . {new Date(r.date_start).toLocaleDateString('id-ID',{day:'numeric',month:'short'})}</div>
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

// -- EMPLOYEES TAB ----------------------------------------------------------
// -- TUNJANGAN EDITOR (shared) ----------------------------------------------
// Komponen untuk edit list tunjangan (multi-row dengan nama + nominal)
function TunjanganEditor({value,onChange}){
  const tunj=Array.isArray(value)?value:[]
  const inp={width:'100%',padding:'7px 9px',border:`.5px solid ${T.border}`,borderRadius:7,fontSize:11,background:T.bg,color:T.black,fontFamily:'inherit'}
  return(
    <div>
      {tunj.map((t,i)=>(
        <div key={i} style={{display:'flex',gap:5,marginBottom:5,alignItems:'center'}}>
          <input value={t.nama||''} onChange={e=>{const n=[...tunj];n[i]={...n[i],nama:e.target.value};onChange(n)}} placeholder="Nama (cth: Makan)" style={{...inp,flex:2}}/>
          <input type="number" inputMode="numeric" value={t.nominal||0} onChange={e=>{const n=[...tunj];n[i]={...n[i],nominal:e.target.value};onChange(n)}} placeholder="Rp" style={{...inp,flex:1}}/>
          <button onClick={()=>onChange(tunj.filter((_,x)=>x!==i))} type="button" style={{padding:'5px 9px',background:T.redLight,color:T.red,border:`.5px solid ${T.redBd}`,borderRadius:6,fontSize:11,cursor:'pointer',fontWeight:700,fontFamily:'inherit',flexShrink:0}}>×</button>
        </div>
      ))}
      <button onClick={()=>onChange([...tunj,{nama:'',nominal:0}])} type="button" style={{padding:'7px 10px',background:T.bg,color:T.muted,border:`.5px dashed ${T.border}`,borderRadius:7,fontSize:11,cursor:'pointer',fontWeight:600,fontFamily:'inherit',width:'100%'}}>+ Tambah Tunjangan</button>
    </div>
  )
}

function EmployeesTab({employees,onRefresh}){
  const [form,setForm]=useState({name:'',role:'',phone:'',pin:'',shift:'',leave_balance:12,gaji_pokok:0,tunjangan:[]})
  const [adding,setAdding]=useState(false)
  const [saving,setSaving]=useState(false)
  const [editingId,setEditingId]=useState(null)
  const [editForm,setEditForm]=useState({})
  const [uploadingId,setUploadingId]=useState(null)
  const inp={width:'100%',padding:'9px 11px',border:`.5px solid ${T.border}`,borderRadius:9,fontSize:12,background:T.bg,color:T.black,fontFamily:'inherit'}

  async function addEmp(){
    setSaving(true)
    await supabase.from('employees').insert({...form,leave_balance:parseInt(form.leave_balance),gaji_pokok:parseInt(form.gaji_pokok)||0,tunjangan:form.tunjangan||[],incentive_enabled:true})
    setSaving(false);setAdding(false);setForm({name:'',role:'',phone:'',pin:'',shift:'',leave_balance:12,gaji_pokok:0,tunjangan:[]});onRefresh()
  }
  function startEdit(emp){setEditingId(emp.id);setEditForm({name:emp.name,role:emp.role,phone:emp.phone,pin:'',shift:emp.shift||'',leave_balance:emp.leave_balance,incentive_enabled:emp.incentive_enabled!==false,gaji_pokok:emp.gaji_pokok||0,tunjangan:emp.tunjangan||[]})}
  async function saveEdit(id){
    setSaving(true)
    const u={name:editForm.name,role:editForm.role,phone:editForm.phone,shift:editForm.shift,leave_balance:parseInt(editForm.leave_balance),incentive_enabled:editForm.incentive_enabled,gaji_pokok:parseInt(editForm.gaji_pokok)||0,tunjangan:editForm.tunjangan||[]}
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
          <div><div style={{fontSize:11,color:T.muted,marginBottom:3}}>PIN (4-6 angka)</div><input type="text" inputMode="numeric" maxLength={6} value={form.pin} onChange={e=>setForm(f=>({...f,pin:e.target.value.replace(/[^0-9]/g,'')}))} placeholder="123456" style={{...inp,letterSpacing:'.15em',fontWeight:700}}/></div>
          <div><div style={{fontSize:11,color:T.muted,marginBottom:3}}>Hak Cuti (hari)</div><input type="number" value={form.leave_balance} onChange={e=>setForm(f=>({...f,leave_balance:e.target.value}))} min={0} max={30} style={inp}/></div>
        </div>

        {/* Gaji Pokok & Tunjangan */}
        <div style={{background:T.greenLight,border:`.5px solid ${T.greenBd}`,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
          <div style={{fontSize:11,fontWeight:700,color:T.green,marginBottom:8}}>💰 Gaji & Tunjangan (opsional)</div>
          <div style={{marginBottom:8}}>
            <div style={{fontSize:11,color:T.muted,marginBottom:3}}>Gaji Pokok (Rp/bulan)</div>
            <input type="number" inputMode="numeric" value={form.gaji_pokok} onChange={e=>setForm(f=>({...f,gaji_pokok:e.target.value}))} placeholder="2500000" style={inp}/>
          </div>
          <div style={{fontSize:11,color:T.muted,marginBottom:5}}>Tunjangan</div>
          <TunjanganEditor value={form.tunjangan} onChange={v=>setForm(f=>({...f,tunjangan:v}))}/>
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

                {/* Gaji Pokok & Tunjangan */}
                <div style={{background:T.greenLight,border:`.5px solid ${T.greenBd}`,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
                  <div style={{fontSize:11,fontWeight:700,color:T.green,marginBottom:8}}>💰 Gaji & Tunjangan</div>
                  <div style={{marginBottom:8}}>
                    <div style={{fontSize:11,color:T.muted,marginBottom:3}}>Gaji Pokok (Rp/bulan)</div>
                    <input type="number" inputMode="numeric" value={editForm.gaji_pokok||0} onChange={e=>setEditForm(f=>({...f,gaji_pokok:e.target.value}))} placeholder="2500000" style={inp}/>
                  </div>
                  <div style={{fontSize:11,color:T.muted,marginBottom:5}}>Tunjangan</div>
                  <TunjanganEditor value={editForm.tunjangan} onChange={v=>setEditForm(f=>({...f,tunjangan:v}))}/>
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
                        {emp[field]&&<a href={emp[field]} target="_blank" rel="noreferrer" style={{fontSize:10,color:T.green,display:'block',marginBottom:3}}>✓ Lihat -></a>}
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
                  <div style={{fontSize:10,color:T.muted}}>{emp.role} . {emp.phone} . Cuti: {emp.leave_balance}hr{emp.shift?` . ${emp.shift}`:''}</div>
                  {emp.gaji_pokok>0&&<div style={{fontSize:10,color:T.green,fontWeight:600,marginTop:1}}>💰 {rp(emp.gaji_pokok)}{totalTunjangan(emp.tunjangan)>0?` + tunj. ${rp(totalTunjangan(emp.tunjangan))}`:''}</div>}
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

// -- REPORT TAB -------------------------------------------------------------
// Versi 2.0: Filter lengkap (bulan/rentang/tanggal/tahun) + Multi-view + Slip Gaji
function ReportTab({employees}){
  // ----- FILTER STATE -----
  const [filterMode,setFilterMode]=useState('month') // month | range | specific | year
  const [filterMonth,setFilterMonth]=useState(localDate().slice(0,7))
  const [filterDateStart,setFilterDateStart]=useState(localDate())
  const [filterDateEnd,setFilterDateEnd]=useState(localDate())
  const [filterDate,setFilterDate]=useState(localDate())
  const [filterYear,setFilterYear]=useState(String(new Date().getFullYear()))
  const [filterEmpId,setFilterEmpId]=useState('all')
  const [filterStatus,setFilterStatus]=useState('all')

  // ----- VIEW STATE -----
  const [view,setView]=useState('summary') // summary | detail | ranking | gaji

  // ----- DATA STATE -----
  const [rows,setRows]=useState([])
  const [potongans,setPotongans]=useState([])
  const [loading,setLoading]=useState(false)

  // ----- SLIP GAJI MODAL STATE -----
  const [gajiModal,setGajiModal]=useState(null) // {emp, atts, potongans} or null
  const [newPotongan,setNewPotongan]=useState({tipe:'kasbon',nominal:'',catatan:''})

  // ===== HITUNG DATE RANGE BERDASARKAN FILTER =====
  function getDateRange(){
    if(filterMode==='month'){
      const [y,m]=filterMonth.split('-').map(Number)
      const lastDay=new Date(y,m,0).getDate()
      return{from:`${filterMonth}-01`,to:`${filterMonth}-${String(lastDay).padStart(2,'0')}`,label:new Date(y,m-1,1).toLocaleDateString('id-ID',{month:'long',year:'numeric'})}
    }
    if(filterMode==='range') return{from:filterDateStart,to:filterDateEnd,label:`${filterDateStart} - ${filterDateEnd}`}
    if(filterMode==='specific') return{from:filterDate,to:filterDate,label:new Date(filterDate).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'})}
    if(filterMode==='year') return{from:`${filterYear}-01-01`,to:`${filterYear}-12-31`,label:`Tahun ${filterYear}`}
    return{from:'',to:'',label:''}
  }

  // ===== FETCH DATA =====
  useEffect(()=>{fetchData()},[filterMode,filterMonth,filterDateStart,filterDateEnd,filterDate,filterYear,filterEmpId])

  async function fetchData(){
    setLoading(true)
    const {from,to}=getDateRange()
    let q=supabase.from('attendance').select('*,employees!employee_id(name,role,leave_balance,incentive_enabled,gaji_pokok,tunjangan)').gte('date',from).lte('date',to).order('date',{ascending:false})
    if(filterEmpId!=='all') q=q.eq('employee_id',filterEmpId)
    const {data}=await q
    setRows(data||[])
    // Fetch potongan untuk view gaji
    const fromMonth=from.slice(0,7);const toMonth=to.slice(0,7)
    let pq=supabase.from('potongan_gaji').select('*').gte('bulan',fromMonth).lte('bulan',toMonth)
    if(filterEmpId!=='all') pq=pq.eq('employee_id',filterEmpId)
    const {data:pdata}=await pq
    setPotongans(pdata||[])
    setLoading(false)
  }

  // ===== APPLY STATUS FILTER (in memory) =====
  function applyStatusFilter(arr){
    if(filterStatus==='all') return arr
    if(filterStatus==='telat') return arr.filter(r=>r.is_late&&!r.is_excused)
    if(filterStatus==='izin_tugas') return arr.filter(r=>r.is_excused)
    return arr.filter(r=>r.status===filterStatus)
  }

  const filteredRows=applyStatusFilter(rows)

  // ===== GROUP BY EMPLOYEE (untuk view summary, ranking, gaji) =====
  function groupByEmployee(arr){
    const grouped={};const empAtts={}
    arr.forEach(r=>{
      const id=r.employee_id
      if(!grouped[id]){
        grouped[id]={
          id,name:r.employees?.name,role:r.employees?.role,
          leave_balance:r.employees?.leave_balance,
          incentive_enabled:r.employees?.incentive_enabled!==false,
          gaji_pokok:r.employees?.gaji_pokok||0,tunjangan:r.employees?.tunjangan||[],
          hadir:0,sakit:0,cuti:0,ctb:0,day_off:0,terlambat:0,izin_tugas:0,total_dur_min:0
        }
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
      const atts=empAtts[id]||[]
      let insentif=0
      if(grouped[id].incentive_enabled){atts.forEach(a=>{insentif+=calcIncentiveRp(a)})}
      grouped[id].total_rp=grouped[id].incentive_enabled?insentif:null
      grouped[id]._atts=atts
    })
    return Object.values(grouped)
  }

  const empData=groupByEmployee(filteredRows)

  // ===== STATS GLOBAL =====
  const stats={
    hadir:filteredRows.filter(r=>r.status==='hadir').length,
    telat:filteredRows.filter(r=>r.is_late&&!r.is_excused).length,
    sakit_ctb:filteredRows.filter(r=>r.status==='sakit'||r.status==='ctb').length,
    total_insentif:empData.reduce((s,e)=>s+(e.total_rp||0),0)
  }

  // ===== EXPORT EXCEL =====
  function exportExcel(){
    const {label}=getDateRange()
    const wb=XLSX.utils.book_new()

    // SHEET 1: Ringkasan per Karyawan
    const ws1=[
      [`LAPORAN KEHADIRAN PICCOLO CORNER - ${label}`],
      [`Filter Status: ${filterStatus==='all'?'Semua':filterStatus} | Karyawan: ${filterEmpId==='all'?'Semua':employees.find(e=>e.id===filterEmpId)?.name||'-'}`],
      [],
      ['Nama','Jabatan','Program','Hadir','Terlambat','Izin Tugas','Sakit','Cuti','Day Off','CTB','% Hadir','Rata2 Kerja','Insentif (Rp)','Sisa Cuti'],
      ...empData.map(d=>{
        const total=d.hadir+d.sakit+d.cuti+d.ctb+d.day_off
        const pct=total>0?Math.round((d.hadir/total)*100)+'%':'0%'
        const avg=d.hadir>0?`${Math.floor(d.total_dur_min/d.hadir/60)}j${d.total_dur_min/d.hadir%60|0}m`:'--'
        const r=d.total_rp
        const rpStr=r===null?'Tidak ikut':r>=0?'Rp '+r.toLocaleString('id-ID'):'-Rp '+Math.abs(r).toLocaleString('id-ID')
        return[d.name,d.role,d.incentive_enabled?'Ikut':'Tidak ikut',d.hadir,d.terlambat,d.izin_tugas,d.sakit,d.cuti,d.day_off,d.ctb,pct,avg,rpStr,(d.leave_balance||0)+' hari']
      })
    ]
    const sht1=XLSX.utils.aoa_to_sheet(ws1)
    sht1['!cols']=[{wch:22},{wch:14},{wch:12},{wch:8},{wch:10},{wch:12},{wch:8},{wch:8},{wch:10},{wch:8},{wch:9},{wch:12},{wch:18},{wch:12}]
    XLSX.utils.book_append_sheet(wb,sht1,'Ringkasan')

    // SHEET 2: Detail Harian
    const ws2=[
      [`DETAIL HARIAN - ${label}`],
      [],
      ['Tanggal','Nama','Jabatan','Status','Clock In','Clock Out','Durasi','Telat (mnt)','Izin Tugas','Insentif (Rp)','Catatan']
    ]
    const sortedRows=[...filteredRows].sort((a,b)=>(a.date+a.employees?.name).localeCompare(b.date+b.employees?.name))
    sortedRows.forEach(r=>{
      const dur=fmtDur(r.check_in,r.check_out)||'--'
      const insRp=calcIncentiveRp(r)
      const insStr=r.employees?.incentive_enabled===false?'-':insRp>=0?'Rp '+insRp.toLocaleString('id-ID'):'-Rp '+Math.abs(insRp).toLocaleString('id-ID')
      ws2.push([r.date,r.employees?.name,r.employees?.role,r.status,fmtTime(r.check_in),fmtTime(r.check_out),dur,r.late_minutes||0,r.is_excused?'Ya':'-',insStr,r.excuse_reason||''])
    })
    const sht2=XLSX.utils.aoa_to_sheet(ws2)
    sht2['!cols']=[{wch:12},{wch:22},{wch:14},{wch:10},{wch:11},{wch:11},{wch:9},{wch:11},{wch:11},{wch:14},{wch:25}]
    XLSX.utils.book_append_sheet(wb,sht2,'Detail Harian')

    // SHEET 3: Ranking Insentif
    const sorted=[...empData].filter(d=>d.incentive_enabled).sort((a,b)=>(b.total_rp||0)-(a.total_rp||0))
    const ws3=[
      [`RANKING INSENTIF - ${label}`],
      [],
      ['Ranking','Nama','Jabatan','Hadir Ontime','Terlambat','Izin Tugas','Insentif (Rp)','Status'],
      ...sorted.map((d,i)=>{
        const r=d.total_rp||0
        const rpStr=r>=0?'Rp '+r.toLocaleString('id-ID'):'-Rp '+Math.abs(r).toLocaleString('id-ID')
        const stat=r>=200000?'Bonus Penuh':r>=100000?'Bonus Sebagian':r>=0?'Netral':'Kena Potongan'
        return['#'+(i+1),d.name,d.role,d.hadir-d.terlambat+d.izin_tugas,d.terlambat,d.izin_tugas,rpStr,stat]
      })
    ]
    const sht3=XLSX.utils.aoa_to_sheet(ws3)
    sht3['!cols']=[{wch:10},{wch:22},{wch:14},{wch:14},{wch:12},{wch:12},{wch:18},{wch:16}]
    XLSX.utils.book_append_sheet(wb,sht3,'Ranking Insentif')

    // SHEET 4: Slip Gaji (jika view gaji aktif atau filter karyawan tertentu)
    if(view==='gaji'||filterEmpId!=='all'){
      const ws4=[
        [`SLIP GAJI BULANAN - ${label}`],
        [],
        ['Nama','Jabatan','Gaji Pokok','Tunjangan','Insentif','Total Pendapatan','Potongan','Gaji Bersih']
      ]
      empData.forEach(d=>{
        const empPotongs=potongans.filter(p=>p.employee_id===d.id)
        const calc=calcGajiBulanan({gaji_pokok:d.gaji_pokok,tunjangan:d.tunjangan,incentive_enabled:d.incentive_enabled},d._atts,empPotongs)
        ws4.push([d.name,d.role,'Rp '+calc.pokok.toLocaleString('id-ID'),'Rp '+calc.tunj_total.toLocaleString('id-ID'),(calc.insentif>=0?'Rp ':'-Rp ')+Math.abs(calc.insentif).toLocaleString('id-ID'),'Rp '+calc.total_pendapatan.toLocaleString('id-ID'),'Rp '+calc.total_potongan.toLocaleString('id-ID'),'Rp '+calc.gaji_bersih.toLocaleString('id-ID')])
      })
      const sht4=XLSX.utils.aoa_to_sheet(ws4)
      sht4['!cols']=[{wch:22},{wch:14},{wch:14},{wch:14},{wch:14},{wch:16},{wch:14},{wch:16}]
      XLSX.utils.book_append_sheet(wb,sht4,'Slip Gaji')
    }

    XLSX.writeFile(wb,`Piccolo_Corner_Laporan_${label.replace(/[^a-zA-Z0-9]/g,'_')}.xlsx`)
  }

  // ===== POTONGAN MANAGEMENT =====
  async function addPotongan(empId,bulan){
    if(!newPotongan.nominal) return
    await supabase.from('potongan_gaji').insert({employee_id:empId,bulan,tipe:newPotongan.tipe,nominal:parseInt(newPotongan.nominal),catatan:newPotongan.catatan})
    setNewPotongan({tipe:'kasbon',nominal:'',catatan:''})
    fetchData()
    if(gajiModal&&gajiModal.emp.id===empId){
      const {data}=await supabase.from('potongan_gaji').select('*').eq('employee_id',empId).eq('bulan',bulan)
      setGajiModal({...gajiModal,potongans:data||[]})
    }
  }
  async function delPotongan(id,empId,bulan){
    if(!window.confirm('Hapus potongan ini?')) return
    await supabase.from('potongan_gaji').delete().eq('id',id)
    fetchData()
    if(gajiModal&&gajiModal.emp.id===empId){
      const {data}=await supabase.from('potongan_gaji').select('*').eq('employee_id',empId).eq('bulan',bulan)
      setGajiModal({...gajiModal,potongans:data||[]})
    }
  }

  // ===== OPEN SLIP GAJI MODAL =====
  async function openGajiModal(emp){
    const {from,to}=getDateRange()
    const bulan=from.slice(0,7) // YYYY-MM
    const {data:atts}=await supabase.from('attendance').select('*').eq('employee_id',emp.id).gte('date',from).lte('date',to)
    const {data:pots}=await supabase.from('potongan_gaji').select('*').eq('employee_id',emp.id).eq('bulan',bulan)
    setGajiModal({emp,atts:atts||[],potongans:pots||[],bulan,label:getDateRange().label})
  }

  // ===== PRINT SLIP GAJI =====
  function printSlipGaji(){
    if(!gajiModal) return
    const {emp,atts,potongans:pots,bulan,label}=gajiModal
    const calc=calcGajiBulanan(emp,atts,pots)
    const tunj=Array.isArray(emp.tunjangan)?emp.tunjangan:[]
    const totalKerja=atts.filter(a=>a.status==='hadir').length
    const initials=emp.name?.split(' ').map(w=>w[0]).join('').slice(0,2)||''
    const cafeName='Piccolo Corner'
    const cafeAddr='Jl. Bypass Ngurah Rai No.729, Pedungan, Denpasar Selatan, Bali'
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Slip Gaji ${emp.name} ${bulan}</title>
<style>
body{font-family:'Helvetica',Arial,sans-serif;color:#111;max-width:680px;margin:30px auto;padding:0 20px;font-size:13px;line-height:1.5}
.header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:14px;margin-bottom:20px}
.cafe{font-size:18px;font-weight:700}
.cafe-addr{font-size:11px;color:#666;margin-top:3px}
.title{text-align:right}
.title-l{font-size:10px;color:#666;letter-spacing:.1em;text-transform:uppercase}
.title-v{font-size:14px;font-weight:700;margin-top:2px}
.info{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:18px}
.info-item{font-size:12px}
.info-l{color:#666;font-size:10px;text-transform:uppercase;letter-spacing:.05em}
.info-v{font-weight:600;margin-top:2px}
.section{margin-bottom:14px}
.section-h{font-size:11px;color:#666;letter-spacing:.05em;text-transform:uppercase;border-bottom:1px solid #ddd;padding-bottom:4px;margin-bottom:6px}
.row{display:flex;justify-content:space-between;padding:4px 0;font-size:12px}
.row-total{font-weight:700;border-top:1px solid #ccc;padding-top:6px;margin-top:4px}
.bersih{background:#F0FDF4;border:2px solid #16A34A;padding:14px 16px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:18px}
.bersih-l{font-size:11px;color:#16A34A;text-transform:uppercase;letter-spacing:.05em}
.bersih-v{font-size:22px;font-weight:800;color:#16A34A;margin-top:2px}
.foot{margin-top:30px;display:flex;justify-content:space-between;font-size:11px}
.sign-box{text-align:center;width:180px}
.sign-line{border-top:1px solid #111;margin-top:60px;padding-top:4px}
.note{margin-top:30px;font-size:10px;color:#999;text-align:center}
@media print{body{margin:0;padding:20px}.no-print{display:none}}
</style></head><body>
<div class="header">
  <div><div class="cafe">${cafeName}</div><div class="cafe-addr">${cafeAddr}</div></div>
  <div class="title"><div class="title-l">Slip Gaji</div><div class="title-v">${label}</div></div>
</div>
<div class="info">
  <div class="info-item"><div class="info-l">Nama</div><div class="info-v">${emp.name||''}</div></div>
  <div class="info-item"><div class="info-l">Jabatan</div><div class="info-v">${emp.role||''}</div></div>
  <div class="info-item"><div class="info-l">Periode</div><div class="info-v">${label}</div></div>
  <div class="info-item"><div class="info-l">Hari Hadir</div><div class="info-v">${totalKerja} hari</div></div>
</div>
<div class="section">
  <div class="section-h">Pendapatan</div>
  <div class="row"><span>Gaji Pokok</span><span>Rp ${calc.pokok.toLocaleString('id-ID')}</span></div>
  ${tunj.map(t=>`<div class="row"><span>Tunjangan ${t.nama||'-'}</span><span>Rp ${(parseInt(t.nominal)||0).toLocaleString('id-ID')}</span></div>`).join('')}
  ${calc.insentif>0?`<div class="row" style="color:#16A34A"><span>Insentif Kehadiran</span><span>+ Rp ${calc.insentif.toLocaleString('id-ID')}</span></div>`:''}
  <div class="row row-total"><span>Total Pendapatan</span><span>Rp ${calc.total_pendapatan.toLocaleString('id-ID')}</span></div>
</div>
<div class="section">
  <div class="section-h">Potongan</div>
  ${calc.insentif<0?`<div class="row" style="color:#DC2626"><span>Potongan Telat (Insentif)</span><span>- Rp ${Math.abs(calc.insentif).toLocaleString('id-ID')}</span></div>`:''}
  ${pots.map(p=>`<div class="row" style="color:#DC2626"><span>${p.tipe.charAt(0).toUpperCase()+p.tipe.slice(1)}${p.catatan?` (${p.catatan})`:''}</span><span>- Rp ${(parseInt(p.nominal)||0).toLocaleString('id-ID')}</span></div>`).join('')}
  ${calc.total_potongan===0?'<div class="row" style="color:#999"><span>Tidak ada potongan</span><span>-</span></div>':''}
  <div class="row row-total"><span>Total Potongan</span><span>Rp ${calc.total_potongan.toLocaleString('id-ID')}</span></div>
</div>
<div class="bersih">
  <div><div class="bersih-l">Gaji Bersih Diterima</div><div class="bersih-v">Rp ${calc.gaji_bersih.toLocaleString('id-ID')}</div></div>
  <div style="text-align:right;font-size:11px;color:#16A34A"><div>Dibayarkan via</div><div style="font-weight:700">Transfer / Tunai</div></div>
</div>
<div class="foot">
  <div class="sign-box"><div class="sign-line">Diterima oleh,<br/>${emp.name||''}</div></div>
  <div class="sign-box"><div class="sign-line">Mengetahui,<br/>Pemilik Cafe</div></div>
</div>
<div class="note">Dokumen rahasia - Hanya untuk karyawan bersangkutan<br/>Dicetak: ${new Date().toLocaleString('id-ID')}</div>
<div class="no-print" style="margin-top:30px;text-align:center;border-top:1px dashed #ccc;padding-top:20px">
  <button onclick="window.print()" style="padding:10px 24px;background:#111;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700">🖨 Print / Save as PDF</button>
  <button onclick="window.close()" style="padding:10px 24px;background:#fff;color:#111;border:1px solid #ccc;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;margin-left:8px">Tutup</button>
</div>
</body></html>`
    const w=window.open('','_blank','width=800,height=900')
    if(w){w.document.write(html);w.document.close()}
  }

  // ===== STYLES =====
  const inp={fontSize:12,padding:'7px 10px',border:`.5px solid ${T.border}`,borderRadius:8,background:T.bg,color:T.black,fontFamily:'inherit'}
  const sel={...inp,cursor:'pointer'}
  const chip=(active)=>({padding:'5px 11px',fontSize:11,fontWeight:600,borderRadius:7,cursor:'pointer',border:`.5px solid ${active?T.black:T.border}`,background:active?T.black:T.bg,color:active?'#fff':T.muted,fontFamily:'inherit'})
  const tabBtn=(active)=>({padding:'8px 12px',fontSize:11,fontWeight:700,border:'none',cursor:'pointer',background:'transparent',color:active?T.black:T.muted,borderBottom:`2px solid ${active?T.orange:'transparent'}`,fontFamily:'inherit'})
  const {label}=getDateRange()

  // ===== RENDER =====
  return(
    <div style={{padding:'14px 14px 80px'}}>

      {/* === FILTER BAR === */}
      <div style={{background:T.surface,borderRadius:14,border:`.5px solid ${T.border}`,padding:12,marginBottom:10}}>
        <div style={{fontSize:10,fontWeight:700,color:T.muted,marginBottom:6,letterSpacing:'.05em'}}>MODE FILTER</div>
        <div style={{display:'flex',gap:5,flexWrap:'wrap',marginBottom:10}}>
          {[['month','Bulan'],['range','Rentang'],['specific','Tanggal'],['year','Tahun']].map(([v,l])=>(
            <button key={v} onClick={()=>setFilterMode(v)} style={chip(filterMode===v)}>{l}</button>
          ))}
        </div>

        {/* Date inputs - depends on mode */}
        {filterMode==='month'&&(
          <input type="month" value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{...inp,width:'100%',marginBottom:8,fontWeight:600}}/>
        )}
        {filterMode==='range'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
            <div><div style={{fontSize:10,color:T.muted,marginBottom:3}}>Dari</div><input type="date" value={filterDateStart} onChange={e=>setFilterDateStart(e.target.value)} style={{...inp,width:'100%'}}/></div>
            <div><div style={{fontSize:10,color:T.muted,marginBottom:3}}>Sampai</div><input type="date" value={filterDateEnd} onChange={e=>setFilterDateEnd(e.target.value)} style={{...inp,width:'100%'}}/></div>
          </div>
        )}
        {filterMode==='specific'&&(
          <input type="date" value={filterDate} onChange={e=>setFilterDate(e.target.value)} style={{...inp,width:'100%',marginBottom:8,fontWeight:600}}/>
        )}
        {filterMode==='year'&&(
          <input type="number" value={filterYear} onChange={e=>setFilterYear(e.target.value)} min={2024} max={2100} style={{...inp,width:'100%',marginBottom:8,fontWeight:600}}/>
        )}

        {/* Karyawan & Status filter */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:8}}>
          <div>
            <div style={{fontSize:10,color:T.muted,marginBottom:3}}>KARYAWAN</div>
            <select value={filterEmpId} onChange={e=>setFilterEmpId(e.target.value)} style={{...sel,width:'100%'}}>
              <option value="all">Semua ({employees.filter(e=>!e.is_owner).length})</option>
              {employees.filter(e=>!e.is_owner).map(e=>(<option key={e.id} value={e.id}>{e.name}</option>))}
            </select>
          </div>
          <div>
            <div style={{fontSize:10,color:T.muted,marginBottom:3}}>STATUS</div>
            <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...sel,width:'100%'}}>
              <option value="all">Semua status</option>
              <option value="hadir">Hadir</option>
              <option value="telat">Telat saja</option>
              <option value="izin_tugas">Izin Tugas</option>
              <option value="sakit">Sakit</option>
              <option value="cuti">Cuti</option>
              <option value="ctb">CTB</option>
              <option value="day_off">Day Off</option>
            </select>
          </div>
        </div>

        {/* Period label & Export button */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,paddingTop:8,borderTop:`.5px solid ${T.border}`}}>
          <div style={{fontSize:11,color:T.muted}}>Periode: <span style={{color:T.black,fontWeight:700}}>{label}</span></div>
          <button onClick={exportExcel} style={{padding:'7px 14px',background:'#1D6F42',color:'#fff',border:'none',borderRadius:8,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>📥 Excel</button>
        </div>
      </div>

      {/* === STATS ROW === */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:6,marginBottom:10}}>
        <div style={{background:T.surface,borderRadius:10,border:`.5px solid ${T.border}`,padding:'8px 10px'}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:'.04em'}}>HADIR</div>
          <div style={{fontSize:18,fontWeight:800,color:T.green,marginTop:1}}>{stats.hadir}</div>
        </div>
        <div style={{background:T.surface,borderRadius:10,border:`.5px solid ${T.border}`,padding:'8px 10px'}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:'.04em'}}>TELAT</div>
          <div style={{fontSize:18,fontWeight:800,color:T.amber,marginTop:1}}>{stats.telat}</div>
        </div>
        <div style={{background:T.surface,borderRadius:10,border:`.5px solid ${T.border}`,padding:'8px 10px'}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:'.04em'}}>SAKIT/CTB</div>
          <div style={{fontSize:18,fontWeight:800,color:T.red,marginTop:1}}>{stats.sakit_ctb}</div>
        </div>
        <div style={{background:T.surface,borderRadius:10,border:`.5px solid ${T.border}`,padding:'8px 10px'}}>
          <div style={{fontSize:9,color:T.muted,letterSpacing:'.04em'}}>INSENTIF</div>
          <div style={{fontSize:14,fontWeight:800,color:stats.total_insentif>=0?T.green:T.red,marginTop:1}}>{stats.total_insentif>=0?'Rp ':'-Rp '}{Math.abs(stats.total_insentif).toLocaleString('id-ID')}</div>
        </div>
      </div>

      {/* === VIEW SWITCHER === */}
      <div style={{display:'flex',gap:0,borderBottom:`.5px solid ${T.border}`,marginBottom:10,overflowX:'auto'}}>
        <button onClick={()=>setView('summary')} style={tabBtn(view==='summary')}>Per Karyawan</button>
        <button onClick={()=>setView('detail')} style={tabBtn(view==='detail')}>Detail Harian</button>
        <button onClick={()=>setView('ranking')} style={tabBtn(view==='ranking')}>Ranking Insentif</button>
        <button onClick={()=>setView('gaji')} style={tabBtn(view==='gaji')}>💰 Slip Gaji</button>
      </div>

      {/* === LOADING / EMPTY STATE === */}
      {loading&&<div style={{textAlign:'center',padding:'2rem',color:T.muted,fontSize:13}}>Memuat data...</div>}
      {!loading&&filteredRows.length===0&&(
        <div style={{textAlign:'center',padding:'2rem 1rem',color:T.muted,fontSize:13,background:T.surface,borderRadius:12,border:`.5px solid ${T.border}`}}>
          <div style={{fontSize:32,marginBottom:8}}>📭</div>
          <div style={{fontWeight:600,color:T.black,marginBottom:4}}>Tidak ada data</div>
          <div style={{fontSize:11}}>Coba ubah filter atau pilih periode lain</div>
        </div>
      )}

      {/* === VIEW: PER KARYAWAN === */}
      {!loading&&view==='summary'&&empData.length>0&&(
        <div style={{display:'flex',flexDirection:'column',gap:7}}>
          {empData.map((d,i)=>{
            const total=d.hadir+d.sakit+d.cuti+d.ctb+d.day_off
            const pct=total>0?Math.round((d.hadir/total)*100):0
            const avgMin=d.hadir>0?Math.round(d.total_dur_min/d.hadir):0
            const avgStr=avgMin>0?`${Math.floor(avgMin/60)}j${avgMin%60}m`:'--'
            const r=d.total_rp
            return(
              <div key={d.id||i} style={{background:T.surface,borderRadius:14,border:`.5px solid ${T.border}`,overflow:'hidden'}}>
                <div style={{display:'flex',alignItems:'center',gap:9,padding:'10px 12px',borderBottom:`.5px solid ${T.border}`}}>
                  <div style={{width:32,height:32,borderRadius:'50%',background:'#D1D5DB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>
                    {d.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:T.black,display:'flex',alignItems:'center',gap:5}}>
                      {d.name}
                      {!d.incentive_enabled&&<span style={{fontSize:9,background:'#F3F4F6',color:T.muted,padding:'1px 5px',borderRadius:4}}>Non-program</span>}
                    </div>
                    <div style={{fontSize:10,color:T.muted}}>{d.role}</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontSize:16,fontWeight:800,color:pct>=90?T.green:pct>=75?T.amber:T.red}}>{pct}%</div>
                    <div style={{fontSize:9,color:T.muted}}>kehadiran</div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',borderBottom:`.5px solid ${T.border}`}}>
                  {[['Hadir',d.hadir,T.green],['Telat',d.terlambat,T.amber],['Izin',d.izin_tugas,T.blue],['Sakit',d.sakit,T.blue],['CTB',d.ctb,T.purple]].map(([l,v,c])=>(
                    <div key={l} style={{padding:'6px 4px',textAlign:'center',borderRight:`.5px solid ${T.border}`}}>
                      <div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>{l}</div>
                      <div style={{fontSize:14,fontWeight:800,color:v>0?c:T.muted}}>{v}</div>
                    </div>
                  ))}
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',padding:'7px 12px',gap:4}}>
                  <div><div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Rata2 kerja</div><div style={{fontSize:11,fontWeight:700,color:T.purple}}>{avgStr}</div></div>
                  <div><div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Insentif</div>
                    <div style={{fontSize:11,fontWeight:700,color:r===null?T.muted:r>=0?T.green:T.red}}>
                      {r===null?'--':r>=0?'Rp '+r.toLocaleString('id-ID'):'-Rp '+Math.abs(r).toLocaleString('id-ID')}
                    </div>
                  </div>
                  <div><div style={{fontSize:8,color:T.muted,textTransform:'uppercase',letterSpacing:'.04em'}}>Sisa cuti</div><div style={{fontSize:11,fontWeight:700,color:T.green}}>{d.leave_balance||0} hr</div></div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* === VIEW: DETAIL HARIAN === */}
      {!loading&&view==='detail'&&filteredRows.length>0&&(
        <div style={{background:T.surface,borderRadius:12,border:`.5px solid ${T.border}`,overflow:'hidden'}}>
          <div style={{maxHeight:500,overflowY:'auto'}}>
            {filteredRows.map((r,i)=>{
              const ins=calcIncentiveRp(r)
              const dur=fmtDur(r.check_in,r.check_out)
              const cfg=statusCfg[r.status]||{color:T.muted,bg:T.bg,label:r.status}
              return(
                <div key={r.id||i} style={{display:'grid',gridTemplateColumns:'80px 1fr auto',gap:10,padding:'9px 12px',borderBottom:`.5px solid ${T.border}`,alignItems:'center'}}>
                  <div style={{fontSize:10,fontWeight:700,color:T.black}}>{new Date(r.date).toLocaleDateString('id-ID',{day:'2-digit',month:'short'})}</div>
                  <div style={{minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:600,color:T.black,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{r.employees?.name}</div>
                    <div style={{fontSize:10,color:T.muted,display:'flex',gap:6,flexWrap:'wrap'}}>
                      <span>{fmtTime(r.check_in)}-{fmtTime(r.check_out)}</span>
                      {dur&&<span>· {dur}</span>}
                      {r.is_late&&!r.is_excused&&<span style={{color:T.amber}}>· telat {r.late_minutes}m</span>}
                      {r.is_excused&&<span style={{color:T.blue}}>· izin tugas</span>}
                    </div>
                  </div>
                  <div style={{textAlign:'right',display:'flex',flexDirection:'column',alignItems:'flex-end',gap:2}}>
                    <span style={{fontSize:9,padding:'2px 7px',borderRadius:6,background:cfg.bg,color:cfg.color,fontWeight:700}}>{cfg.label}</span>
                    {ins!==0&&r.employees?.incentive_enabled!==false&&(
                      <span style={{fontSize:10,fontWeight:700,color:ins>0?T.green:T.red}}>{ins>0?'+':''}{ins.toLocaleString('id-ID')}</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{padding:'8px 12px',background:T.bg,fontSize:10,color:T.muted,textAlign:'center'}}>
            Total: {filteredRows.length} record
          </div>
        </div>
      )}

      {/* === VIEW: RANKING INSENTIF === */}
      {!loading&&view==='ranking'&&empData.filter(d=>d.incentive_enabled).length>0&&(
        <div style={{display:'flex',flexDirection:'column',gap:5}}>
          {[...empData].filter(d=>d.incentive_enabled).sort((a,b)=>(b.total_rp||0)-(a.total_rp||0)).map((d,i)=>{
            const r=d.total_rp||0
            const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':`#${i+1}`
            return(
              <div key={d.id} style={{background:T.surface,borderRadius:11,border:`.5px solid ${T.border}`,display:'flex',alignItems:'center',gap:10,padding:'9px 12px'}}>
                <div style={{fontSize:i<3?20:13,fontWeight:800,color:T.muted,width:32,textAlign:'center'}}>{medal}</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:T.black,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{d.name}</div>
                  <div style={{fontSize:10,color:T.muted}}>{d.role} · {d.hadir-d.terlambat+d.izin_tugas} ontime · {d.terlambat} telat</div>
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:13,fontWeight:800,color:r>=0?T.green:T.red}}>{r>=0?'Rp ':'-Rp '}{Math.abs(r).toLocaleString('id-ID')}</div>
                  <div style={{fontSize:9,color:T.muted}}>{r>=200000?'Bonus penuh':r>=100000?'Bonus sebagian':r>=0?'Netral':'Kena potongan'}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* === VIEW: SLIP GAJI === */}
      {!loading&&view==='gaji'&&empData.length>0&&(
        <div>
          <div style={{background:T.amberLight,border:`.5px solid ${T.amberBd}`,borderRadius:10,padding:'9px 12px',marginBottom:10,fontSize:11,color:T.amber}}>
            💡 Klik karyawan untuk lihat detail slip gaji + tambah potongan + cetak PDF
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {empData.map(d=>{
              const empPotongs=potongans.filter(p=>p.employee_id===d.id)
              const calc=calcGajiBulanan({gaji_pokok:d.gaji_pokok,tunjangan:d.tunjangan,incentive_enabled:d.incentive_enabled},d._atts,empPotongs)
              const hasGaji=d.gaji_pokok>0||totalTunjangan(d.tunjangan)>0
              return(
                <div key={d.id} onClick={()=>openGajiModal(d)} style={{background:T.surface,borderRadius:12,border:`.5px solid ${T.border}`,padding:'11px 13px',cursor:'pointer',transition:'border-color .1s'}}>
                  <div style={{display:'flex',alignItems:'center',gap:9,marginBottom:hasGaji?9:0}}>
                    <div style={{width:32,height:32,borderRadius:'50%',background:'#D1D5DB',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:'#fff',flexShrink:0}}>
                      {d.name?.split(' ').map(w=>w[0]).join('').slice(0,2)}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:T.black}}>{d.name}</div>
                      <div style={{fontSize:10,color:T.muted}}>{d.role}</div>
                    </div>
                    {!hasGaji&&<span style={{fontSize:10,padding:'3px 8px',background:T.amberLight,color:T.amber,borderRadius:6,fontWeight:600}}>Belum set gaji</span>}
                  </div>
                  {hasGaji&&(
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr 1fr',gap:6,padding:'8px 0 0',borderTop:`.5px dashed ${T.border}`}}>
                      <div><div style={{fontSize:8,color:T.muted,letterSpacing:'.04em'}}>POKOK + TUNJ.</div><div style={{fontSize:11,fontWeight:700,color:T.black}}>Rp {(calc.pokok+calc.tunj_total).toLocaleString('id-ID')}</div></div>
                      <div><div style={{fontSize:8,color:T.muted,letterSpacing:'.04em'}}>INSENTIF</div><div style={{fontSize:11,fontWeight:700,color:calc.insentif>=0?T.green:T.red}}>{calc.insentif>=0?'+':'-'}Rp {Math.abs(calc.insentif).toLocaleString('id-ID')}</div></div>
                      <div><div style={{fontSize:8,color:T.muted,letterSpacing:'.04em'}}>POTONGAN</div><div style={{fontSize:11,fontWeight:700,color:T.red}}>Rp {empPotongs.reduce((s,p)=>s+(parseInt(p.nominal)||0),0).toLocaleString('id-ID')}</div></div>
                      <div><div style={{fontSize:8,color:T.green,letterSpacing:'.04em',fontWeight:700}}>BERSIH</div><div style={{fontSize:12,fontWeight:800,color:T.green}}>Rp {calc.gaji_bersih.toLocaleString('id-ID')}</div></div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* === SLIP GAJI MODAL === */}
      {gajiModal&&(
        <div onClick={()=>setGajiModal(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.6)',zIndex:50,display:'flex',alignItems:'flex-end',justifyContent:'center'}}>
          <div onClick={e=>e.stopPropagation()} style={{background:T.surface,borderRadius:'18px 18px 0 0',width:'100%',maxWidth:520,maxHeight:'90vh',overflowY:'auto',padding:'16px 14px 80px'}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:12,paddingBottom:10,borderBottom:`.5px solid ${T.border}`}}>
              <div>
                <div style={{fontSize:11,color:T.muted}}>SLIP GAJI</div>
                <div style={{fontSize:14,fontWeight:800,color:T.black}}>{gajiModal.emp.name}</div>
                <div style={{fontSize:10,color:T.muted}}>{gajiModal.emp.role} · {gajiModal.label}</div>
              </div>
              <button onClick={()=>setGajiModal(null)} style={{width:30,height:30,borderRadius:'50%',background:T.bg,border:`.5px solid ${T.border}`,fontSize:14,cursor:'pointer'}}>×</button>
            </div>

            {(() => {
              const calc=calcGajiBulanan(gajiModal.emp,gajiModal.atts,gajiModal.potongans)
              const tunj=Array.isArray(gajiModal.emp.tunjangan)?gajiModal.emp.tunjangan:[]
              return(
                <>
                  <div style={{background:T.greenLight,border:`.5px solid ${T.greenBd}`,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:T.green,marginBottom:6,letterSpacing:'.04em'}}>PENDAPATAN</div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span>Gaji Pokok</span><span>Rp {calc.pokok.toLocaleString('id-ID')}</span></div>
                    {tunj.map((t,i)=>(<div key={i} style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0'}}><span>{t.nama||'(tanpa nama)'}</span><span>Rp {(parseInt(t.nominal)||0).toLocaleString('id-ID')}</span></div>))}
                    {calc.insentif>0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0',color:T.green}}><span>Insentif</span><span>+ Rp {calc.insentif.toLocaleString('id-ID')}</span></div>}
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'6px 0 2px',borderTop:`.5px solid ${T.greenBd}`,marginTop:4,fontWeight:700}}><span>Total</span><span>Rp {calc.total_pendapatan.toLocaleString('id-ID')}</span></div>
                  </div>

                  <div style={{background:T.redLight,border:`.5px solid ${T.redBd}`,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:T.red,marginBottom:6,letterSpacing:'.04em'}}>POTONGAN</div>
                    {calc.insentif<0&&<div style={{display:'flex',justifyContent:'space-between',fontSize:11,padding:'2px 0',color:T.red}}><span>Potongan Telat (Insentif)</span><span>- Rp {Math.abs(calc.insentif).toLocaleString('id-ID')}</span></div>}
                    {gajiModal.potongans.map(p=>(
                      <div key={p.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',fontSize:11,padding:'2px 0',color:T.red}}>
                        <span style={{flex:1}}>{p.tipe.charAt(0).toUpperCase()+p.tipe.slice(1)}{p.catatan?` (${p.catatan})`:''}</span>
                        <span>- Rp {(parseInt(p.nominal)||0).toLocaleString('id-ID')}</span>
                        <button onClick={()=>delPotongan(p.id,gajiModal.emp.id,gajiModal.bulan)} style={{marginLeft:6,padding:'2px 6px',fontSize:9,background:'transparent',border:`.5px solid ${T.redBd}`,color:T.red,borderRadius:4,cursor:'pointer'}}>×</button>
                      </div>
                    ))}
                    {calc.total_potongan===0&&<div style={{fontSize:10,color:T.muted,fontStyle:'italic'}}>Tidak ada potongan</div>}
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:12,padding:'6px 0 2px',borderTop:`.5px solid ${T.redBd}`,marginTop:4,fontWeight:700}}><span>Total Potongan</span><span>Rp {calc.total_potongan.toLocaleString('id-ID')}</span></div>
                  </div>

                  {/* Tambah Potongan */}
                  <div style={{background:T.bg,borderRadius:10,padding:'10px 12px',marginBottom:10}}>
                    <div style={{fontSize:10,fontWeight:700,color:T.muted,marginBottom:6,letterSpacing:'.04em'}}>+ TAMBAH POTONGAN</div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:6}}>
                      <select value={newPotongan.tipe} onChange={e=>setNewPotongan(p=>({...p,tipe:e.target.value}))} style={sel}>
                        <option value="kasbon">Kasbon</option>
                        <option value="bpjs">BPJS</option>
                        <option value="pajak">Pajak</option>
                        <option value="lain">Lain-lain</option>
                      </select>
                      <input type="number" inputMode="numeric" value={newPotongan.nominal} onChange={e=>setNewPotongan(p=>({...p,nominal:e.target.value}))} placeholder="Nominal Rp" style={inp}/>
                    </div>
                    <input value={newPotongan.catatan} onChange={e=>setNewPotongan(p=>({...p,catatan:e.target.value}))} placeholder="Catatan (opsional)" style={{...inp,width:'100%',marginBottom:6}}/>
                    <button onClick={()=>addPotongan(gajiModal.emp.id,gajiModal.bulan)} disabled={!newPotongan.nominal} style={{width:'100%',padding:8,background:T.black,color:'#fff',border:'none',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:newPotongan.nominal?1:.5}}>+ Tambah Potongan</button>
                  </div>

                  {/* Gaji Bersih */}
                  <div style={{background:T.green,borderRadius:12,padding:'14px 16px',marginBottom:12,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <div style={{fontSize:10,color:'rgba(255,255,255,.85)',letterSpacing:'.04em',fontWeight:700}}>GAJI BERSIH</div>
                      <div style={{fontSize:20,color:'#fff',fontWeight:800,marginTop:2}}>Rp {calc.gaji_bersih.toLocaleString('id-ID')}</div>
                    </div>
                  </div>

                  <div style={{display:'flex',gap:7}}>
                    <button onClick={()=>setGajiModal(null)} style={{flex:1,padding:11,background:T.bg,color:T.black,border:`.5px solid ${T.border}`,borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>Tutup</button>
                    <button onClick={printSlipGaji} style={{flex:2,padding:11,background:T.black,color:'#fff',border:'none',borderRadius:9,fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>🖨 Cetak Slip Gaji</button>
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

// -- QUOTES TAB -------------------------------------------------------------
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
      if(txt){setNewText(txt);setNewAuthor('AI . Piccolo Corner');setAdding(true)}
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
                {q.author&&<div style={{fontSize:10,color:T.muted}}>-- {q.author}</div>}
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

// -- SETTINGS TAB ------------------------------------------------------------
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
                ? 'Program berjalan -- karyawan bisa melihat insentif & leaderboard' 
                : 'Program belum aktif -- tidak ada yang tampil ke karyawan'}
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
            + Ontime maks jam 10:30 = +Rp 10.000/hari<br/>
            + Maks bonus per bulan = Rp 260.000<br/>
            ✓ Telat setelah 11:00 = -Rp 10.000 (potong gaji)
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

// -- MAIN OWNER PAGE ---------------------------------------------------------
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
