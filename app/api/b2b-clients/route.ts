import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";

export const dynamic="force-dynamic";
export const revalidate=0;

type Profile={id:string;email:string;full_name:string;app_role:"admin"|"supervisor";active:boolean};
const institutionTypes=["salud","ferreteria","papeleria","belleza","b2b"] as const;

function tokenFrom(request:NextRequest){return request.headers.get("x-supabase-token")?.trim()||"";}
function dbFor(request:NextRequest){return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${tokenFrom(request)}`}},auth:{persistSession:false,autoRefreshToken:false}});}
function clean(value:unknown,max:number){return String(value??"").trim().slice(0,max);}
function isDate(value:unknown){const date=String(value||"");if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;const parsed=new Date(`${date}T12:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;}
function normalizedPhone(value:string){return value.replace(/[^0-9]/g,"");}
function uniqueStrings(value:unknown){return [...new Set((Array.isArray(value)?value:[]).map(item=>clean(item,180)).filter(Boolean))].slice(0,50);}

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
  const [{data:contacts,error:contactError},{data:profiles,error:profileError}]=await Promise.all([
    auth.db.from("b2b_client_contacts").select("id,institution_type,institution_name,contact_date,sector,contact_phone,email,store_names,additional_comments,submitted_by,submitted_by_name,submitted_by_email,created_at,updated_at").order("contact_date",{ascending:false}).order("created_at",{ascending:false}),
    auth.profile.app_role==="admin"
      ?auth.db.from("profiles").select("id,email,full_name").eq("app_role","supervisor").eq("active",true).order("full_name")
      :Promise.resolve({data:[{id:auth.profile.id,email:auth.profile.email,full_name:auth.profile.full_name}],error:null})
  ]);
  const error=contactError||profileError;
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({
    contacts:contacts||[],
    supervisors:(profiles||[]).map(row=>({id:row.id,email:row.email,name:row.full_name||row.email})),
    currentUserId:auth.profile.id,
    isAdmin:auth.profile.app_role==="admin"
  },{headers:{"Cache-Control":"private, no-store, max-age=0"}});
}

export async function POST(request:NextRequest){
  const auth=await authenticate(request);if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"Solicitud no válida."},{status:400});
  const action=String(body.action||"");

  if(action==="delete"){
    const id=Number(body.id);
    if(!Number.isInteger(id)||id<=0)return NextResponse.json({error:"Registro no válido."},{status:400});
    const {data,error}=await auth.db.from("b2b_client_contacts").delete().eq("id",id).select("id").maybeSingle();
    if(error)return NextResponse.json({error:error.message},{status:400});
    if(!data)return NextResponse.json({error:"No tienes permiso para eliminar este registro."},{status:403});
    return NextResponse.json({ok:true});
  }

  if(action!=="save")return NextResponse.json({error:"Acción desconocida."},{status:400});
  const institutionType=clean(body.institutionType,30);
  const institutionName=clean(body.institutionName,200);
  const contactDate=clean(body.contactDate,10);
  const sector=clean(body.sector,300);
  const contactPhone=clean(body.contactPhone,80);
  const email=clean(body.email,320).toLowerCase();
  const storeNames=uniqueStrings(body.storeNames);
  const additionalComments=clean(body.additionalComments,5000);
  if(!institutionTypes.includes(institutionType as typeof institutionTypes[number]))return NextResponse.json({error:"Selecciona un tipo de institución válido."},{status:400});
  if(institutionName.length<2||sector.length<2||!isDate(contactDate))return NextResponse.json({error:"Completa la institución, fecha y sector."},{status:400});
  if(normalizedPhone(contactPhone).length<7&&!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))return NextResponse.json({error:"Ingresa un teléfono o correo válido."},{status:400});

  const values={institution_type:institutionType,institution_name:institutionName,contact_date:contactDate,sector,contact_phone:contactPhone,email,store_names:storeNames,additional_comments:additionalComments};
  const id=Number(body.id);
  const operation=Number.isInteger(id)&&id>0
    ?auth.db.from("b2b_client_contacts").update(values).eq("id",id).select("id").maybeSingle()
    :auth.db.from("b2b_client_contacts").insert({...values,submitted_by:auth.profile.id,submitted_by_name:auth.profile.full_name||auth.profile.email,submitted_by_email:auth.profile.email}).select("id").single();
  const {data,error}=await operation;
  if(error){
    if(error.code==="23505")return NextResponse.json({error:"Este teléfono o correo ya pertenece a otro cliente registrado."},{status:409});
    return NextResponse.json({error:error.message},{status:400});
  }
  if(!data)return NextResponse.json({error:"No tienes permiso para editar este registro."},{status:403});
  return NextResponse.json({ok:true,id:data.id});
}
