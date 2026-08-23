"use client";

import {useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";

type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type EvidenceType="automatic_assignment"|"team_meeting";
type Evidence={id:number;location_id:number;location_name_snapshot:string;week_start:string;evidence_type:EvidenceType;evidence_path:string;evidence_url:string|null;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};
const evidenceInfo:Record<EvidenceType,{title:string;description:string;icon:string}>={
  automatic_assignment:{title:"Asignación automática",description:"Foto de la carga o asignación automática de los horarios.",icon:"▦"},
  team_meeting:{title:"Reunión semanal del equipo",description:"Foto de la reunión semanal del supervisor con su equipo.",icon:"♟"}
};
const evidenceTypes=Object.keys(evidenceInfo) as EvidenceType[];
function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function firstMonday(year:number){let date=`${year}-01-01`;while(new Date(`${date}T12:00:00Z`).getUTCDay()!==1)date=moveDate(date,1);return date;}
function weeksFor(year:number){const values:string[]=[];for(let date=firstMonday(year);date.startsWith(String(year));date=moveDate(date,7))values.push(date);return values;}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function timeLabel(value:string){return new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}

export default function Constancias({locations,currentUser,apiFetch,setNotice}:Props){
  const isAdmin=currentUser.role==="admin",today=new Date().toLocaleDateString("en-CA"),currentYear=Math.max(2026,new Date().getFullYear());
  const [year,setYear]=useState(currentYear),[weekStart,setWeekStart]=useState(mondayFor(today));
  const [locationId,setLocationId]=useState(locations[0]?.id||0),[evidences,setEvidences]=useState<Evidence[]>([]);
  const [files,setFiles]=useState<Partial<Record<EvidenceType,File>>>({}),[saving,setSaving]=useState<EvidenceType|null>(null),[loading,setLoading]=useState(true);
  const weeks=useMemo(()=>weeksFor(year),[year]);

  useEffect(()=>{if(!weekStart.startsWith(String(year)))setWeekStart(firstMonday(year));},[year]);
  useEffect(()=>{if(!locations.some(location=>location.id===locationId))setLocationId(locations[0]?.id||0);},[locations,locationId]);
  async function loadEvidences(){
    setLoading(true);
    try{
      const response=await apiFetch(`/api/constancias?year=${year}`);
      const payload=await response.json().catch(()=>({error:"No se pudieron cargar las constancias"})) as {evidences?:Evidence[];error?:string};
      if(!response.ok)setNotice(`Error: ${payload.error}`);else setEvidences(payload.evidences||[]);
    }catch{setNotice("Error: no se pudo cargar el apartado de constancias");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void loadEvidences();},[year]);

  async function uploadEvidence(type:EvidenceType){
    if(isAdmin||saving)return;
    const file=files[type];
    if(!locationId){setNotice("Selecciona un local");return;}
    if(!file?.size){setNotice("Selecciona una fotografía antes de enviar");return;}
    if(file.size>8*1024*1024){setNotice("La fotografía no puede superar 8 MB");return;}
    if(!file.type.startsWith("image/")){setNotice("El archivo debe ser una fotografía");return;}
    setSaving(type);
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error("Sesión no válida");
      const extension=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,8)||"jpg";
      const evidencePath=`${session.user.id}/${locationId}/${weekStart}/${type}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const {error:uploadError}=await supabase.storage.from("weekly-evidence").upload(evidencePath,file,{contentType:file.type,upsert:false});
      if(uploadError)throw new Error(`No se pudo subir la fotografía: ${uploadError.message}`);
      const response=await apiFetch("/api/constancias",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({locationId,weekStart,evidenceType:type,evidencePath})});
      const result=await response.json().catch(()=>({error:"No se pudo guardar la constancia"})) as {error?:string};
      if(!response.ok)throw new Error(result.error||"No se pudo guardar la constancia");
      setFiles(current=>({...current,[type]:undefined}));
      setNotice(`✓ ${evidenceInfo[type].title} registrada para la semana`);
      await loadEvidences();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar la constancia"}`);}
    finally{setSaving(null);}
  }

  const selectedLocation=locations.find(location=>location.id===locationId);
  const selected=useMemo(()=>evidenceTypes.map(type=>({type,row:evidences.find(row=>row.location_id===locationId&&row.week_start===weekStart&&row.evidence_type===type)})),[evidences,locationId,weekStart]);
  const completed=selected.filter(item=>item.row).length;

  return <section className="evidence-module">
    <div className="evidence-hero"><div><span>EVIDENCIA SEMANAL</span><h2>Constancias</h2><p>{isAdmin?"Revisa las fotografías enviadas por cada local y supervisor.":"Sube las dos fotografías obligatorias de cada local durante la semana."}</p></div><span className="evidence-role">{isAdmin?"Vista regional del administrador":"Visible solo en tus locales"}</span></div>
    <div className="evidence-toolbar"><label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(1,currentYear-2025)},(_,index)=>2026+index).map(value=><option key={value}>{value}</option>)}</select></label><label>Semana<select value={weekStart} onChange={event=>setWeekStart(event.target.value)}>{weeks.map(week=><option key={week} value={week}>{dateLabel(week)} — {dateLabel(moveDate(week,6))}</option>)}</select></label><label>Local<select value={locationId} onChange={event=>setLocationId(Number(event.target.value))}>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><div className={`evidence-week-status ${completed===2?"complete":"pending"}`}><strong>{completed}/2</strong><span>{completed===2?"Semana completa":"Constancias cargadas"}</span></div></div>
    {!selectedLocation?<div className="evidence-empty">No existen locales disponibles para tu cuenta.</div>:<div className="evidence-card-grid">{selected.map(({type,row})=>{const info=evidenceInfo[type];return <article key={type} className={`evidence-card ${row?"complete":"pending"}`}><div className="evidence-card-head"><span>{info.icon}</span><div><small>{row?"CUMPLIDA":"PENDIENTE"}</small><h3>{info.title}</h3><p>{info.description}</p></div><b>{row?"✓":"!"}</b></div>{row?<><a className="evidence-preview" href={row.evidence_url||"#"} target="_blank" rel="noreferrer" aria-disabled={!row.evidence_url}>{row.evidence_url?<img src={row.evidence_url} alt={`Constancia de ${info.title}`} />:<span>Vista previa no disponible</span>}<strong>Ver fotografía completa</strong></a><div className="evidence-audit"><span>Subida por</span><strong>{row.submitted_by_name}</strong><small>{timeLabel(row.submitted_at)}</small>{row.last_updated_by_name!==row.submitted_by_name&&<small>Última actualización: {row.last_updated_by_name} · {timeLabel(row.updated_at)}</small>}</div></>:<div className="evidence-placeholder"><span>▧</span><strong>Falta la fotografía</strong><small>Esta actividad todavía no cuenta para el cumplimiento.</small></div>}{!isAdmin&&<div className="evidence-upload-control"><label>{row?"Reemplazar fotografía":"Seleccionar fotografía"}<input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event=>{const file=event.target.files?.[0];if(file)setFiles(current=>({...current,[type]:file}));}} /></label>{files[type]&&<small>{files[type]!.name}</small>}<button className="primary" disabled={!files[type]||saving!==null} onClick={()=>void uploadEvidence(type)}>{saving===type?"Subiendo…":row?"Guardar nueva foto":"Enviar constancia"}</button></div>}</article>})}</div>}
    {loading&&<div className="evidence-loading">Actualizando constancias…</div>}
  </section>;
}
