import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "jsr:@supabase/supabase-js@2.110.9";

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods":"POST, OPTIONS"
};

function json(body:Record<string,unknown>,status=200){
  return new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
}

function temporaryPassword(){
  const values=new Uint32Array(1);
  crypto.getRandomValues(values);
  return `Tipti-${String(values[0]%1000000).padStart(6,"0")}`;
}

Deno.serve(async(req:Request)=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST")return json({error:"Método no permitido."},405);
  const authorization=req.headers.get("Authorization")||"";
  if(!authorization.startsWith("Bearer "))return json({error:"Sesión no válida."},401);

  const url=Deno.env.get("SUPABASE_URL");
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anonKey||!serviceKey)return json({error:"El servicio de contraseñas no está configurado."},500);

  const authClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const service=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:userError}=await authClient.auth.getUser();
  if(userError||!user)return json({error:"Sesión no válida."},401);
  const body=await req.json().catch(()=>null) as {action?:string;userId?:string}|null;
  if(!body)return json({error:"Solicitud no válida."},400);

  if(body.action==="complete-change"){
    const {error}=await service.auth.admin.updateUserById(user.id,{
      app_metadata:{...(user.app_metadata||{}),must_change_password:false}
    });
    if(error)return json({error:"No se pudo finalizar el cambio de contraseña."},400);
    return json({ok:true});
  }

  if(body.action!=="reset-user")return json({error:"Acción desconocida."},400);
  const {data:profile}=await service.from("profiles").select("app_role,active").eq("id",user.id).maybeSingle();
  if(profile?.app_role!=="admin"||!profile.active)return json({error:"Solo el administrador puede restablecer contraseñas."},403);
  const targetId=String(body.userId||"");
  if(!/^[0-9a-f-]{36}$/i.test(targetId))return json({error:"Usuario no válido."},400);
  const {data:targetProfile}=await service.from("profiles").select("app_role").eq("id",targetId).maybeSingle();
  if(!targetProfile||targetProfile.app_role==="admin")return json({error:"No se encontró una cuenta permitida."},404);
  const {data:{user:targetUser},error:targetError}=await service.auth.admin.getUserById(targetId);
  if(targetError||!targetUser)return json({error:"No se encontró la cuenta de acceso."},404);

  const password=temporaryPassword();
  const {error:updateError}=await service.auth.admin.updateUserById(targetId,{
    password,
    app_metadata:{...(targetUser.app_metadata||{}),must_change_password:true}
  });
  if(updateError)return json({error:"No se pudo generar la contraseña temporal."},400);
  return json({ok:true,temporaryPassword:password});
});
