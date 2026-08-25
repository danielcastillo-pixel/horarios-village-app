"use client";

import {useEffect,useMemo,useState} from "react";
import * as XLSX from "xlsx-js-style";
type Location={id:number;name:string;city:string};
type Supervisor={id:number;name:string;location_id:number;active:number;active_from:string;active_until:string|null};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type Submission={id:number;location_id:number;week_start:string;activity_type:"shopper_purchase"|"shopper_delivery"|"supervisor_schedule";submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Evaluation={id:number;location_id:number;week_start:string;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Evidence={id:number;location_id:number;week_start:string;evidence_type:"automatic_assignment"|"team_meeting";evidence_url:string|null;submitted_by_name:string;submitted_by_email:string;submitted_at:string;last_updated_by_name:string;updated_at:string};
type Entry=Submission|Evaluation|Evidence;
type Props={locations:Location[];supervisors:Supervisor[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};
const activityLabels={shopper_purchase:"Horario shoppers · Compra",shopper_delivery:"Horario shoppers · Entrega",administrator_rating:"Calificación administrador",supervisor_schedule:"Horario supervisor",automatic_assignment:"Constancia · Asignación automática",team_meeting:"Constancia · Reunión semanal"} as const;
type Activity=keyof typeof activityLabels;
function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function firstMonday(year:number){let date=`${year}-01-01`;while(new Date(`${date}T12:00:00Z`).getUTCDay()!==1)date=moveDate(date,1);return date;}
function weeksFor(year:number){const values:string[]=[];for(let date=firstMonday(year);date.startsWith(String(year));date=moveDate(date,7))values.push(date);return values;}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function timeLabel(value:string){return new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}

export default function WeeklyCompliance({locations,supervisors,currentUser,apiFetch,setNotice}:Props){
  const isAdmin=currentUser.role==="admin",today=new Date().toLocaleDateString("en-CA"),currentYear=Math.max(2026,new Date().getFullYear());
  const [year,setYear]=useState(currentYear),[weekStart,setWeekStart]=useState(mondayFor(today));
  const [submissions,setSubmissions]=useState<Submission[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[evidences,setEvidences]=useState<Evidence[]>([]),[loading,setLoading]=useState(true);
  const weeks=useMemo(()=>weeksFor(year),[year]);
  useEffect(()=>{if(!weekStart.startsWith(String(year)))setWeekStart(firstMonday(year));},[year]);
  useEffect(()=>{(async()=>{setLoading(true);const response=await apiFetch(`/api/compliance?year=${year}`);const payload=await response.json().catch(()=>({error:"No se pudo cargar el cumplimiento"})) as {submissions?:Submission[];evaluations?:Evaluation[];evidences?:Evidence[];error?:string};if(!response.ok)setNotice(`Error: ${payload.error}`);else{setSubmissions(payload.submissions||[]);setEvaluations(payload.evaluations||[]);setEvidences(payload.evidences||[]);}setLoading(false);})();},[year]);

  const weekEnd=moveDate(weekStart,6);
  const rows=useMemo(()=>locations.map(location=>{
    const entries:Partial<Record<Activity,Entry>>={};
    submissions.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>{entries[row.activity_type]=row;});
    const evaluation=evaluations.find(row=>row.location_id===location.id&&row.week_start===weekStart);if(evaluation)entries.administrator_rating=evaluation;
    evidences.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>{entries[row.evidence_type]=row;});
    const completed=(Object.keys(activityLabels) as Activity[]).filter(activity=>entries[activity]).length;
    const responsible=supervisors.filter(supervisor=>supervisor.location_id===location.id&&(!supervisor.active_from||supervisor.active_from<=weekEnd)&&(!supervisor.active_until||supervisor.active_until>=weekStart));
    return {location,entries,responsible,completed,percentage:Math.round(completed/6*100)};
  }),[locations,supervisors,submissions,evaluations,evidences,weekStart,weekEnd]);
  const totals=useMemo(()=>({completed:rows.reduce((sum,row)=>sum+row.completed,0),required:rows.length*6,full:rows.filter(row=>row.percentage===100).length,pending:rows.filter(row=>row.percentage<100).length}),[rows]);
  const actors=useMemo(()=>{
    const map=new Map<string,{name:string;email:string;count:number;admin:boolean}>();
    rows.forEach(row=>Object.values(row.entries).forEach(entry=>{if(!entry)return;const key=entry.submitted_by_email;const current=map.get(key)||{name:entry.submitted_by_name,email:key,count:0,admin:key.toLowerCase()===currentUser.email.toLowerCase()};current.count++;map.set(key,current);}));
    return [...map.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
  },[rows,currentUser.email]);
  const overall=totals.required?Math.round(totals.completed/totals.required*100):0;

  function downloadComplianceReport(){
    if(!isAdmin)return;
    const activities=Object.keys(activityLabels) as Activity[];
    const summaryRows=rows.flatMap(row=>{
      const missing=activities.filter(activity=>!row.entries[activity]).map(activity=>activityLabels[activity]);
      const authors=[...new Set(activities.map(activity=>row.entries[activity]?.submitted_by_name).filter(Boolean))].join(", ")||"Sin registros";
      const responsible=row.responsible.length?row.responsible.map(supervisor=>supervisor.name):["Sin supervisor asignado"];
      return responsible.map(supervisor=>[
        weekStart,weekEnd,supervisor,row.location.name,row.location.city,row.completed,6-row.completed,row.percentage/100,
        row.percentage===100?"Completo":row.percentage?"En proceso":"Sin iniciar",missing.join("; ")||"Ninguna",authors
      ]);
    });
    const detailRows=rows.flatMap(row=>{
      const responsible=row.responsible.map(supervisor=>supervisor.name).join(", ")||"Sin supervisor asignado";
      return activities.map(activity=>{
        const entry=row.entries[activity];
        return [weekStart,weekEnd,responsible,row.location.name,row.location.city,activityLabels[activity],entry?"Cumplida":"Pendiente",entry?.submitted_by_name||"—",entry?.submitted_by_email||"—",entry?timeLabel(entry.submitted_at):"—",entry?timeLabel(entry.updated_at):"—"];
      });
    });
    const title="TIPTI Operaciones | Reporte de cumplimiento semanal";
    const createSheet=(headers:string[],body:(string|number)[][],widths:number[])=>{
      const sheet=XLSX.utils.aoa_to_sheet([[title],[`Semana: ${weekStart} al ${weekEnd}`],[],headers,...body]);
      sheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:headers.length-1}},{s:{r:1,c:0},e:{r:1,c:headers.length-1}}];
      sheet["!cols"]=widths.map(wch=>({wch}));
      sheet["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:3,c:0},e:{r:Math.max(3,body.length+3),c:headers.length-1}})};
      sheet["!freeze"]={xSplit:0,ySplit:4,topLeftCell:"A5",activePane:"bottomLeft",state:"frozen"};
      const range=XLSX.utils.decode_range(sheet["!ref"]||"A1:A1");
      for(let column=0;column<headers.length;column++){
        const titleCell=sheet[XLSX.utils.encode_cell({r:0,c:column})]||(sheet[XLSX.utils.encode_cell({r:0,c:column})]={t:"s",v:""});
        titleCell.s={fill:{fgColor:{rgb:"102F4D"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:16},alignment:{horizontal:"center",vertical:"center"}};
        const subtitleCell=sheet[XLSX.utils.encode_cell({r:1,c:column})]||(sheet[XLSX.utils.encode_cell({r:1,c:column})]={t:"s",v:""});
        subtitleCell.s={fill:{fgColor:{rgb:"EAF0F5"}},font:{bold:true,color:{rgb:"102F4D"}},alignment:{horizontal:"center",vertical:"center"}};
        const header=sheet[XLSX.utils.encode_cell({r:3,c:column})];
        if(header)header.s={fill:{fgColor:{rgb:"FF6813"}},font:{bold:true,color:{rgb:"FFFFFF"}},alignment:{horizontal:"center",vertical:"center",wrapText:true},border:{top:{style:"thin",color:{rgb:"D7DCE1"}},bottom:{style:"thin",color:{rgb:"D7DCE1"}},left:{style:"thin",color:{rgb:"D7DCE1"}},right:{style:"thin",color:{rgb:"D7DCE1"}}}};
      }
      sheet["!rows"]=[{hpt:28},{hpt:21},{hpt:8},{hpt:34}];
      for(let row=4;row<=range.e.r;row++)for(let column=0;column<=range.e.c;column++){
        const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];
        if(!cell)continue;
        const status=String(body[row-4]?.[headers.indexOf("Estado")]||"");
        const fill=status==="Completo"||status==="Cumplida"?"E6F7EF":status==="Pendiente"||status==="Sin iniciar"?"FDECEC":"FFF4CC";
        cell.s={fill:{fgColor:{rgb:fill}},font:{color:{rgb:"202124"}},alignment:{vertical:"top",wrapText:true},border:{top:{style:"thin",color:{rgb:"E2E5E8"}},bottom:{style:"thin",color:{rgb:"E2E5E8"}},left:{style:"thin",color:{rgb:"E2E5E8"}},right:{style:"thin",color:{rgb:"E2E5E8"}}}};
      }
      return sheet;
    };
    const summaryHeaders=["Semana inicio","Semana fin","Supervisor responsable","Local","Ciudad","Cumplidas","Pendientes","Cumplimiento","Estado","Actividades faltantes","Realizadas por"];
    const detailHeaders=["Semana inicio","Semana fin","Supervisor responsable","Local","Ciudad","Actividad","Estado","Autor","Correo","Fecha de envío","Última actualización"];
    const workbook=XLSX.utils.book_new();
    const summarySheet=createSheet(summaryHeaders,summaryRows,[14,14,25,24,17,11,11,15,14,48,32]);
    const detailSheet=createSheet(detailHeaders,detailRows,[14,14,28,24,17,34,14,24,29,22,22]);
    for(let row=4;row<summaryRows.length+4;row++){
      const cell=summarySheet[XLSX.utils.encode_cell({r:row,c:7})];
      if(cell)cell.z="0%";
    }
    XLSX.utils.book_append_sheet(workbook,summarySheet,"Resumen");
    XLSX.utils.book_append_sheet(workbook,detailSheet,"Detalle de actividades");
    const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"});
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link=document.createElement("a");link.href=url;link.download=`Cumplimiento_Semanal_${weekStart}.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    setNotice("✓ Reporte de cumplimiento descargado");
  }

  return <section className={`compliance-module ${isAdmin?"admin-view":"supervisor-view"}`}>
    <div className="compliance-hero"><div><span>CONTROL AUTOMÁTICO</span><h2>Cumplimiento semanal</h2><p>Seis actividades obligatorias por local, con autor y fecha reales.</p></div><span className="admin-lock">{isAdmin?"Vista regional del administrador":"Solo tus locales asignados"}</span></div>
    <div className="compliance-toolbar"><label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(1,currentYear-2025)},(_,index)=>2026+index).map(value=><option key={value}>{value}</option>)}</select></label><label>Semana<select value={weekStart} onChange={event=>setWeekStart(event.target.value)}>{weeks.map(week=><option key={week} value={week}>{dateLabel(week)} — {dateLabel(moveDate(week,6))}</option>)}</select></label>{isAdmin&&<button type="button" className="compliance-download" onClick={downloadComplianceReport} disabled={loading}>⇩ Descargar reporte</button>}</div>
    <div className="compliance-kpis"><article><span>{isAdmin?"Cumplimiento regional":"Mi cumplimiento"}</span><strong>{overall}%</strong><div className="compliance-progress"><i style={{width:`${overall}%`}}/></div></article><article><span>Actividades completas</span><strong>{totals.completed}/{totals.required}</strong><small>6 obligatorias por local</small></article><article><span>Locales al 100%</span><strong>{totals.full}</strong><small>Semana seleccionada</small></article><article><span>Locales pendientes</span><strong>{totals.pending}</strong><small>{isAdmin?"Requieren seguimiento":"Revisa qué te falta"}</small></article></div>
    <div className="compliance-layout"><div className="compliance-table-card"><div className="compliance-table-title"><div><h3>{dateLabel(weekStart)} — {dateLabel(moveDate(weekStart,6))}</h3><p>{loading?"Cargando actividad…":"Cada actividad completa suma una de las seis obligaciones."}</p></div></div><div className="table-wrap"><table className="compliance-table"><thead><tr><th>Local</th>{(Object.keys(activityLabels) as Activity[]).map(activity=><th key={activity}>{activityLabels[activity]}</th>)}<th>Total</th></tr></thead><tbody>{rows.map(row=><tr key={row.location.id}><td><strong>{row.location.name}</strong><small>{row.location.city}</small></td>{(Object.keys(activityLabels) as Activity[]).map(activity=>{const entry=row.entries[activity];const isEvidence=entry&&"evidence_url" in entry;return <td key={activity}>{entry?<div className="compliance-done"><b>✓ Cumplida</b><strong>{entry.submitted_by_name}</strong><small>{timeLabel(entry.submitted_at)}</small>{entry.last_updated_by_name!==entry.submitted_by_name&&<small>Actualizó: {entry.last_updated_by_name}</small>}{isEvidence&&entry.evidence_url&&<a href={entry.evidence_url} target="_blank" rel="noreferrer">Ver foto</a>}{isAdmin&&entry.submitted_by_email.toLowerCase()===currentUser.email.toLowerCase()&&<em>Hecho por administrador</em>}</div>:<div className="compliance-missing"><b>0%</b><span>Pendiente</span></div>}</td>})}<td><span className={`compliance-total ${row.percentage===100?"full":row.percentage?"partial":"empty"}`}>{row.percentage}%</span></td></tr>)}</tbody></table></div></div>{isAdmin&&<aside className="compliance-ranking"><h3>Actividad por supervisor</h3><p>Quién registró las funciones de esta semana.</p>{actors.length?actors.map((actor,index)=><article key={actor.email}><span>{index+1}</span><div><strong>{actor.name}</strong><small>{actor.admin?"Administrador":"Supervisor"}</small></div><b>{actor.count}</b></article>):<div className="compliance-ranking-empty">Todavía no existen actividades publicadas.</div>}<small className="ranking-note">Las actividades hechas por el administrador quedan identificadas y no se atribuyen a un supervisor.</small></aside>}</div>
  </section>;
}
