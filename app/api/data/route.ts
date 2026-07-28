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
  else if(body.action==="addLocation") result=await db.from("locations").insert({name:String(body.name).trim(),city:String(body.city).trim()});
  else if(body.action==="addSupervisor") result=await db.from("supervisors").insert({name:String(body.name).trim(),location_id:body.locationId});
  else if(body.action==="addRole") result=await db.from("roles").insert({name:String(body.name).trim(),color:body.color,counts_hours:!["Descanso","Libre","Vacaciones"].includes(String(body.name))});
  else if(body.action==="updateSupervisor") result=await db.from("supervisors").update({name:body.name,location_id:body.locationId,active:Boolean(body.active)}).eq("id",body.id);
  else return NextResponse.json({error:"Acción desconocida"},{status:400});
  if(result.error)return NextResponse.json({error:result.error.message},{status:400});
  return NextResponse.json({ok:true});
}
