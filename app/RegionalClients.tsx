"use client";

import {useEffect,useMemo,useState} from "react";
import {supabase} from "@/lib/supabase";

type Location={id:number;name:string;city:string};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type ClientType="potential"|"blacklist";
type ClientRow={
  id:number;client_type:ClientType;client_external_id:string;client_name:string;city:string;sector:string;
  estimated_orders:number|null;responsible:string;observations:string;next_action:string;next_action_date:string|null;
  potential_status:"pending"|"contacted"|"interested"|"converted"|"discarded";
  blacklist_reason:string;order_reference:string;evidence_paths:string[];evidence_urls:string[];
  blacklist_status:"pending"|"restricted"|"enabled"|"rejected";submitted_by:string;submitted_by_name:string;created_at:string;
};
type Props={locations:Location[];currentUser:CurrentUser;apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;setNotice:(value:string)=>void};

const potentialLabels={pending:"Pendiente",contacted:"Contactado",interested:"Interesado",converted:"Convertido",discarded:"Descartado"} as const;
const blacklistLabels={pending:"Pendiente de aprobación",restricted:"Restringido",enabled:"Habilitado",rejected:"Rechazado"} as const;
function formatDate(value:string|null){if(!value)return "Sin fecha";return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value.slice(0,10)}T12:00:00Z`));}

export default function RegionalClients({locations,currentUser,apiFetch,setNotice}:Props){
  const [tab,setTab]=useState<ClientType>("potential"),[clients,setClients]=useState<ClientRow[]>([]),[currentUserId,setCurrentUserId]=useState("");
  const [query,setQuery]=useState(""),[loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[modal,setModal]=useState(false),[editing,setEditing]=useState<ClientRow|null>(null),[files,setFiles]=useState<File[]>([]);
  const isAdmin=currentUser.role==="admin";
  const cityOptions=useMemo(()=>[...new Set(locations.map(item=>item.city).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"es")),[locations]);
  const visible=useMemo(()=>clients.filter(row=>row.client_type===tab).filter(row=>{
    const term=query.trim().toLocaleLowerCase("es");
    return !term||[row.client_external_id,row.client_name,row.city,row.sector].some(value=>value.toLocaleLowerCase("es").includes(term));
  }),[clients,tab,query]);
  const potential=clients.filter(row=>row.client_type==="potential"),blacklist=clients.filter(row=>row.client_type==="blacklist");

  async function load(){
    setLoading(true);
    try{
      const response=await apiFetch(`/api/regional-clients?refresh=${Date.now()}`),payload=await response.json().catch(()=>({error:"No se pudo cargar"})) as {clients?:ClientRow[];currentUserId?:string;error?:string};
      if(!response.ok)throw new Error(payload.error||"No se pudo cargar la gestión de clientes");
      setClients(payload.clients||[]);setCurrentUserId(payload.currentUserId||"");
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo cargar la gestión de clientes"}`);}finally{setLoading(false);}
  }
  useEffect(()=>{void load();},[]);

  function openCreate(type:ClientType){setTab(type);setEditing(null);setFiles([]);setModal(true);}
  function openEdit(row:ClientRow){setEditing(row);setFiles([]);setModal(true);}

  async function uploadEvidence(type:ClientType){
    if(!files.length)return editing?.evidence_paths||[];
    if(files.length>10)throw new Error("Puedes subir máximo 10 fotografías");
    const invalid=files.find(file=>file.size>8*1024*1024||!file.type.startsWith("image/"));
    if(invalid)throw new Error(invalid.size>8*1024*1024?"Cada fotografía puede pesar máximo 8 MB":"Las evidencias deben ser fotografías");
    const {data:{user}}=await supabase.auth.getUser();if(!user)throw new Error("Sesión no válida");
    const paths:string[]=[];
    for(const [index,file] of files.entries()){
      const extension=(file.name.split(".").pop()||"jpg").replace(/[^a-z0-9]/gi,"").toLowerCase().slice(0,8)||"jpg";
      const path=`${user.id}/clients/${type}-${Date.now()}-${index}.${extension}`;
      const {error}=await supabase.storage.from("regional-evidence").upload(path,file,{contentType:file.type,upsert:false});
      if(error)throw new Error(`No se pudo subir ${file.name}: ${error.message}`);paths.push(path);
    }
    return paths;
  }

  async function save(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(saving)return;setSaving(true);const form=new FormData(event.currentTarget),type=editing?.client_type||tab;
    try{
      const evidencePaths=await uploadEvidence(type);
      const response=await apiFetch("/api/regional-clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"saveClient",id:editing?.id,clientType:type,clientExternalId:editing?.client_external_id||form.get("clientExternalId"),clientName:form.get("clientName"),city:form.get("city"),sector:form.get("sector"),estimatedOrders:form.get("estimatedOrders"),responsible:form.get("responsible"),observations:form.get("observations"),nextAction:form.get("nextAction"),nextActionDate:form.get("nextActionDate"),potentialStatus:form.get("potentialStatus"),blacklistReason:form.get("blacklistReason"),orderReference:form.get("orderReference"),blacklistStatus:form.get("blacklistStatus"),evidencePaths})});
      const payload=await response.json().catch(()=>({error:"No se pudo guardar"})) as {error?:string};if(!response.ok)throw new Error(payload.error||"No se pudo guardar");
      setNotice(type==="potential"?"✓ Cliente potencial guardado":"✓ Solicitud de lista negra guardada");setModal(false);await load();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar"}`);}finally{setSaving(false);}
  }

  async function decide(row:ClientRow,status:ClientRow["blacklist_status"]){
    if(saving)return;setSaving(true);
    try{
      const response=await apiFetch("/api/regional-clients",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"decideBlacklist",id:row.id,status})});
      const payload=await response.json().catch(()=>({error:"No se pudo actualizar"})) as {error?:string};if(!response.ok)throw new Error(payload.error||"No se pudo actualizar");
      setNotice(`✓ Cliente ${blacklistLabels[status].toLocaleLowerCase("es")}`);await load();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo actualizar"}`);}finally{setSaving(false);}
  }

  return <section className="client-module">
    <div className="client-hero"><div><span>REGIÓN SUR · INFORMACIÓN COMPARTIDA</span><h2>Gestión de clientes</h2><p>Consulta y registra clientes potenciales o alertas de lista negra para que todo el equipo tenga la misma información.</p></div><button className="primary" onClick={()=>openCreate(tab)}>＋ Registrar {tab==="potential"?"potencial":"lista negra"}</button></div>
    <div className="client-kpis"><article><span>Clientes potenciales</span><strong>{potential.length}</strong><small>{potential.filter(row=>!['converted','discarded'].includes(row.potential_status)).length} en seguimiento</small></article><article><span>Convertidos</span><strong>{potential.filter(row=>row.potential_status==="converted").length}</strong><small>Oportunidades logradas</small></article><article><span>Lista negra</span><strong>{blacklist.length}</strong><small>{blacklist.filter(row=>row.blacklist_status==="restricted").length} restringidos</small></article><article><span>Por aprobar</span><strong>{blacklist.filter(row=>row.blacklist_status==="pending").length}</strong><small>Decisión del administrador</small></article></div>
    <div className="client-tabs"><button className={tab==="potential"?"active":""} onClick={()=>setTab("potential")}>Clientes potenciales <b>{potential.length}</b></button><button className={tab==="blacklist"?"active":""} onClick={()=>setTab("blacklist")}>Lista negra <b>{blacklist.length}</b></button></div>
    <div className="client-table-card"><div className="client-toolbar"><div><h3>{tab==="potential"?"Clientes potenciales":"Clientes en lista negra"}</h3><p>{tab==="potential"?"Seguimiento comercial por ciudad y sector.":"Las restricciones solo se activan después de la aprobación del administrador."}</p></div><input aria-label="Buscar clientes" value={query} onChange={event=>setQuery(event.target.value)} placeholder="⌕ Buscar por ID, nombre, ciudad o sector"/><button className="secondary" onClick={()=>openCreate(tab)}>＋ Nuevo registro</button></div>
      <div className="table-wrap"><table className="client-table"><thead><tr><th>Cliente</th><th>Ciudad / sector</th>{tab==="potential"?<><th>Pedidos</th><th>Responsable</th><th>Próxima acción</th></>:<><th>Motivo</th><th>Pedido</th><th>Evidencias</th></>}<th>Estado</th><th>Registrado por</th><th></th></tr></thead><tbody>
        {visible.length?visible.map(row=>{const canEdit=isAdmin||row.submitted_by===currentUserId;return <tr key={row.id}><td><strong>{row.client_name}</strong><small>ID: {row.client_external_id}</small></td><td><strong>{row.city}</strong><small>{row.sector||"Sin sector"}</small></td>{tab==="potential"?<><td>{row.estimated_orders??"—"}</td><td>{row.responsible||"Sin asignar"}</td><td><strong>{row.next_action||"Sin acción"}</strong><small>{formatDate(row.next_action_date)}</small></td></>:<><td className="client-reason">{row.blacklist_reason}</td><td>{row.order_reference||"—"}</td><td>{row.evidence_urls.length?<div className="client-evidence-mini">{row.evidence_urls.slice(0,3).map((url,index)=><a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Evidencia ${index+1}`}/></a>)}{row.evidence_urls.length>3&&<span>+{row.evidence_urls.length-3}</span>}</div>:"Sin fotos"}</td></>}<td><span className={`client-status ${tab==="potential"?row.potential_status:row.blacklist_status}`}>{tab==="potential"?potentialLabels[row.potential_status]:blacklistLabels[row.blacklist_status]}</span></td><td>{row.submitted_by_name}</td><td><div className="client-row-actions">{canEdit&&<button onClick={()=>openEdit(row)}>Editar</button>}{tab==="blacklist"&&isAdmin&&<>{row.blacklist_status!=="restricted"&&<button className="approve" disabled={saving} onClick={()=>void decide(row,"restricted")}>Restringir</button>}{row.blacklist_status!=="enabled"&&<button className="enable" disabled={saving} onClick={()=>void decide(row,"enabled")}>Habilitar</button>}{row.blacklist_status!=="rejected"&&<button className="reject" disabled={saving} onClick={()=>void decide(row,"rejected")}>Rechazar</button>}</>}</div></td></tr>}):<tr><td colSpan={9}><div className="client-empty">{loading?"Cargando clientes…":query?"No se encontraron clientes con esa búsqueda.":"Todavía no existen registros en este apartado."}</div></td></tr>}
      </tbody></table></div>
    </div>
    {modal&&<div className="modal-backdrop"><form className="modal client-form" onSubmit={save}><button type="button" className="close" onClick={()=>setModal(false)}>×</button><span className="client-form-eyebrow">{(editing?.client_type||tab)==="potential"?"CLIENTE POTENCIAL":"LISTA NEGRA"}</span><h2>{editing?"Editar cliente":"Registrar cliente"}</h2><p>{(editing?.client_type||tab)==="blacklist"&&!isAdmin?"La restricción quedará pendiente hasta que el administrador la apruebe.":"Completa la información para compartirla con Región Sur."}</p><div className="client-form-grid">
      <label>ID del cliente<input name="clientExternalId" defaultValue={editing?.client_external_id||""} disabled={Boolean(editing)} required/></label><label>Nombre del cliente<input name="clientName" defaultValue={editing?.client_name||""} required/></label><label>Ciudad<input name="city" list="client-cities" defaultValue={editing?.city||""} required/><datalist id="client-cities">{cityOptions.map(city=><option key={city}>{city}</option>)}</datalist></label><label>Sector<input name="sector" defaultValue={editing?.sector||""}/></label>
      {(editing?.client_type||tab)==="potential"?<><label>Pedidos estimados<input name="estimatedOrders" type="number" min="0" defaultValue={editing?.estimated_orders??""}/></label><label>Responsable<input name="responsible" defaultValue={editing?.responsible||currentUser.name}/></label><label className="wide">Observaciones<textarea name="observations" rows={3} defaultValue={editing?.observations||""}/></label><label className="wide">Próxima acción<textarea name="nextAction" rows={3} defaultValue={editing?.next_action||""}/></label><label>Fecha de próxima acción<input name="nextActionDate" type="date" defaultValue={editing?.next_action_date||""}/></label><label>Estado<select name="potentialStatus" defaultValue={editing?.potential_status||"pending"}><option value="pending">Pendiente</option><option value="contacted">Contactado</option><option value="interested">Interesado</option><option value="converted">Convertido</option><option value="discarded">Descartado</option></select></label></>:<><label className="wide">Motivo de lista negra<textarea name="blacklistReason" rows={4} defaultValue={editing?.blacklist_reason||""} required/></label><label>Referencia del pedido<input name="orderReference" defaultValue={editing?.order_reference||""}/></label>{isAdmin&&<label>Estado<select name="blacklistStatus" defaultValue={editing?.blacklist_status||"pending"}><option value="pending">Pendiente</option><option value="restricted">Restringido</option><option value="enabled">Habilitado</option><option value="rejected">Rechazado</option></select></label>}<label className="wide">Evidencias fotográficas<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif" onChange={event=>setFiles(Array.from(event.target.files||[]))}/><small>Hasta 10 fotografías · 8 MB cada una</small></label>{editing?.evidence_urls.length?<div className="client-existing-evidence wide">{editing.evidence_urls.map((url,index)=><a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`Evidencia actual ${index+1}`}/></a>)}</div>:null}</>}
    </div><button className="primary save" disabled={saving}>{saving?"Guardando…":"Guardar cliente"}</button></form></div>}
  </section>;
}
