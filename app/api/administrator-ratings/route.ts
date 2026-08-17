import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type Profile = {
  id:string;
  email:string;
  full_name:string;
  app_role:"admin"|"supervisor";
  location_id:number|null;
  active:boolean;
};

const criteriaKeys=[
  "rule_compliance",
  "uniform_compliance",
  "ethics_compliance",
  "punctuality_compliance",
  "no_team_complaints"
] as const;

function tokenFrom(request:NextRequest){
  return request.headers.get("x-supabase-token")?.trim()||"";
}

function userClient(request:NextRequest){
  const token=tokenFrom(request);
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}}
  );
}

function isDate(value:unknown){
  const date=String(value||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(`${date}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
}

function moveDate(value:string,days:number){
  const date=new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function isMonday(value:string){
  return new Date(`${value}T12:00:00Z`).getUTCDay()===1;
}

function cleanText(value:unknown,maxLength:number){
  return String(value??"").trim().slice(0,maxLength);
}

function criterion(value:unknown):boolean|null|undefined{
  if(value===true||value==="true")return true;
  if(value===false||value==="false")return false;
  if(value===null||value==="na")return null;
  return undefined;
}

async function authenticate(request:NextRequest){
  const token=tokenFrom(request);
  if(!token)return {error:NextResponse.json({error:"Sesión no válida."},{status:401})};
  const db=userClient(request);
  const {data:{user},error:userError}=await db.auth.getUser(token);
  if(userError||!user)return {error:NextResponse.json({error:"Sesión no válida."},{status:401})};
  const {data:profile,error:profileError}=await db.from("profiles").select("id,email,full_name,app_role,location_id,active").eq("id",user.id).maybeSingle();
  if(profileError||!profile||!profile.active)return {error:NextResponse.json({error:"Usuario no autorizado."},{status:403})};
  return {db,profile:profile as Profile};
}

export async function GET(request:NextRequest){
  const auth=await authenticate(request);
  if(auth.error)return auth.error;
  const year=Number(request.nextUrl.searchParams.get("year")||new Date().getFullYear());
  if(!Number.isInteger(year)||year<2026||year>2100)return NextResponse.json({error:"El año solicitado no es válido."},{status:400});
  const first=`${year}-01-01`,last=`${year}-12-31`;

  if(auth.profile.app_role==="admin"){
    const {data,error}=await auth.db
      .from("administrator_evaluations")
      .select("*,locations(name,city),administrator_evaluation_results(compliant_count,applicable_count,score,semaphore,calculated_at)")
      .gte("week_start",first).lte("week_start",last)
      .order("week_start",{ascending:false}).order("location_id");
    if(error)return NextResponse.json({error:error.message},{status:400});
    return NextResponse.json({
      isAdmin:true,
      evaluations:(data||[]).map((row:any)=>({
        ...row,
        location_name:row.locations?.name||"",
        city:row.locations?.city||"",
        result:Array.isArray(row.administrator_evaluation_results)?row.administrator_evaluation_results[0]||null:row.administrator_evaluation_results||null,
        locations:undefined,
        administrator_evaluation_results:undefined
      }))
    });
  }

  const {data,error}=await auth.db
    .from("administrator_evaluations")
    .select("*,locations(name,city)")
    .gte("week_start",first).lte("week_start",last)
    .order("week_start",{ascending:false}).order("location_id");
  if(error)return NextResponse.json({error:error.message},{status:400});
  return NextResponse.json({
    isAdmin:false,
    evaluations:(data||[]).map((row:any)=>({
      ...row,
      location_name:row.locations?.name||"",
      city:row.locations?.city||"",
      locations:undefined
    }))
  });
}

export async function POST(request:NextRequest){
  const auth=await authenticate(request);
  if(auth.error)return auth.error;
  const body=await request.json().catch(()=>null) as Record<string,unknown>|null;
  if(!body)return NextResponse.json({error:"La evaluación no es válida."},{status:400});
  const locationId=Number(body.locationId);
  const weekStart=String(body.weekStart||"");
  const visitDate=String(body.visitDate||"");
  const nextVisitDate=body.nextVisitDate?String(body.nextVisitDate):null;
  if(!Number.isInteger(locationId)||locationId<=0)return NextResponse.json({error:"Selecciona un local válido."},{status:400});
  if(!isDate(weekStart)||!isMonday(weekStart))return NextResponse.json({error:"La semana debe comenzar en lunes."},{status:400});
  const weekEnd=moveDate(weekStart,6);
  if(!isDate(visitDate)||visitDate<weekStart||visitDate>weekEnd)return NextResponse.json({error:"La fecha de visita debe pertenecer a la semana seleccionada."},{status:400});
  if(nextVisitDate&&(!isDate(nextVisitDate)||nextVisitDate<visitDate))return NextResponse.json({error:"La próxima visita no puede ser anterior a la visita actual."},{status:400});

  const administratorName=cleanText(body.administratorName,160);
  if(administratorName.length<2)return NextResponse.json({error:"Ingresa el nombre del administrador evaluado."},{status:400});
  const administratorPosition=cleanText(body.administratorPosition,160);
  if(administratorPosition.length<2)return NextResponse.json({error:"Ingresa el puesto o función de la persona evaluada."},{status:400});
  const metricsSocialized=body.metricsSocialized===true||body.metricsSocialized==="true"?true:body.metricsSocialized===false||body.metricsSocialized==="false"?false:undefined;
  if(metricsSocialized===undefined)return NextResponse.json({error:"Indica si se socializaron las métricas con el administrador."},{status:400});
  const criteria=criteriaKeys.map(key=>criterion(body[key]));
  if(criteria.some(value=>value===undefined))return NextResponse.json({error:"Completa todos los criterios del checklist."},{status:400});
  const applicable=criteria.filter(value=>value!==null) as boolean[];
  if(!applicable.length)return NextResponse.json({error:"Al menos un criterio debe ser aplicable."},{status:400});

  const {data:location,error:locationError}=await auth.db.from("locations").select("id").eq("id",locationId).eq("active",true).maybeSingle();
  if(locationError||!location)return NextResponse.json({error:"El local seleccionado no está disponible."},{status:400});

  const now=new Date().toISOString();
  const editable={
    visit_date:visitDate,
    next_visit_date:nextVisitDate,
    administrator_name:administratorName,
    administrator_position:administratorPosition,
    administrator_phone:cleanText(body.administratorPhone,80),
    metrics_socialized:metricsSocialized,
    rule_compliance:criteria[0],
    uniform_compliance:criteria[1],
    ethics_compliance:criteria[2],
    punctuality_compliance:criteria[3],
    no_team_complaints:criteria[4],
    particular_observations:cleanText(body.particularObservations,4000),
    observations:cleanText(body.observations,4000),
    local_feedback:cleanText(body.localFeedback,4000),
    supervisor_feedback:cleanText(body.supervisorFeedback,4000),
    updated_at:now
  };
  const {data:existing,error:existingError}=await auth.db
    .from("administrator_evaluations").select("id")
    .eq("location_id",locationId).eq("week_start",weekStart).maybeSingle();
  if(existingError)return NextResponse.json({error:existingError.message},{status:400});

  let evaluationId:number;
  if(existing){
    const {data:updated,error:updateError}=await auth.db.from("administrator_evaluations").update(editable).eq("id",existing.id).select("id").single();
    if(updateError)return NextResponse.json({error:updateError.message},{status:400});
    evaluationId=Number(updated.id);
  }else{
    const {data:inserted,error:insertError}=await auth.db.from("administrator_evaluations").insert({
      location_id:locationId,week_start:weekStart,week_end:weekEnd,
      ...editable
    }).select("id").single();
    if(insertError)return NextResponse.json({error:insertError.message},{status:400});
    evaluationId=Number(inserted.id);
  }

  return NextResponse.json({ok:true,id:evaluationId});
}
