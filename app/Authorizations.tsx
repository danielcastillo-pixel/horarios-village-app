"use client";

import {useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";

type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type RequestRow={id:number;request_type:"discount"|"incentive";location_id:number;location_name_snapshot:string;shopper_name:string;shopper_external_id:string;order_number:string;client_name:string;amount:number;reason:string;evidence_path:string;evidence_url:string|null;status:"pending"|"approved"|"rejected";decision_comment:string;created_by_name:string;created_by_email:string;created_at:string;decided_by_name:string|null;decided_at:string|null};
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};
const months=["Todo el año","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
function timeLabel(value:string){return new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));}
function money(value:number){return new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD"}).format(value);}
function statusLabel(value:RequestRow["status"]){return value==="pending"?"Pendiente":value==="approved"?"Autorizado":"Rechazado";}

export default function Authorizations({locations,currentUser,apiFetch,setNotice}:Props){
  const isAdmin=currentUser.role==="admin",now=new Date();
  const [tab,setTab]=useState<"new"|"pending"|"history"|"summary">(isAdmin?"pending":"new");
  const [year,setYear]=useState(Math.max(2026,now.getFullYear()));
  const [month,setMonth]=useState(now.getMonth()+1);
  const [requests,setRequests]=useState<RequestRow[]>([]);
  const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [type,setType]=useState<"discount"|"incentive">("discount");
  const [decision,setDecision]=useState<{request:RequestRow;status:"approved"|"rejected"}|null>(null);
  const [locationFilter,setLocationFilter]=useState(0);

  async function loadRequests(){
    setLoading(true);
    try{
      const response=await apiFetch(`/api/authorizations?year=${year}&month=${month}`);
      const payload=await response.json().catch(()=>({error:"No se pudo cargar el historial"})) as {requests?:RequestRow[];error?:string};
      if(!response.ok){setNotice(`Error: ${payload.error}`);return;}
      setRequests(payload.requests||[]);
    }catch{setNotice("Error: no se pudo cargar el apartado de autorizaciones");}
    finally{setLoading(false);}
  }
  useEffect(()=>{void loadRequests();},[year,month]);

  async function createRequest(form:FormData){
    if(saving)return;
    const evidence=form.get("evidence") as File|null;
    if(!evidence?.size){setNotice("Adjunta una fotografía de constancia");return;}
    if(evidence.size>8*1024*1024){setNotice("La constancia no puede superar 8 MB");return;}
    if(!evidence.type.startsWith("image/")){setNotice("La constancia debe ser una imagen");return;}
    setSaving(true);
    let evidencePath="";
    try{
      const {data:{session}}=await supabase.auth.getSession();
      if(!session)throw new Error("Sesión no válida");
      const extension=(evidence.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,8)||"jpg";
      evidencePath=`${session.user.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
      const {error:uploadError}=await supabase.storage.from("authorization-evidence").upload(evidencePath,evidence,{contentType:evidence.type,upsert:false});
      if(uploadError)throw new Error(`No se pudo subir la constancia: ${uploadError.message}`);
      const response=await apiFetch("/api/authorizations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action:"create",requestType:type,locationId:Number(form.get("locationId")),shopperName:form.get("shopperName"),shopperExternalId:form.get("shopperExternalId"),orderNumber:form.get("orderNumber"),clientName:form.get("clientName"),amount:form.get("amount"),reason:form.get("reason"),evidencePath
      })});
      const result=await response.json().catch(()=>({error:"No se pudo enviar"})) as {error?:string};
      if(!response.ok)throw new Error(result.error||"No se pudo enviar");
      setNotice("✓ Solicitud enviada y registrada permanentemente");
      setTab("pending");
      await loadRequests();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo enviar la solicitud"}`);}
    finally{setSaving(false);}
  }

  async function saveDecision(form:FormData){
    if(!decision||saving)return;setSaving(true);
    const response=await apiFetch("/api/authorizations",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"decide",id:decision.request.id,status:decision.status,comment:form.get("comment")})});
    const result=await response.json().catch(()=>({error:"No se pudo guardar la decisión"})) as {error?:string};
    setSaving(false);
    if(!response.ok){setNotice(`Error: ${result.error}`);return;}
    setDecision(null);setNotice(`✓ Solicitud ${decision.status==="approved"?"autorizada":"rechazada"}`);await loadRequests();
  }

  const filtered=useMemo(()=>requests.filter(row=>!locationFilter||row.location_id===locationFilter),[requests,locationFilter]);
  const visible=tab==="pending"?filtered.filter(row=>row.status==="pending"):filtered;
  const monthlySummary=useMemo(()=>locations.map(location=>({location,discounts:requests.filter(row=>row.location_id===location.id&&row.status==="approved"&&row.request_type==="discount").length,incentives:requests.filter(row=>row.location_id===location.id&&row.status==="approved"&&row.request_type==="incentive").length})).filter(row=>row.discounts||row.incentives),[locations,requests]);

  return <section className="authorization-module">
    <div className="authorization-hero"><div><span>AUTORIZACIONES OPERATIVAS</span><h2>Descuentos e incentivos</h2><p>{isAdmin?"Revisa constancias, decide solicitudes y consulta el resumen mensual por local.":"Envía solicitudes con constancia y consulta el histórico de tus locales."}</p></div><span className="authorization-lock">{isAdmin?"Control privado del administrador":"Histórico protegido por local"}</span></div>
    <div className="authorization-tabs">
      {!isAdmin&&<button className={tab==="new"?"active":""} onClick={()=>setTab("new")}>＋ Nueva solicitud</button>}
      <button className={tab==="pending"?"active":""} onClick={()=>setTab("pending")}>Pendientes <b>{requests.filter(row=>row.status==="pending").length}</b></button>
      <button className={tab==="history"?"active":""} onClick={()=>setTab("history")}>Historial</button>
      {isAdmin&&<button className={tab==="summary"?"active":""} onClick={()=>setTab("summary")}>Resumen mensual</button>}
    </div>

    {tab==="new"&&!isAdmin?<form className="authorization-form" onSubmit={event=>{event.preventDefault();void createRequest(new FormData(event.currentTarget));}}>
      <div className="authorization-type"><button type="button" className={type==="discount"?"active":""} onClick={()=>setType("discount")}>Descuento</button><button type="button" className={type==="incentive"?"active":""} onClick={()=>setType("incentive")}>Incentivo</button></div>
      <div className="authorization-grid"><label>Local<select name="locationId" required>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label>Supervisor<input value={currentUser.name} disabled /></label><label>Nombre del shopper<input name="shopperName" required /></label><label>ID del shopper<input name="shopperExternalId" placeholder="Opcional" /></label><label>Número de pedido<input name="orderNumber" required /></label><label>Nombre del cliente<input name="clientName" required /></label><label>Valor solicitado<input name="amount" type="number" min="0.01" step="0.01" required /></label><label className="wide">{type==="discount"?"Razón del descuento":"Razón del incentivo"}<textarea name="reason" rows={4} required minLength={5}/></label><label className="wide evidence-upload">Constancia fotográfica<input name="evidence" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" required/><small>JPG, PNG, WEBP o HEIC · máximo 8 MB</small></label></div>
      <button className="primary authorization-send" disabled={saving}>{saving?"Subiendo y enviando…":"Enviar solicitud"}</button>
    </form>:tab==="summary"&&isAdmin?<div className="authorization-summary"><div className="authorization-summary-head"><div><h3>Resumen mensual autorizado</h3><p>Solo cuenta descuentos e incentivos aprobados.</p></div></div>{monthlySummary.length?<div className="summary-location-grid">{monthlySummary.map(row=><article key={row.location.id}><strong>{row.location.name}</strong><span>{row.location.city}</span><div><p><b>{row.discounts}</b> descuentos</p><p><b>{row.incentives}</b> incentivos</p></div></article>)}</div>:<div className="authorization-empty">No existen autorizaciones aprobadas para este período.</div>}</div>:<div className="authorization-list-card">
      <div className="authorization-filters"><label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(1,now.getFullYear()-2025)},(_,index)=>2026+index).map(value=><option key={value}>{value}</option>)}</select></label><label>Mes<select value={month} onChange={event=>setMonth(Number(event.target.value))}>{months.map((label,index)=><option key={label} value={index}>{label}</option>)}</select></label>{isAdmin&&<label>Local<select value={locationFilter} onChange={event=>setLocationFilter(Number(event.target.value))}><option value={0}>Todos los locales</option>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}</div>
      {loading?<div className="authorization-empty">Cargando solicitudes…</div>:visible.length?<div className="authorization-cards">{visible.map(row=><article key={row.id} className={`authorization-request ${row.status}`}><div className="request-main"><span className={`request-type ${row.request_type}`}>{row.request_type==="discount"?"Descuento":"Incentivo"}</span><h3>{row.shopper_name}</h3><p>{row.location_name_snapshot} · Pedido #{row.order_number}</p><small>Cliente: {row.client_name}</small></div><div className="request-amount"><strong>{money(Number(row.amount))}</strong><span className={`request-status ${row.status}`}>{statusLabel(row.status)}</span></div><div className="request-detail"><p><strong>Motivo</strong>{row.reason}</p><p><strong>Enviado por</strong>{row.created_by_name}<small>{timeLabel(row.created_at)}</small></p>{row.status!=="pending"&&<p><strong>Decisión</strong>{row.decided_by_name||"Administrador"}<small>{row.decision_comment||"Sin comentario"}</small></p>}</div><div className="request-actions">{row.evidence_url?<a href={row.evidence_url} target="_blank" rel="noreferrer">Ver constancia</a>:<span>Constancia no disponible</span>}{isAdmin&&row.status==="pending"&&<><button className="approve" onClick={()=>setDecision({request:row,status:"approved"})}>Autorizar</button><button className="reject" onClick={()=>setDecision({request:row,status:"rejected"})}>Rechazar</button></>}</div></article>)}</div>:<div className="authorization-empty">No existen solicitudes para los filtros seleccionados.</div>}
    </div>}

    {tab==="summary"&&isAdmin&&<div className="authorization-filters summary-filter"><label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(1,now.getFullYear()-2025)},(_,index)=>2026+index).map(value=><option key={value}>{value}</option>)}</select></label><label>Mes<select value={month} onChange={event=>setMonth(Number(event.target.value))}>{months.slice(1).map((label,index)=><option key={label} value={index+1}>{label}</option>)}</select></label></div>}
    {decision&&<div className="modal-backdrop" onMouseDown={()=>!saving&&setDecision(null)}><form className="modal authorization-decision" onSubmit={event=>{event.preventDefault();void saveDecision(new FormData(event.currentTarget));}} onMouseDown={event=>event.stopPropagation()}><button type="button" className="close" onClick={()=>setDecision(null)}>×</button><span className="modal-kicker">DECISIÓN ADMINISTRATIVA</span><h2>{decision.status==="approved"?"Autorizar solicitud":"Rechazar solicitud"}</h2><p>{decision.request.location_name_snapshot} · {decision.request.shopper_name} · {money(Number(decision.request.amount))}</p><label>Comentario<textarea name="comment" rows={4} placeholder="Escribe la respuesta para el supervisor" required={decision.status==="rejected"}/></label><button className={`primary save ${decision.status}`} disabled={saving}>{saving?"Guardando…":decision.status==="approved"?"Confirmar autorización":"Confirmar rechazo"}</button></form></div>}
  </section>;
}
