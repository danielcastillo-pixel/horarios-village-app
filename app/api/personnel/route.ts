import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";
export const revalidate=0;

function client(request:NextRequest){
  const token=(request.headers.get("x-supabase-token")||"").trim();
  const auth={persistSession:false,autoRefreshToken:false};
  return token
    ?createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth})
    :createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth});
}

async function authenticate(request:NextRequest){
  const token=(request.headers.get("x-supabase-token")||"").trim();
  if(!token)return null;
  const db=client(request),{data:{user}}=await db.auth.getUser(token);
  if(!user)return null;
  const {data:profile}=await db.from("profiles").select("id,active").eq("id",user.id).maybeSingle();
  return profile?.active?db:null;
}

function message(error:{message?:string}|null|undefined,fallback:string){
  const detail=error?.message||"";
  if(detail.includes("row-level security"))return `${fallback}: no tienes acceso a ese local`;
  if(detail.includes("check constraint"))return `${fallback}: revisa el nombre del cargo`;
  return detail?`${fallback}: ${detail}`:fallback;
}

function role(value:unknown,fallback:string){
  const normalized=String(value||"").trim();
  return normalized||fallback;
}

async function loadAll(db:ReturnType<typeof client>,table:"supervisors"|"shopper_staff",columns:string){
  const rows:any[]=[];
  const pageSize=1000;
  for(let from=0;;from+=pageSize){
    const {data,error}=await db.from(table).select(columns).order("name").range(from,from+pageSize-1);
    if(error)return {data:rows,error};
    const page=(data||[]) as any[];rows.push(...page);
    if(page.length<pageSize)break;
  }
  return {data:rows,error:null};
}

export async function GET(request:NextRequest){
  const db=await authenticate(request);
  if(!db)return NextResponse.json({error:"Sesión no válida"},{status:401});
  const [{data:supervisors,error:supervisorError},{data:staff,error:staffError}]=await Promise.all([
    loadAll(db,"supervisors","id,name,job_role,location_id,active,locations(name,city)"),
    loadAll(db,"shopper_staff","id,name,shopper_external_id,job_role,category,employment_type,location_id,active,locations(name,city)")
  ]);
  const error=supervisorError||staffError;
  if(error)return NextResponse.json({error:message(error,"No se pudo cargar la nómina regional")},{status:400});
  const people=[
    ...(supervisors||[]).map((person:any)=>({
      key:`supervisor-${person.id}`,source:"supervisor",id:Number(person.id),name:person.name,
      external_id:null,job_role:role(person.job_role,"Supervisor"),area:"supervision",employment_type:"",
      location_id:Number(person.location_id),location_name:person.locations?.name||"",city:person.locations?.city||"",active:Boolean(person.active)
    })),
    ...(staff||[]).map((person:any)=>({
      key:`shopper-${person.id}`,source:"shopper",id:Number(person.id),name:person.name,
      external_id:person.shopper_external_id||null,job_role:role(person.job_role,person.category==="delivery"?"Repartidor":"Asesor de compra"),
      area:person.category,employment_type:person.employment_type||"",
      location_id:Number(person.location_id),location_name:person.locations?.name||"",city:person.locations?.city||"",active:Boolean(person.active)
    }))
  ];
  return NextResponse.json({people},{headers:{"Cache-Control":"private, no-store, max-age=0"}});
}

export async function POST(request:NextRequest){
  const db=await authenticate(request);
  if(!db)return NextResponse.json({error:"Sesión no válida"},{status:401});
  const body=await request.json();
  if(body.action!=="update")return NextResponse.json({error:"Acción desconocida"},{status:400});
  const id=Number(body.id),source=body.source==="supervisor"?"supervisor":body.source==="shopper"?"shopper":"";
  const name=String(body.name||"").trim(),jobRole=String(body.jobRole||"").trim(),locationId=Number(body.locationId);
  if(!Number.isInteger(id)||id<=0||!source)return NextResponse.json({error:"La persona seleccionada no es válida"},{status:400});
  if(name.length<2||name.length>180)return NextResponse.json({error:"Escribe un nombre válido"},{status:400});
  if(jobRole.length<2||jobRole.length>80)return NextResponse.json({error:"El cargo debe tener entre 2 y 80 caracteres"},{status:400});
  if(!Number.isInteger(locationId)||locationId<=0)return NextResponse.json({error:"Selecciona un local válido"},{status:400});
  const active=Boolean(body.active);
  if(source==="supervisor"){
    const yesterday=new Date();yesterday.setUTCDate(yesterday.getUTCDate()-1);
    const {data,error}=await db.from("supervisors").update({
      name,job_role:jobRole,location_id:locationId,active,active_until:active?null:yesterday.toISOString().slice(0,10)
    }).eq("id",id).select("id").maybeSingle();
    if(error)return NextResponse.json({error:message(error,"No se pudo actualizar al supervisor")},{status:400});
    if(!data)return NextResponse.json({error:"El supervisor no existe o no pertenece a tus locales"},{status:404});
  }else{
    const employmentType=String(body.employmentType||"").trim();
    if(employmentType.length<2||employmentType.length>80)return NextResponse.json({error:"Selecciona una modalidad válida"},{status:400});
    const externalId=String(body.externalId||"").trim();
    const {data,error}=await db.from("shopper_staff").update({
      name,job_role:jobRole,shopper_external_id:externalId||null,employment_type:employmentType,location_id:locationId,active
    }).eq("id",id).select("id").maybeSingle();
    if(error)return NextResponse.json({error:message(error,"No se pudo actualizar al colaborador")},{status:400});
    if(!data)return NextResponse.json({error:"El colaborador no existe o no pertenece a tus locales"},{status:404});
  }
  return NextResponse.json({ok:true});
}
