"use client";

import { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx-js-style";

type LocationRow={id:number;name:string;city:string;active:number};
type CurrentUser={email:string;name:string;role:"admin"|"supervisor";locationId:number|null;locationIds:number[]};
type RatingResult={compliant_count:number;applicable_count:number;score:number;semaphore:"green"|"yellow"|"red";calculated_at:string};
type RatingEvaluation={
  id:number;location_id:number;location_name:string;city:string;week_start:string;week_end:string;
  visit_date:string;next_visit_date:string|null;administrator_name:string;administrator_position:string;administrator_phone:string;
  metrics_socialized:boolean;
  rule_compliance:boolean|null;uniform_compliance:boolean|null;ethics_compliance:boolean|null;
  punctuality_compliance:boolean|null;no_team_complaints:boolean|null;
  particular_observations:string;observations:string;local_feedback:string;supervisor_feedback:string;
  submitted_by_name:string;submitted_by_email:string;last_updated_by_name:string;
  submitted_at:string;updated_at:string;result?:RatingResult|null;
};
type Props={
  locations:LocationRow[];
  currentUser:CurrentUser;
  apiFetch:(path:string,init?:RequestInit)=>Promise<Response>;
  setNotice:(message:string)=>void;
};
type Editor={location:LocationRow;evaluation?:RatingEvaluation};

const criteria=[
  ["rule_compliance","Cumplimiento horario de cajeros y apertura del local en el horario establecido"],
  ["uniform_compliance","Apertura para corrección de inventarios (OOS)"],
  ["ethics_compliance","Stock del Local (status de las perchas)"],
  ["punctuality_compliance","Apertura a sacar productos de bodega"],
  ["no_team_complaints","Trato del personal del local"]
] as const;

function moveDate(value:string,days:number){
  const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);
}
function mondayFor(value:string){
  const date=new Date(`${value}T12:00:00Z`),day=date.getUTCDay()||7;date.setUTCDate(date.getUTCDate()-day+1);return date.toISOString().slice(0,10);
}
function firstMonday(year:number){
  let date=`${year}-01-01`;while(new Date(`${date}T12:00:00Z`).getUTCDay()!==1)date=moveDate(date,1);return date;
}
function weeksFor(year:number){
  const values:string[]=[];for(let date=firstMonday(year);date.startsWith(String(year));date=moveDate(date,7))values.push(date);return values;
}
function dateLabel(value:string){
  return new Intl.DateTimeFormat("es-EC",{day:"2-digit",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(`${value}T12:00:00Z`));
}
function timeLabel(value:string){
  return new Intl.DateTimeFormat("es-EC",{dateStyle:"medium",timeStyle:"short"}).format(new Date(value));
}
function criterionLabel(value:boolean|null){return value===true?"Cumple":value===false?"No cumple":"No aplica";}
function semaphoreLabel(value:RatingResult["semaphore"]){return value==="green"?"Verde":value==="yellow"?"Amarillo":"Rojo";}
function safeName(value:string){return value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/gi,"_").replace(/^_|_$/g,"");}
function compactDate(value:string|null){
  if(!value)return "";
  const [year,month,day]=value.split("-").map(Number);
  const months=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
  return `${day}${months[month-1]||""}`;
}
function visitFrequency(visitDate:string,nextVisitDate:string|null){
  if(!nextVisitDate)return "";
  const start=new Date(`${visitDate}T12:00:00Z`).getTime(),end=new Date(`${nextVisitDate}T12:00:00Z`).getTime();
  const days=Math.round((end-start)/86400000);
  return `${days} ${days===1?"día":"días"}`;
}
function numericCriterion(value:boolean|null){return value===true?1:value===false?0:"N/A";}

function decorateSheet(sheet:XLSX.WorkSheet,widths:number[]){
  sheet["!cols"]=widths.map(wch=>({wch}));
  const range=XLSX.utils.decode_range(sheet["!ref"]||"A1:A1");
  for(let column=range.s.c;column<=range.e.c;column++){
    const cell=sheet[XLSX.utils.encode_cell({r:0,c:column})];
    if(cell)cell.s={font:{bold:true,color:{rgb:"FFFFFF"}},fill:{fgColor:{rgb:"6F2C91"}},alignment:{horizontal:"center"}};
  }
}

