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
  const {data,error}=await db.from("profiles").select("*,locations(name)").order("email");
  if(error)return NextResponse.json({error:error.message},{status:403});
  return NextResponse.json({users:(data||[]).filter((x:any)=>x.app_role!=="admin").map((x:any)=>({
    id:x.id,email:x.email,name:x.full_name||x.email,role:x.app_role,location_id:x.location_id,
    location_name:x.locations?.name||"Sin asignar",active:x.active?1:0
  }))});
}
export async function POST(request:NextRequest) {
  const db=client(request);const body=await request.json();
  if(body.action==="save"){
    const {data:user,error:findError}=await db.from("profiles").select("id").eq("email",String(body.email).toLowerCase()).maybeSingle();
    if(findError)return NextResponse.json({error:findError.message},{status:400});
    if(!user)return NextResponse.json({error:"El usuario debe crear su cuenta primero desde la página de acceso."},{status:400});
    const {error}=await db.from("profiles").update({full_name:body.name,location_id:body.locationId,app_role:"supervisor",active:true}).eq("id",user.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
  } else if(body.action==="toggle"){
    const {error}=await db.from("profiles").update({active:Boolean(body.active)}).eq("id",body.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
  } else if(body.action==="update"){
    const {error}=await db.from("profiles").update({
      full_name:String(body.name||"").trim(),
      location_id:Number(body.locationId),
      app_role:"supervisor",
      active:Boolean(body.active)
    }).eq("id",body.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
  } else return NextResponse.json({error:"Acción desconocida"},{status:400});
  return NextResponse.json({ok:true});
}
