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

export default function B2BClientRegistry({currentUser,apiFetch,setNotice}:Props){
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
  const [storesConsumed,setStoresConsumed]=useState("");
  const [weekStart,setWeekStart]=useState(currentWeek);
  const [selectedMonth,setSelectedMonth]=useState(today.slice(0,7));
  const [reportStart,setReportStart]=useState(`${today.slice(0,7)}-01`);
  const [reportEnd,setReportEnd]=useState(today);
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

  function openCreate(){setEditing(null);setStoresConsumed("");setFormVersion(value=>value+1);setFormOpen(true);}
  function openEdit(contact:ContactRow){setEditing(contact);setStoresConsumed((contact.store_names||[]).join(", "));setFormVersion(value=>value+1);setFormOpen(true);requestAnimationFrame(()=>document.querySelector(".b2b-form-card")?.scrollIntoView({behavior:"smooth",block:"start"}));}
  function closeForm(){setFormOpen(false);setEditing(null);setStoresConsumed("");}

  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setSaving(true);
    const form=new FormData(event.currentTarget);
    try{
      const response=await apiFetch("/api/b2b-clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action:"save",id:editing?.id,institutionType:form.get("institutionType"),institutionName:form.get("institutionName"),
        contactDate:form.get("contactDate"),sector:form.get("sector"),contactPhone:form.get("contactPhone"),
        email:form.get("email"),storeNames:storesConsumed.split(",").map(value=>value.trim()).filter(Boolean),additionalComments:form.get("additionalComments")
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

  function downloadClientReport(){
    if(!isAdmin)return;
    if(!reportStart||!reportEnd){setNotice("Error: Selecciona la fecha inicial y final del reporte");return;}
    if(reportStart>reportEnd){setNotice("Error: La fecha inicial no puede ser posterior a la fecha final");return;}
    const selectedContacts=contacts.filter(contact=>contact.contact_date>=reportStart&&contact.contact_date<=reportEnd).sort((a,b)=>a.contact_date.localeCompare(b.contact_date)||a.institution_name.localeCompare(b.institution_name,"es"));
    if(!selectedContacts.length){setNotice("No existen clientes registrados en las fechas seleccionadas");return;}
    const headers=["Tipo de Institución","Nombre de la Institución","Fecha","Sector","# Contacto","Correo","Tiendas donde Consume","Comentarios Adicionales"];
    const rows=selectedContacts.map(contact=>[
      institutionLabels[contact.institution_type],contact.institution_name,new Date(`${contact.contact_date}T12:00:00`),contact.sector,
      contact.contact_phone,contact.email,contact.store_names.join(", "),contact.additional_comments
    ]);
    const sheet=XLSX.utils.aoa_to_sheet([
      ["TIPTI Operaciones | Registro de clientes B2B"],
      [`Periodo: ${dateLabel(reportStart)} — ${dateLabel(reportEnd)}`],
      [],headers,...rows
    ],{cellDates:true});
    sheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}];
    sheet["!cols"]=[{wch:22},{wch:34},{wch:14},{wch:26},{wch:18},{wch:32},{wch:44},{wch:60}];
    sheet["!rows"]=[{hpt:27},{hpt:21},{hpt:8},{hpt:34},...rows.map(()=>({hpt:30}))];
    sheet["!autofilter"]={ref:XLSX.utils.encode_range({s:{r:3,c:0},e:{r:rows.length+3,c:7}})};
    const thinBorder={top:{style:"thin",color:{rgb:"D9E1E8"}},right:{style:"thin",color:{rgb:"D9E1E8"}},bottom:{style:"thin",color:{rgb:"D9E1E8"}},left:{style:"thin",color:{rgb:"D9E1E8"}}};
    const categoryColors:Record<InstitutionType,{fill:string;font:string}>={
      salud:{fill:"DDF4E8",font:"147453"},ferreteria:{fill:"FDE2DE",font:"B52B24"},papeleria:{fill:"ECE3CF",font:"72501E"},belleza:{fill:"EADDF7",font:"6D3997"},b2b:{fill:"DDEAF7",font:"245D95"}
    };
    for(let column=0;column<8;column++){
      const title=sheet[XLSX.utils.encode_cell({r:0,c:column})]||(sheet[XLSX.utils.encode_cell({r:0,c:column})]={t:"s",v:""});
      title.s={fill:{fgColor:{rgb:"102F4D"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:16},alignment:{horizontal:"center",vertical:"center"}};
      const subtitle=sheet[XLSX.utils.encode_cell({r:1,c:column})]||(sheet[XLSX.utils.encode_cell({r:1,c:column})]={t:"s",v:""});
      subtitle.s={fill:{fgColor:{rgb:"EAF0F5"}},font:{bold:true,color:{rgb:"102F4D"},sz:11},alignment:{horizontal:"center",vertical:"center"}};
      const header=sheet[XLSX.utils.encode_cell({r:3,c:column})];
      if(header)header.s={fill:{fgColor:{rgb:"F97316"}},font:{bold:true,color:{rgb:"FFFFFF"},sz:11},alignment:{horizontal:"center",vertical:"center",wrapText:true},border:thinBorder};
    }
    selectedContacts.forEach((contact,rowIndex)=>{
      for(let column=0;column<8;column++){
        const cell=sheet[XLSX.utils.encode_cell({r:rowIndex+4,c:column})];if(!cell)continue;
        cell.s={fill:{fgColor:{rgb:rowIndex%2===0?"FFFFFF":"F7F9FB"}},font:{color:{rgb:"26384A"}},alignment:{horizontal:column===2?"center":"left",vertical:"top",wrapText:true},border:thinBorder};
        if(column===2)cell.z="dd/mm/yyyy";
      }
      const typeCell=sheet[XLSX.utils.encode_cell({r:rowIndex+4,c:0})];
      const colors=categoryColors[contact.institution_type];
      if(typeCell)typeCell.s={...typeCell.s,fill:{fgColor:{rgb:colors.fill}},font:{bold:true,color:{rgb:colors.font}},alignment:{horizontal:"center",vertical:"center"}};
    });
    const workbook=XLSX.utils.book_new();
    workbook.Props={Title:"Registro de clientes B2B",Subject:`Clientes del ${reportStart} al ${reportEnd}`,Company:"TIPTI Operaciones"};
    XLSX.utils.book_append_sheet(workbook,sheet,"Clientes B2B");
    const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"});
    const url=URL.createObjectURL(new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link=document.createElement("a");link.href=url;link.download=`Clientes_B2B_${reportStart}_${reportEnd}.xlsx`;document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    setNotice(`✓ Reporte generado con ${selectedContacts.length} cliente${selectedContacts.length===1?"":"s"}`);
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
        <label className="wide">Tiendas donde consume<input value={storesConsumed} onChange={event=>setStoresConsumed(event.target.value)} placeholder="Ej. Kiwy, Megamaxi, Ferreterías en general" maxLength={2000}/><small>Escribe libremente una o varias tiendas separadas por comas.</small></label>
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
      <div className="b2b-section-head b2b-month-head"><div><span>REPORTE POR SEMANAS</span><h3>Control mensual</h3><p>Todas las semanas que forman parte del mes seleccionado.</p></div><label>Mes<input type="month" value={selectedMonth} onChange={event=>{if(event.target.value)setSelectedMonth(event.target.value)}}/></label></div>
      <div className="table-wrap"><table className="b2b-month-table"><thead><tr><th>Supervisor</th>{monthWeeks.map(week=><th key={week}>{shortDate(week)}–{shortDate(moveDate(week,6))}</th>)}<th>Total</th><th>Cumplimiento</th></tr></thead><tbody>
        {monthlyRows.map(row=><tr key={row.id}><td><strong>{row.name}</strong></td>{row.counts.map((count,index)=><td key={monthWeeks[index]}><span className={monthWeeks[index]>currentWeek?"future":progressClass(count)}>{monthWeeks[index]>currentWeek?"No iniciada":`${count}/${WEEKLY_GOAL}`}</span></td>)}<td><strong>{row.total}</strong></td><td><b>{row.percentage}%</b><small>{row.completed}/{row.elapsed} semanas</small></td></tr>)}
      </tbody></table></div>
    </div>

    {isAdmin&&<div className="b2b-report-card">
      <div className="b2b-section-head"><div><span>REPORTE DE CLIENTES</span><h3>Generar Excel por fechas</h3><p>El archivo incluye únicamente la información de los clientes guardados en la base.</p></div></div>
      <div className="b2b-report-controls"><label>Desde<input type="date" value={reportStart} max={reportEnd||undefined} onChange={event=>setReportStart(event.target.value)}/></label><label>Hasta<input type="date" value={reportEnd} min={reportStart||undefined} onChange={event=>setReportEnd(event.target.value)}/></label><button type="button" className="primary" onClick={downloadClientReport}>⇩ Generar Excel</button></div>
      <small className="b2b-report-note">No contiene nombres de supervisores, correos internos ni datos de cumplimiento.</small>
    </div>}

    <div className="b2b-records-card">
      <div className="b2b-section-head b2b-records-head"><div><span>HISTORIAL</span><h3>Clientes registrados</h3><p>{visibleContacts.length} registros visibles.</p></div><select aria-label="Filtrar por tipo" value={typeFilter} onChange={event=>setTypeFilter(event.target.value as InstitutionType|"all")}><option value="all">Todos los tipos</option>{institutionOptions.map(type=><option key={type} value={type}>{institutionLabels[type]}</option>)}</select><input aria-label="Buscar clientes B2B" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Buscar institución, sector o contacto"/><button type="button" className="secondary" onClick={openCreate}>＋ Nuevo registro</button></div>
      <div className="table-wrap"><table className="b2b-records-table"><thead><tr><th>Tipo de institución</th><th>Nombre de la institución</th><th>Fecha</th><th>Sector</th><th># Contacto</th><th>Correo</th><th>Tiendas donde consume</th><th>Comentarios adicionales</th><th>Supervisor</th><th>Acciones</th></tr></thead><tbody>
        {visibleContacts.length?visibleContacts.map(contact=>{const canEdit=isAdmin||contact.submitted_by===currentUserId;return <tr key={contact.id}><td><span className={`b2b-type ${contact.institution_type}`}>{institutionLabels[contact.institution_type]}</span></td><td><strong>{contact.institution_name}</strong></td><td>{dateLabel(contact.contact_date)}</td><td>{contact.sector}</td><td>{contact.contact_phone||"—"}</td><td>{contact.email||"—"}</td><td>{contact.store_names.length?contact.store_names.join(", "):"Sin tiendas"}</td><td className="b2b-comments">{contact.additional_comments||"Sin comentarios"}</td><td><strong>{contact.submitted_by_name}</strong><small>{contact.submitted_by_email}</small></td><td>{canEdit?<div className="b2b-row-actions"><button type="button" onClick={()=>openEdit(contact)}>Editar</button><button type="button" className="delete" onClick={()=>void remove(contact)}>Eliminar</button></div>:"Solo lectura"}</td></tr>}):<tr><td colSpan={10}><div className="b2b-empty">{loading?"Cargando clientes…":query||typeFilter!=="all"?"No existen resultados con esos filtros.":"Todavía no se han registrado clientes B2B."}</div></td></tr>}
      </tbody></table></div>
    </div>
  </section>;
}
