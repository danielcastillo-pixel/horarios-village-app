"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from "react";
import * as XLSX from "xlsx-js-style";

type Location={id:number;name:string;city:string};
type Person={
  key:string;source:"supervisor"|"shopper";id:number;name:string;external_id:string|null;job_role:string;
  area:"supervision"|"purchase"|"delivery";employment_type:string;location_id:number;location_name:string;city:string;active:boolean;
};
type Props={locations:Location[];apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};
type View="counts"|"names";
type StatusFilter="active"|"inactive"|"all";

const rolePriority=["Asesor de compra","Supervisor","Repartidor"];
const areaLabels={supervision:"Supervisión",purchase:"Compra",delivery:"Entrega"} as const;

function normalize(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();}
function safeFilePart(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi,"_").replace(/^_+|_+$/g,"")||"Region_Sur";}
function roleSort(a:string,b:string){
  const ai=rolePriority.indexOf(a),bi=rolePriority.indexOf(b);
  if(ai>=0||bi>=0)return (ai<0?999:ai)-(bi<0?999:bi)||a.localeCompare(b,"es");
  return a.localeCompare(b,"es");
}
function initials(name:string){return name.split(/\s+/).filter(Boolean).map(part=>part[0]).join("").slice(0,2).toUpperCase();}
function statusLabel(filter:StatusFilter){return filter==="active"?"Activos":filter==="inactive"?"Inactivos":"Todos";}

function styleSheet(sheet:XLSX.WorkSheet,headerRow:number,widths:number[],numericFrom:number|null=null,hasTotal=false){
  const range=XLSX.utils.decode_range(sheet["!ref"]||"A1:A1");
  sheet["!cols"]=widths.map(w=>({wch:w}));
  sheet["!rows"]=[{hpt:29},{hpt:20},{hpt:8},{hpt:28}];
  for(let col=range.s.c;col<=range.e.c;col++){
    const title=sheet[XLSX.utils.encode_cell({r:0,c:col})];
    if(title)title.s={font:{name:"Arial",sz:16,bold:true,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"102F4D"}},alignment:{vertical:"center"}};
    const header=sheet[XLSX.utils.encode_cell({r:headerRow,c:col})];
    if(header)header.s={font:{name:"Arial",sz:10,bold:true,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"FF6813"}},alignment:{horizontal:"center",vertical:"center",wrapText:true},border:{bottom:{style:"thin",color:{rgb:"D45108"}}}};
  }
  for(let row=headerRow+1;row<=range.e.r;row++)for(let col=range.s.c;col<=range.e.c;col++){
    const cell=sheet[XLSX.utils.encode_cell({r:row,c:col})];
    if(!cell)continue;
    const isLast=hasTotal&&row===range.e.r;
    cell.s={font:{name:"Arial",sz:9,bold:isLast,color:{rgb:isLast?"FFFFFF":"334155"}},fill:{fgColor:{rgb:isLast?"102F4D":row%2?"FFFFFF":"F5F7FA"}},alignment:{horizontal:numericFrom!==null&&col>=numericFrom?"center":"left",vertical:"center"},border:{bottom:{style:"hair",color:{rgb:"DDE3E9"}}}};
  }
}

