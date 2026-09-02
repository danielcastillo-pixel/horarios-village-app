import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";
export const revalidate=0;

type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";active:boolean};
const BUCKET="regional-evidence";

function tokenFrom(request:NextRequest){return request.headers.get("x-supabase-token")?.trim()||"";}
function dbFor(request:NextRequest){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${tokenFrom(request)}`}},auth:{persistSession:false,autoRefreshToken:false}});}
function isDate(value:unknown){const date=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsed=new Date(`${date}T12:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;}
function isMonday(value:string){return isDate(value)&&new Date(`${value}T12:00:00Z`).getUTCDay()===1;}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function numberValue(value:unknown,min:number,max:number){const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=min&&parsed<=max?parsed:null;}
function integerValue(value:unknown,min:number,max:number){const parsed=numberValue(value,min,max);return parsed===null?null:Math.round(parsed);}
function uniquePaths(value:unknown){return [...new Set((Array.isArray(value)?value:[]).map(path=>clean(path,500)).filter(Boolean))];}

async function authenticateAdmin(request:NextRequest){
  const token=tokenFrom(request);if(!token)return {error:NextResponse.json({error:"Sesión no válida."},{status:401})};
  const db=dbFor(request),{data:{user}}=await db.auth.getUser(token);
  if(!user)return {error:NextResponse.json({error:"Sesión no válida."},{status:401})};
  const {data:profile}=await db.from("profiles").select("id,email,full_name,app_role,active").eq("id",user.id).maybeSingle();
  if(!profile?.active||profile.app_role!=="admin")return {error:NextResponse.json({error:"Este apartado está disponible únicamente para el administrador de Región Sur."},{status:403})};
  return {db,profile:profile as Profile};
}

async function signedMeeting(row:any,db:ReturnType<typeof dbFor>){
  const paths=uniquePaths(row.evidence_paths);
  const signed=await Promise.all(paths.map(path=>db.storage.from(BUCKET).createSignedUrl(path,900)));
  return {...row,evidence_paths:paths,evidence_urls:signed.map(result=>result.data?.signedUrl||null).filter(Boolean)};
}

export async function GET(request:NextRequest){
  const auth=await authenticateAdmin(request);if(auth.error)return auth.error;
  const year=Number(request.nextUrl.searchParams.get("year")||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2026||year>2100)return NextResponse.json({error:"Año no válido."},{status:400});
  const firstDay=new Date(`${year}-01-01T12:00:00Z`);firstDay.setUTCDate(firstDay.getUTCDate()-7);
  const start=firstDay.toISOString().slice(0,10),end=`${year}-12-31`;
  const [{data:kpis,error:kpiError},{data:meetings,error:meetingError},{data:requests,error:requestError}]=await Promise.all([
    auth.db.from("regional_weekly_kpis").select("*").gte("week_start",start).lte("week_start",end).order("week_start",{ascending:false}).order("city"),
    auth.db.from("regional_meetings").select("*").gte("week_start",start).lte("week_start",end).order("meeting_date",{ascending:false}),
    auth.db.from("regional_requests").select("*").gte("week_start",start).lte("week_start",end).order("created_at",{ascending:false})
  ]);
  const failure=kpiError||meetingError||requestError;
  if(failure)return NextResponse.json({error:failure.message},{status:400});
  const meetingsWithUrls=await Promise.all((meetings||[]).map(row=>signedMeeting(row,auth.db)));
  return NextResponse.json({kpis:kpis||[],meetings:meetingsWithUrls,requests:requests||[]},{headers:{"Cache-Control":"private, no-store, max-age=0"}});
}

function kpiValues(source:Record<string,unknown>,profileId:string){
  const weekStart=clean(source.weekStart,10),city=clean(source.city,120);
  if(!isMonday(weekStart))throw new Error("Selecciona una semana válida.");
  if(city.length<2)throw new Error("Escribe una ciudad válida.");
  const sales=numberValue(source.sales,0,999999999999),orders=integerValue(source.orders,0,100000000),activeClients=integerValue(source.activeClients,0,100000000);
  const averageTicket=numberValue(source.averageTicket,0,999999999),marginPercent=numberValue(source.marginPercent,-100,1000);
  const latePercent=numberValue(source.latePercent,0,100),reschedulingPercent=numberValue(source.reschedulingPercent,0,100),oosPercent=numberValue(source.oosPercent,0,100),incidents=integerValue(source.incidents,0,1000000);
  if([sales,orders,activeClients,averageTicket,marginPercent,latePercent,reschedulingPercent,oosPercent,incidents].some(value=>value===null))throw new Error(`Los KPIs de ${city} contienen valores no válidos.`);
  return {week_start:weekStart,city,sales,orders,active_clients:activeClients,average_ticket:averageTicket,margin_percent:marginPercent,late_percent:latePercent,rescheduling_percent:reschedulingPercent,oos_percent:oosPercent,incidents,analysis:clean(source.analysis,5000),affected_clients:clean(source.affectedClients,5000),affected_sectors:clean(source.affectedSectors,3000),action_plan:clean(source.actionPlan,5000),meeting_summary:clean(source.meetingSummary,5000),created_by:profileId,updated_by:profileId,updated_at:new Date().toISOString()};
}

