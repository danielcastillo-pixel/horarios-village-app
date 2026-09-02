"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import * as XLSX from "xlsx-js-style";

type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type Submission={id:number;location_id:number;week_start:string;activity_type:"shopper_purchase"|"shopper_delivery"|"supervisor_schedule";submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Evaluation={id:number;location_id:number;week_start:string;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Evidence={id:number;location_id:number;week_start:string;evidence_type:"automatic_assignment"|"team_meeting"|"supervisor_meeting";evidence_url:string|null;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Entry=Submission|Evaluation|Evidence;
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};

const activityLabels={
  shopper_purchase:"Horario shoppers · Compra",
  shopper_delivery:"Horario shoppers · Entrega",
  administrator_rating:"Calificación administrador",
  supervisor_schedule:"Horario supervisor",
  automatic_assignment:"Constancia · Asignación automática",
  team_meeting:"Constancia · Reunión semanal",
  supervisor_meeting:"Constancia · Reunión de supervisores"
} as const;
type Activity=keyof typeof activityLabels;
const requiredActivityCount=Object.keys(activityLabels).length;

function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function firstMonday(year:number){let date=`${year}-01-01`;while(new Date(`${date}T12:00:00Z`).getUTCDay()!==1)date=moveDate(date,1);return date;}
function weeksFor(year:number){const values:string[]=[];for(let date=firstMonday(year);date.startsWith(String(year));date=moveDate(date,7))values.push(date);return values;}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function timeLabel(value:string){return new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}

export default function WeeklyCompliance({locations,currentUser,apiFetch,setNotice}:Props){
  const isAdmin=currentUser.role==="admin";
  const today=new Date().toLocaleDateString("en-CA");
  const currentYear=Math.max(2026,new Date().getFullYear());
  const [year,setYear]=useState(currentYear);
  const [weekStart,setWeekStart]=useState(mondayFor(today));
  const [submissions,setSubmissions]=useState<Submission[]>([]);
  const [evaluations,setEvaluations]=useState<Evaluation[]>([]);
  const [evidences,setEvidences]=useState<Evidence[]>([]);
  const [loading,setLoading]=useState(true);
  const [lastRefresh,setLastRefresh]=useState<Date|null>(null);
  const weeks=useMemo(()=>weeksFor(year),[year]);

  useEffect(()=>{if(!weekStart.startsWith(String(year)))setWeekStart(firstMonday(year));},[year,weekStart]);

  const loadCompliance=useCallback(async(showNotice=false)=>{
    setLoading(true);
    try{
      const nonce=Date.now();
      const response=await apiFetch(`/api/compliance?year=${year}&week=${weekStart}&_=${nonce}`,{cache:"no-store",headers:{"cache-control":"no-cache"}});
      const payload=await response.json().catch(()=>({error:"No se pudo cargar el cumplimiento"})) as {submissions?:Submission[];evaluations?:Evaluation[];evidences?:Evidence[];error?:string};
      if(!response.ok){
        setNotice(`Error: ${payload.error||"No se pudo cargar el cumplimiento"}`);
        return;
      }
      setSubmissions(payload.submissions||[]);
      setEvaluations(payload.evaluations||[]);
      setEvidences(payload.evidences||[]);
      setLastRefresh(new Date());
      if(showNotice)setNotice("✓ Cumplimiento actualizado");
    }catch{
      setNotice("Error: no se pudo actualizar el cumplimiento. Revisa la conexión e inténtalo otra vez.");
    }finally{
      setLoading(false);
    }
  },[apiFetch,setNotice,weekStart,year]);

  useEffect(()=>{void loadCompliance(false);},[loadCompliance]);
  useEffect(()=>{
    const onFocus=()=>void loadCompliance(false);
    const onVisible=()=>{if(document.visibilityState==="visible")void loadCompliance(false);};
    window.addEventListener("focus",onFocus);
    document.addEventListener("visibilitychange",onVisible);
    return()=>{window.removeEventListener("focus",onFocus);document.removeEventListener("visibilitychange",onVisible);};
  },[loadCompliance]);

  const rows=useMemo(()=>locations.map(location=>{
    const entries:Partial<Record<Activity,Entry>>={};
    submissions.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>{entries[row.activity_type]=row;});
    const evaluation=evaluations.find(row=>row.location_id===location.id&&row.week_start===weekStart);if(evaluation)entries.administrator_rating=evaluation;
    evidences.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>{entries[row.evidence_type]=row;});
    const completed=(Object.keys(activityLabels) as Activity[]).filter(activity=>entries[activity]).length;
    return {location,entries,completed,percentage:Math.round(completed/requiredActivityCount*100)};
  }),[locations,submissions,evaluations,evidences,weekStart]);

  const totals=useMemo(()=>({
    completed:rows.reduce((sum,row)=>sum+row.completed,0),
    required:rows.length*requiredActivityCount,
    full:rows.filter(row=>row.percentage===100).length,
    pending:rows.filter(row=>row.percentage<100).length
  }),[rows]);

  const actors=useMemo(()=>{
    const map=new Map<string,{name:string;email:string;count:number;admin:boolean}>();
    rows.forEach(row=>Object.values(row.entries).forEach(entry=>{
      if(!entry)return;
      const key=entry.submitted_by_email||entry.submitted_by_name;
      const current=map.get(key)||{name:entry.submitted_by_name,email:entry.submitted_by_email,count:0,admin:(entry.submitted_by_email||"").toLowerCase()===currentUser.email.toLowerCase()};
      current.count++;
      map.set(key,current);
    }));
    return [...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  },[rows,currentUser.email]);

  const overall=totals.required?Math.round(totals.completed/totals.required*100):0;

  function downloadComplianceReport(){
    if(!isAdmin)return;
    const activities=Object.keys(activityLabels) as Activity[];
    const headers=["Local",...activities.map(activity=>activityLabels[activity]),"Cumplimiento"];
    const body=rows.map(row=>[row.location.name,...activities.map(activity=>row.entries[activity]?"✓ Cumplida":"Pendiente"),row.percentage/100]);
    const weekEnd=moveDate(weekStart,6),title="TIPTI Operaciones | Cumplimiento semanal";
    const sheet=XLSX.utils.aoa_to_sheet([[title],[`Semana: ${weekStart} al ${weekEnd}`],[],headers,...body]);
    sheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:headers.length-1}},{s:{r:1,c:0},e:{r:1,c:headers.length-1}}];
    sheet["!cols"]=[{wch:27},...activities.map(()=>({wch:26})),{wch:15}];
    sheet["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:3,c:0},e:{r:Math.max(3,body.length+3),c:headers.length-1}})};
    sheet["!rows"]=[{hpt:28},{hpt:21},{hpt:8},{hpt:38}];
    for(let column=0;column<headers.length;column++){
      const titleCell=sheet[XLSX.utils.encode_cell({r:0,c:column})]||(sheet[XLSX.utils.encode_cell({r:0,c:column})]={t:"s",v:""});
      titleCell.s={fill:{fgColor:{rgb:"102F4D"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:16},alignment:{horizontal:"center",vertical:"center"}};
      const subtitleCell=sheet[XLSX.utils.encode_cell({r:1,c:column})]||(sheet[XLSX.utils.encode_cell({r:1,c:column})]={t:"s",v:""});
      subtitleCell.s={fill:{fgColor:{rgb:"EAF0F5"}},font:{bold:true,color:{rgb:"102F4D"}},alignment:{horizontal:"center",vertical:"center"}};
      const header=sheet[XLSX.utils.encode_cell({r:3,c:column})];
      if(header)header.s={fill:{fgColor:{rgb:"F1F3F5"}},font:{bold:true,color:{rgb:"334155"}},alignment:{horizontal:column===0?"left":"center",vertical:"center",wrapText:true},border:{bottom:{style:"thin",color:{rgb:"CBD5E1"}}}};
    }
    for(let row=4;row<body.length+4;row++){
      for(let column=0;column<headers.length;column++){
        const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];if(!cell)continue;
        const isLocal=column===0,isTotal=column===headers.length-1,status=String(cell.v||"");
        const complete=status.includes("Cumplida"),pending=status==="Pendiente";
        cell.s={font:{bold:isLocal||complete||pending,color:complete?{rgb:"08794C"}:pending?{rgb:"B02B2B"}:{rgb:"172B43"}},alignment:{horizontal:isLocal?"left":"center",vertical:"center",wrapText:true},border:{bottom:{style:"thin",color:{rgb:"E2E8F0"}},right:{style:"thin",color:{rgb:"EDF0F3"}}},fill:isTotal?{fgColor:{rgb:"F8FAFC"}}:undefined};
        if(isTotal)cell.z="0%";
      }
    }
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,"Cumplimiento");
    const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"});
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link=document.createElement("a");link.href=url;link.download=`Cumplimiento_Semanal_${weekStart}.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    setNotice("✓ Reporte de cumplimiento descargado");
  }

  return <section className={`compliance-module ${isAdmin?"admin-view":"supervisor-view"}`}>
    <div className="compliance-hero"><div><span>CONTROL AUTOMÁTICO</span><h2>Cumplimiento semanal</h2><p>Siete actividades obligatorias por local, con autor y fecha reales.</p></div><span className="admin-lock">{isAdmin?"Vista regional del administrador":"Solo tus locales asignados"}</span></div>
    <div className="compliance-toolbar">
      <label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(1,currentYear-2025)},(_,index)=>2026+index).map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Semana<select value={weekStart} onChange={event=>setWeekStart(event.target.value)}>{weeks.map(week=><option key={week} value={week}>{dateLabel(week)} — {dateLabel(moveDate(week,6))}</option>)}</select></label>
      <button type="button" className="compliance-download" onClick={()=>void loadCompliance(true)} disabled={loading}>{loading?"Actualizando…":"↻ Actualizar"}</button>
      {isAdmin&&<button type="button" className="compliance-download" onClick={downloadComplianceReport} disabled={loading}>⇩ Descargar reporte</button>}
      {lastRefresh&&<small>Última actualización: {lastRefresh.toLocaleTimeString("es-EC",{hour:"2-digit",minute:"2-digit"})}</small>}
    </div>
    <div className="compliance-kpis"><article><span>{isAdmin?"Cumplimiento regional":"Mi cumplimiento"}</span><strong>{overall}%</strong><div className="compliance-progress"><i style={{width:`${overall}%`}}/></div></article><article><span>Actividades completas</span><strong>{totals.completed}/{totals.required}</strong><small>{requiredActivityCount} obligatorias por local</small></article><article><span>Locales al 100%</span><strong>{totals.full}</strong><small>Semana seleccionada</small></article><article><span>Locales pendientes</span><strong>{totals.pending}</strong><small>{isAdmin?"Requieren seguimiento":"Revisa qué te falta"}</small></article></div>
    <div className="compliance-layout"><div className="compliance-table-card"><div className="compliance-table-title"><div><h3>{dateLabel(weekStart)} — {dateLabel(moveDate(weekStart,6))}</h3><p>{loading?"Cargando actividad…":`Cada actividad completa suma una de las ${requiredActivityCount} obligaciones.`}</p></div></div><div className="table-wrap"><table className="compliance-table"><thead><tr><th>Local</th>{(Object.keys(activityLabels) as Activity[]).map(activity=><th key={activity}>{activityLabels[activity]}</th>)}<th>Total</th></tr></thead><tbody>{rows.map(row=><tr key={row.location.id}><td><strong>{row.location.name}</strong><small>{row.location.city}</small></td>{(Object.keys(activityLabels) as Activity[]).map(activity=>{const entry=row.entries[activity];const isEvidence=entry&&"evidence_url" in entry;return <td key={activity}>{entry?<div className="compliance-done"><b>✓ Cumplida</b><strong>{entry.submitted_by_name}</strong><small>{timeLabel(entry.submitted_at)}</small>{entry.last_updated_by_name!==entry.submitted_by_name&&<small>Actualizó: {entry.last_updated_by_name}</small>}{isEvidence&&entry.evidence_url&&<a href={entry.evidence_url} target="_blank" rel="noreferrer">Ver foto</a>}{isAdmin&&entry.submitted_by_email.toLowerCase()===currentUser.email.toLowerCase()&&<em>Hecho por administrador</em>}</div>:<div className="compliance-missing"><b>0%</b><span>Pendiente</span></div>}</td>})}<td><span className={`compliance-total ${row.percentage===100?"full":row.percentage?"partial":"empty"}`}>{row.percentage}%</span></td></tr>)}</tbody></table></div></div>{isAdmin&&<aside className="compliance-ranking"><h3>Actividad por supervisor</h3><p>Quién registró las funciones de esta semana.</p>{actors.length?actors.map((actor,index)=><article key={actor.email||actor.name}><span>{index+1}</span><div><strong>{actor.name}</strong><small>{actor.admin?"Administrador":"Supervisor"}</small></div><b>{actor.count}</b></article>):<div className="compliance-ranking-empty">Todavía no existen actividades publicadas.</div>}<small className="ranking-note">Las actividades hechas por el administrador quedan identificadas y no se atribuyen a un supervisor.</small></aside>}</div>
  </section>;
}
