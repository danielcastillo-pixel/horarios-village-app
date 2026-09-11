"use client";

import {useCallback,useEffect,useMemo,useState} from "react";
import * as XLSX from "xlsx-js-style";

type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type InstitutionType="salud"|"ferreteria"|"papeleria"|"belleza"|"b2b";
type ContactRow={
  id:number;institution_type:InstitutionType;institution_name:string;contact_date:string;sector:string;
  contact_phone:string;email:string;store_names:string[];additional_comments:string;submitted_by:string;
  submitted_by_name:string;submitted_by_email:string;created_at:string;updated_at:string;
};
type SupervisorRow={id:string;email:string;name:string};
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};

const WEEKLY_GOAL=5;
const institutionLabels:Record<InstitutionType,string>={salud:"Salud",ferreteria:"Ferretería",papeleria:"Papelería",belleza:"Belleza",b2b:"B2B"};
const institutionOptions=(Object.keys(institutionLabels) as InstitutionType[]);

function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
function mondayFor(value:string){const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);}
function dateLabel(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function shortDate(value:string){return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));}
function monthLabel(value:string){if(!/^\d{4}-\d{2}$/.test(value))return "Mes no seleccionado";const [year,month]=value.split("-").map(Number);return new Intl.DateTimeFormat("es-EC",{month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(Date.UTC(year,month-1,1)));}
function weeksForMonth(value:string){
  if(!/^\d{4}-\d{2}$/.test(value))return [];
  const [year,month]=value.split("-").map(Number);
  const first=`${value}-01`;
  const last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10);
  const weeks:string[]=[];
  for(let week=mondayFor(first);week<=last;week=moveDate(week,7))weeks.push(week);
  return weeks;
}
function inWeek(date:string,week:string){return date>=week&&date<=moveDate(week,6);}
function progressClass(count:number){return count>=WEEKLY_GOAL?"complete":count>0?"progress":"pending";}

