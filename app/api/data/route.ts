import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function client(request:NextRequest) {
  const token=request.headers.get("x-supabase-token")||"";
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}}
  );
}
function tone(value:string,name:string) {
  if (["Libre","Descanso","Vacaciones"].includes(name)) return "yellow";
  if (value.includes("dcfce7")||value==="green") return "green";
  if (value.includes("fed7aa")||value==="orange") return "orange";
  if (value.includes("f3e8ff")||value==="purple") return "purple";
  return "blue";
}
function workedHours(start:string|null,end:string|null,counts:boolean) {
  if (!counts||!start||!end) return 0;
  const [sh,sm]=start.split(":").map(Number),[eh,em]=end.split(":").map(Number);
  let minutes=eh*60+em-sh*60-sm;if(minutes<0)minutes+=1440;
  return Math.round(minutes/60*100)/100;
}
function isDate(value:unknown){
  const date=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(`${date}T12:00:00`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}
function moveDate(value:string,days:number){
  const date=new Date(`${value}T12:00:00`);
  date.setDate(date.getDate()+days);
  return date.toISOString().slice(0,10);
}
const regionalLocations=[
  ["MX. Village Plaza","Guayaquil"],["SX. Plaza Batán","Guayaquil"],
  ["SX. Villa Club","Guayaquil"],["MX. Ceibos","Guayaquil"],
  ["SX. Ciudad Celeste","Guayaquil"],["MX. City Mall","Guayaquil"],
  ["MX. Mall del Sol","Guayaquil"],["SX. Vistana","Guayaquil"],
  ["SX. Vía a la Costa","Guayaquil"],["MX. Mall del Norte","Guayaquil"],
  ["MX. Mall del Sur","Guayaquil"],["Akí Astillero","Guayaquil"],
  ["Akí Mapasingue","Guayaquil"],["Akí La Joya","Guayaquil"],
  ["MX. Wayra","Cuenca"],["SX. Vergel","Cuenca"],
  ["SX. Don Bosco","Cuenca"],["SX. Chaullabamba","Cuenca"],
  ["Super Akí Narancay","Cuenca"],["SX. Pradera","Cuenca"],
  ["MX. Mall del Pacífico","Manta"],["Supermaxi Salinas","Salinas"],
  ["Akí Pedernales","Pedernales"]
].map(([name,city])=>({name,city,active:true}));

export async function GET(request:NextRequest) {
  const db=client(request);
  const token=request.headers.get("x-supabase-token")||"";
  const {data:{user},error:userError}=await db.auth.getUser(token);
  if(userError||!user) return NextResponse.json({error:"Sesión no válida"},{status:401});
  const {data:profile,error:profileError}=await db.from("profiles").select("*").eq("id",user.id).single();
  if(profileError||!profile) return NextResponse.json({error:"Usuario no autorizado"},{status:403});
  if(!profile.active) return NextResponse.json({error:"Usuario pendiente de activación"},{status:403});
  const {data:locationGrants}=await db.from("profile_locations").select("location_id").eq("profile_id",user.id);
  const locationIds=(locationGrants||[]).map((x:any)=>Number(x.location_id));
  if(profile.app_role==="admin"){
    await db.from("locations").update({name:"MX. Village Plaza",city:"Guayaquil"}).eq("name","Village Plaza");
    await db.from("locations").update({active:false}).in("name",["El Recreo","El Bosque","Quicentro Sur","Quicentro Shopping","Scala Shopping","Condado Shopping"]);
    const {error:seedError}=await db.from("locations").upsert(regionalLocations,{onConflict:"name"});
    if(seedError)return NextResponse.json({error:seedError.message},{status:400});
  }
  const [{data:locations,error:le},{data:roles,error:re},{data:supervisors,error:se},{data:assignments,error:ae}]=await Promise.all([
    db.from("locations").select("*").eq("active",true).order("name"),
    db.from("roles").select("*").eq("active",true).order("name"),
    db.from("supervisors").select("*,locations(name,city)").order("name"),
    db.from("assignments").select("*,roles(name,color,counts_hours)").order("work_date")
  ]);
  const failure=le||re||se||ae;if(failure)return NextResponse.json({error:failure.message},{status:400});
  return NextResponse.json({
    locations:(locations||[]).map((x:any)=>({...x,active:x.active?1:0})),
    roles:(roles||[]).map((x:any)=>({...x,color:tone(x.color,x.name),active:x.active?1:0})),
    supervisors:(supervisors||[]).map((x:any)=>({...x,location_name:x.locations?.name||"",city:x.locations?.city||"",active:x.active?1:0})),
    assignments:(assignments||[]).map((x:any)=>({...x,role_name:x.roles?.name||"",color:tone(x.roles?.color||"",x.roles?.name||""),hours:workedHours(x.start_time,x.end_time,x.roles?.counts_hours!==false)})),
    currentUser:{email:profile.email,name:profile.full_name||profile.email,role:profile.app_role,locationId:profile.location_id,locationIds}
  });
}

export async function POST(request:NextRequest) {
  const db=client(request);const body=await request.json();
  let result;
  if(body.action==="saveAssignment") result=await db.from("assignments").upsert({
    supervisor_id:body.supervisorId,work_date:body.workDate,start_time:body.start,end_time:body.end,role_id:body.roleId,updated_at:new Date().toISOString()
  },{onConflict:"supervisor_id,work_date"});
  else if(body.action==="fillAssignments"){
    const assignments=Array.isArray(body.assignments)?body.assignments:[];
    if(!assignments.length||assignments.length>200)return NextResponse.json({error:"Selecciona entre 1 y 200 filas para copiar"},{status:400});
    const rows=assignments.map((assignment:any)=>({
      supervisor_id:Number(assignment.supervisorId),work_date:String(assignment.workDate||""),
      start_time:assignment.start===null?null:String(assignment.start||""),end_time:assignment.end===null?null:String(assignment.end||""),
      role_id:Number(assignment.roleId),updated_at:new Date().toISOString()
    }));
    const invalid=rows.some((row:any)=>!Number.isFinite(row.supervisor_id)||!Number.isFinite(row.role_id)||!isDate(row.work_date)
      ||(row.start_time!==null&&!/^\d{2}:\d{2}$/.test(row.start_time))||(row.end_time!==null&&!/^\d{2}:\d{2}$/.test(row.end_time)));
    if(invalid)return NextResponse.json({error:"Uno de los turnos seleccionados no es válido"},{status:400});
    result=await db.from("assignments").upsert(rows,{onConflict:"supervisor_id,work_date"});
    if(result.error)return NextResponse.json({error:result.error.message},{status:400});
    return NextResponse.json({ok:true,copied:rows.length});
  }
  else if(body.action==="addLocation") result=await db.from("locations").insert({name:String(body.name).trim(),city:String(body.city).trim()});
  else if(body.action==="addSupervisor"){
    const activeFrom=isDate(body.weekStart)?String(body.weekStart):"2026-07-27";
    const activeUntil=isDate(body.weekEnd)?String(body.weekEnd):moveDate(activeFrom,6);
    result=await db.from("supervisors").insert({
      name:String(body.name).trim(),location_id:body.locationId,active:true,active_from:activeFrom,active_until:activeUntil
    });
  }
  else if(body.action==="addRole") result=await db.from("roles").insert({name:String(body.name).trim(),color:body.color,counts_hours:!["Descanso","Libre","Vacaciones"].includes(String(body.name))});
  else if(body.action==="updateRole"){
    const name=String(body.name||"").trim();
    if(name.length<2)return NextResponse.json({error:"Escribe un nombre válido para el rol"},{status:400});
    result=await db.from("roles").update({name,color:String(body.color||"blue"),counts_hours:!["Descanso","Libre","Vacaciones"].includes(name),active:true}).eq("id",Number(body.id));
  }
  else if(body.action==="archiveRole") result=await db.from("roles").update({active:false}).eq("id",Number(body.id));
  else if(body.action==="updateSupervisor"){
    const changes:Record<string,unknown>={name:String(body.name).trim(),location_id:Number(body.locationId)};
    if(body.active!==undefined)changes.active=Boolean(Number(body.active));
    result=await db.from("supervisors").update(changes).eq("id",body.id);
  }
  else if(body.action==="removeSupervisorFromWeek"){
    if(!isDate(body.weekStart))return NextResponse.json({error:"La semana seleccionada no es válida"},{status:400});
    result=await db.from("supervisors").update({active:false,active_until:moveDate(String(body.weekStart),-1)}).eq("id",body.id);
  }
  else if(body.action==="copyWeek"){
    const sourceStart=String(body.sourceStart),targetStart=String(body.targetStart);
    if(!isDate(sourceStart)||!isDate(targetStart))return NextResponse.json({error:"La semana seleccionada no es válida"},{status:400});
    const sourceEnd=moveDate(sourceStart,6),targetEnd=moveDate(targetStart,6);
    const {data:localSupervisors,error:supervisorError}=await db.from("supervisors").select("id,active_until").eq("location_id",body.locationId).lte("active_from",sourceEnd).or(`active_until.is.null,active_until.gte.${sourceStart}`);
    if(supervisorError)return NextResponse.json({error:supervisorError.message},{status:400});
    const supervisorIds=(localSupervisors||[]).map((s:any)=>s.id);
    if(!supervisorIds.length)return NextResponse.json({error:"El local no tiene filas de supervisores activas."},{status:400});
    const {data:source,error:sourceError}=await db.from("assignments").select("supervisor_id,work_date,start_time,end_time,role_id,notes").in("supervisor_id",supervisorIds).gte("work_date",sourceStart).lte("work_date",sourceEnd);
    if(sourceError)return NextResponse.json({error:sourceError.message},{status:400});
    const offset=Math.round((new Date(`${targetStart}T12:00:00`).getTime()-new Date(`${sourceStart}T12:00:00`).getTime())/86400000);
    const copied=(source||[]).map((assignment:any)=>{
      const date=new Date(`${assignment.work_date}T12:00:00`);date.setDate(date.getDate()+offset);
      return {...assignment,work_date:date.toISOString().slice(0,10),updated_at:new Date().toISOString()};
    });
    if(copied.length){
      const {error:copyError}=await db.from("assignments").upsert(copied,{onConflict:"supervisor_id,work_date"});
      if(copyError)return NextResponse.json({error:copyError.message},{status:400});
    }
    const extendIds=(localSupervisors||[]).filter((s:any)=>s.active_until&&s.active_until<=sourceEnd).map((s:any)=>s.id);
    if(extendIds.length){
      const {error:extendError}=await db.from("supervisors").update({active:true,active_until:targetEnd}).in("id",extendIds);
      if(extendError)return NextResponse.json({error:extendError.message},{status:400});
    }
    return NextResponse.json({ok:true,copied:copied.length});
  }
  else return NextResponse.json({error:"Acción desconocida"},{status:400});
  if(result.error)return NextResponse.json({error:result.error.message},{status:400});
  return NextResponse.json({ok:true});
}
