import {NextRequest,NextResponse} from "next/server";
import {createClient} from "@supabase/supabase-js";
const SCHEDULE_MIN_DATE="2026-07-27";
const SCHEDULE_MAX_DATE=`${Math.max(new Date().getFullYear()+1,2027)}-12-31`;
function sessionToken(request:NextRequest){return (request.headers.get("x-supabase-token")||"").trim();}
function client(request:NextRequest){
  const token=sessionToken(request);
  const auth={persistSession:false,autoRefreshToken:false};
  return token
    ?createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth})
    :createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth});
}
type Profile={id:string;app_role:"admin"|"supervisor";active:boolean};
async function authenticate(request:NextRequest){
  const token=sessionToken(request);if(!token)return null;
  const db=client(request),{data:{user}}=await db.auth.getUser(token);
  if(!user)return null;
  const {data:profile}=await db.from("profiles").select("id,app_role,active").eq("id",user.id).maybeSingle();
  return profile?.active?{db,profile:profile as Profile}:null;
}
function databaseError(error:{message?:string}|null|undefined,fallback:string){
  const message=error?.message||"";
  if(message.includes("row-level security"))return `${fallback}: no tienes permiso para modificar ese local`;
  if(message.includes("duplicate key"))return `${fallback}: ya existe un registro con esos datos`;
  if(message.includes("schema cache"))return `${fallback}: la base de datos todavía está actualizando su estructura`;
  return message?`${fallback}: ${message}`:fallback;
}
function invalidDate(value:unknown){
  const date=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<SCHEDULE_MIN_DATE||date>SCHEDULE_MAX_DATE)return true;
  const parsed=new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==date;
}
export async function GET(request:NextRequest){
  const auth=await authenticate(request);if(!auth)return NextResponse.json({error:"Sesión no válida"},{status:401});
  const db=auth.db,category=request.nextUrl.searchParams.get("category")==="delivery"?"delivery":"purchase";
  if(request.nextUrl.searchParams.get("directory")==="1"){
    const {data,error}=await db.from("shopper_staff").select("*,locations(name)").order("name");
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo cargar el repositorio de shoppers")},{status:400});
    return NextResponse.json({staff:(data||[]).map((x:any)=>({...x,location_name:x.locations?.name||"",active:x.active?1:0}))});
  }
  const [{data:staff,error},{data:turns,error:te},{data:shiftTypes}]=await Promise.all([
    db.from("shopper_staff").select("*,locations(name)").eq("category",category).eq("active",true).order("name"),
    db.from("shopper_turns").select("*").gte("work_date",SCHEDULE_MIN_DATE).lte("work_date",SCHEDULE_MAX_DATE),
    db.from("shopper_shift_types").select("*").or(`category.eq.${category},category.eq.both`).order("code")
  ]);
  if(error||te)return NextResponse.json({error:databaseError(error||te,"No se pudo cargar el horario de shoppers")},{status:400});
  const ids=new Set((staff||[]).map((x:any)=>x.id));
  const defaults=[
    {id:-1,code:"A",label:"Apertura",start_time:"06:00",end_time:"14:00",category:"both",counts_opening:true,counts_closing:false,is_free:false,location_id:null,created_by:null,is_general:true,active:true},
    {id:-3,code:"B",label:"Intermedio",start_time:"10:00",end_time:"18:00",category:"both",counts_opening:false,counts_closing:false,is_free:false,location_id:null,created_by:null,is_general:true,active:true},
    {id:-4,code:"T",label:"Apertura y cierre",start_time:"13:00",end_time:"21:00",category:"both",counts_opening:true,counts_closing:true,is_free:false,location_id:null,created_by:null,is_general:true,active:true},
    {id:-7,code:"L",label:"Libre",start_time:null,end_time:null,category:"both",counts_opening:false,counts_closing:false,is_free:true,location_id:null,created_by:null,is_general:true,active:true},
    {id:-8,code:"V",label:"Vacaciones",start_time:null,end_time:null,category:"both",counts_opening:false,counts_closing:false,is_free:true,location_id:null,created_by:null,is_general:true,active:true}
  ];
  return NextResponse.json({
    staff:(staff||[]).map((x:any)=>({...x,location_name:x.locations?.name||"",active:x.active?1:0})),
    turns:(turns||[]).filter((x:any)=>ids.has(x.staff_id)),
    shiftTypes:shiftTypes?.length?shiftTypes:defaults
  });
}
export async function POST(request:NextRequest){
  const auth=await authenticate(request);if(!auth)return NextResponse.json({error:"Sesión no válida"},{status:401});
  const db=auth.db,body=await request.json();
  if(body.action==="addStaff"){
    const shopperId=String(body.shopperId||"").trim();
    const {error}=await db.from("shopper_staff").insert({name:String(body.name).trim(),shopper_external_id:shopperId||null,category:body.category,employment_type:body.employmentType,location_id:body.locationId});
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo agregar el shopper")},{status:400});
  }else if(body.action==="updateStaff"){
    const changes:Record<string,unknown>={name:String(body.name).trim(),shopper_external_id:String(body.shopperId||"").trim()||null};
    if(body.locationId)changes.location_id=Number(body.locationId);
    const {error}=await db.from("shopper_staff").update(changes).eq("id",body.id);
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo actualizar el shopper")},{status:400});
  }else if(body.action==="deleteStaff"){
    const staffId=Number(body.id);
    if(!Number.isFinite(staffId))return NextResponse.json({error:"Shopper inválido"},{status:400});
    const {error}=await db.from("shopper_staff").update({active:false}).eq("id",staffId);
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo eliminar el shopper del horario")},{status:400});
  }else if(body.action==="addShiftType"||body.action==="updateShiftType"){
    const free=Boolean(body.isFree);
    const code=String(body.code||"").trim().toUpperCase(),label=String(body.label||"").trim();
    const category=["purchase","delivery","both"].includes(body.category)?body.category:null;
    const locationId=Number(body.locationId);
    if(!/^[A-Z0-9_-]{1,6}$/.test(code))return NextResponse.json({error:"El código debe tener entre 1 y 6 letras o números"},{status:400});
    if(!label)return NextResponse.json({error:"Escribe el nombre del turno"},{status:400});
    if(!category)return NextResponse.json({error:"La categoría del turno no es válida"},{status:400});
    if(!free&&(!/^\d{2}:\d{2}$/.test(String(body.start||""))||!/^\d{2}:\d{2}$/.test(String(body.end||""))))return NextResponse.json({error:"Selecciona una hora de inicio y una hora de fin válidas"},{status:400});
    const editableValues={
      code,label,start_time:free?null:body.start,end_time:free?null:body.end,
      category,
      counts_opening:free?false:Boolean(body.countsOpening),
      counts_closing:free?false:Boolean(body.countsClosing),is_free:free,active:true
    };
    if(body.action==="updateShiftType"){
      const shiftTypeId=Number(body.id);
      if(!Number.isInteger(shiftTypeId)||shiftTypeId<=0)return NextResponse.json({error:"El turno seleccionado no es válido"},{status:400});
      const {data:updated,error}=await db.from("shopper_shift_types").update(editableValues).eq("id",shiftTypeId).select("id").maybeSingle();
      if(error)return NextResponse.json({error:databaseError(error,"No se pudo editar el turno")},{status:400});
      if(!updated)return NextResponse.json({error:"El turno no existe o no tienes acceso para editarlo"},{status:404});
      return NextResponse.json({ok:true,updated:true});
    }
    if(!Number.isFinite(locationId)||locationId<=0)return NextResponse.json({error:"Selecciona el local al que pertenece el turno"},{status:400});
    const values={...editableValues,location_id:locationId,created_by:auth.profile.id,is_general:false};
    const {data:existing,error:existingError}=await db.from("shopper_shift_types").select("id").eq("code",code).eq("category",category).eq("location_id",locationId).eq("created_by",auth.profile.id).maybeSingle();
    if(existingError)return NextResponse.json({error:databaseError(existingError,"No se pudo validar el turno del local")},{status:400});
    const operation=existing
      ?db.from("shopper_shift_types").update({...values,active:true}).eq("id",existing.id)
      :db.from("shopper_shift_types").insert(values);
    const {error}=await operation;
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo crear el turno para este local")},{status:400});
    return NextResponse.json({ok:true,updated:Boolean(existing)});
  }else if(body.action==="deleteShiftType"){
    const shiftTypeId=Number(body.id);
    if(!Number.isInteger(shiftTypeId)||shiftTypeId<=0)return NextResponse.json({error:"El turno seleccionado no es válido"},{status:400});
    const {data:removed,error}=await db.from("shopper_shift_types").update({active:false}).eq("id",shiftTypeId).select("id").maybeSingle();
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo eliminar el turno")},{status:400});
    if(!removed)return NextResponse.json({error:"El turno no existe o no tienes acceso para eliminarlo"},{status:404});
    return NextResponse.json({ok:true});
  }else if(body.action==="saveTurn"){
    const staffId=Number(body.staffId),shiftTypeId=Number(body.shiftTypeId);
    if(!Number.isFinite(staffId))return NextResponse.json({error:"El shopper seleccionado no es válido"},{status:400});
    if(invalidDate(body.workDate))return NextResponse.json({error:`La fecha debe estar entre ${SCHEDULE_MIN_DATE} y ${SCHEDULE_MAX_DATE}`},{status:400});
    if(!Number.isInteger(shiftTypeId))return NextResponse.json({error:"Selecciona un turno válido"},{status:400});
    const {data:staff,error:staffError}=await db.from("shopper_staff").select("id,category,location_id,active").eq("id",staffId).eq("active",true).maybeSingle();
    if(staffError)return NextResponse.json({error:databaseError(staffError,"No se pudo validar el shopper")},{status:400});
    if(!staff)return NextResponse.json({error:"El shopper no existe, está inactivo o no pertenece a tus locales"},{status:404});
    const {data:shiftTypes,error:shiftError}=await db.from("shopper_shift_types").select("id,code").eq("id",shiftTypeId).eq("active",true).or(`category.eq.${staff.category},category.eq.both`).or(`location_id.eq.${staff.location_id},location_id.is.null`).limit(1);
    if(shiftError)return NextResponse.json({error:databaseError(shiftError,"No se pudo validar el turno")},{status:400});
    const selectedShift=shiftTypes?.[0];
    if(!selectedShift)return NextResponse.json({error:"Ese turno no pertenece a tu cuenta o no está disponible para el local"},{status:400});
    const {data:savedTurn,error}=await db.from("shopper_turns")
      .upsert({staff_id:staffId,work_date:String(body.workDate),turn_code:selectedShift.code,shift_type_id:selectedShift.id,updated_at:new Date().toISOString()},{onConflict:"staff_id,work_date"})
      .select("id,staff_id,work_date,turn_code,shift_type_id")
      .single();
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo guardar el turno")},{status:400});
    return NextResponse.json({ok:true,turn:savedTurn});
  }else if(body.action==="fillTurns"){
    const legacyDate=String(body.workDate||"");
    const rawCells=Array.isArray(body.cells)?body.cells:[];
    const cellMap=new Map<string,{staffId:number;workDate:string}>();
    (rawCells.length?rawCells:(Array.isArray(body.staffIds)?body.staffIds:[]).map((staffId:unknown)=>({staffId,workDate:legacyDate}))).forEach((cell:any)=>{
      const staffId=Number(cell.staffId),workDate=String(cell.workDate||"");
      if(Number.isFinite(staffId))cellMap.set(`${staffId}-${workDate}`,{staffId,workDate});
    });
    const cells=[...cellMap.values()],staffIds=[...new Set(cells.map(cell=>cell.staffId))],shiftTypeId=Number(body.shiftTypeId);
    if(!cells.length||cells.length>500)return NextResponse.json({error:"Selecciona entre 1 y 500 celdas para copiar"},{status:400});
    if(cells.some(cell=>invalidDate(cell.workDate)))return NextResponse.json({error:`Todas las fechas deben estar entre ${SCHEDULE_MIN_DATE} y ${SCHEDULE_MAX_DATE}`},{status:400});
    if(!Number.isInteger(shiftTypeId))return NextResponse.json({error:"El turno que quieres copiar no es válido"},{status:400});
    const {data:staff,error:staffError}=await db.from("shopper_staff").select("id,category,location_id").in("id",staffIds).eq("active",true);
    if(staffError)return NextResponse.json({error:databaseError(staffError,"No se pudo validar a los shoppers")},{status:400});
    if((staff||[]).length!==staffIds.length)return NextResponse.json({error:"Uno de los shoppers no existe o no pertenece a tus locales"},{status:400});
    const {data:shiftTypes,error:shiftError}=await db.from("shopper_shift_types").select("id,code,category,location_id").eq("id",shiftTypeId).eq("active",true);
    if(shiftError)return NextResponse.json({error:databaseError(shiftError,"No se pudo validar el turno")},{status:400});
    const selectedShift=shiftTypes?.[0];
    const invalidStaff=(staff||[]).find((person:any)=>!selectedShift||(selectedShift.category!=="both"&&selectedShift.category!==person.category)||(selectedShift.location_id!==null&&Number(selectedShift.location_id)!==Number(person.location_id)));
    if(invalidStaff||!selectedShift)return NextResponse.json({error:"El turno no pertenece a tu cuenta o no está disponible para todas las filas"},{status:400});
    const rows=cells.map(cell=>({staff_id:cell.staffId,work_date:cell.workDate,turn_code:selectedShift.code,shift_type_id:selectedShift.id,updated_at:new Date().toISOString()}));
    const {error}=await db.from("shopper_turns").upsert(rows,{onConflict:"staff_id,work_date"});
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo copiar el turno")},{status:400});
    return NextResponse.json({ok:true,copied:rows.length});
  }else if(body.action==="copyWeek"){
    const start=new Date(`${body.sourceStart}T12:00:00`),end=new Date(start);end.setDate(end.getDate()+6);
    const {data:staff,error:se}=await db.from("shopper_staff").select("id").eq("category",body.category).eq("location_id",body.locationId).eq("active",true);
    if(se)return NextResponse.json({error:databaseError(se,"No se pudo consultar el personal del local")},{status:400});
    const ids=(staff||[]).map((x:any)=>x.id);if(!ids.length)return NextResponse.json({error:"No hay filas para copiar"},{status:400});
    const {data:source,error}=await db.from("shopper_turns").select("staff_id,work_date,turn_code,shift_type_id").in("staff_id",ids).gte("work_date",body.sourceStart).lte("work_date",end.toISOString().slice(0,10));
    if(error)return NextResponse.json({error:databaseError(error,"No se pudo leer la semana de origen")},{status:400});
    const rows=(source||[]).map((x:any)=>{const d=new Date(`${x.work_date}T12:00:00`);d.setDate(d.getDate()+7);return {...x,work_date:d.toISOString().slice(0,10),updated_at:new Date().toISOString()};});
    if(!rows.length)return NextResponse.json({error:"La semana no tiene turnos"},{status:400});
    const {error:ue}=await db.from("shopper_turns").upsert(rows,{onConflict:"staff_id,work_date"});if(ue)return NextResponse.json({error:databaseError(ue,"No se pudo copiar la semana")},{status:400});
    return NextResponse.json({ok:true,copied:rows.length});
  }else return NextResponse.json({error:"Acción desconocida"},{status:400});
  return NextResponse.json({ok:true});
}