function downloadWorkbook(workbook:XLSX.WorkBook,filename:string){
  const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array"});
  const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function RegionalPersonnel({locations,apiFetch,setNotice}:Props){
  const apiFetchRef=useRef(apiFetch);
  const [people,setPeople]=useState<Person[]>([]),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false);
  const [view,setView]=useState<View>("counts"),[status,setStatus]=useState<StatusFilter>("active");
  const [city,setCity]=useState("all"),[locationId,setLocationId]=useState("all"),[role,setRole]=useState("all"),[query,setQuery]=useState("");
  const [editing,setEditing]=useState<Person|null>(null),[lastSync,setLastSync]=useState<Date|null>(null);
  useEffect(()=>{apiFetchRef.current=apiFetch},[apiFetch]);

  const loadPersonnel=useCallback(async(silent=false)=>{
    if(!silent)setLoading(true);
    try{
      const response=await apiFetchRef.current(`/api/personnel?refresh=${Date.now()}`);
      const result=await response.json().catch(()=>({error:"No se pudo cargar la nómina"})) as {people?:Person[];error?:string};
      if(!response.ok){if(!silent)setNotice(`Error: ${result.error??"No se pudo cargar la nómina"}`);return;}
      setPeople(result.people??[]);setLastSync(new Date());
    }catch{if(!silent)setNotice("Error: no se pudo conectar con la nómina regional");}
    finally{if(!silent)setLoading(false);}
  },[setNotice]);

  useEffect(()=>{
    void loadPersonnel();
    const refresh=()=>{if(document.visibilityState==="visible")void loadPersonnel(true)};
    window.addEventListener("focus",refresh);document.addEventListener("visibilitychange",refresh);
    const timer=window.setInterval(refresh,60000);
    return()=>{window.clearInterval(timer);window.removeEventListener("focus",refresh);document.removeEventListener("visibilitychange",refresh)};
  },[loadPersonnel]);

  const cities=useMemo(()=>[...new Set(locations.map(item=>item.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es")),[locations]);
  const roles=useMemo(()=>[...new Set(people.map(person=>person.job_role).filter(Boolean))].sort(roleSort),[people]);
  const availableLocations=useMemo(()=>locations.filter(item=>city==="all"||item.city===city),[locations,city]);
  useEffect(()=>{if(locationId!=="all"&&!availableLocations.some(item=>String(item.id)===locationId))setLocationId("all")},[availableLocations,locationId]);

  const matchesStatus=(person:Person)=>status==="all"||(status==="active"?person.active:!person.active);
  const scopePeople=useMemo(()=>people.filter(person=>matchesStatus(person)&&(city==="all"||person.city===city)&&(locationId==="all"||String(person.location_id)===locationId)),[people,status,city,locationId]);
  const nominalPeople=useMemo(()=>{
    const term=normalize(query);
    return scopePeople.filter(person=>(role==="all"||person.job_role===role)&&(!term||[person.name,person.external_id||"",person.job_role,person.location_name,person.city,person.employment_type].some(value=>normalize(value).includes(term))))
      .sort((a,b)=>a.location_name.localeCompare(b.location_name,"es")||a.job_role.localeCompare(b.job_role,"es")||a.name.localeCompare(b.name,"es"));
  },[scopePeople,role,query]);
  const summaryLocations=useMemo(()=>availableLocations.filter(item=>locationId==="all"||String(item.id)===locationId),[availableLocations,locationId]);
  const counts=useMemo(()=>summaryLocations.map(local=>{
    const localPeople=scopePeople.filter(person=>person.location_id===local.id);
    return {local,byRole:Object.fromEntries(roles.map(item=>[item,localPeople.filter(person=>person.job_role===item).length])),total:localPeople.length};
  }),[summaryLocations,scopePeople,roles]);
  const activePeople=people.filter(person=>person.active),activePurchase=activePeople.filter(person=>person.area==="purchase").length;
  const activeDelivery=activePeople.filter(person=>person.area==="delivery").length,activeSupervision=activePeople.filter(person=>person.area==="supervision").length;
  const coveredLocations=new Set(activePeople.map(person=>person.location_id)).size;

  async function savePerson(form:FormData){
    if(!editing||saving)return;
    setSaving(true);
    try{
      const response=await apiFetchRef.current("/api/personnel",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action:"update",source:editing.source,id:editing.id,name:form.get("name"),jobRole:form.get("jobRole"),externalId:form.get("externalId"),
        employmentType:form.get("employmentType"),locationId:Number(form.get("locationId")),active:form.get("active")==="active"
      })});
      const result=await response.json().catch(()=>({error:"No se pudo guardar"})) as {error?:string};
      if(!response.ok){setNotice(`Error: ${result.error??"No se pudo guardar"}`);return;}
      setEditing(null);setNotice("✓ Nómina regional actualizada");await loadPersonnel(true);
    }catch{setNotice("Error: no se pudo conectar para actualizar la nómina");}
    finally{setSaving(false);}
  }

  function exportExcel(){
    if(!scopePeople.length){setNotice("No existen personas para los filtros seleccionados");return;}
    const generated=new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date());
    const scope=`Estado: ${statusLabel(status)} · Ciudad: ${city==="all"?"Todas":city} · Local: ${locationId==="all"?"Todos":locations.find(item=>String(item.id)===locationId)?.name||"Todos"}`;
    const countRows=[
      ["NÓMINA REGIONAL · CANTIDADES POR LOCAL"],
      [`${scope} · Generado: ${generated}`],[],
      ["Local","Ciudad",...roles,"Total"],
      ...counts.map(row=>[row.local.name,row.local.city,...roles.map(item=>Number(row.byRole[item]||0)),Number(row.total)]),
      ["TOTAL REGIÓN","",...roles.map(item=>scopePeople.filter(person=>person.job_role===item).length),scopePeople.length]
    ];
    const detailRows=[
      ["NÓMINA REGIONAL · LISTADO DE NOMBRES"],
      [`${scope} · Cargo: ${role==="all"?"Todos":role} · Generado: ${generated}`],[],
      ["Nombre","ID","Cargo","Área","Modalidad","Local","Ciudad","Estado"],
      ...nominalPeople.map(person=>[person.name,person.external_id||"",person.job_role,areaLabels[person.area],person.employment_type||"—",person.location_name,person.city,person.active?"Activo":"Inactivo"])
    ];
    const countSheet=XLSX.utils.aoa_to_sheet(countRows),detailSheet=XLSX.utils.aoa_to_sheet(detailRows);
    countSheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:roles.length+2}},{s:{r:1,c:0},e:{r:1,c:roles.length+2}}];
    detailSheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:7}},{s:{r:1,c:0},e:{r:1,c:7}}];
    countSheet["!autofilter"]={ref:`A4:${XLSX.utils.encode_col(roles.length+2)}${counts.length+4}`};
    detailSheet["!autofilter"]={ref:`A4:H${nominalPeople.length+4}`};
    styleSheet(countSheet,3,[30,16,...roles.map(()=>18),11],2,true);
    styleSheet(detailSheet,3,[30,14,22,15,17,29,16,12]);
    const workbook=XLSX.utils.book_new();XLSX.utils.book_append_sheet(workbook,countSheet,"Cantidades por local");XLSX.utils.book_append_sheet(workbook,detailSheet,"Listado de nombres");
    const localPart=locationId==="all"?"Region_Sur":safeFilePart(locations.find(item=>String(item.id)===locationId)?.name||"Region_Sur");
    downloadWorkbook(workbook,`Nomina_Regional_${localPart}_${new Date().toLocaleDateString("en-CA")}.xlsx`);
    setNotice(`✓ Excel generado con ${scopePeople.length} personas y ${counts.length} locales`);
  }

  return <section className="personnel-module">
    <div className="personnel-hero"><div><span>MAPA REGIONAL DE PERSONAL</span><h2>Nómina regional por local y cargo</h2><p>Consulta cantidades o nombres de supervisión, compra y entrega. Los cargos nuevos se agregan automáticamente al reporte.</p></div><div><button type="button" className="secondary" disabled={loading} onClick={()=>void loadPersonnel()}>{loading?"Actualizando…":"↻ Actualizar"}</button><button type="button" className="primary" onClick={exportExcel}>⇩ Descargar Excel</button></div></div>
    <div className="personnel-sync"><span className="presence-live-dot"/><strong>Información conectada a la nómina operativa</strong><small>{lastSync?`Última actualización ${lastSync.toLocaleTimeString("es-EC",{hour:"2-digit",minute:"2-digit"})}`:"Cargando datos actuales…"}</small></div>
    <div className="personnel-kpis"><article><span>Personal activo</span><strong>{activePeople.length}</strong><small>{coveredLocations} locales con personal</small></article><article><span>Asesores / compra</span><strong>{activePurchase}</strong><small>Todas las modalidades</small></article><article><span>Repartidores / entrega</span><strong>{activeDelivery}</strong><small>Todas las modalidades</small></article><article><span>Supervisión</span><strong>{activeSupervision}</strong><small>Supervisores y encargados</small></article></div>
    <div className="personnel-tabs" role="tablist" aria-label="Tipo de reporte"><button type="button" className={view==="counts"?"active":""} onClick={()=>setView("counts")}><b>123</b><span><strong>Cantidades por local</strong><small>Totales de cada cargo</small></span></button><button type="button" className={view==="names"?"active":""} onClick={()=>setView("names")}><b>ABC</b><span><strong>Listado de nombres</strong><small>Detalle completo y editable</small></span></button></div>
    <div className="personnel-filters">
      <label>Estado<select value={status} onChange={event=>setStatus(event.target.value as StatusFilter)}><option value="active">Activos</option><option value="all">Todos</option><option value="inactive">Inactivos</option></select></label>
      <label>Ciudad<select value={city} onChange={event=>setCity(event.target.value)}><option value="all">Todas las ciudades</option>{cities.map(item=><option key={item}>{item}</option>)}</select></label>
      <label>Local<select value={locationId} onChange={event=>setLocationId(event.target.value)}><option value="all">Todos los locales</option>{availableLocations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      {view==="names"&&<><label>Cargo<select value={role} onChange={event=>setRole(event.target.value)}><option value="all">Todos los cargos</option>{roles.map(item=><option key={item}>{item}</option>)}</select></label><label className="personnel-search">Buscar<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Nombre, ID, local o cargo…"/></label></>}
    </div>
    <div className="personnel-table-card">
      <div className="personnel-table-head"><div><h3>{view==="counts"?"Cantidad de personal por local":"Nómina detallada por nombres"}</h3><p>{statusLabel(status)} · {city==="all"?"Toda la región":city}</p></div><b>{view==="counts"?`${scopePeople.length} personas`: `${nominalPeople.length} registros`}</b></div>
      {loading?<div className="personnel-empty">Actualizando la nómina regional…</div>:view==="counts"?<div className="table-wrap"><table className="personnel-count-table"><thead><tr><th>Local</th><th>Ciudad</th>{roles.map(item=><th key={item}>{item}</th>)}<th>Total</th></tr></thead><tbody>{counts.map(row=><tr key={row.local.id}><td><strong>{row.local.name}</strong></td><td>{row.local.city}</td>{roles.map(item=><td key={item}><b>{row.byRole[item]||0}</b></td>)}<td><strong>{row.total}</strong></td></tr>)}<tr className="personnel-total"><td><strong>TOTAL REGIÓN</strong></td><td>—</td>{roles.map(item=><td key={item}><b>{scopePeople.filter(person=>person.job_role===item).length}</b></td>)}<td><strong>{scopePeople.length}</strong></td></tr></tbody></table></div>:<div className="table-wrap"><table className="personnel-name-table"><thead><tr><th>Nombre</th><th>ID</th><th>Cargo</th><th>Área</th><th>Modalidad</th><th>Local</th><th>Ciudad</th><th>Estado</th><th>Actualizar</th></tr></thead><tbody>{nominalPeople.map(person=><tr key={person.key}><td><div className="personnel-name"><span>{initials(person.name)}</span><strong>{person.name}</strong></div></td><td><b className="personnel-id">{person.external_id||"—"}</b></td><td><strong>{person.job_role}</strong></td><td>{areaLabels[person.area]}</td><td>{person.employment_type||"—"}</td><td><strong>{person.location_name}</strong></td><td>{person.city}</td><td><span className={`personnel-status ${person.active?"active":"inactive"}`}>{person.active?"Activo":"Inactivo"}</span></td><td><button type="button" className="personnel-edit" onClick={()=>setEditing(person)}>✎ Editar</button></td></tr>)}</tbody></table>{!nominalPeople.length&&<div className="personnel-empty">No hay nombres que coincidan con los filtros.</div>}</div>}
    </div>
    {editing&&<div className="modal-backdrop" onMouseDown={()=>!saving&&setEditing(null)}><form className="modal personnel-modal" onSubmit={event=>{event.preventDefault();void savePerson(new FormData(event.currentTarget))}} onMouseDown={event=>event.stopPropagation()}><button type="button" className="close" disabled={saving} onClick={()=>setEditing(null)}>×</button><span className="modal-kicker">ACTUALIZAR NÓMINA</span><h2>{editing.name}</h2><p>El cargo define cómo aparece en cantidades y en el listado regional.</p><div className="personnel-form-grid"><label>Nombre completo<input name="name" required minLength={2} defaultValue={editing.name}/></label><label>Cargo<input name="jobRole" list="personnel-role-options" required minLength={2} maxLength={80} defaultValue={editing.job_role}/><datalist id="personnel-role-options">{[...new Set([...rolePriority,"Encargado","Encargado Jr",...roles])].map(item=><option key={item} value={item}/>)}</datalist><small>Puedes escribir un cargo nuevo.</small></label>{editing.source==="shopper"&&<><label>ID de shopper<input name="externalId" defaultValue={editing.external_id||""}/></label><label>Modalidad<select name="employmentType" defaultValue={editing.employment_type}>{[...new Set([editing.employment_type,"Interno","Externo","Full service","Shopper cobrador"].filter(Boolean))].map(item=><option key={item}>{item}</option>)}</select></label></>}<label>Local<select name="locationId" required defaultValue={editing.location_id}>{locations.map(item=><option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}</select></label><label>Estado<select name="active" defaultValue={editing.active?"active":"inactive"}><option value="active">Activo</option><option value="inactive">Inactivo</option></select></label></div><small className="personnel-history-note">Al marcar una persona como inactiva deja de contar en la cobertura, pero se conserva su historial.</small><button className="primary save" disabled={saving}>{saving?"Guardando…":"Guardar cambios"}</button></form></div>}
  </section>;
}
