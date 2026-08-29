import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";active:boolean};
const BUCKET="authorization-evidence";
function tokenFrom(request:NextRequest){return request.headers.get("x-supabase-token")?.trim()||"";}
function dbFor(request:NextRequest){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${tokenFrom(request)}`}},auth:{persistSession:false,autoRefreshToken:false}});}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function uniquePaths(value:unknown,fallback:unknown){const source=Array.isArray(value)?value:[fallback];return [...new Set(source.map(path=>clean(path,500)).filter(Boolean))];}
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
  const month=Number(request.nextUrl.searchParams.get("month")||0);
  if(!Number.isInteger(year)||year<2026||year>2100||!Number.isInteger(month)||month<0||month>12)return NextResponse.json({error:"Período no válido."},{status:400});
  let query=auth.db.from("authorization_requests").select("*").gte("created_at",`${year}-01-01T00:00:00Z`).lt("created_at",`${year+1}-01-01T00:00:00Z`).order("created_at",{ascending:false});
  if(month){
    const start=`${year}-${String(month).padStart(2,"0")}-01T00:00:00Z`;
    const nextMonth=month===12?`${year+1}-01-01T00:00:00Z`:`${year}-${String(month+1).padStart(2,"0")}-01T00:00:00Z`;
    query=query.gte("created_at",start).lt("created_at",nextMonth);
  }
  const {data,error}=await query;
  if(error)return NextResponse.json({error:error.message},{status:400});
  const requests=await Promise.all((data||[]).map(async row=>{
    const paths=uniquePaths(row.evidence_paths,row.evidence_path);
    const signed=await Promise.all(paths.map(path=>auth.db.storage.from(BUCKET).createSignedUrl(path,900)));
    const evidenceUrls=signed.map(result=>result.data?.signedUrl||null).filter((url):url is string=>Boolean(url));
    return {...row,evidence_paths:paths,evidence_urls:evidenceUrls,evidence_url:evidenceUrls[0]||null};
  }));
  return NextResponse.json({isAdmin:auth.profile.app_role==="admin",requests});
}

export async function POST(request:NextRequest){
  const auth=await authenticate(request);if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"Solicitud no válida."},{status:400});
  if(body.action==="decide"){
    if(auth.profile.app_role!=="admin")return NextResponse.json({error:"Solo el administrador puede autorizar o rechazar."},{status:403});
    const id=Number(body.id),status=String(body.status||"");
    if(!Number.isInteger(id)||id<=0||!["approved","rejected"].includes(status))return NextResponse.json({error:"Decisión no válida."},{status:400});
    const {error}=await auth.db.from("authorization_requests").update({status,decision_comment:clean(body.comment,2000),updated_at:new Date().toISOString()}).eq("id",id);
    if(error)return NextResponse.json({error:error.message},{status:400});
    return NextResponse.json({ok:true});
  }

  if(body.action!=="create")return NextResponse.json({error:"Acción desconocida."},{status:400});
  const requestType=String(body.requestType||""),locationId=Number(body.locationId),amount=Number(body.amount);
  const shopperName=clean(body.shopperName,180),orderNumber=clean(body.orderNumber,80),clientName=clean(body.clientName,180),reason=clean(body.reason,4000);
  const evidencePaths=uniquePaths(body.evidencePaths,body.evidencePath),needsHelp=body.needsHelp===true;
  if(!["discount","incentive"].includes(requestType))return NextResponse.json({error:"Selecciona descuento o incentivo."},{status:400});
  if(!Number.isInteger(locationId)||locationId<=0)return NextResponse.json({error:"Selecciona un local válido."},{status:400});
  if(shopperName.length<2||orderNumber.length<2||clientName.length<2)return NextResponse.json({error:"Completa shopper, número de pedido y cliente."},{status:400});
  if(!Number.isFinite(amount)||amount<=0||amount>999999.99)return NextResponse.json({error:"Ingresa un valor válido."},{status:400});
  if(reason.length<5)return NextResponse.json({error:"Explica la razón de la solicitud."},{status:400});
  if(evidencePaths.length>10)return NextResponse.json({error:"Puedes adjuntar un máximo de 10 fotografías."},{status:400});
  if(requestType==="incentive"&&!evidencePaths.length)return NextResponse.json({error:"Adjunta al menos una constancia fotográfica para el incentivo."},{status:400});
  if(evidencePaths.some(path=>!path.startsWith(`${auth.profile.id}/`)))return NextResponse.json({error:"Una constancia fotográfica no es válida."},{status:400});
  const {data:location}=await auth.db.from("locations").select("id,name").eq("id",locationId).eq("active",true).maybeSingle();
  if(!location)return NextResponse.json({error:"El local no está disponible para tu cuenta."},{status:403});
  const storedPaths=requestType==="incentive"?evidencePaths:[];
  const {data,error}=await auth.db.from("authorization_requests").insert({
    request_type:requestType,location_id:locationId,location_name_snapshot:location.name,
    shopper_name:shopperName,shopper_external_id:clean(body.shopperExternalId,80),order_number:orderNumber,
    client_name:clientName,amount:Math.round(amount*100)/100,reason,
    evidence_path:storedPaths[0]||null,evidence_paths:storedPaths,needs_help:needsHelp,status:"pending",
    created_by:auth.profile.id,created_by_name:auth.profile.full_name||auth.profile.email,created_by_email:auth.profile.email
  }).select("id").single();
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({ok:true,id:data.id});
}
