import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function client(request:NextRequest) {
  const token=request.headers.get("x-supabase-token")||"";
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{
    global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}
  });
}
export async function GET(request:NextRequest) {
  const db=client(request);
  const [{data,error},{data:grants,error:grantsError},{data:locations}]=await Promise.all([
    db.from("profiles").select("*").order("email"),
    db.from("profile_locations").select("profile_id,location_id"),
    db.from("locations").select("id,name")
  ]);
  if(error)return NextResponse.json({error:error.message},{status:403});
  const service=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{
    auth:{persistSession:false,autoRefreshToken:false}
  });
  const {data:authPage}=await service.auth.admin.listUsers({page:1,perPage:1000});
  const authById=new Map((authPage?.users||[]).map(user=>[user.id,user]));
  const safeGrants=grantsError?[]:(grants||[]);
  const locationNameById=new Map((locations||[]).map((location:any)=>[Number(location.id),location.name]));
  return NextResponse.json({users:(data||[]).filter((x:any)=>x.app_role!=="admin").map((x:any)=>{
    const requestedNames=((authById.get(x.id)?.user_metadata?.requested_location_names||[]) as unknown[]).map(String).filter(Boolean);
    const requested=requestedNames.map(name=>{
      const match=(locations||[]).find((location:any)=>location.name===name);
      return Number(match?.id);
    }).filter(Boolean);
    return ({
    id:x.id,email:x.email,name:x.full_name||x.email,role:x.app_role,location_id:x.location_id,
    location_name:locationNameById.get(Number(x.location_id))||"Sin asignar",
    location_ids:safeGrants.filter((g:any)=>g.profile_id===x.id).map((g:any)=>g.location_id).concat(
      safeGrants.some((g:any)=>g.profile_id===x.id)||!x.location_id?[]:[x.location_id]
    ),
    location_names:safeGrants.filter((g:any)=>g.profile_id===x.id).map((g:any)=>locationNameById.get(Number(g.location_id))).filter(Boolean).concat(
      safeGrants.some((g:any)=>g.profile_id===x.id)||!x.location_id?[]:[locationNameById.get(Number(x.location_id))]
    ),
    requested_location_ids:requested,
    requested_location_names:requestedNames,
    active:x.active?1:0
  })})});
}
export async function POST(request:NextRequest) {
  const db=client(request);const body=await request.json();
  const locationIds=[...new Set((body.locationIds||[]).map(Number).filter(Boolean))] as number[];
  if(body.action==="save"){
    const {data:user,error:findError}=await db.from("profiles").select("id").eq("email",String(body.email).toLowerCase()).maybeSingle();
    if(findError)return NextResponse.json({error:findError.message},{status:400});
    if(!user)return NextResponse.json({error:"El usuario debe crear su cuenta primero desde la página de acceso."},{status:400});
    if(!locationIds.length)return NextResponse.json({error:"Selecciona al menos un local."},{status:400});
    const {error}=await db.from("profiles").update({full_name:body.name,location_id:locationIds[0],app_role:"supervisor",active:true}).eq("id",user.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
    const {error:deleteError}=await db.from("profile_locations").delete().eq("profile_id",user.id);
    if(deleteError)return NextResponse.json({error:deleteError.message},{status:400});
    const {error:grantError}=await db.from("profile_locations").insert(locationIds.map(location_id=>({profile_id:user.id,location_id})));
    if(grantError)return NextResponse.json({error:grantError.message},{status:400});
  } else if(body.action==="toggle"){
    const {error}=await db.from("profiles").update({active:Boolean(body.active)}).eq("id",body.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
  } else if(body.action==="update"){
    if(!locationIds.length)return NextResponse.json({error:"Selecciona al menos un local."},{status:400});
    const {error}=await db.from("profiles").update({
      full_name:String(body.name||"").trim(),
      location_id:locationIds[0],
      app_role:"supervisor",
      active:Boolean(body.active)
    }).eq("id",body.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
    const {error:deleteError}=await db.from("profile_locations").delete().eq("profile_id",body.id);
    if(deleteError)return NextResponse.json({error:deleteError.message},{status:400});
    const {error:grantError}=await db.from("profile_locations").insert(locationIds.map(location_id=>({profile_id:body.id,location_id})));
    if(grantError)return NextResponse.json({error:grantError.message},{status:400});
  } else return NextResponse.json({error:"Acción desconocida"},{status:400});
  return NextResponse.json({ok:true});
}
