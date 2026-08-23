"use client";

import {useEffect,useMemo,useState} from "react";
type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type Submission={id:number;location_id:number;week_start:string;activity_type:"shopper_purchase"|"shopper_delivery"|"supervisor_schedule";submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Evaluation={id:number;location_id:number;week_start:string;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Evidence={id:number;location_id:number;week_start:string;evidence_type:"automatic_assignment"|"team_meeting";evidence_url:string|null;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Entry=Submission|Evaluation|Evidence;
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};
const activityLabels={shopper_purchase:"Horario shoppers · Compra",shopper_delivery:"Horario shoppers · Entrega",administrator_rating:"Calificación administrador",supervisor_schedule:"Horario supervisor",automatic_assignment:"Constancia · Asignación automática",team_meeting:"Constancia · Reunión semanal"} as const;
type Activity=keyof typeof activityLabels;
function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function firstMonday(year:number){let date=`${year}-01-01`;while(new Date(`${date}T12:00:00Z`).getUTCDay()!==1)date=moveDate(date,1);return date;}
function weeksFor(year:number){const values:string[]=[];for(let date=firstMonday(year);date.startsWith(String(year));date=moveDate(date,7))values.push(date);return values;}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function timeLabel(value:string){return new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}

export default function WeeklyCompliance({locations,currentUser,apiFetch,setNotice}:Props){
  const isAdmin=currentUser.role==="admin",today=new Date().toLocaleDateString("en-CA"),currentYear=Math.max(2026,new Date().getFullYear());
  const [year,setYear]=useState(currentYear),[weekStart,setWeekStart]=useState(mondayFor(today));
  const [submissions,setSubmissions]=useState<Submission[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[evidences,setEvidences]=useState<Evidence[]>([]),[loading,setLoading]=useState(true);
  const weeks=useMemo(()=>weeksFor(year),[year]);
  useEffect(()=>{if(!weekStart.startsWith(String(year)))setWeekStart(firstMonday(year));},[year]);
  useEffect(()=>{(async()=>{setLoading(true);const response=await apiFetch(`/api/compliance?year=${year}`);const payload=await response.json().catch(()=>({error:"No se pudo cargar el cumplimiento"})) as {submissions?:Submission[];evaluations?:Evaluation[];evidences?:Evidence[];error?:string};if(!response.ok)setNotice(`Error: ${payload.error}`);else{setSubmissions(payload.submissions||[]);setEvaluations(payload.evaluations||[]);setEvidences(payload.evidences||[]);}setLoading(false);})();},[year]);

  const rows=useMemo(()=>locations.map(location=>{
    const entries:Partial<Record<Activity,Entry>>={};
    submissions.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>{entries[row.activity_type]=row;});
    const evaluation=evaluations.find(row=>row.location_id===location.id&&row.week_start===weekStart);if(evaluation)entries.administrator_rating=evaluation;
    evidences.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>{entries[row.evidence_type]=row;});
    const completed=(Object.keys(activityLabels) as Activity[]).filter(activity=>entries[activity]).length;
    return {location,entries,completed,percentage:Math.round(completed/6*100)};
  }),[locations,submissions,evaluations,evidences,weekStart]);
  const totals=useMemo(()=>({completed:rows.reduce((sum,row)=>sum+row.completed,0),required:rows.length*6,full:rows.filter(row=>row.percentage===100).length,pending:rows.filter(row=>row.percentage<100).length}),[rows]);
  const actors=useMemo(()=>{
    const map=new Map<string,{name:string;email:string;count:number;admin:boolean}>();
    rows.forEach(row=>Object.values(row.entries).forEach(entry=>{if(!entry)return;const key=entry.submitted_by_email;const current=map.get(key)||{name:entry.submitted_by_name,email:key,count:0,admin:key.toLowerCase()===currentUser.email.toLowerCase()};current.count++;map.set(key,current);}));
    return [...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  },[rows,currentUser.email]);
  const overall=totals.required?Math.round(totals.completed/totals.required*100):0;

  return <section className={`compliance-module ${isAdmin?"admin-view":"supervisor-view"}`}>
    <div className="compliance-hero"><div><span>CONTROL AUTOMÁTICO</span><h2>Cumplimiento semanal</h2><p>Seis actividades obligatorias por local, con autor y fecha reales.</p></div><span className="admin-lock">{isAdmin?"Vista regional del administrador":"Solo tus locales asignados"}</span></div>
    <div className="compliance-toolbar"><label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(1,currentYear-2025)},(_,index)=>2026+index).map(value=><option key={value}>{value}</option>)}</select></label><label>Semana<select value={weekStart} onChange={event=>setWeekStart(event.target.value)}>{weeks.map(week=><option key={week} value={week}>{dateLabel(week)} — {dateLabel(moveDate(week,6))}</option>)}</select></label></div>
    <div className="compliance-kpis"><article><span>{isAdmin?"Cumplimiento regional":"Mi cumplimiento"}</span><strong>{overall}%</strong><div className="compliance-progress"><i style={{width:`${overall}%`}}/></div></article><article><span>Actividades completas</span><strong>{totals.completed}/{totals.required}</strong><small>6 obligatorias por local</small></article><article><span>Locales al 100%</span><strong>{totals.full}</strong><small>Semana seleccionada</small></article><article><span>Locales pendientes</span><strong>{totals.pending}</strong><small>{isAdmin?"Requieren seguimiento":"Revisa qué te falta"}</small></article></div>
    <div className="compliance-layout"><div className="compliance-table-card"><div className="compliance-table-title"><div><h3>{dateLabel(weekStart)} — {dateLabel(moveDate(weekStart,6))}</h3><p>{loading?"Cargando actividad…":"Cada actividad completa suma una de las seis obligaciones."}</p></div></div><div className="table-wrap"><table className="compliance-table"><thead><tr><th>Local</th>{(Object.keys(activityLabels) as Activity[]).map(activity=><th key={activity}>{activityLabels[activity]}</th>)}<th>Total</th></tr></thead><tbody>{rows.map(row=><tr key={row.location.id}><td><strong>{row.location.name}</strong><small>{row.location.city}</small></td>{(Object.keys(activityLabels) as Activity[]).map(activity=>{const entry=row.entries[activity];const isEvidence=entry&&"evidence_url" in entry;return <td key={activity}>{entry?<div className="compliance-done"><b>✓ Cumplida</b><strong>{entry.submitted_by_name}</strong><small>{timeLabel(entry.submitted_at)}</small>{entry.last_updated_by_name!==entry.submitted_by_name&&<small>Actualizó: {entry.last_updated_by_name}</small>}{isEvidence&&entry.evidence_url&&<a href={entry.evidence_url} target="_blank" rel="noreferrer">Ver foto</a>}{isAdmin&&entry.submitted_by_email.toLowerCase()===currentUser.email.toLowerCase()&&<em>Hecho por administrador</em>}</div>:<div className="compliance-missing"><b>0%</b><span>Pendiente</span></div>}</td>})}<td><span className={`compliance-total ${row.percentage===100?"full":row.percentage?"partial":"empty"}`}>{row.percentage}%</span></td></tr>)}</tbody></table></div></div>{isAdmin&&<aside className="compliance-ranking"><h3>Actividad por supervisor</h3><p>Quién registró las funciones de esta semana.</p>{actors.length?actors.map((actor,index)=><article key={actor.email}><span>{index+1}</span><div><strong>{actor.name}</strong><small>{actor.admin?"Administrador":"Supervisor"}</small></div><b>{actor.count}</b></article>):<div className="compliance-ranking-empty">Todavía no existen actividades publicadas.</div>}<small className="ranking-note">Las actividades hechas por el administrador quedan identificadas y no se atribuyen a un supervisor.</small></aside>}</div>
  </section>;
}
