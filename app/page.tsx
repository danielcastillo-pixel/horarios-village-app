"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";

type Location={id:number;name:string;city:string};
type Role={id:number;name:string;color:string;counts_hours:boolean};
type Supervisor={id:number;name:string;location_id:number;active:boolean};
type Assignment={id:number;supervisor_id:number;work_date:string;start_time:string|null;end_time:string|null;role_id:number;notes:string};
type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";location_id:number|null;active:boolean};

const iso=(d:Date)=>d.toISOString().slice(0,10);
const monday=(d=new Date())=>{const x=new Date(d);x.setHours(12,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x};
const days=(start:Date)=>Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d});
const hours=(a:Assignment|undefined,r?:Role)=>{if(!a||!r?.counts_hours||!a.start_time||!a.end_time)return 0;const [sh,sm]=a.start_time.split(":").map(Number),[eh,em]=a.end_time.split(":").map(Number);return Math.max(0,(eh*60+em-sh*60-sm)/60)};

export default function Home(){
  const [session,setSession]=useState<any>(null),[profile,setProfile]=useState<Profile|null>(null);
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[error,setError]=useState("");
  const [register,setRegister]=useState(false),[fullName,setFullName]=useState("");
  const [locations,setLocations]=useState<Location[]>([]),[roles,setRoles]=useState<Role[]>([]);
  const [supervisors,setSupervisors]=useState<Supervisor[]>([]),[assignments,setAssignments]=useState<Assignment[]>([]);
  const [profiles,setProfiles]=useState<Profile[]>([]);
  const [locationId,setLocationId]=useState<number>(0),[week,setWeek]=useState(monday());
  const [tab,setTab]=useState<"schedule"|"team"|"catalogs"|"access"|"report">("schedule");

  useEffect(()=>{supabase.auth.getSession().then(({data})=>setSession(data.session));return supabase.auth.onAuthStateChange((_e,s)=>setSession(s)).data.subscription.unsubscribe},[]);
  useEffect(()=>{if(!session)return;loadProfile()},[session]);
  useEffect(()=>{if(profile?.active)loadAll()},[profile,week]);

  async function loadProfile(){const {data,error}=await supabase.from("profiles").select("*").single();if(error)setError(error.message);else setProfile(data)}
  async function loadAll(){
    const from=iso(week),to=iso(days(week)[6]);
    const [{data:l},{data:r},{data:s},{data:a},{data:p}]=await Promise.all([
      supabase.from("locations").select("*").eq("active",true).order("name"),
      supabase.from("roles").select("*").order("name"),
      supabase.from("supervisors").select("*").eq("active",true).order("name"),
      supabase.from("assignments").select("*").gte("work_date",from).lte("work_date",to),
      supabase.from("profiles").select("*").order("email")
    ]);
    setLocations(l||[]);setRoles(r||[]);setSupervisors(s||[]);setAssignments(a||[]);setProfiles(p||[]);
    const wanted=profile?.app_role==="supervisor"?profile.location_id:(locationId||l?.[0]?.id);
    if(wanted)setLocationId(wanted);
  }
  async function login(e:FormEvent){e.preventDefault();setError("");const {error}=await supabase.auth.signInWithPassword({email,password});if(error)setError("Correo o contraseña incorrectos.")}
  async function submitAccess(e:FormEvent){e.preventDefault();setError("");if(register){const {error}=await supabase.auth.signUp({email,password,options:{data:{full_name:fullName}}});if(error)setError(error.message);else setError("Registro recibido. Revisa tu correo y luego espera la activación del administrador.");}else await login(e)}
  async function saveCell(supervisorId:number,date:string,current?:Assignment){
    const roleId=Number(prompt("ID del rol:\n"+roles.map(r=>`${r.id}: ${r.name}`).join("\n"),String(current?.role_id||roles[0]?.id||"")));
    if(!roleId)return;const role=roles.find(r=>r.id===roleId);
    const start=role?.counts_hours?prompt("Hora de entrada (HH:MM)",current?.start_time?.slice(0,5)||"06:00"):null;
    const end=role?.counts_hours?prompt("Hora de salida (HH:MM)",current?.end_time?.slice(0,5)||"14:00"):null;
    const payload={supervisor_id:supervisorId,work_date:date,role_id:roleId,start_time:start||null,end_time:end||null,notes:""};
    const {error}=await supabase.from("assignments").upsert(payload,{onConflict:"supervisor_id,work_date"});if(error)alert(error.message);else loadAll();
  }
  async function addSupervisor(){const name=prompt("Nombre del supervisor");if(!name)return;const {error}=await supabase.from("supervisors").insert({name,location_id:locationId});if(error)alert(error.message);else loadAll()}
  async function renameSupervisor(s:Supervisor){const name=prompt("Nuevo nombre",s.name);if(!name)return;await supabase.from("supervisors").update({name}).eq("id",s.id);loadAll()}
  async function removeSupervisor(s:Supervisor){if(!confirm(`¿Quitar a ${s.name}?`))return;await supabase.from("supervisors").update({active:false}).eq("id",s.id);loadAll()}
  async function addLocation(){const name=prompt("Nombre del local");if(!name)return;await supabase.from("locations").insert({name,city:"Quito"});loadAll()}
  async function addRole(){const name=prompt("Nombre del rol");if(!name)return;const counts_hours=confirm("Aceptar = suma horas. Cancelar = cuenta como libre.");await supabase.from("roles").insert({name,counts_hours,color:counts_hours?"#dcfce7":"#fef3c7"});loadAll()}
  async function updateAccess(p:Profile,patch:Partial<Profile>){const {error}=await supabase.from("profiles").update(patch).eq("id",p.id);if(error)alert(error.message);else loadAll()}
  function exportExcel(){
    const start=prompt("Fecha inicial (AAAA-MM-DD)",iso(week)),end=prompt("Fecha final (AAAA-MM-DD)",iso(days(week)[6]));if(!start||!end)return;
    supabase.from("assignments").select("*, supervisors!inner(name,location_id), roles(name,counts_hours)").eq("supervisors.location_id",locationId).gte("work_date",start).lte("work_date",end).then(({data,error})=>{
      if(error)return alert(error.message);
      const rows=(data||[]).map((a:any)=>({Fecha:a.work_date,Supervisor:a.supervisors.name,Rol:a.roles.name,Entrada:a.start_time?.slice(0,5)||"",Salida:a.end_time?.slice(0,5)||"",Horas:hours(a,a.roles)}));
      const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Horario");XLSX.writeFile(wb,`Horario_${start}_${end}.xlsx`);
    });
  }
  const visible=useMemo(()=>supervisors.filter(s=>s.location_id===locationId),[supervisors,locationId]);
  const weekDays=days(week);

  if(!session)return <main className="login"><form className="card loginCard" onSubmit={submitAccess}><div className="brand">V</div><h1>Horarios Village</h1><p>{register?"Crea tu cuenta de supervisor":"Acceso interno para supervisores"}</p>{register&&<label>Nombre completo<input value={fullName} onChange={e=>setFullName(e.target.value)} required/></label>}<label>Correo<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Contraseña<input type="password" minLength={8} value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className="error">{error}</div>}<button>{register?"Registrarme":"Ingresar"}</button><button type="button" className="ghost" onClick={()=>{setRegister(!register);setError("")}}>{register?"Ya tengo cuenta":"Crear cuenta"}</button></form></main>;
  if(!profile)return <main className="center">Cargando acceso…</main>;
  if(!profile.active)return <main className="center card"><h2>Cuenta pendiente de aprobación</h2><p>El administrador debe activar tu usuario y asignarte un local.</p><button onClick={()=>supabase.auth.signOut()}>Cerrar sesión</button></main>;

  return <main>
    <header><div><h1>Horarios Village</h1><small>{profile.app_role==="admin"?"Administrador":"Supervisor"} · {profile.email}</small></div><button className="ghost" onClick={()=>supabase.auth.signOut()}>Salir</button></header>
    <nav>{(["schedule","team","catalogs",...(profile.app_role==="admin"?["access" as const]:[]),"report"] as const).map((t)=><button key={t} className={tab===t?"active":""} onClick={()=>setTab(t)}>{({schedule:"Horario",team:"Supervisores",catalogs:"Configuración",access:"Accesos",report:"Reportes"})[t]}</button>)}</nav>
    <section className="toolbar">
      <label>Local<select value={locationId} disabled={profile.app_role!=="admin"} onChange={e=>setLocationId(Number(e.target.value))}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
      {tab==="schedule"&&<><button onClick={()=>{const d=new Date(week);d.setDate(d.getDate()-7);setWeek(d)}}>←</button><strong>{iso(week)} — {iso(weekDays[6])}</strong><button onClick={()=>{const d=new Date(week);d.setDate(d.getDate()+7);setWeek(d)}}>→</button></>}
    </section>

    {tab==="schedule"&&<section className="tableWrap"><table><thead><tr><th>Supervisor</th>{weekDays.map(d=><th key={iso(d)}>{d.toLocaleDateString("es-EC",{weekday:"short",day:"2-digit",month:"2-digit"})}</th>)}<th>Total</th></tr></thead><tbody>{visible.map(s=><tr key={s.id}><th>{s.name}</th>{weekDays.map(d=>{const a=assignments.find(x=>x.supervisor_id===s.id&&x.work_date===iso(d)),r=roles.find(x=>x.id===a?.role_id);return <td key={iso(d)} onClick={()=>saveCell(s.id,iso(d),a)} style={{background:r?.color}}><b>{r?.name||"Agregar"}</b>{a?.start_time&&<small>{a.start_time.slice(0,5)}–{a.end_time?.slice(0,5)}</small>}</td>})}<td className="total">{assignments.filter(a=>a.supervisor_id===s.id).reduce((n,a)=>n+hours(a,roles.find(r=>r.id===a.role_id)),0).toFixed(1)} h</td></tr>)}</tbody></table></section>}
    {tab==="team"&&<section className="panel"><div className="panelHead"><h2>Supervisores del local</h2>{profile.app_role==="admin"&&<button onClick={addSupervisor}>+ Agregar</button>}</div>{visible.map(s=><div className="row" key={s.id}><span className="avatar">{s.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><b>{s.name}</b><span className="grow"/>{profile.app_role==="admin"&&<><button className="ghost" onClick={()=>renameSupervisor(s)}>Editar nombre</button><button className="danger" onClick={()=>removeSupervisor(s)}>Quitar</button></>}</div>)}</section>}
    {tab==="catalogs"&&<section className="grid"><div className="panel"><div className="panelHead"><h2>Locales</h2>{profile.app_role==="admin"&&<button onClick={addLocation}>+ Local</button>}</div>{locations.map(x=><div className="row" key={x.id}>{x.name}</div>)}</div><div className="panel"><div className="panelHead"><h2>Roles</h2>{profile.app_role==="admin"&&<button onClick={addRole}>+ Rol</button>}</div>{roles.map(r=><div className="row" key={r.id}><span className="dot" style={{background:r.color}}/>{r.name}<span className="grow"/><small>{r.counts_hours?"Suma horas":"Cuenta como libre"}</small></div>)}</div></section>}
    {tab==="access"&&<section className="panel"><div className="panelHead"><div><h2>Administración de accesos</h2><small>Los usuarios nuevos quedan bloqueados hasta que tú los actives.</small></div></div>{profiles.map(p=><div className="row" key={p.id}><div><b>{p.full_name||p.email}</b><small>{p.email}</small></div><span className="grow"/><select value={p.location_id||""} onChange={e=>updateAccess(p,{location_id:Number(e.target.value)||null})}><option value="">Sin local</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><select value={p.app_role} disabled={p.id===profile.id} onChange={e=>updateAccess(p,{app_role:e.target.value as Profile["app_role"]})}><option value="supervisor">Supervisor</option><option value="admin">Administrador</option></select><button className={p.active?"danger":""} disabled={p.id===profile.id} onClick={()=>updateAccess(p,{active:!p.active})}>{p.active?"Bloquear":"Activar"}</button></div>)}</section>}
    {tab==="report"&&<section className="panel report"><h2>Reporte por local y rango de fechas</h2><p>El Excel incluye fecha, supervisor, rol, entrada, salida y total de horas.</p><button onClick={exportExcel}>Descargar reporte Excel</button></section>}
  </main>
}