export default function B2BClientRegistry({locations,currentUser,apiFetch,setNotice}:Props){
  const today=new Date().toLocaleDateString("en-CA");
  const currentWeek=mondayFor(today);
  const [contacts,setContacts]=useState<ContactRow[]>([]);
  const [supervisors,setSupervisors]=useState<SupervisorRow[]>([]);
  const [currentUserId,setCurrentUserId]=useState("");
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [formOpen,setFormOpen]=useState(false);
  const [formVersion,setFormVersion]=useState(0);
  const [editing,setEditing]=useState<ContactRow|null>(null);
  const [selectedStores,setSelectedStores]=useState<string[]>([]);
  const [weekStart,setWeekStart]=useState(currentWeek);
  const [selectedMonth,setSelectedMonth]=useState(today.slice(0,7));
  const [query,setQuery]=useState("");
  const [typeFilter,setTypeFilter]=useState<InstitutionType|"all">("all");
  const isAdmin=currentUser.role==="admin";

  const load=useCallback(async(showNotice=false)=>{
    setLoading(true);
    try{
      const response=await apiFetch(`/api/b2b-clients?refresh=${Date.now()}`,{cache:"no-store"});
      const payload=await response.json().catch(()=>({error:"No se pudo cargar"})) as {contacts?:ContactRow[];supervisors?:SupervisorRow[];currentUserId?:string;error?:string};
      if(!response.ok)throw new Error(payload.error||"No se pudo cargar el registro B2B");
      setContacts(payload.contacts||[]);
      setSupervisors(payload.supervisors||[]);
      setCurrentUserId(payload.currentUserId||"");
      if(showNotice)setNotice("✓ Registro B2B actualizado");
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo cargar el registro B2B"}`);}finally{setLoading(false);}
  },[apiFetch,setNotice]);

  useEffect(()=>{void load();},[load]);

  const weeklyRows=useMemo(()=>supervisors.map(supervisor=>{
    const count=contacts.filter(contact=>contact.submitted_by===supervisor.id&&inWeek(contact.contact_date,weekStart)).length;
    return {...supervisor,count,missing:Math.max(0,WEEKLY_GOAL-count),percentage:Math.min(100,Math.round(count/WEEKLY_GOAL*100))};
  }).sort((a,b)=>a.count-b.count||a.name.localeCompare(b.name,"es")),[contacts,supervisors,weekStart]);
  const pendingRows=weeklyRows.filter(row=>row.count<WEEKLY_GOAL);
  const weeklyContactCount=contacts.filter(contact=>inWeek(contact.contact_date,weekStart)&&(isAdmin||contact.submitted_by===currentUserId)).length;
  const achieved=weeklyRows.filter(row=>row.count>=WEEKLY_GOAL).length;
  const weeklyTarget=(isAdmin?weeklyRows.length:1)*WEEKLY_GOAL;

  const monthWeeks=useMemo(()=>weeksForMonth(selectedMonth),[selectedMonth]);
  const monthlyRows=useMemo(()=>supervisors.map(supervisor=>{
    const counts=monthWeeks.map(week=>contacts.filter(contact=>contact.submitted_by===supervisor.id&&inWeek(contact.contact_date,week)).length);
    const elapsed=monthWeeks.filter(week=>week<=currentWeek);
    const completed=elapsed.filter(week=>counts[monthWeeks.indexOf(week)]>=WEEKLY_GOAL).length;
    return {...supervisor,counts,total:counts.reduce((sum,count)=>sum+count,0),completed,elapsed:elapsed.length,percentage:elapsed.length?Math.round(completed/elapsed.length*100):0};
  }),[contacts,supervisors,monthWeeks,currentWeek]);

  const visibleContacts=useMemo(()=>contacts.filter(contact=>{
    const term=query.trim().toLocaleLowerCase("es");
    const matchesType=typeFilter==="all"||contact.institution_type===typeFilter;
    const matchesText=!term||[contact.institution_name,contact.sector,contact.contact_phone,contact.email,contact.submitted_by_name,...contact.store_names].some(value=>value.toLocaleLowerCase("es").includes(term));
    return matchesType&&matchesText;
  }),[contacts,query,typeFilter]);

  function openCreate(){setEditing(null);setSelectedStores([]);setFormVersion(value=>value+1);setFormOpen(true);}
  function openEdit(contact:ContactRow){setEditing(contact);setSelectedStores(contact.store_names||[]);setFormVersion(value=>value+1);setFormOpen(true);requestAnimationFrame(()=>document.querySelector(".b2b-form-card")?.scrollIntoView({behavior:"smooth",block:"start"}));}
  function closeForm(){setFormOpen(false);setEditing(null);setSelectedStores([]);}

  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setSaving(true);
    const form=new FormData(event.currentTarget);
    try{
      const response=await apiFetch("/api/b2b-clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action:"save",id:editing?.id,institutionType:form.get("institutionType"),institutionName:form.get("institutionName"),
        contactDate:form.get("contactDate"),sector:form.get("sector"),contactPhone:form.get("contactPhone"),
        email:form.get("email"),storeNames:selectedStores,additionalComments:form.get("additionalComments")
      })});
      const payload=await response.json().catch(()=>({error:"No se pudo guardar"})) as {error?:string};
      if(!response.ok)throw new Error(payload.error||"No se pudo guardar el cliente");
      setNotice(editing?"✓ Cliente B2B actualizado":"✓ Cliente B2B registrado y sumado al cumplimiento semanal");
      closeForm();await load();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar el cliente"}`);}finally{setSaving(false);}
  }

  async function remove(contact:ContactRow){
    if(!window.confirm(`¿Eliminar el registro de ${contact.institution_name}? Se descontará del cumplimiento de su semana.`))return;
    const response=await apiFetch("/api/b2b-clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"delete",id:contact.id})});
    const payload=await response.json().catch(()=>({error:"No se pudo eliminar"})) as {error?:string};
    if(!response.ok){setNotice(`Error: ${payload.error||"No se pudo eliminar"}`);return;}
    setNotice("✓ Registro B2B eliminado");await load();
  }

  function downloadMonthlyReport(){
    if(!isAdmin||!monthWeeks.length)return;
    const headers=["Supervisor",...monthWeeks.map(week=>`${shortDate(week)}–${shortDate(moveDate(week,6))}`),"Contactos","Semanas cumplidas","Cumplimiento"];
    const summaryRows=monthlyRows.map(row=>[
      row.name,...row.counts.map((count,index)=>monthWeeks[index]>currentWeek?"No iniciada":`${count}/${WEEKLY_GOAL}`),
      row.total,`${row.completed}/${row.elapsed}`,row.percentage/100
    ]);
    const summary=XLSX.utils.aoa_to_sheet([["TIPTI Operaciones | Control mensual de clientes B2B"],[`Mes: ${monthLabel(selectedMonth)} · Meta semanal: ${WEEKLY_GOAL} contactos por supervisor`],[],headers,...summaryRows]);
    summary["!merges"]=[{s:{r:0,c:0},e:{r:0,c:headers.length-1}},{s:{r:1,c:0},e:{r:1,c:headers.length-1}}];
    summary["!cols"]=[{wch:30},...monthWeeks.map(()=>({wch:18})),{wch:12},{wch:18},{wch:15}];
    summary["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:3,c:0},e:{r:Math.max(3,summaryRows.length+3),c:headers.length-1}})};
    for(let column=0;column<headers.length;column++){
      for(const row of [0,1]){
        const cell=summary[XLSX.utils.encode_cell({r:row,c:column})]||(summary[XLSX.utils.encode_cell({r:row,c:column})]={t:"s",v:""});
        cell.s={fill:{fgColor:{rgb:row===0?"102F4D":"EAF0F5"}},font:{bold:true,color:{rgb:row===0?"FFFFFF":"102F4D"},sz:row===0?16:11},alignment:{horizontal:"center",vertical:"center"}};
      }
      const header=summary[XLSX.utils.encode_cell({r:3,c:column})];
      if(header)header.s={fill:{fgColor:{rgb:"F97316"}},font:{bold:true,color:{rgb:"FFFFFF"}},alignment:{horizontal:"center",vertical:"center",wrapText:true}};
    }
    summaryRows.forEach((row,rowIndex)=>row.forEach((_,column)=>{
      const cell=summary[XLSX.utils.encode_cell({r:rowIndex+4,c:column})];if(!cell)return;
      cell.s={alignment:{horizontal:column===0?"left":"center",vertical:"center"},border:{bottom:{style:"thin",color:{rgb:"E2E8F0"}}}};
      if(column===headers.length-1)cell.z="0%";
    }));

    const reportStart=monthWeeks[0],reportEnd=moveDate(monthWeeks[monthWeeks.length-1],6);
    const details=contacts.filter(contact=>contact.contact_date>=reportStart&&contact.contact_date<=reportEnd).map(contact=>[
      institutionLabels[contact.institution_type],contact.institution_name,contact.contact_date,contact.sector,contact.contact_phone,contact.email,
      contact.store_names.join(", "),contact.additional_comments,contact.submitted_by_name
    ]);
    const detailHeaders=["Tipo de institución","Nombre de la institución","Fecha","Sector","# Contacto","Correo","Tiendas donde consume","Comentarios adicionales","Supervisor"];
    const detail=XLSX.utils.aoa_to_sheet([detailHeaders,...details]);
    detail["!cols"]=[{wch:20},{wch:34},{wch:13},{wch:22},{wch:18},{wch:30},{wch:38},{wch:55},{wch:28}];
    detail["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:Math.max(0,details.length),c:detailHeaders.length-1}})};
    detailHeaders.forEach((_,column)=>{const cell=detail[XLSX.utils.encode_cell({r:0,c:column})];if(cell)cell.s={fill:{fgColor:{rgb:"102F4D"}},font:{bold:true,color:{rgb:"FFFFFF"}},alignment:{horizontal:"center",vertical:"center",wrapText:true}};});
    details.forEach((row,rowIndex)=>row.forEach((_,column)=>{const cell=detail[XLSX.utils.encode_cell({r:rowIndex+1,c:column})];if(cell)cell.s={alignment:{vertical:"top",wrapText:true},border:{bottom:{style:"thin",color:{rgb:"E2E8F0"}}}};}));

    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,summary,"Cumplimiento mensual");
    XLSX.utils.book_append_sheet(workbook,detail,"Clientes registrados");
    const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"});
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link=document.createElement("a");link.href=url;link.download=`Registro_Clientes_B2B_${selectedMonth}.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    setNotice("✓ Reporte mensual B2B descargado");
  }

  return <section className="b2b-module">
    <div className="b2b-hero">
      <div><span>REGIÓN SUR · CONTROL SEMANAL</span><h2>Registro clientes B2B</h2><p>Registra nuevos contactos y controla la meta mínima de cinco clientes por supervisor cada semana.</p></div>
      <button type="button" className="primary" onClick={formOpen?closeForm:openCreate}>{formOpen?"Cerrar formulario":"＋ Registrar nuevo cliente"}</button>
    </div>

    <div className="b2b-week-toolbar">
      <button type="button" aria-label="Semana anterior" onClick={()=>setWeekStart(value=>moveDate(value,-7))}>‹</button>
      <div><span>Semana controlada</span><strong>{dateLabel(weekStart)} — {dateLabel(moveDate(weekStart,6))}</strong></div>
      <button type="button" aria-label="Semana siguiente" onClick={()=>setWeekStart(value=>moveDate(value,7))}>›</button>
      <button type="button" className="b2b-refresh" onClick={()=>void load(true)} disabled={loading}>{loading?"Actualizando…":"↻ Actualizar"}</button>
    </div>

    <div className="b2b-kpis">
      <article><span>{isAdmin?"Contactos registrados":"Mis contactos"}</span><strong>{weeklyContactCount}</strong><small>Semana seleccionada</small></article>
      <article><span>Meta semanal</span><strong>{weeklyTarget}</strong><small>{isAdmin?`${weeklyRows.length} supervisores × ${WEEKLY_GOAL}`:`${WEEKLY_GOAL} contactos`}</small></article>
      <article><span>Cumplieron</span><strong>{achieved}</strong><small>Con 5 contactos o más</small></article>
      <article><span>Pendientes</span><strong>{pendingRows.length}</strong><small>{isAdmin?"Necesitan seguimiento":"Contactos que aún te faltan"}</small></article>
    </div>

    {formOpen&&<form key={editing?.id||`new-${formVersion}`} className="b2b-form-card" onSubmit={save}>
      <div className="b2b-form-title"><div><span>{editing?"EDITAR REGISTRO":"NUEVO CONTACTO"}</span><h3>{editing?editing.institution_name:"Registrar cliente B2B"}</h3></div><small>Los campos marcados con * son obligatorios.</small></div>
      <div className="b2b-form-grid">
        <label>Tipo de institución *<select name="institutionType" defaultValue={editing?.institution_type||"salud"} required>{institutionOptions.map(type=><option key={type} value={type}>{institutionLabels[type]}</option>)}</select></label>
        <label>Nombre de la institución *<input name="institutionName" defaultValue={editing?.institution_name||""} maxLength={200} required/></label>
        <label>Fecha *<input name="contactDate" type="date" defaultValue={editing?.contact_date||today} required/></label>
        <label>Sector *<input name="sector" defaultValue={editing?.sector||""} placeholder="Ej. Urdesa, Centro, Samborondón" maxLength={300} required/></label>
        <label># Contacto<input name="contactPhone" type="tel" defaultValue={editing?.contact_phone||""} placeholder="Ej. 099 000 0000" maxLength={80}/></label>
        <label>Correo<input name="email" type="email" defaultValue={editing?.email||""} placeholder="contacto@institucion.com" maxLength={320}/><small>Ingresa al menos teléfono o correo.</small></label>
        <fieldset className="b2b-store-picker"><legend>Tiendas donde consume</legend><div>{locations.map(location=><label key={location.id}><input type="checkbox" checked={selectedStores.includes(location.name)} onChange={event=>setSelectedStores(values=>event.target.checked?[...values,location.name]:values.filter(name=>name!==location.name))}/><span>{location.name}<small>{location.city}</small></span></label>)}</div>{!locations.length&&<p>No existen tiendas disponibles para tu cuenta.</p>}</fieldset>
        <label className="wide">Comentarios adicionales<textarea name="additionalComments" rows={4} defaultValue={editing?.additional_comments||""} maxLength={5000} placeholder="Escribe qué se conversó, necesidades del cliente y próximos pasos."/></label>
      </div>
      <div className="b2b-form-actions"><button type="button" className="secondary" onClick={closeForm}>Cancelar</button><button className="primary" disabled={saving}>{saving?"Guardando…":editing?"Guardar cambios":"Guardar cliente"}</button></div>
    </form>}

    <div className="b2b-pending-card">
      <div className="b2b-section-head"><div><span>CONTROL SEMANAL</span><h3>{isAdmin?"Supervisores pendientes":"Mi cumplimiento semanal"}</h3><p>La meta se completa automáticamente al llegar a cinco contactos únicos.</p></div><b>{pendingRows.length} pendiente{pendingRows.length===1?"":"s"}</b></div>
      <div className="table-wrap"><table className="b2b-progress-table"><thead><tr><th>Supervisor</th><th>Registrados</th><th>Meta</th><th>Faltan</th><th>Avance</th><th>Estado</th></tr></thead><tbody>
        {weeklyRows.length?weeklyRows.map(row=><tr key={row.id}><td><strong>{row.name}</strong><small>{row.email}</small></td><td>{row.count}</td><td>{WEEKLY_GOAL}</td><td>{row.missing}</td><td><div className="b2b-progress"><i style={{width:`${row.percentage}%`}}/><span>{row.percentage}%</span></div></td><td><span className={`b2b-status ${progressClass(row.count)}`}>{row.count>=WEEKLY_GOAL?"Cumplido":row.count?"En proceso":"Pendiente"}</span></td></tr>):<tr><td colSpan={6}><div className="b2b-empty">{loading?"Cargando supervisores…":"No existen supervisores activos."}</div></td></tr>}
      </tbody></table></div>
    </div>

    <div className="b2b-monthly-card">
      <div className="b2b-section-head b2b-month-head"><div><span>REPORTE POR SEMANAS</span><h3>Control mensual</h3><p>Todas las semanas que forman parte del mes seleccionado.</p></div><label>Mes<input type="month" value={selectedMonth} onChange={event=>{if(event.target.value)setSelectedMonth(event.target.value)}}/></label>{isAdmin&&<button type="button" className="secondary" onClick={downloadMonthlyReport}>⇩ Descargar reporte</button>}</div>
      <div className="table-wrap"><table className="b2b-month-table"><thead><tr><th>Supervisor</th>{monthWeeks.map(week=><th key={week}>{shortDate(week)}–{shortDate(moveDate(week,6))}</th>)}<th>Total</th><th>Cumplimiento</th></tr></thead><tbody>
        {monthlyRows.map(row=><tr key={row.id}><td><strong>{row.name}</strong></td>{row.counts.map((count,index)=><td key={monthWeeks[index]}><span className={monthWeeks[index]>currentWeek?"future":progressClass(count)}>{monthWeeks[index]>currentWeek?"No iniciada":`${count}/${WEEKLY_GOAL}`}</span></td>)}<td><strong>{row.total}</strong></td><td><b>{row.percentage}%</b><small>{row.completed}/{row.elapsed} semanas</small></td></tr>)}
      </tbody></table></div>
    </div>

    <div className="b2b-records-card">
      <div className="b2b-section-head b2b-records-head"><div><span>HISTORIAL</span><h3>Clientes registrados</h3><p>{visibleContacts.length} registros visibles.</p></div><select aria-label="Filtrar por tipo" value={typeFilter} onChange={event=>setTypeFilter(event.target.value as InstitutionType|"all")}><option value="all">Todos los tipos</option>{institutionOptions.map(type=><option key={type} value={type}>{institutionLabels[type]}</option>)}</select><input aria-label="Buscar clientes B2B" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar institución, sector o contacto"/><button type="button" className="secondary" onClick={openCreate}>＋ Nuevo registro</button></div>
      <div className="table-wrap"><table className="b2b-records-table"><thead><tr><th>Tipo de institución</th><th>Nombre de la institución</th><th>Fecha</th><th>Sector</th><th># Contacto</th><th>Correo</th><th>Tiendas donde consume</th><th>Comentarios adicionales</th><th>Supervisor</th><th>Acciones</th></tr></thead><tbody>
        {visibleContacts.length?visibleContacts.map(contact=>{const canEdit=isAdmin||contact.submitted_by===currentUserId;return <tr key={contact.id}><td><span className={`b2b-type ${contact.institution_type}`}>{institutionLabels[contact.institution_type]}</span></td><td><strong>{contact.institution_name}</strong></td><td>{dateLabel(contact.contact_date)}</td><td>{contact.sector}</td><td>{contact.contact_phone||"—"}</td><td>{contact.email||"—"}</td><td>{contact.store_names.length?contact.store_names.join(", "):"Sin tiendas"}</td><td className="b2b-comments">{contact.additional_comments||"Sin comentarios"}</td><td><strong>{contact.submitted_by_name}</strong><small>{contact.submitted_by_email}</small></td><td>{canEdit?<div className="b2b-row-actions"><button type="button" onClick={()=>openEdit(contact)}>Editar</button><button type="button" className="delete" onClick={()=>void remove(contact)}>Eliminar</button></div>:"Solo lectura"}</td></tr>}):<tr><td colSpan={10}><div className="b2b-empty">{loading?"Cargando clientes…":query||typeFilter!=="all"?"No existen resultados con esos filtros.":"Todavía no se han registrado clientes B2B."}</div></td></tr>}
      </tbody></table></div>
    </div>
  </section>;
}
