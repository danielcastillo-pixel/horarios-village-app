"use client";

import {useEffect,useMemo,useState} from "react";

type Location={id:number;name:string;city:string};
type Submission={location_id:number;week_start:string;activity_type:"shopper_purchase"|"shopper_delivery"|"supervisor_schedule";submitted_by_name:string;submitted_at:string};
type Evaluation={location_id:number;week_start:string;submitted_by_name:string;submitted_at:string};
type Authorization={id:number;status:"pending"|"approved"|"rejected";location_name_snapshot:string;request_type:"discount"|"incentive";shopper_name:string;created_at:string};
type Props={locations:Location[];apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void;onNavigate:(section:"Autorizaciones"|"Cumplimiento semanal")=>void};

function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function daysSince(value:string){return Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/86400000));}

export default function DashboardInsights({locations,apiFetch,setNotice,onNavigate}:Props){
  const today=new Date().toLocaleDateString("en-CA"),weekStart=mondayFor(today),year=Number(weekStart.slice(0,4)),month=new Date().getMonth()+1;
  const [submissions,setSubmissions]=useState<Submission[]>([]),[evaluations,setEvaluations]=useState<Evaluation[]>([]),[requests,setRequests]=useState<Authorization[]>([]),[loading,setLoading]=useState(true);

  useEffect(()=>{(async()=>{
    setLoading(true);
    try{
      const [complianceResponse,authorizationResponse]=await Promise.all([apiFetch(`/api/compliance?year=${year}`),apiFetch(`/api/authorizations?year=${year}&month=${month}`)]);
      const compliance=await complianceResponse.json().catch(()=>({error:"No disponible"})) as {submissions?:Submission[];evaluations?:Evaluation[];error?:string};
      const authorizations=await authorizationResponse.json().catch(()=>({error:"No disponible"})) as {requests?:Authorization[];error?:string};
      if(!complianceResponse.ok||!authorizationResponse.ok){setNotice(`Error: ${compliance.error||authorizations.error||"No se pudo actualizar el panel"}`);return;}
      setSubmissions(compliance.submissions||[]);setEvaluations(compliance.evaluations||[]);setRequests(authorizations.requests||[]);
    }catch{setNotice("Error: no se pudieron actualizar las alertas del panel");}
    finally{setLoading(false);}
  })();},[year,month]);

  const localCompliance=useMemo(()=>locations.map(location=>{
    const activity=new Set<string>();
    submissions.filter(row=>row.location_id===location.id&&row.week_start===weekStart).forEach(row=>activity.add(row.activity_type));
    if(evaluations.some(row=>row.location_id===location.id&&row.week_start===weekStart))activity.add("administrator_rating");
    const completed=activity.size;
    return {...location,completed,pending:4-completed,percentage:completed*25};
  }),[locations,submissions,evaluations,weekStart]);
  const pendingRequests=useMemo(()=>requests.filter(row=>row.status==="pending").sort((a,b)=>a.created_at.localeCompare(b.created_at)),[requests]);
  const incomplete=localCompliance.reduce((sum,local)=>sum+local.pending,0);
  const critical=localCompliance.filter(local=>local.percentage<=50);
  const best=[...localCompliance].sort((a,b)=>b.percentage-a.percentage||a.name.localeCompare(b.name)).slice(0,5);
  const lowest=[...localCompliance].sort((a,b)=>a.percentage-b.percentage||a.name.localeCompare(b.name)).slice(0,5);
  const regional=localCompliance.length?Math.round(localCompliance.reduce((sum,local)=>sum+local.percentage,0)/localCompliance.length):0;

  return <section className="dashboard-insights">
    <div className="dashboard-insight-head"><div><span>CENTRO DE ACCIÓN</span><h2>Prioridades de esta semana</h2><p>Alertas y cumplimiento actualizados con la información registrada en el sistema.</p></div><strong className={regional>=75?"healthy":regional>=50?"warning":"critical"}>{loading?"…":`${regional}%`}<small>Cumplimiento regional</small></strong></div>
    <div className="dashboard-alert-grid">
      <button className={`dashboard-alert requests ${pendingRequests.length?"has-alert":""}`} onClick={()=>onNavigate("Autorizaciones")}><i>!</i><div><span>Solicitudes por revisar</span><strong>{loading?"—":pendingRequests.length}</strong><small>{pendingRequests.length?`${pendingRequests.filter(item=>daysSince(item.created_at)>=2).length} llevan 2 días o más`:"Todo está al día"}</small></div><b>Ver solicitudes →</b></button>
      <button className={`dashboard-alert compliance ${critical.length?"has-alert":""}`} onClick={()=>onNavigate("Cumplimiento semanal")}><i>↓</i><div><span>Locales con bajo cumplimiento</span><strong>{loading?"—":critical.length}</strong><small>Con 50% o menos esta semana</small></div><b>Revisar locales →</b></button>
      <button className={`dashboard-alert tasks ${incomplete?"has-alert":""}`} onClick={()=>onNavigate("Cumplimiento semanal")}><i>✓</i><div><span>Actividades pendientes</span><strong>{loading?"—":incomplete}</strong><small>De {locations.length*4} obligaciones regionales</small></div><b>Ver cumplimiento →</b></button>
    </div>
    {pendingRequests.length>0&&<button className="dashboard-priority-banner" onClick={()=>onNavigate("Autorizaciones")}><span className="priority-pulse"/><div><strong>Atención: {pendingRequests.length} {pendingRequests.length===1?"solicitud espera":"solicitudes esperan"} tu decisión</strong><small>La más antigua es de {pendingRequests[0].location_name_snapshot} · {daysSince(pendingRequests[0].created_at)} días pendiente.</small></div><span>Autorizar o rechazar</span></button>}
    <div className="dashboard-ranking-grid">
      <article className="dashboard-ranking low"><div className="ranking-head"><div><span>SEGUIMIENTO PRIORITARIO</span><h3>Locales con menor cumplimiento</h3></div><button onClick={()=>onNavigate("Cumplimiento semanal")}>Ver detalle</button></div><div className="ranking-list">{lowest.map((local,index)=><div key={local.id}><span className="rank-number">{index+1}</span><div className="rank-local"><strong>{local.name}</strong><small>{local.pending} {local.pending===1?"actividad pendiente":"actividades pendientes"}</small></div><div className="rank-bar"><i style={{width:`${local.percentage}%`}}/></div><b>{local.percentage}%</b></div>)}</div></article>
      <article className="dashboard-ranking best"><div className="ranking-head"><div><span>MEJOR DESEMPEÑO</span><h3>Locales con mayor cumplimiento</h3></div><button onClick={()=>onNavigate("Cumplimiento semanal")}>Ver detalle</button></div><div className="ranking-list">{best.map((local,index)=><div key={local.id}><span className="rank-number">{index+1}</span><div className="rank-local"><strong>{local.name}</strong><small>{local.completed} de 4 actividades completas</small></div><div className="rank-bar"><i style={{width:`${local.percentage}%`}}/></div><b>{local.percentage}%</b></div>)}</div></article>
    </div>
  </section>;
}
