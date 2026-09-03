"use client";

import {useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";
import * as XLSX from "xlsx-js-style";

type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type KpiRow={id:number;week_start:string;city:string;sales:number;orders:number;active_clients:number;average_ticket:number;margin_percent:number;late_percent:number;rescheduling_percent:number;oos_percent:number;incidents:number;analysis:string;affected_clients:string;affected_sectors:string;action_plan:string;meeting_summary:string};
type MeetingRow={id:number;week_start:string;meeting_date:string;meeting_time:string|null;meeting_type:"individual"|"group"|"city";title:string;participants:string;cities:string;topics:string;agreements:string;responsible:string;due_date:string|null;status:"open"|"done";evidence_paths:string[];evidence_urls:string[]};
type RequestRow={id:number;week_start:string;city:string;target_area:"marketing"|"b2b"|"commercial"|"operations"|"other";request_text:string;rationale:string;priority:"low"|"medium"|"high";responsible:string;due_date:string|null;status:"pending"|"requested"|"in_progress"|"completed"|"rejected"};
type ImportedKpi={city:string;sales:number;orders:number;activeClients:number;averageTicket:number;marginPercent:number;latePercent:number;reschedulingPercent:number;oosPercent:number;incidents:number};
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};
type Modal="kpi"|"meeting"|"request"|"import"|null;

function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function money(value:number){return new Intl.NumberFormat("es-EC",{style:"currency",currency:"USD",maximumFractionDigits:0}).format(Number(value)||0);}
function percent(value:number){return `${Number(value||0).toFixed(1).replace(".",",")}%`;}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();}
function parseNumber(value:unknown){
  if(typeof value==="number")return Number.isFinite(value)?value:0;
  let text=String(value??"").trim().replace(/[$%\s]/g,"");
  if(!text)return 0;
  const comma=text.lastIndexOf(","),dot=text.lastIndexOf(".");
  if(comma>=0&&dot>=0)text=comma>dot?text.replace(/\./g,"").replace(",","."):text.replace(/,/g,"");
  else if(comma>=0)text=text.replace(",",".");
  const parsed=Number(text);return Number.isFinite(parsed)?parsed:0;
}
function field(row:Record<string,unknown>,aliases:string[]){const entries=Object.entries(row);for(const alias of aliases){const found=entries.find(([key])=>normalize(key)===alias);if(found)return found[1];}return "";}
function areaLabel(value:RequestRow["target_area"]){return ({marketing:"Marketing",b2b:"B2B",commercial:"Comercial",operations:"Operaciones",other:"Otra área"} as const)[value];}
function requestStatus(value:RequestRow["status"]){return ({pending:"Pendiente",requested:"Solicitada",in_progress:"En proceso",completed:"Completada",rejected:"Rechazada"} as const)[value];}
function meetingType(value:MeetingRow["meeting_type"]){return ({individual:"Individual",group:"Grupal",city:"Por ciudad"} as const)[value];}
function statusFor(row:KpiRow,change:number|null){
  if(!row.analysis&&!row.action_plan)return {key:"pending",label:"Pendiente"};
  if(row.margin_percent<0||(change!==null&&change<=-10)||row.late_percent>5||row.oos_percent>8)return {key:"critical",label:"Crítica"};
  if(row.margin_percent<5||(change!==null&&change<0)||row.late_percent>2||row.rescheduling_percent>5||row.oos_percent>5||row.incidents>1)return {key:"risk",label:"En riesgo"};
  return {key:"stable",label:"Estable"};
}
function styleSheet(sheet:XLSX.WorkSheet,widths:number[]){
  sheet["!cols"]=widths.map(w=>({wch:w}));
  const range=XLSX.utils.decode_range(sheet["!ref"]||"A1:A1");
  for(let col=range.s.c;col<=range.e.c;col++){
    const cell=sheet[XLSX.utils.encode_cell({r:0,c:col})];
    if(cell)cell.s={font:{bold:true,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"FF6108"}},alignment:{vertical:"center",wrapText:true}};
  }
  sheet["!rows"]=[{hpt:27}];
}