async function downloadWorkbook(workbook:XLSX.WorkBook,filename:string,title:string){
  const bytes=XLSX.write(workbook,{bookType:"xlsx",type:"array",cellStyles:true});
  const blob=new Blob([bytes],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
  const file=new File([blob],filename,{type:blob.type});
  if(navigator.share&&navigator.canShare?.({files:[file]})){
    try{await navigator.share({files:[file],title});return;}catch(error){if(error instanceof DOMException&&error.name==="AbortError")throw error;}
  }
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function evaluationSheet(evaluation:RatingEvaluation,includeResult:boolean){
  const result=evaluation.result;
  const rows:(string|number)[][]=[
    ["CALIFICACIÓN AL ADMINISTRADOR"],
    ["FECHA DE VISITA",evaluation.visit_date,"PRÓXIMA VISITA",evaluation.next_visit_date||""],
    ["LOCAL",evaluation.location_name,"ADMINISTRADOR",evaluation.administrator_name],
    ["PUESTO O FUNCIÓN",evaluation.administrator_position,"TELÉFONO",evaluation.administrator_phone||"Sin registrar"],
    ["SEMANA",`${evaluation.week_start} al ${evaluation.week_end}`],
    [],
    ["CHECK LIST","RESPUESTA"],
    ...criteria.map(([key,label])=>[label,criterionLabel(evaluation[key])]),
  ];
  if(includeResult&&result){
    rows.push([], ["CALIFICACIÓN",result.score], ["SEMÁFORO",semaphoreLabel(result.semaphore)]);
  }
  rows.push(
    [],
    ["OBSERVACIONES PARTICULARES",evaluation.particular_observations],
    ["OBSERVACIONES",evaluation.observations],
    ["FEEDBACK LOCAL",evaluation.local_feedback],
    ["SUPERVISOR QUE CALIFICA",evaluation.submitted_by_name],
    ["FEEDBACK SUPERVISOR",evaluation.supervisor_feedback],
    ["FECHA Y HORA DE ENVÍO",timeLabel(evaluation.submitted_at)]
  );
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  decorateSheet(sheet,[42,34,24,34]);
  sheet["!merges"]=[XLSX.utils.decode_range("A1:D1")];
  return sheet;
}

function supervisorReportSheet(evaluation:RatingEvaluation){
  const rows:(string|number)[][]=[
    ["FECHA DE\nVISITA","PROXIM\nA\nVISITA","LOCAL","ADMINISTRADO\nR","TELÉFONO","PERIODICI\nDAD DE\nVISITA","CHECK LIST","CALIFICA\nCIÓN","OBSERVACIONES","Supervisor","Feedback Supervisor"],
    [compactDate(evaluation.visit_date),compactDate(evaluation.next_visit_date),evaluation.location_name,evaluation.administrator_name,evaluation.administrator_phone,visitFrequency(evaluation.visit_date,evaluation.next_visit_date),`1. ${criteria[0][1]}`,numericCriterion(evaluation.rule_compliance),evaluation.observations,evaluation.submitted_by_name,evaluation.supervisor_feedback],
    ["","","","","","",`2. ${criteria[1][1]}`,numericCriterion(evaluation.uniform_compliance),"","",""],
    ["","","","","","",`3. ${criteria[2][1]}`,numericCriterion(evaluation.ethics_compliance),"","",""],
    ["","","","","","",`4. ${criteria[3][1]}`,numericCriterion(evaluation.punctuality_compliance),"","",""],
    ["","","","","","",`5. ${criteria[4][1]}`,numericCriterion(evaluation.no_team_complaints),"","",""]
  ];
  const sheet=XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"]=[82,61,63,109,99,74,299,66,316,100,253].map(wpx=>({wpx}));
  sheet["!rows"]=[{hpt:33},{hpt:11.25},{hpt:11.25},{hpt:12},{hpt:46.5},{hpt:12}];
  sheet["!merges"]=["A2:A6","B2:B6","C2:C6","D2:D6","E2:E6","F2:F6","I2:I6","J2:J6","K2:K6"].map(XLSX.utils.decode_range);
  const black={rgb:"000000"},thin={style:"thin",color:black};
  const whiteFill={patternType:"solid",fgColor:{rgb:"FFFFFF"},bgColor:{rgb:"FFFFFF"}};
  const headerStyle={font:{name:"Calibri",sz:11,bold:true,color:black},fill:whiteFill,alignment:{horizontal:"center",vertical:"center",wrapText:true},border:{top:thin,bottom:thin,left:thin,right:thin}};
  const centerStyle={font:{name:"Calibri",sz:9,color:black},fill:whiteFill,alignment:{horizontal:"center",vertical:"center",wrapText:true},border:{top:thin,bottom:thin,left:thin,right:thin}};
  const checklistStyle={font:{name:"Calibri",sz:9,color:black},fill:whiteFill,alignment:{horizontal:"left",vertical:"center",wrapText:false},border:{top:thin,bottom:thin,left:thin,right:thin}};
  for(let column=0;column<11;column++)sheet[XLSX.utils.encode_cell({r:0,c:column})].s=headerStyle;
  for(let row=1;row<=5;row++){
    for(let column=0;column<11;column++){
      const cell=sheet[XLSX.utils.encode_cell({r:row,c:column})];
      if(cell)cell.s=column===6?checklistStyle:centerStyle;
    }
  }
  sheet.E2.s={...centerStyle,numFmt:"@"};
  sheet["!pageSetup"]={orientation:"landscape",fitToWidth:1,fitToHeight:1,paperSize:9};
  sheet["!margins"]={left:0.2,right:0.2,top:0.3,bottom:0.3,header:0,footer:0};
  return sheet;
}

export default function AdministratorRatings({locations,currentUser,apiFetch,setNotice}:Props){
  const isAdmin=currentUser.role==="admin";
  const today=new Date().toLocaleDateString("en-CA");
  const currentYear=new Date().getFullYear();
  const [year,setYear]=useState(Math.max(2026,currentYear));
  const [weekStart,setWeekStart]=useState(()=>mondayFor(today));
  const [evaluations,setEvaluations]=useState<RatingEvaluation[]>([]);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [editor,setEditor]=useState<Editor|null>(null);
  const [detail,setDetail]=useState<RatingEvaluation|null>(null);
  const [reportLocationId,setReportLocationId]=useState<number>(locations[0]?.id||0);
  const yearWeeks=useMemo(()=>weeksFor(year),[year]);
  const weekEnd=moveDate(weekStart,6);

  async function loadEvaluations(){
    setLoading(true);
    try{
      const response=await apiFetch(`/api/administrator-ratings?year=${year}`);
      const payload=await response.json().catch(()=>({error:"No se pudo cargar el historial"})) as {evaluations?:RatingEvaluation[];error?:string};
      if(!response.ok){setNotice(`Error: ${payload.error||"No se pudo cargar el historial"}`);return;}
      setEvaluations(payload.evaluations||[]);
    }catch{setNotice("Error: no se pudo cargar la calificación del administrador");}
    finally{setLoading(false);}
  }

  useEffect(()=>{void loadEvaluations();},[year]);
  useEffect(()=>{
    const current=mondayFor(today);
    setWeekStart(current.startsWith(String(year))&&weeksFor(year).includes(current)?current:firstMonday(year));
  },[year]);
  useEffect(()=>{
    if(!locations.some(location=>location.id===reportLocationId))setReportLocationId(locations[0]?.id||0);
  },[locations,reportLocationId]);

  const selectedByLocation=useMemo(()=>new Map(evaluations.filter(item=>item.week_start===weekStart).map(item=>[item.location_id,item])),[evaluations,weekStart]);
  const completed=selectedByLocation.size;
  const pending=Math.max(0,locations.length-completed);
  const overdue=weekEnd<today?pending:0;
  const scored=[...selectedByLocation.values()].map(item=>item.result?.score).filter((score):score is number=>typeof score==="number");
  const average=scored.length?Math.round(scored.reduce((sum,score)=>sum+score,0)/scored.length*10)/10:0;

  async function saveEvaluation(form:FormData){
    if(!editor)return;
    setSaving(true);
    const body:Record<string,unknown>={
      locationId:editor.location.id,weekStart,
      visitDate:form.get("visitDate"),nextVisitDate:form.get("nextVisitDate"),
      administratorName:form.get("administratorName"),administratorPosition:form.get("administratorPosition"),administratorPhone:form.get("administratorPhone"),
      metricsSocialized:form.get("metricsSocialized"),
      particularObservations:form.get("particularObservations"),observations:form.get("observations"),
      localFeedback:form.get("localFeedback"),supervisorFeedback:form.get("supervisorFeedback")
    };
    criteria.forEach(([key])=>{body[key]=form.get(key);});
    try{
      const response=await apiFetch("/api/administrator-ratings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
      const raw=await response.text();
      const payload=(()=>{try{return JSON.parse(raw) as {error?:string};}catch{return {} as {error?:string};}})();
      if(!response.ok){setNotice(`Error: ${payload.error||`No se pudo guardar la evaluación (HTTP ${response.status})`}`);return;}
      setEditor(null);setNotice("✓ Evaluación enviada y guardada en el histórico");await loadEvaluations();
    }catch(error){setNotice(`Error: ${error instanceof Error?error.message:"No se pudo guardar la evaluación"}`);}
    finally{setSaving(false);}
  }

  async function downloadSupervisorReport(evaluation:RatingEvaluation){
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,supervisorReportSheet(evaluation),"Calificación");
    try{
      await downloadWorkbook(workbook,`Evaluacion_Administrador_${safeName(evaluation.location_name)}_${evaluation.week_start}.xlsx`,"Reporte de evaluación");
      setNotice("✓ Reporte de entrega generado");
    }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))setNotice("Error: no se pudo generar el reporte");}
  }

  async function downloadAdminReport(){
    const location=locations.find(item=>item.id===reportLocationId);
    const rows=evaluations.filter(item=>item.location_id===reportLocationId).sort((a,b)=>a.week_start.localeCompare(b.week_start));
    if(!location){setNotice("Selecciona un local para generar el reporte");return;}
    if(!rows.length){setNotice("Ese local todavía no tiene evaluaciones en el año seleccionado");return;}
    const summaryRows:(string|number)[][]=[
      ["RESUMEN PROGRESIVO · CALIFICACIÓN AL ADMINISTRADOR"],
      ["Semana","Fecha de visita","Próxima visita","Local","Administrador","Puesto o función","Calificación","Semáforo","Observaciones","Feedback local","Supervisor que califica","Feedback supervisor","Enviado el"],
      ...rows.map(item=>[item.week_start,item.visit_date,item.next_visit_date||"",item.location_name,item.administrator_name,item.administrator_position,item.result?.score??"",item.result?semaphoreLabel(item.result.semaphore):"",item.observations,item.local_feedback,item.submitted_by_name,item.supervisor_feedback,timeLabel(item.submitted_at)])
    ];
    const summary=XLSX.utils.aoa_to_sheet(summaryRows);decorateSheet(summary,[14,15,15,28,28,24,14,13,34,34,26,34,22]);summary["!merges"]=[XLSX.utils.decode_range("A1:M1")];
    const selectedMonth=weekStart.slice(0,7);
    const fortnightRows=rows.filter(item=>item.week_start.slice(0,7)===selectedMonth).slice(-2);
    const fortnight=XLSX.utils.aoa_to_sheet([
      ["CORTE QUINCENAL",location.name,selectedMonth],
      ["Semana","Administrador","Calificación","Semáforo","Supervisor","Observaciones"],
      ...fortnightRows.map(item=>[item.week_start,item.administrator_name,item.result?.score??"",item.result?semaphoreLabel(item.result.semaphore):"",item.submitted_by_name,item.observations])
    ]);decorateSheet(fortnight,[15,28,14,13,26,42]);
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,summary,"Resumen Progresivo");
    XLSX.utils.book_append_sheet(workbook,fortnight,"Corte Quincenal");
    rows.forEach((item,index)=>XLSX.utils.book_append_sheet(workbook,evaluationSheet(item,true),`S${String(index+1).padStart(2,"0")}`));
    try{
      await downloadWorkbook(workbook,`Calificacion_Administrador_${safeName(location.name)}_${year}.xlsx`,"Histórico de calificaciones");
      setNotice("✓ Excel anual completo generado");
    }catch(error){if(!(error instanceof DOMException&&error.name==="AbortError"))setNotice("Error: no se pudo generar el Excel anual");}
  }

  return <section className="rating-module">
    <div className="rating-hero">
      <div><span className="rating-eyebrow">CONTROL SEMANAL</span><h2>Calificación del administrador</h2><p>{isAdmin?"Seguimiento privado de todos los locales, entregas y resultados del año.":"Completa la evaluación de cada local asignado y genera el reporte de tu entrega."}</p></div>
      <span className="rating-privacy">🔒 {isAdmin?"Resultados visibles solo para administrador":"Tu envío no muestra la calificación"}</span>
    </div>
    <div className="rating-toolbar">
      <label>Año<select value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:Math.max(2,currentYear-2024)},(_,index)=>2026+index).filter(value=>value<=currentYear+1).map(value=><option key={value}>{value}</option>)}</select></label>
      <label>Semana<select value={weekStart} onChange={event=>setWeekStart(event.target.value)}>{yearWeeks.map(value=><option key={value} value={value}>{dateLabel(value)} — {dateLabel(moveDate(value,6))}</option>)}</select></label>
      {isAdmin&&<label>Local para Excel<select value={reportLocationId} onChange={event=>setReportLocationId(Number(event.target.value))}>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>}
      {isAdmin&&<button className="primary rating-download" onClick={()=>void downloadAdminReport()}>⇩ Excel anual</button>}
    </div>

    {isAdmin&&<div className="rating-kpis">
      <article><span>Locales esperados</span><strong>{locations.length}</strong><small>Semana seleccionada</small></article>
      <article><span>Entregados</span><strong>{completed}</strong><small className="rating-ok">Registrados con fecha y autor</small></article>
      <article><span>Pendientes</span><strong>{pending}</strong><small className={overdue?"rating-alert":""}>{overdue?`${overdue} vencidos`:"Semana abierta"}</small></article>
      <article><span>Promedio privado</span><strong>{scored.length?`${average}%`:"—"}</strong><small>Solo visible para ti</small></article>
    </div>}

    <div className="rating-table-card">
      <div className="rating-table-headline"><div><h3>{dateLabel(weekStart)} — {dateLabel(weekEnd)}</h3><p>{loading?"Cargando histórico…":isAdmin?"Revisión de cumplimiento de todos los locales":"Evaluaciones disponibles para tus locales asignados"}</p></div><span>{completed}/{locations.length} enviados</span></div>
      <div className="table-wrap">
        <table className="rating-table">
          <thead><tr><th>Local</th><th>Estado</th>{isAdmin&&<><th>Supervisor que evaluó</th><th>Enviado</th><th>Resultado</th></>}<th>Acciones</th></tr></thead>
          <tbody>{locations.map(location=>{
            const evaluation=selectedByLocation.get(location.id);
            const isLate=!evaluation&&weekEnd<today;
            return <tr key={location.id}>
              <td><strong>{location.name}</strong><small>{location.city}</small></td>
              <td><span className={`rating-status ${evaluation?"submitted":isLate?"late":"pending"}`}>{evaluation?"Enviado":isLate?"Vencido":"Pendiente"}</span></td>
              {isAdmin&&<><td>{evaluation?<><strong>{evaluation.submitted_by_name}</strong><small>{evaluation.last_updated_by_name!==evaluation.submitted_by_name?`Actualizó: ${evaluation.last_updated_by_name}`:evaluation.submitted_by_email}</small></>:"—"}</td><td>{evaluation?<><strong>{timeLabel(evaluation.submitted_at)}</strong><small>{evaluation.updated_at!==evaluation.submitted_at?`Editado ${timeLabel(evaluation.updated_at)}`:"Registro original"}</small></>:"—"}</td><td>{evaluation?.result?<span className={`rating-score ${evaluation.result.semaphore}`}><strong>{evaluation.result.score}%</strong><small>{semaphoreLabel(evaluation.result.semaphore)}</small></span>:"—"}</td></>}
              <td><div className="rating-actions">{isAdmin?evaluation&&<button onClick={()=>setDetail(evaluation)}>Ver evaluación</button>:<><button className="rating-edit" onClick={()=>setEditor({location,evaluation})}>{evaluation?"Editar entrega":"Completar"}</button>{evaluation&&<button onClick={()=>void downloadSupervisorReport(evaluation)}>Generar reporte</button>}</>}</div></td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </div>

    {!isAdmin&&<div className="rating-safe-note"><strong>Tu resultado permanece privado.</strong><span>Puedes revisar y corregir lo que enviaste, pero el sistema no te mostrará puntaje, porcentaje, semáforo ni resultados históricos.</span></div>}

    {editor&&<div className="modal-backdrop" onMouseDown={()=>!saving&&setEditor(null)}><form className="modal rating-form" onSubmit={event=>{event.preventDefault();void saveEvaluation(new FormData(event.currentTarget));}} onMouseDown={event=>event.stopPropagation()}>
      <button type="button" className="close" disabled={saving} onClick={()=>setEditor(null)}>×</button>
      <span className="modal-kicker">SEMANA {weekStart}</span><h2>{editor.location.name}</h2><p>Completa el checklist. La calificación calculada será visible únicamente para el administrador.</p>
      <div className="rating-form-grid"><label>Fecha de visita<input name="visitDate" type="date" min={weekStart} max={weekEnd} required defaultValue={editor.evaluation?.visit_date||(today>=weekStart&&today<=weekEnd?today:weekStart)}/></label><label>Próxima visita<input name="nextVisitDate" type="date" min={editor.evaluation?.visit_date||weekStart} defaultValue={editor.evaluation?.next_visit_date||""}/></label><label>Persona evaluada<input name="administratorName" required defaultValue={editor.evaluation?.administrator_name||""}/></label><label>Puesto o función<input name="administratorPosition" required placeholder="Ej. Administrador, encargado o jefe de local" defaultValue={editor.evaluation?.administrator_position||""}/></label><label>Teléfono<input name="administratorPhone" defaultValue={editor.evaluation?.administrator_phone||""}/></label><label>¿Se socializaron métricas con el administrador?<select name="metricsSocialized" required defaultValue={editor.evaluation?editor.evaluation.metrics_socialized?"true":"false":""}><option value="" disabled>Selecciona</option><option value="true">Sí</option><option value="false">No</option></select></label></div>
      <fieldset className="rating-checklist"><legend>Checklist de evaluación</legend>{criteria.map(([key,label])=><label key={key}><span>{label}</span><select name={key} required defaultValue={editor.evaluation?editor.evaluation[key]===true?"true":editor.evaluation[key]===false?"false":"na":""}><option value="" disabled>Selecciona</option><option value="true">Cumple</option><option value="false">No cumple</option><option value="na">No aplica</option></select></label>)}</fieldset>
      <label>Observaciones particulares<textarea name="particularObservations" rows={2} defaultValue={editor.evaluation?.particular_observations||""}/></label>
      <label>Observaciones<textarea name="observations" rows={2} defaultValue={editor.evaluation?.observations||""}/></label>
      <label>Feedback del local<textarea name="localFeedback" rows={2} defaultValue={editor.evaluation?.local_feedback||""}/></label>
      <label>Feedback del supervisor<textarea name="supervisorFeedback" rows={2} defaultValue={editor.evaluation?.supervisor_feedback||""}/></label>
      <button className="primary save" disabled={saving}>{saving?"Enviando…":editor.evaluation?"Guardar corrección":"Enviar evaluación"}</button>
    </form></div>}

    {detail&&<div className="modal-backdrop" onMouseDown={()=>setDetail(null)}><div className="modal rating-detail" onMouseDown={event=>event.stopPropagation()}>
      <button type="button" className="close" onClick={()=>setDetail(null)}>×</button><span className="modal-kicker">RESULTADO PRIVADO</span><h2>{detail.location_name}</h2><p>{detail.administrator_name} · {detail.administrator_position} · Semana {detail.week_start}</p>
      {detail.result&&<div className={`rating-detail-score ${detail.result.semaphore}`}><strong>{detail.result.score}%</strong><span>{semaphoreLabel(detail.result.semaphore)} · {detail.result.compliant_count} de {detail.result.applicable_count} criterios</span></div>}
      <div className="rating-detail-list">{criteria.map(([key,label])=><div key={key}><span>{label}</span><strong className={detail[key]===true?"yes":detail[key]===false?"no":"na"}>{criterionLabel(detail[key])}</strong></div>)}</div>
      <div className="rating-detail-notes"><p><strong>Métricas socializadas</strong>{detail.metrics_socialized?"Sí":"No"}</p><p><strong>Observaciones particulares</strong>{detail.particular_observations||"Sin observaciones"}</p><p><strong>Observaciones</strong>{detail.observations||"Sin observaciones"}</p><p><strong>Feedback local</strong>{detail.local_feedback||"Sin feedback"}</p><p><strong>Feedback supervisor</strong>{detail.supervisor_feedback||"Sin feedback"}</p></div>
      <div className="rating-audit"><strong>{detail.submitted_by_name}</strong><span>{detail.submitted_by_email} · {timeLabel(detail.submitted_at)}</span></div>
    </div></div>}
  </section>;
}