export async function POST(request:NextRequest){
  const auth=await authenticateAdmin(request);if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"Solicitud no válida."},{status:400});
  const action=String(body.action||"");
  try{
    if(action==="saveKpi"){
      const values=kpiValues(body,auth.profile.id);
      const {error}=await auth.db.from("regional_weekly_kpis").upsert(values,{onConflict:"week_start,city"});
      if(error)throw error;
      return NextResponse.json({ok:true});
    }
    if(action==="importKpis"){
      const rows=Array.isArray(body.rows)?body.rows as Record<string,unknown>[]:[];
      if(!rows.length||rows.length>200)return NextResponse.json({error:"El archivo debe contener entre 1 y 200 ciudades."},{status:400});
      const values=rows.map(row=>kpiValues({...row,weekStart:body.weekStart},auth.profile.id));
      const {error}=await auth.db.from("regional_weekly_kpis").upsert(values,{onConflict:"week_start,city"});
      if(error)throw error;
      return NextResponse.json({ok:true,imported:values.length});
    }
    if(action==="saveMeeting"){
      const weekStart=clean(body.weekStart,10),meetingDate=clean(body.meetingDate,10),meetingType=clean(body.meetingType,30);
      const evidencePaths=uniquePaths(body.evidencePaths);
      if(!isMonday(weekStart)||!isDate(meetingDate))return NextResponse.json({error:"La semana o fecha de reunión no es válida."},{status:400});
      if(!["individual","group","city"].includes(meetingType))return NextResponse.json({error:"Selecciona un tipo de reunión válido."},{status:400});
      if(evidencePaths.length>10||evidencePaths.some(path=>!path.startsWith(`${auth.profile.id}/meetings/${weekStart}/`)))return NextResponse.json({error:"Una evidencia de la reunión no es válida."},{status:400});
      const values={week_start:weekStart,meeting_date:meetingDate,meeting_time:clean(body.meetingTime,5)||null,meeting_type:meetingType,title:clean(body.title,180),participants:clean(body.participants,2000),cities:clean(body.cities,1000),topics:clean(body.topics,5000),agreements:clean(body.agreements,5000),responsible:clean(body.responsible,1000),due_date:isDate(body.dueDate)?String(body.dueDate):null,status:body.status==="done"?"done":"open",evidence_paths:evidencePaths,updated_by:auth.profile.id,updated_at:new Date().toISOString()};
      if(values.title.length<3||values.participants.length<2||values.topics.length<3)return NextResponse.json({error:"Completa el título, participantes y temas tratados."},{status:400});
      const id=Number(body.id);
      const operation=Number.isInteger(id)&&id>0
        ?auth.db.from("regional_meetings").update(values).eq("id",id)
        :auth.db.from("regional_meetings").insert({...values,created_by:auth.profile.id});
      const {error}=await operation;if(error)throw error;
      return NextResponse.json({ok:true});
    }
    if(action==="saveRequest"){
      const weekStart=clean(body.weekStart,10),area=clean(body.targetArea,30),priority=clean(body.priority,20),status=clean(body.status,30);
      if(!isMonday(weekStart))return NextResponse.json({error:"Selecciona una semana válida."},{status:400});
      if(!["marketing","b2b","commercial","operations","other"].includes(area))return NextResponse.json({error:"Selecciona un área válida."},{status:400});
      if(!["low","medium","high"].includes(priority)||!["pending","requested","in_progress","completed","rejected"].includes(status))return NextResponse.json({error:"El estado de la solicitud no es válido."},{status:400});
      const values={week_start:weekStart,city:clean(body.city,120),target_area:area,request_text:clean(body.requestText,5000),rationale:clean(body.rationale,5000),priority,responsible:clean(body.responsible,1000),due_date:isDate(body.dueDate)?String(body.dueDate):null,status,updated_by:auth.profile.id,updated_at:new Date().toISOString()};
      if(values.city.length<2||values.request_text.length<3)return NextResponse.json({error:"Completa la ciudad y la solicitud."},{status:400});
      const id=Number(body.id);
      const operation=Number.isInteger(id)&&id>0
        ?auth.db.from("regional_requests").update(values).eq("id",id)
        :auth.db.from("regional_requests").insert({...values,created_by:auth.profile.id});
      const {error}=await operation;if(error)throw error;
      return NextResponse.json({ok:true});
    }
    return NextResponse.json({error:"Acción desconocida."},{status:400});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"No se pudo guardar la información."},{status:400});}
}
