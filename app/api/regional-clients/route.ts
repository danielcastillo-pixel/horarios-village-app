import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";
export const revalidate=0;

type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";active:boolean};
const BUCKET="regional-evidence";

function tokenFrom(request:NextRequest){return request.headers.get("x-supabase-token")?.trim()||"";}
function dbFor(request:NextRequest){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${tokenFrom(request)}`}},auth:{persistSession:false,autoRefreshToken:false}});}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function isDate(value:unknown){const date=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsed=new Date(`${date}T12:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;}
function uniquePaths(value:unknown){return [...new Set((Array.isArray(value)?value:[]).map(path=>clean(path,500)).filter(Boolean))];}

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
  const {data,error}=await auth.db.from("regional_clients").select("*").order("created_at",{ascending:false});
  if(error)return NextResponse.json({error:error.message},{status:400});
  const clients=await Promise.all((data||[]).map(async row=>{
    const paths=uniquePaths(row.evidence_paths);
    const signed=await Promise.all(paths.map(path=>auth.db.storage.from(BUCKET).createSignedUrl(path,900)));
    return {...row,evidence_paths:paths,evidence_urls:signed.map(item=>item.data?.signedUrl||null).filter(Boolean)};
  }));
  return NextResponse.json({clients,currentUserId:auth.profile.id},{headers:{"Cache-Control":"private, no-store, max-age=0"}});
}

export async function POST(request:NextRequest){
  const auth=await authenticate(request);if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"Solicitud no válida."},{status:400});
  const action=String(body.action||"");
  if(action==="decideBlacklist"){
    if(auth.profile.app_role!=="admin")return NextResponse.json({error:"Solo el administrador puede aprobar la lista negra."},{status:403});
    const id=Number(body.id),status=String(body.status||"");
    if(!Number.isInteger(id)||id<=0||!["restricted","enabled","rejected"].includes(status))return NextResponse.json({error:"Decisión no válida."},{status:400});
    const {error}=await auth.db.from("regional_clients").update({blacklist_status:status,updated_at:new Date().toISOString()}).eq("id",id).eq("client_type","blacklist");
    if(error)return NextResponse.json({error:error.message},{status:400});
    return NextResponse.json({ok:true});
  }
  if(action!=="saveClient")return NextResponse.json({error:"Acción desconocida."},{status:400});

  const clientType=body.clientType==="blacklist"?"blacklist":"potential";
  const externalId=clean(body.clientExternalId,120),clientName=clean(body.clientName,200),city=clean(body.city,120);
  const evidencePaths=uniquePaths(body.evidencePaths);
  if(externalId.length<1||clientName.length<2||city.length<2)return NextResponse.json({error:"Completa el ID, nombre y ciudad del cliente."},{status:400});
  if(clientType==="blacklist"&&clean(body.blacklistReason,5000).length<3)return NextResponse.json({error:"Escribe el motivo de la lista negra."},{status:400});
  if(evidencePaths.length>10||evidencePaths.some(path=>!path.startsWith(`${auth.profile.id}/clients/`)))return NextResponse.json({error:"Una evidencia del cliente no es válida."},{status:400});
  const estimatedRaw=body.estimatedOrders===null||body.estimatedOrders===""?null:Number(body.estimatedOrders);
  if(estimatedRaw!==null&&(!Number.isFinite(estimatedRaw)||estimatedRaw<0))return NextResponse.json({error:"La cantidad estimada de pedidos no es válida."},{status:400});
  const potentialStatus=String(body.potentialStatus||"pending"),blacklistStatus=String(body.blacklistStatus||"pending");
  if(!["pending","contacted","interested","converted","discarded"].includes(potentialStatus))return NextResponse.json({error:"Estado de cliente potencial no válido."},{status:400});
  const values={client_name:clientName,city,sector:clean(body.sector,500),estimated_orders:estimatedRaw===null?null:Math.round(estimatedRaw),responsible:clean(body.responsible,500),observations:clean(body.observations,5000),next_action:clean(body.nextAction,3000),next_action_date:isDate(body.nextActionDate)?String(body.nextActionDate):null,potential_status:potentialStatus,blacklist_reason:clean(body.blacklistReason,5000),order_reference:clean(body.orderReference,200),evidence_paths:evidencePaths,blacklist_status:auth.profile.app_role==="admin"&&["pending","restricted","enabled","rejected"].includes(blacklistStatus)?blacklistStatus:"pending",updated_at:new Date().toISOString()};
  const id=Number(body.id);
  if(Number.isInteger(id)&&id>0){
    const {data:existing}=await auth.db.from("regional_clients").select("id,submitted_by,client_type,evidence_paths").eq("id",id).maybeSingle();
    if(!existing)return NextResponse.json({error:"El cliente ya no está disponible."},{status:404});
    if(auth.profile.app_role!=="admin"&&existing.submitted_by!==auth.profile.id)return NextResponse.json({error:"Solo puedes editar los registros que creaste."},{status:403});
    const mergedPaths=[...new Set([...uniquePaths(existing.evidence_paths),...evidencePaths])];
    if(mergedPaths.length>10)return NextResponse.json({error:"El cliente puede tener máximo 10 fotografías."},{status:400});
    const {error}=await auth.db.from("regional_clients").update({...values,evidence_paths:mergedPaths}).eq("id",id);
    if(error)return NextResponse.json({error:error.message},{status:400});
    return NextResponse.json({ok:true});
  }
  const {data:duplicate}=await auth.db.from("regional_clients").select("id").eq("client_type",clientType).ilike("client_external_id",externalId).ilike("city",city).limit(1).maybeSingle();
  if(duplicate)return NextResponse.json({error:"Ese cliente ya está registrado en esta categoría y ciudad."},{status:409});
  const {error}=await auth.db.from("regional_clients").insert({...values,client_type:clientType,client_external_id:externalId,submitted_by:auth.profile.id,submitted_by_name:auth.profile.full_name||auth.profile.email});
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true});
}
