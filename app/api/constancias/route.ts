import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";active:boolean};
const BUCKET="weekly-evidence";
const evidenceTypes=["automatic_assignment","team_meeting"] as const;

function tokenFrom(request:NextRequest){return request.headers.get("x-supabase-token")?.trim()||"";}
function dbFor(request:NextRequest){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${tokenFrom(request)}`}},auth:{persistSession:false,autoRefreshToken:false}});}
function isDate(value:unknown){const date=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsed=new Date(`${date}T12:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;}
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
  const year=Number(request.nextUrl.searchParams.get("year")||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2026||year>2100)return NextResponse.json({error:"Año no válido."},{status:400});
  const {data,error}=await auth.db.from("weekly_evidences").select("*").gte("week_start",`${year}-01-01`).lte("week_start",`${year}-12-31`).order("week_start",{ascending:false});
  if(error)return NextResponse.json({error:error.message},{status:400});
  const evidences=await Promise.all((data||[]).map(async row=>{
    const {data:signed}=await auth.db.storage.from(BUCKET).createSignedUrl(row.evidence_path,900);
    return {...row,evidence_url:signed?.signedUrl||null};
  }));
  return NextResponse.json({evidences});
}

export async function POST(request:NextRequest){
  const auth=await authenticate(request);if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"Solicitud no válida."},{status:400});
  const locationId=Number(body.locationId),weekStart=String(body.weekStart||""),evidenceType=String(body.evidenceType||""),evidencePath=String(body.evidencePath||"").trim().slice(0,500);
  if(!Number.isInteger(locationId)||locationId<=0)return NextResponse.json({error:"Selecciona un local válido."},{status:400});
  if(!isDate(weekStart)||new Date(`${weekStart}T12:00:00Z`).getUTCDay()!==1)return NextResponse.json({error:"Selecciona una semana válida."},{status:400});
  if(!evidenceTypes.includes(evidenceType as typeof evidenceTypes[number]))return NextResponse.json({error:"Tipo de constancia no válido."},{status:400});
  const expectedPrefix=`${auth.profile.id}/${locationId}/${weekStart}/${evidenceType}/`;
  if(!evidencePath.startsWith(expectedPrefix))return NextResponse.json({error:"La fotografía no corresponde al local y semana seleccionados."},{status:400});
  const {data:location}=await auth.db.from("locations").select("id,name").eq("id",locationId).eq("active",true).maybeSingle();
  if(!location)return NextResponse.json({error:"El local no está disponible para tu cuenta."},{status:403});

  const {data:existing,error:existingError}=await auth.db.from("weekly_evidences").select("id").eq("location_id",locationId).eq("week_start",weekStart).eq("evidence_type",evidenceType).maybeSingle();
  if(existingError)return NextResponse.json({error:existingError.message},{status:400});
  const audit={last_updated_by:auth.profile.id,last_updated_by_name:auth.profile.full_name||auth.profile.email,updated_at:new Date().toISOString()};
  const operation=existing
    ?auth.db.from("weekly_evidences").update({evidence_path:evidencePath,...audit}).eq("id",existing.id).select("id").single()
    :auth.db.from("weekly_evidences").insert({location_id:locationId,location_name_snapshot:location.name,week_start:weekStart,week_end:moveDate(weekStart,6),evidence_type:evidenceType,evidence_path:evidencePath,submitted_by:auth.profile.id,submitted_by_name:auth.profile.full_name||auth.profile.email,submitted_by_email:auth.profile.email,...audit}).select("id").single();
  const {data,error}=await operation;
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true,id:data.id});
}
