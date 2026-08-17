import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";active:boolean};
const activityTypes=["shopper_purchase","shopper_delivery","supervisor_schedule"] as const;

function tokenFrom(request:NextRequest){return request.headers.get("x-supabase-token")?.trim()||"";}
function dbFor(request:NextRequest){
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    global:{headers:{Authorization:`Bearer ${tokenFrom(request)}`}},auth:{persistSession:false,autoRefreshToken:false}
  });
}
function isDate(value:unknown){
  const date=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}
function moveDate(value:string,days:number){const date=new Date(`${value}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
async function authenticate(request:NextRequest){
  const token=tokenFrom(request);if(!token)return {error:NextResponse.json({error:"Sesión no válida."},{status:401})};
  const db=dbFor(request),{data:{user}}=await db.auth.getUser(token);
  if(!user)return {error:NextResponse.json({error:"Sesión no válida."},{status:401})};
  const {data:profile}=await db.from("profiles").select("id,email,full_name,app_role,active").eq("id",user.id).maybeSingle();
  if(!profile?.active)return {error:NextResponse.json({error:"Usuario no autorizado."},{status:403})};
  return {db,profile:profile as Profile};
}

export async function GET(request:NextRequest){
  const auth=await authenticate(request);if(auth.error)return auth.error;
  if(auth.profile.app_role!=="admin")return NextResponse.json({error:"Este panel es privado para el administrador."},{status:403});
  const year=Number(request.nextUrl.searchParams.get("year")||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2026||year>2100)return NextResponse.json({error:"Año no válido."},{status:400});
  const first=`${year}-01-01`,last=`${year}-12-31`;
  const [{data:submissions,error:submissionError},{data:evaluations,error:evaluationError}]=await Promise.all([
    auth.db.from("weekly_activity_submissions").select("*").gte("week_start",first).lte("week_start",last).order("week_start",{ascending:false}),
    auth.db.from("administrator_evaluations").select("id,location_id,week_start,week_end,submitted_by,submitted_by_name,submitted_by_email,submitted_at,last_updated_by,last_updated_by_name,updated_at").gte("week_start",first).lte("week_start",last).order("week_start",{ascending:false})
  ]);
  const error=submissionError||evaluationError;
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({submissions:submissions||[],evaluations:evaluations||[]});
}

export async function POST(request:NextRequest){
  const auth=await authenticate(request);if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"Solicitud no válida."},{status:400});
  const locationId=Number(body.locationId),weekStart=String(body.weekStart||""),activityType=String(body.activityType||"");
  if(!Number.isInteger(locationId)||locationId<=0)return NextResponse.json({error:"Selecciona un local válido."},{status:400});
  if(!isDate(weekStart)||new Date(`${weekStart}T12:00:00Z`).getUTCDay()!==1)return NextResponse.json({error:"La semana debe comenzar en lunes."},{status:400});
  if(!activityTypes.includes(activityType as typeof activityTypes[number]))return NextResponse.json({error:"Actividad no válida."},{status:400});
  const weekEnd=moveDate(weekStart,6);
  const {data:location}=await auth.db.from("locations").select("id,name").eq("id",locationId).eq("active",true).maybeSingle();
  if(!location)return NextResponse.json({error:"El local no está disponible para tu cuenta."},{status:403});

  if(activityType==="shopper_purchase"||activityType==="shopper_delivery"){
    const category=activityType==="shopper_purchase"?"purchase":"delivery";
    const {data:staff,error:staffError}=await auth.db.from("shopper_staff").select("id,name").eq("location_id",locationId).eq("category",category).eq("active",true);
    if(staffError)return NextResponse.json({error:staffError.message},{status:400});
    if(!staff?.length)return NextResponse.json({error:`No existen ${category==="purchase"?"asesores de compra":"repartidores"} activos en este local.`},{status:400});
    const ids=staff.map(row=>row.id);
    const {data:turns,error:turnError}=await auth.db.from("shopper_turns").select("staff_id,work_date").in("staff_id",ids).gte("work_date",weekStart).lte("work_date",weekEnd);
    if(turnError)return NextResponse.json({error:turnError.message},{status:400});
    const completed=new Set((turns||[]).map(row=>`${row.staff_id}:${row.work_date}`));
    const missing=staff.reduce((total,row)=>total+Array.from({length:7},(_,day)=>`${row.id}:${moveDate(weekStart,day)}`).filter(key=>!completed.has(key)).length,0);
    if(missing)return NextResponse.json({error:`El horario todavía tiene ${missing} ${missing===1?"celda pendiente":"celdas pendientes"}. Complétalo antes de publicarlo.`},{status:400});
  }else{
    const {data:supervisors,error:supervisorError}=await auth.db.from("supervisors").select("id,name").eq("location_id",locationId).lte("active_from",weekEnd).or(`active_until.is.null,active_until.gte.${weekStart}`);
    if(supervisorError)return NextResponse.json({error:supervisorError.message},{status:400});
    if(!supervisors?.length)return NextResponse.json({error:"No existen supervisores activos en este local para la semana."},{status:400});
    const ids=supervisors.map(row=>row.id);
    const {data:assignments,error:assignmentError}=await auth.db.from("assignments").select("supervisor_id,work_date").in("supervisor_id",ids).gte("work_date",weekStart).lte("work_date",weekEnd);
    if(assignmentError)return NextResponse.json({error:assignmentError.message},{status:400});
    const completed=new Set((assignments||[]).map(row=>`${row.supervisor_id}:${row.work_date}`));
    const missing=supervisors.reduce((total,row)=>total+Array.from({length:7},(_,day)=>`${row.id}:${moveDate(weekStart,day)}`).filter(key=>!completed.has(key)).length,0);
    if(missing)return NextResponse.json({error:`El horario de supervisión todavía tiene ${missing} ${missing===1?"celda pendiente":"celdas pendientes"}.`},{status:400});
  }

  const row={location_id:locationId,location_name_snapshot:location.name,week_start:weekStart,week_end:weekEnd,activity_type:activityType,submitted_by:auth.profile.id,submitted_by_name:auth.profile.full_name||auth.profile.email,submitted_by_email:auth.profile.email,last_updated_by:auth.profile.id,last_updated_by_name:auth.profile.full_name||auth.profile.email,updated_at:new Date().toISOString()};
  const {data:existing,error:existingError}=await auth.db.from("weekly_activity_submissions").select("id").eq("location_id",locationId).eq("week_start",weekStart).eq("activity_type",activityType).maybeSingle();
  if(existingError)return NextResponse.json({error:existingError.message},{status:400});
  const operation=existing
    ?auth.db.from("weekly_activity_submissions").update({updated_at:new Date().toISOString()}).eq("id",existing.id)
    :auth.db.from("weekly_activity_submissions").insert(row);
  const {error}=await operation;
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true,publishedBy:auth.profile.full_name||auth.profile.email});
}