export default function RegionalProfitability({locations,currentUser,apiFetch,setNotice}:Props){
  const today=new Date().toLocaleDateString("en-CA"),[weekStart,setWeekStart]=useState(mondayFor(today));
  const [view,setView]=useState<"summary"|"meetings"|"requests">("summary"),[modal,setModal]=useState<Modal>(null),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [kpis,setKpis]=useState<KpiRow[]>([]),[meetings,setMeetings]=useState<MeetingRow[]>([]),[requests,setRequests]=useState<RequestRow[]>([]);
  const [editingKpi,setEditingKpi]=useState<KpiRow|null>(null),[editingMeeting,setEditingMeeting]=useState<MeetingRow|null>(null),[editingRequest,setEditingRequest]=useState<RequestRow|null>(null);
  const [meetingFiles,setMeetingFiles]=useState<File[]>([]),[importRows,setImportRows]=useState<ImportedKpi[]>([]),[importFileName,setImportFileName]=useState("");
  const year=Number(weekStart.slice(0,4));
  const cityOptions=useMemo(()=>[...new Set([...locations.map(location=>location.city),...kpis.map(row=>row.city)])].filter(Boolean).sort((a,b)=>a.localeCompare(b,"es")),[locations,kpis]);
  const weekKpis=useMemo(()=>kpis.filter(row=>row.week_start===weekStart),[kpis,weekStart]);
  const previousKpis=useMemo(()=>kpis.filter(row=>row.week_start===moveDate(weekStart,-7)),[kpis,weekStart]);
  const weekMeetings=useMemo(()=>meetings.filter(row=>row.week_start===weekStart),[meetings,weekStart]);
  const weekRequests=useMemo(()=>requests.filter(row=>row.week_start===weekStart||!["completed","rejected"].includes(row.status)),[requests,weekStart]);
  const previousFor=(city:string)=>previousKpis.find(row=>normalize(row.city)===normalize(city));
  const changeFor=(row:KpiRow)=>{const previous=previousFor(row.city);return previous&&previous.sales>0?(row.sales-previous.sales)/previous.sales*100:null;};
  const salesTotal=weekKpis.reduce((sum,row)=>sum+Number(row.sales),0),previousSales=previousKpis.reduce((sum,row)=>sum+Number(row.sales),0);
  const salesChange=previousSales>0?(salesTotal-previousSales)/previousSales*100:null;
  const weightedMargin=salesTotal>0?weekKpis.reduce((sum,row)=>sum+Number(row.sales)*Number(row.margin_percent),0)/salesTotal:0;
  const atRisk=weekKpis.filter(row=>["risk","critical"].includes(statusFor(row,changeFor(row)).key)).length;

  async function loadData(){
    setLoading(true);
    try{
      const response=await apiFetch(`/api/regional-performance?year=${year}&refresh=${Date.now()}`),payload=await response.json().catch(()=>({error:"No se pudo cargar el módulo"})) as {kpis?:KpiRow[];meetings?:MeetingRow[];requests?:RequestRow[];error?:string};
      if(!response.ok)throw new Error(payload.error||"No se pudo cargar el módulo");
      setKpis(payload.kpis||[]);setMeetings(payload.meetings||[]);setRequests(payload.requests||[]);
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo cargar la rentabilidad"}`);}finally{setLoading(false);}
  }
  useEffect(()=>{void loadData();},[year]);

  function openKpi(row?:KpiRow){setEditingKpi(row||null);setModal("kpi");}
  function openMeeting(row?:MeetingRow){setEditingMeeting(row||null);setMeetingFiles([]);setModal("meeting");}
  function openRequest(row?:RequestRow){setEditingRequest(row||null);setModal("request");}

  async function post(body:Record<string,unknown>){
    const response=await apiFetch("/api/regional-performance",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}),payload=await response.json().catch(()=>({error:"No se pudo guardar"})) as {error?:string;imported?:number};
    if(!response.ok)throw new Error(payload.error||"No se pudo guardar");return payload;
  }

  async function saveKpi(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setSaving(true);
    const form=new FormData(event.currentTarget);
    try{
      await post({action:"saveKpi",weekStart,city:form.get("city"),sales:form.get("sales"),orders:form.get("orders"),activeClients:form.get("activeClients"),averageTicket:form.get("averageTicket"),marginPercent:form.get("marginPercent"),latePercent:form.get("latePercent"),reschedulingPercent:form.get("reschedulingPercent"),oosPercent:form.get("oosPercent"),incidents:form.get("incidents"),analysis:form.get("analysis"),affectedClients:form.get("affectedClients"),affectedSectors:form.get("affectedSectors"),actionPlan:form.get("actionPlan"),meetingSummary:form.get("meetingSummary")});
      setNotice("✓ Revisión semanal guardada");setModal(null);await loadData();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar"}`);}finally{setSaving(false);}
  }

  async function uploadMeetingEvidence(){
    if(!meetingFiles.length)return editingMeeting?.evidence_paths||[];
    const existing=editingMeeting?.evidence_paths||[];
    if(existing.length+meetingFiles.length>10)throw new Error("La reunión puede tener máximo 10 fotografías");
    const invalid=meetingFiles.find(file=>file.size>8*1024*1024||!file.type.startsWith("image/"));
    if(invalid)throw new Error(invalid.size>8*1024*1024?"Cada fotografía puede pesar máximo 8 MB":"Las evidencias deben ser fotografías");
    const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error("Sesión no válida");
    const paths:string[]=[];
    for(const [index,file] of meetingFiles.entries()){
      const extension=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,8)||"jpg";
      const path=`${user.id}/meetings/${weekStart}/${Date.now()}-${index}.${extension}`;
      const {error}=await supabase.storage.from("regional-evidence").upload(path,file,{contentType:file.type,upsert:false});
      if(error)throw new Error(`No se pudo subir ${file.name}: ${error.message}`);paths.push(path);
    }
    return [...new Set([...existing,...paths])];
  }

  async function saveMeeting(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setSaving(true);const form=new FormData(event.currentTarget);
    try{
      const evidencePaths=await uploadMeetingEvidence();
      await post({action:"saveMeeting",id:editingMeeting?.id,weekStart,meetingDate:form.get("meetingDate"),meetingTime:form.get("meetingTime"),meetingType:form.get("meetingType"),title:form.get("title"),participants:form.get("participants"),cities:form.get("cities"),topics:form.get("topics"),agreements:form.get("agreements"),responsible:form.get("responsible"),dueDate:form.get("dueDate"),status:form.get("status"),evidencePaths});
      setNotice("✓ Reunión registrada");setModal(null);await loadData();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar la reunión"}`);}finally{setSaving(false);}
  }

  async function saveRequest(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setSaving(true);const form=new FormData(event.currentTarget);
    try{
      await post({action:"saveRequest",id:editingRequest?.id,weekStart,city:form.get("city"),targetArea:form.get("targetArea"),requestText:form.get("requestText"),rationale:form.get("rationale"),priority:form.get("priority"),responsible:form.get("responsible"),dueDate:form.get("dueDate"),status:form.get("status")});
      setNotice("✓ Solicitud guardada");setModal(null);await loadData();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar la solicitud"}`);}finally{setSaving(false);}
  }

  async function readKpiFile(file:File){
    if(file.size>8*1024*1024){setNotice("El archivo puede pesar máximo 8 MB");return;}
    try{
      const workbook=XLSX.read(await file.arrayBuffer(),{type:"array"}),sheet=workbook.Sheets[workbook.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:"",raw:false});
      const parsed=raw.map(row=>{
        const sales=parseNumber(field(row,["ventas","venta","sales"])),orders=parseNumber(field(row,["pedidos","ordenes","orders"]));
        return {city:String(field(row,["ciudad","city"])).trim(),sales,orders:Math.round(orders),activeClients:Math.round(parseNumber(field(row,["clientes activos","clientes","active clients"]))),averageTicket:parseNumber(field(row,["ticket promedio","ticket medio","average ticket"]))||(orders>0?sales/orders:0),marginPercent:parseNumber(field(row,["rentabilidad","margen","margen porcentual","margin"])),latePercent:parseNumber(field(row,["tarde","tarde porcentual","late"])),reschedulingPercent:parseNumber(field(row,["reagendamiento","reagendamiento porcentual","rescheduling"])),oosPercent:parseNumber(field(row,["oos","oos porcentual"])),incidents:Math.round(parseNumber(field(row,["incidencias","incidents"])))};
      }).filter(row=>row.city.length>=2);
      if(!parsed.length)throw new Error("No encontré una columna llamada Ciudad con información");
      setImportRows(parsed);setImportFileName(file.name);
    }catch(error){setImportRows([]);setImportFileName("");setNotice(`Error: ${error instanceof Error?error.message:"No se pudo leer el archivo"}`);}
  }

  async function importKpis(){
    if(!importRows.length||saving)return;setSaving(true);
    try{const result=await post({action:"importKpis",weekStart,rows:importRows});setNotice(`✓ ${result.imported||importRows.length} ciudades importadas`);setModal(null);setImportRows([]);await loadData();}
    catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo importar"}`);}finally{setSaving(false);}
  }

  function downloadTemplate(){
    const rows=[["Ciudad","Ventas","Pedidos","Clientes activos","Ticket promedio","Rentabilidad %","Tarde %","Reagendamiento %","OOS %","Incidencias"],...cityOptions.map(city=>[city,0,0,0,0,0,0,0,0,0])];
    const sheet=XLSX.utils.aoa_to_sheet(rows);styleSheet(sheet,[22,14,12,18,16,17,12,20,12,13]);
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,sheet,"KPIs Región Sur");XLSX.writeFile(workbook,`Plantilla_KPIs_Region_Sur_${weekStart}.xlsx`);
  }

  async function downloadReport(){
    try{
      const clientsResponse=await apiFetch(`/api/regional-clients?refresh=${Date.now()}`),clientsPayload=await clientsResponse.json().catch(()=>({clients:[]})) as {clients?:any[]};
      const clients=clientsPayload.clients||[],workbook=XLSX.utils.book_new();
      const summaryRows=[["REPORTE SEMANAL REGIÓN SUR"],["Semana",`${dateLabel(weekStart)} — ${dateLabel(moveDate(weekStart,6))}`],["Ventas totales",salesTotal],["Variación semanal",salesChange===null?"Sin semana anterior":salesChange/100],["Margen regional",weightedMargin/100],["Ciudades en riesgo",atRisk],[],["Ciudad","Ventas","Variación %","Pedidos","Clientes activos","Ticket promedio","Margen %","Tarde %","Reagendamiento %","OOS %","Incidencias","Estado","Análisis","Clientes afectados","Sectores afectados","Plan de acción","Resumen reunión"],...weekKpis.map(row=>[row.city,row.sales,changeFor(row)===null?"":changeFor(row)!/100,row.orders,row.active_clients,row.average_ticket,row.margin_percent/100,row.late_percent/100,row.rescheduling_percent/100,row.oos_percent/100,row.incidents,statusFor(row,changeFor(row)).label,row.analysis,row.affected_clients,row.affected_sectors,row.action_plan,row.meeting_summary])];
      const summary=XLSX.utils.aoa_to_sheet(summaryRows);styleSheet(summary,[22,15,14,12,16,15,13,12,18,12,12,14,34,30,28,34,34]);
      ["B4","B5"].forEach(cell=>{if(summary[cell])summary[cell].z="0.0%";});for(let row=8;row<8+weekKpis.length;row++){[2,6,7,8,9].forEach(col=>{const cell=summary[XLSX.utils.encode_cell({r:row,c:col})];if(cell)cell.z="0.0%";});}
      XLSX.utils.book_append_sheet(workbook,summary,"Resumen ciudades");
      const meetingSheet=XLSX.utils.aoa_to_sheet([["Fecha","Tipo","Título","Participantes","Ciudades","Temas","Acuerdos","Responsable","Fecha límite","Estado"],...weekMeetings.map(row=>[row.meeting_date,meetingType(row.meeting_type),row.title,row.participants,row.cities,row.topics,row.agreements,row.responsible,row.due_date||"",row.status==="done"?"Cumplida":"Pendiente"])]);styleSheet(meetingSheet,[13,14,28,28,20,38,38,24,14,14]);XLSX.utils.book_append_sheet(workbook,meetingSheet,"Reuniones");
      const requestSheet=XLSX.utils.aoa_to_sheet([["Ciudad","Área","Solicitud","Motivo","Prioridad","Responsable","Fecha límite","Estado"],...weekRequests.map(row=>[row.city,areaLabel(row.target_area),row.request_text,row.rationale,row.priority,row.responsible,row.due_date||"",requestStatus(row.status)])]);styleSheet(requestSheet,[20,16,40,36,12,24,14,15]);XLSX.utils.book_append_sheet(workbook,requestSheet,"Solicitudes");
      const potential=clients.filter(row=>row.client_type==="potential"),blacklist=clients.filter(row=>row.client_type==="blacklist");
      const potentialSheet=XLSX.utils.aoa_to_sheet([["ID","Cliente","Ciudad","Sector","Pedidos estimados","Responsable","Próxima acción","Fecha","Estado"],...potential.map(row=>[row.client_external_id,row.client_name,row.city,row.sector,row.estimated_orders??"",row.responsible,row.next_action,row.next_action_date||"",row.potential_status])]);styleSheet(potentialSheet,[16,28,18,20,18,24,36,14,15]);XLSX.utils.book_append_sheet(workbook,potentialSheet,"Clientes potenciales");
      const blacklistSheet=XLSX.utils.aoa_to_sheet([["ID","Cliente","Ciudad","Motivo","Pedido","Reportado por","Estado"],...blacklist.map(row=>[row.client_external_id,row.client_name,row.city,row.blacklist_reason,row.order_reference,row.submitted_by_name,row.blacklist_status])]);styleSheet(blacklistSheet,[16,28,18,40,18,24,15]);XLSX.utils.book_append_sheet(workbook,blacklistSheet,"Lista negra");
      XLSX.writeFile(workbook,`Reporte_Rentabilidad_Region_Sur_${weekStart}.xlsx`);setNotice("✓ Reporte semanal generado");
    }catch{setNotice("Error: no se pudo generar el reporte semanal");}
  }

  return <section className="regional-module">
    <div className="regional-hero"><div><span>GESTIÓN INTERCITY · REGIÓN SUR</span><h2>Rentabilidad de ciudades</h2><p>Revisa ventas, rentabilidad, KPIs y acciones semanales para levantar cada ciudad.</p></div><div><button className="secondary" onClick={()=>void downloadReport()}>⇩ Descargar reporte</button><button className="primary" onClick={()=>openKpi()}>＋ Registrar ciudad</button></div></div>
    <div className="regional-focus"><strong>Enfoque de gestión semanal</strong><span><b>40%</b> Guayaquil</span><span><b>60%</b> otras ciudades de Región Sur</span><small>El análisis, las reuniones y los planes deben priorizar especialmente las ciudades fuera de Guayaquil.</small></div>
    <div className="regional-week-toolbar"><button onClick={()=>setWeekStart(moveDate(weekStart,-7))}>‹</button><label>Semana<input type="date" value={weekStart} onChange={event=>setWeekStart(mondayFor(event.target.value))}/></label><strong>{dateLabel(weekStart)} — {dateLabel(moveDate(weekStart,6))}</strong><button onClick={()=>setWeekStart(moveDate(weekStart,7))}>›</button><button className="regional-upload" onClick={()=>{setImportRows([]);setImportFileName("");setModal("import")}}>▧ Cargar KPIs por Excel</button></div>
    <div className="regional-kpis"><article><span>Ventas Región Sur</span><strong>{money(salesTotal)}</strong><small className={salesChange!==null&&salesChange<0?"negative":"positive"}>{salesChange===null?"Sin semana anterior":`${salesChange>=0?"↑":"↓"} ${percent(Math.abs(salesChange))} semanal`}</small></article><article><span>Margen regional</span><strong>{percent(weightedMargin)}</strong><small>Promedio ponderado por ventas</small></article><article><span>Ciudades revisadas</span><strong>{weekKpis.filter(row=>row.analysis&&row.action_plan).length}/{cityOptions.length}</strong><small>Con análisis y plan de acción</small></article><article><span>Alertas</span><strong>{atRisk}</strong><small>Ciudades en riesgo o críticas</small></article></div>
    <div className="regional-tabs"><button className={view==="summary"?"active":""} onClick={()=>setView("summary")}>Resumen de ciudades</button><button className={view==="meetings"?"active":""} onClick={()=>setView("meetings")}>Mis reuniones <b>{weekMeetings.length}</b></button><button className={view==="requests"?"active":""} onClick={()=>setView("requests")}>Solicitudes a áreas <b>{weekRequests.filter(row=>!["completed","rejected"].includes(row.status)).length}</b></button></div>
    {view==="summary"&&<div className="regional-table-card"><div className="regional-card-head"><div><h3>Revisión semanal por ciudad</h3><p>Alertas: Tarde &gt; 2% · Reagendamiento &gt; 5% · OOS &gt; 5%.</p></div><button className="secondary" onClick={()=>openKpi()}>＋ Nueva revisión</button></div><div className="table-wrap"><table className="regional-table"><thead><tr><th>Ciudad</th><th>Ventas</th><th>Variación</th><th>Margen</th><th>Tarde</th><th>Reag.</th><th>OOS</th><th>Incid.</th><th>Estado</th><th></th></tr></thead><tbody>{weekKpis.length?weekKpis.map(row=>{const change=changeFor(row),status=statusFor(row,change);return <tr key={row.id}><td><strong>{row.city}</strong><small>{row.active_clients} clientes · {row.orders} pedidos</small></td><td>{money(row.sales)}</td><td className={change!==null&&change<0?"negative":"positive"}>{change===null?"—":percent(change)}</td><td>{percent(row.margin_percent)}</td><td>{percent(row.late_percent)}</td><td>{percent(row.rescheduling_percent)}</td><td>{percent(row.oos_percent)}</td><td>{row.incidents}</td><td><span className={`regional-status ${status.key}`}>{status.label}</span></td><td><button className="regional-edit" onClick={()=>openKpi(row)}>Ver / editar</button></td></tr>}):<tr><td colSpan={10}><div className="regional-empty">Todavía no existen KPIs para esta semana. Puedes registrarlos manualmente o cargar el Excel.</div></td></tr>}</tbody></table></div></div>}
    {view==="meetings"&&<div className="regional-table-card"><div className="regional-card-head"><div><h3>Reuniones de la semana</h3><p>Registra lo conversado, acuerdos, responsables y evidencias.</p></div><button className="primary" onClick={()=>openMeeting()}>＋ Registrar reunión</button></div><div className="regional-list">{weekMeetings.length?weekMeetings.map(row=><article key={row.id}><div><strong>{dateLabel(row.meeting_date)} {row.meeting_time?`· ${row.meeting_time.slice(0,5)}`:""}</strong><small>{meetingType(row.meeting_type)} · {row.cities||"Región Sur"}</small></div><div><strong>{row.title}</strong><p>{row.topics}</p><small>{row.agreements||"Sin acuerdos registrados"}</small></div><span className={`regional-status ${row.status==="done"?"stable":"risk"}`}>{row.status==="done"?"Cumplida":"Pendiente"}</span><button className="regional-edit" onClick={()=>openMeeting(row)}>Editar</button></article>):<div className="regional-empty">No registraste reuniones en esta semana.</div>}</div></div>}
    {view==="requests"&&<div className="regional-table-card"><div className="regional-card-head"><div><h3>Solicitudes a otras áreas</h3><p>Marketing, B2B, Comercial y Operaciones.</p></div><button className="primary" onClick={()=>openRequest()}>＋ Nueva solicitud</button></div><div className="regional-list">{weekRequests.length?weekRequests.map(row=><article key={row.id}><div><strong>{areaLabel(row.target_area)}</strong><small>{row.city} · Prioridad {row.priority}</small></div><div><strong>{row.request_text}</strong><p>{row.rationale}</p><small>{row.responsible?`Responsable: ${row.responsible}`:"Sin responsable"}{row.due_date?` · Límite ${dateLabel(row.due_date)}`:""}</small></div><span className={`regional-status ${row.status==="completed"?"stable":row.status==="rejected"?"critical":"risk"}`}>{requestStatus(row.status)}</span><button className="regional-edit" onClick={()=>openRequest(row)}>Editar</button></article>):<div className="regional-empty">No existen solicitudes para esta semana.</div>}</div></div>}
    {loading&&<div className="regional-loading">Actualizando información…</div>}

    {modal==="kpi"&&<div className="modal-backdrop"><form className="modal regional-form" onSubmit={saveKpi}><button type="button" className="close" onClick={()=>setModal(null)}>×</button><h2>{editingKpi?`Revisión de ${editingKpi.city}`:"Registrar ciudad"}</h2><p>Semana del {dateLabel(weekStart)}</p><div className="regional-form-grid"><label>Ciudad<input name="city" list="regional-cities" defaultValue={editingKpi?.city||""} required/><datalist id="regional-cities">{cityOptions.map(city=><option key={city}>{city}</option>)}</datalist></label><label>Ventas ($)<input name="sales" type="number" min="0" step="0.01" defaultValue={editingKpi?.sales||0} required/></label><label>Pedidos<input name="orders" type="number" min="0" defaultValue={editingKpi?.orders||0} required/></label><label>Clientes activos<input name="activeClients" type="number" min="0" defaultValue={editingKpi?.active_clients||0} required/></label><label>Ticket promedio ($)<input name="averageTicket" type="number" min="0" step="0.01" defaultValue={editingKpi?.average_ticket||0} required/></label><label>Rentabilidad / margen %<input name="marginPercent" type="number" min="-100" max="1000" step="0.01" defaultValue={editingKpi?.margin_percent||0} required/></label><label>Tarde %<input name="latePercent" type="number" min="0" max="100" step="0.01" defaultValue={editingKpi?.late_percent||0} required/></label><label>Reagendamiento %<input name="reschedulingPercent" type="number" min="0" max="100" step="0.01" defaultValue={editingKpi?.rescheduling_percent||0} required/></label><label>OOS %<input name="oosPercent" type="number" min="0" max="100" step="0.01" defaultValue={editingKpi?.oos_percent||0} required/></label><label>Incidencias<input name="incidents" type="number" min="0" defaultValue={editingKpi?.incidents||0} required/></label><label className="wide">¿Qué está pasando?<textarea name="analysis" rows={3} defaultValue={editingKpi?.analysis||""} placeholder="Explica la situación de ventas, rentabilidad y operación"/></label><label>Clientes afectados<textarea name="affectedClients" rows={3} defaultValue={editingKpi?.affected_clients||""} placeholder="Qué clientes disminuyeron y por qué"/></label><label>Sectores afectados<textarea name="affectedSectors" rows={3} defaultValue={editingKpi?.affected_sectors||""}/></label><label className="wide">Plan de acción<textarea name="actionPlan" rows={3} defaultValue={editingKpi?.action_plan||""} placeholder="Qué harán para levantar la ciudad"/></label><label className="wide">Resumen de la reunión<textarea name="meetingSummary" rows={3} defaultValue={editingKpi?.meeting_summary||""}/></label></div><button className="primary save" disabled={saving}>{saving?"Guardando…":"Guardar revisión"}</button></form></div>}
    {modal==="meeting"&&<div className="modal-backdrop"><form className="modal regional-form" onSubmit={saveMeeting}><button type="button" className="close" onClick={()=>setModal(null)}>×</button><h2>{editingMeeting?"Editar reunión":"Registrar reunión"}</h2><div className="regional-form-grid"><label>Título<input name="title" defaultValue={editingMeeting?.title||""} required/></label><label>Tipo<select name="meetingType" defaultValue={editingMeeting?.meeting_type||"group"}><option value="individual">Individual</option><option value="group">Grupal</option><option value="city">Por ciudad</option></select></label><label>Fecha<input name="meetingDate" type="date" min={weekStart} max={moveDate(weekStart,6)} defaultValue={editingMeeting?.meeting_date||weekStart} required/></label><label>Hora<input name="meetingTime" type="time" defaultValue={editingMeeting?.meeting_time?.slice(0,5)||""}/></label><label className="wide">Participantes<textarea name="participants" rows={2} defaultValue={editingMeeting?.participants||""} placeholder="Nombres de tus chicos" required/></label><label className="wide">Ciudades tratadas<input name="cities" defaultValue={editingMeeting?.cities||""} placeholder="Ej.: Machala, Loja y Manta"/></label><label className="wide">Temas conversados<textarea name="topics" rows={4} defaultValue={editingMeeting?.topics||""} required/></label><label className="wide">Acuerdos y tareas<textarea name="agreements" rows={4} defaultValue={editingMeeting?.agreements||""}/></label><label>Responsables<input name="responsible" defaultValue={editingMeeting?.responsible||""}/></label><label>Fecha límite<input name="dueDate" type="date" defaultValue={editingMeeting?.due_date||""}/></label><label>Estado<select name="status" defaultValue={editingMeeting?.status||"open"}><option value="open">Pendiente</option><option value="done">Cumplida</option></select></label><label>Evidencias<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event=>setMeetingFiles(Array.from(event.target.files||[]))}/><small>Hasta 10 fotografías · 8 MB cada una</small></label></div><button className="primary save" disabled={saving}>{saving?"Guardando…":"Guardar reunión"}</button></form></div>}
    {modal==="request"&&<div className="modal-backdrop"><form className="modal regional-form" onSubmit={saveRequest}><button type="button" className="close" onClick={()=>setModal(null)}>×</button><h2>{editingRequest?"Editar solicitud":"Nueva solicitud"}</h2><div className="regional-form-grid"><label>Ciudad<input name="city" list="regional-cities-request" defaultValue={editingRequest?.city||""} required/><datalist id="regional-cities-request">{cityOptions.map(city=><option key={city}>{city}</option>)}</datalist></label><label>Área<select name="targetArea" defaultValue={editingRequest?.target_area||"marketing"}><option value="marketing">Marketing</option><option value="b2b">B2B</option><option value="commercial">Comercial</option><option value="operations">Operaciones</option><option value="other">Otra área</option></select></label><label className="wide">¿Qué necesitas?<textarea name="requestText" rows={4} defaultValue={editingRequest?.request_text||""} required/></label><label className="wide">¿Por qué se necesita?<textarea name="rationale" rows={3} defaultValue={editingRequest?.rationale||""}/></label><label>Prioridad<select name="priority" defaultValue={editingRequest?.priority||"medium"}><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option></select></label><label>Responsable<input name="responsible" defaultValue={editingRequest?.responsible||""}/></label><label>Fecha límite<input name="dueDate" type="date" defaultValue={editingRequest?.due_date||""}/></label><label>Estado<select name="status" defaultValue={editingRequest?.status||"pending"}><option value="pending">Pendiente</option><option value="requested">Solicitada</option><option value="in_progress">En proceso</option><option value="completed">Completada</option><option value="rejected">Rechazada</option></select></label></div><button className="primary save" disabled={saving}>{saving?"Guardando…":"Guardar solicitud"}</button></form></div>}
    {modal==="import"&&<div className="modal-backdrop"><div className="modal regional-form regional-import"><button type="button" className="close" onClick={()=>setModal(null)}>×</button><h2>Cargar KPIs por Excel</h2><p>Semana del {dateLabel(weekStart)}. El archivo debe incluir una columna llamada Ciudad.</p><div className="regional-import-actions"><button className="secondary" type="button" onClick={downloadTemplate}>⇩ Descargar plantilla</button><label>Seleccionar Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={event=>{const file=event.target.files?.[0];if(file)void readKpiFile(file)}}/></label></div>{importFileName&&<strong className="regional-file-name">{importFileName} · {importRows.length} ciudades</strong>}{importRows.length>0&&<div className="table-wrap regional-preview"><table><thead><tr><th>Ciudad</th><th>Ventas</th><th>Pedidos</th><th>Margen</th><th>Tarde</th><th>Reag.</th><th>OOS</th></tr></thead><tbody>{importRows.slice(0,12).map((row,index)=><tr key={`${row.city}-${index}`}><td>{row.city}</td><td>{money(row.sales)}</td><td>{row.orders}</td><td>{percent(row.marginPercent)}</td><td>{percent(row.latePercent)}</td><td>{percent(row.reschedulingPercent)}</td><td>{percent(row.oosPercent)}</td></tr>)}</tbody></table></div>}<button className="primary save" type="button" disabled={!importRows.length||saving} onClick={()=>void importKpis()}>{saving?"Importando…":`Importar ${importRows.length||0} ciudades`}</button></div></div>}
  </section>;
}
