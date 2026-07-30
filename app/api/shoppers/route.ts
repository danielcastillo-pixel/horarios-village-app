import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
function client(request:NextRequest){
  const token=request.headers.get("x-supabase-token")||"";
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false}});
}
export async function GET(request:NextRequest){
  const db=client(request),category=request.nextUrl.searchParams.get("category")==="delivery"?"delivery":"purchase";
  const [{data:staff,error},{data:turns,error:te},{data:shiftTypes}]=await Promise.all([
    db.from("shopper_staff").select("*,locations(name)").eq("category",category).eq("active",true).order("name"),
    db.from("shopper_turns").select("*").gte("work_date","2026-07-27").lte("work_date","2026-12-31"),
    db.from("shopper_shift_types").select("*").or(`category.eq.${category},category.eq.both`).eq("active",true).order("code")
  ]);
  if(error||te)return NextResponse.json({error:(error||te)?.message},{status:400});
  const ids=new Set((staff||[]).map((x:any)=>x.id));
  const defaults=[
    {id:-1,code:"A",label:"Apertura",start_time:"06:00",end_time:"14:00",category:"both",counts_opening:true,counts_closing:false,is_free:false,location_id:null},
    {id:-2,code:"A2",label:"Apertura 2",start_time:"07:00",end_time:"15:00",category:"both",counts_opening:true,counts_closing:false,is_free:false,location_id:null},
    {id:-3,code:"B",label:"Intermedio",start_time:"10:00",end_time:"18:00",category:"both",counts_opening:false,counts_closing:false,is_free:false,location_id:null},
    {id:-4,code:"T",label:"Apertura y cierre",start_time:"13:00",end_time:"21:00",category:"both",counts_opening:true,counts_closing:true,is_free:false,location_id:null},
    {id:-5,code:"I",label:"Apertura",start_time:"06:00",end_time:"14:00",category:"both",counts_opening:true,counts_closing:false,is_free:false,location_id:null},
    {id:-6,code:"N",label:"Apertura",start_time:"06:00",end_time:"14:00",category:"both",counts_opening:true,counts_closing:false,is_free:false,location_id:null},
    {id:-7,code:"L",label:"Libre",start_time:null,end_time:null,category:"both",counts_opening:false,counts_closing:false,is_free:true,location_id:null},
    {id:-8,code:"V",label:"Vacaciones",start_time:null,end_time:null,category:"both",counts_opening:false,counts_closing:false,is_free:true,location_id:null}
  ];
  return NextResponse.json({
    staff:(staff||[]).map((x:any)=>({...x,location_name:x.locations?.name||"",active:x.active?1:0})),
    turns:(turns||[]).filter((x:any)=>ids.has(x.staff_id)),
    shiftTypes:shiftTypes?.length?shiftTypes:defaults
  });
}
export async function POST(request:NextRequest){
  const db=client(request),body=await request.json();
  if(body.action==="addStaff"){
    const shopperId=String(body.shopperId||"").trim();
    const {error}=await db.from("shopper_staff").insert({name:String(body.name).trim(),shopper_external_id:shopperId||null,category:body.category,employment_type:body.employmentType,location_id:body.locationId});
    if(error)return NextResponse.json({error:error.message},{status:400});
  }else if(body.action==="updateStaff"){
    const {error}=await db.from("shopper_staff").update({name:String(body.name).trim(),shopper_external_id:String(body.shopperId||"").trim()||null}).eq("id",body.id);
    if(error)return NextResponse.json({error:error.message},{status:400});
  }else if(body.action==="deleteStaff"){
    const staffId=Number(body.id);
    if(!Number.isFinite(staffId))return NextResponse.json({error:"Shopper inválido"},{status:400});
    const {error}=await db.from("shopper_staff").update({active:false}).eq("id",staffId);
    if(error)return NextResponse.json({error:error.message},{status:400});
  }else if(body.action==="addShiftType"){
    const free=Boolean(body.isFree);
    const {error}=await db.from("shopper_shift_types").insert({
      code:String(body.code).trim().toUpperCase(),label:String(body.label).trim(),
      start_time:free?null:body.start,end_time:free?null:body.end,
      category:body.category,location_id:body.locationId||null,
      counts_opening:free?false:Boolean(body.countsOpening),
      counts_closing:free?false:Boolean(body.countsClosing),is_free:free
    });
    if(error)return NextResponse.json({error:error.message},{status:400});
  }else if(body.action==="saveTurn"){
    const {error}=await db.from("shopper_turns").upsert({staff_id:body.staffId,work_date:body.workDate,turn_code:body.turnCode,updated_at:new Date().toISOString()},{onConflict:"staff_id,work_date"});
    if(error)return NextResponse.json({error:error.message},{status:400});
  }else if(body.action==="copyWeek"){
    const start=new Date(`${body.sourceStart}T12:00:00`),end=new Date(start);end.setDate(end.getDate()+6);
    const {data:staff,error:se}=await db.from("shopper_staff").select("id").eq("category",body.category).eq("location_id",body.locationId).eq("active",true);
    if(se)return NextResponse.json({error:se.message},{status:400});
    const ids=(staff||[]).map((x:any)=>x.id);if(!ids.length)return NextResponse.json({error:"No hay filas para copiar"},{status:400});
    const {data:source,error}=await db.from("shopper_turns").select("staff_id,work_date,turn_code").in("staff_id",ids).gte("work_date",body.sourceStart).lte("work_date",end.toISOString().slice(0,10));
    if(error)return NextResponse.json({error:error.message},{status:400});
    const rows=(source||[]).map((x:any)=>{const d=new Date(`${x.work_date}T12:00:00`);d.setDate(d.getDate()+7);return {...x,work_date:d.toISOString().slice(0,10),updated_at:new Date().toISOString()};});
    if(!rows.length)return NextResponse.json({error:"La semana no tiene turnos"},{status:400});
    const {error:ue}=await db.from("shopper_turns").upsert(rows,{onConflict:"staff_id,work_date"});if(ue)return NextResponse.json({error:ue.message},{status:400});
    return NextResponse.json({ok:true,copied:rows.length});
  }else return NextResponse.json({error:"Acción desconocida"},{status:400});
  return NextResponse.json({ok:true});
}
