"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";

type Shift = { time: string; role: string; tone: "blue" | "green" | "orange" | "yellow" };
type Person = { id: number; name: string; location: string; initials: string; shifts: (Shift | null)[] };
type LocationRow = { id:number; name:string; city:string; active:number };
type RoleRow = { id:number; name:string; color:Shift["tone"] | "purple"; active:number };
type SupervisorRow = { id:number; name:string; location_id:number; location_name:string; city:string; active:number };
type AssignmentRow = { id:number; supervisor_id:number; work_date:string; start_time:string|null; end_time:string|null; role_id:number; role_name:string; color:Shift["tone"]; hours:number };
type CurrentUser = { email:string; name:string; role:"admin"|"supervisor"; locationId:number|null };
type DataSet = { locations:LocationRow[]; roles:RoleRow[]; supervisors:SupervisorRow[]; assignments:AssignmentRow[]; currentUser:CurrentUser };
type AccessUserRow = { id:number; email:string; name:string; role:string; location_id:number; location_name:string; active:number };

const locations = [
  "Todos los locales", "MX. Village Plaza", "SX. Plaza Batán", "SX. Villa Club",
  "MX. Ceibos", "SX. Ciudad Celeste", "MX. City Mall", "MX. Mall del Sol",
  "SX. Vistana", "SX. Vía a la Costa", "MX. Mall del Norte", "MX. Mall del Sur",
  "Akí Astillero", "Akí Mapasingue", "Akí La Joya", "MX. Wayra", "SX. Vergel",
  "SX. Don Bosco", "SX. Chaullabamba", "Super Akí Narancay", "SX. Pradera",
  "MX. Mall del Pacífico", "Supermaxi Salinas", "Akí Pedernales"
];

const shift = (time: string, role: string, tone: Shift["tone"]): Shift => ({ time, role, tone });
const adminNav = [
  ["▦", "Panel general"], ["▣", "Horarios"], ["♙", "Supervisores"],
  ["◫", "Turnos y roles"], ["⌂", "Locales"], ["▥", "Reportes"], ["⚿", "Accesos"]
];
const supervisorNav = [["▣", "Horarios"],["▥", "Reportes"]];

function hoursFor(person: Person) {
  return Math.round(person.shifts.reduce((total, item) => total + shiftHours(item), 0) * 100) / 100;
}

function shiftHours(item: Shift | null) {
  if (!item || item.time === "LIBRE" || item.role === "Vacaciones") return 0;
  const times = item.time.match(/\d{2}:\d{2}/g);
  if (!times || times.length < 2) return 0;
  const [start,end] = times.map(value => {
    const [hours,minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
  });
  let difference = end - start;
  if (difference < 0) difference += 24 * 60;
  return difference / 60;
}

function displayHours(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/,"");
}

function shiftTime(item: Shift | null, position: 0 | 1, fallback: string) {
  if (!item || item.time === "LIBRE" || item.role === "Vacaciones") return fallback;
  return item.time.match(/\d{2}:\d{2}/g)?.[position] ?? fallback;
}

function excelEscape(value: unknown) {
  return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export default function Home() {
  const [mobileMenuOpen,setMobileMenuOpen] = useState(false);
  const [sessionReady,setSessionReady] = useState(false);
  const [loginEmail,setLoginEmail] = useState("");
  const [loginPassword,setLoginPassword] = useState("");
  const [registering,setRegistering] = useState(false);
  const [loginName,setLoginName] = useState("");
  const [loginError,setLoginError] = useState("");
  const [active, setActive] = useState("Panel general");
  const [location, setLocation] = useState("Todos los locales");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [modal, setModal] = useState<{ person: Person; day: number } | null>(null);
  const [data, setData] = useState<DataSet | null>(null);
  const [create, setCreate] = useState<"location" | "supervisor" | "role" | null>(null);
  const [editSupervisor, setEditSupervisor] = useState<SupervisorRow | null>(null);
  const [notice, setNotice] = useState("");
  const [weekStart, setWeekStart] = useState("2026-07-27");
  const [reportLocation, setReportLocation] = useState("");
  const [reportStart, setReportStart] = useState("2026-07-27");
  const [reportEnd, setReportEnd] = useState("2026-07-31");
  const [accessState, setAccessState] = useState<"loading"|"authorized"|"signin"|"denied">("loading");
  const [accessUsers, setAccessUsers] = useState<AccessUserRow[]>([]);

  const dateKeys = useMemo(() => Array.from({length:7},(_,i) => {
    const d = new Date(`${weekStart}T12:00:00`);
    d.setDate(d.getDate()+i);
    return d.toISOString().slice(0,10);
  }), [weekStart]);
  const days = useMemo(() => {
    const names = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
    return dateKeys.map(x => { const d = new Date(`${x}T12:00:00`); return `${names[d.getDay()]} ${String(d.getDate()).padStart(2,"0")}`; });
  }, [dateKeys]);
  const weekLabel = useMemo(() => {
    const months = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
    const a = new Date(`${dateKeys[0]}T12:00:00`), b = new Date(`${dateKeys[6]}T12:00:00`);
    return `${String(a.getDate()).padStart(2,"0")} ${months[a.getMonth()]} — ${String(b.getDate()).padStart(2,"0")} ${months[b.getMonth()]} ${b.getFullYear()}`;
  },[dateKeys]);

  async function apiFetch(path:string, init:RequestInit = {}) {
    const {data:{session}} = await supabase.auth.getSession();
    const headers = new Headers(init.headers);
    if (session?.access_token) headers.set("x-supabase-token",session.access_token);
    return fetch(path,{...init,headers});
  }

  async function loadData() {
    try {
      const response = await apiFetch("/api/data");
      if (!response.ok) {
        if (response.status === 401) { setAccessState("signin"); return; }
        if (response.status === 403) { setAccessState("denied"); return; }
        const problem = await response.json().catch(() => ({error:"No se pudo conectar con el almacenamiento"})) as {error?:string};
        setNotice(`Error de almacenamiento: ${problem.error ?? "No disponible"}`);
        return;
      }
      const payload = await response.json() as DataSet;
      setData(payload);
      setAccessState("authorized");
      if (payload.currentUser.role === "supervisor" && payload.locations[0]) {
        setLocation(payload.locations[0].name);
        setReportLocation(payload.locations[0].name);
        setActive("Horarios");
      }
    } catch { setNotice("No se pudo conectar con el almacenamiento. Intenta nuevamente."); }
  }

  useEffect(() => {
    supabase.auth.getSession().then(({data:{session}}) => {
      setSessionReady(true);
      if (session) void loadData(); else setAccessState("signin");
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_event,session) => {
      setSessionReady(true);
      if (session) { setAccessState("loading"); void loadData(); }
      else { setData(null); setAccessState("signin"); }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (active === "Accesos" && data?.currentUser.role === "admin") void loadAccessUsers();
  },[active,data?.currentUser.role]);
  useEffect(() => {
    if (!data) return;
    setPeople(data.supervisors.filter(s => s.active === 1).map(s => ({
      id:s.id, name:s.name, location:s.location_name,
      initials:s.name.split(" ").map(x => x[0]).join("").slice(0,2).toUpperCase(),
      shifts:dateKeys.map(date => {
        const a = data.assignments.find(x => x.supervisor_id === s.id && x.work_date === date);
        if (!a) return null;
        const isRest = a.role_name === "Descanso" || a.role_name === "Vacaciones";
        return { time:isRest ? "LIBRE" : `${a.start_time} — ${a.end_time}`, role:a.role_name, tone:a.color ?? "blue" };
      })
    })));
  }, [data, dateKeys]);

  const filtered = useMemo(() => people.filter(p =>
    (location === "Todos los locales" || p.location === location) &&
    p.name.toLowerCase().includes(query.toLowerCase())
  ), [people, location, query]);

  const reportRows = useMemo(() => {
    if (!data || !reportLocation || !reportStart || !reportEnd) return [];
    const supervisorsById = new Map(data.supervisors.map(s => [s.id,s]));
    return data.assignments
      .filter(a => a.work_date >= reportStart && a.work_date <= reportEnd)
      .map(a => ({assignment:a,supervisor:supervisorsById.get(a.supervisor_id)}))
      .filter(row => row.supervisor?.location_name === reportLocation)
      .sort((a,b) => a.assignment.work_date.localeCompare(b.assignment.work_date) || (a.supervisor?.name ?? "").localeCompare(b.supervisor?.name ?? ""));
  },[data,reportLocation,reportStart,reportEnd]);

  const reportSummary = useMemo(() => {
    const summary = new Map<number,{name:string;hours:number;worked:number;free:number;vacations:number}>();
    reportRows.forEach(({assignment,supervisor}) => {
      if (!supervisor) return;
      const current = summary.get(supervisor.id) ?? {name:supervisor.name,hours:0,worked:0,free:0,vacations:0};
      const isVacation = assignment.role_name === "Vacaciones";
      const isFree = assignment.role_name === "Descanso" || isVacation;
      current.hours += Number(assignment.hours ?? 0);
      if (isFree) current.free += 1; else current.worked += 1;
      if (isVacation) current.vacations += 1;
      summary.set(supervisor.id,current);
    });
    return [...summary.values()].sort((a,b) => a.name.localeCompare(b.name));
  },[reportRows]);

  function downloadExcelReport() {
    if (!reportLocation) { setNotice("Selecciona el local del reporte"); return; }
    if (!reportStart || !reportEnd || reportStart > reportEnd) { setNotice("Selecciona un rango de fechas válido"); return; }
    if (!reportRows.length) { setNotice("No existen horarios guardados para ese local y rango"); return; }
    const detailRows = reportRows.map(({assignment,supervisor}) => {
      const free = assignment.role_name === "Descanso" || assignment.role_name === "Vacaciones";
      return [assignment.work_date,supervisor?.name,reportLocation,assignment.role_name,free?"":assignment.start_time,free?"":assignment.end_time,Number(assignment.hours ?? 0),free?"Libre":"Trabajado"];
    });
    const cell = (value:unknown,type:"String"|"Number"="String") => `<Cell><Data ss:Type="${type}">${excelEscape(value)}</Data></Cell>`;
    const row = (values:unknown[],numeric:number[] = []) => `<Row>${values.map((v,i)=>cell(v,numeric.includes(i)?"Number":"String")).join("")}</Row>`;
    const workbook = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles><Style ss:ID="Header"><Font ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#12304A" ss:Pattern="Solid"/></Style></Styles>
<Worksheet ss:Name="Resumen"><Table>
<Row><Cell ss:StyleID="Header"><Data ss:Type="String">Supervisor</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Local</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Horas totales</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Días trabajados</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Días libres</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Vacaciones</Data></Cell></Row>
${reportSummary.map(s=>row([s.name,reportLocation,s.hours,s.worked,s.free,s.vacations],[2,3,4,5])).join("")}
</Table></Worksheet>
<Worksheet ss:Name="Detalle diario"><Table>
<Row><Cell ss:StyleID="Header"><Data ss:Type="String">Fecha</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Supervisor</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Local</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Rol</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Entrada</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Salida</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Horas</Data></Cell><Cell ss:StyleID="Header"><Data ss:Type="String">Estado</Data></Cell></Row>
${detailRows.map(values=>row(values,[6])).join("")}
</Table></Worksheet></Workbook>`;
    const blob = new Blob([workbook],{type:"application/vnd.ms-excel;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href=url;
    link.download=`Horario_${reportLocation.replace(/[^a-z0-9]+/gi,"_")}_${reportStart}_${reportEnd}.xls`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice("✓ Reporte de Excel generado correctamente");
  }

  async function saveShift(form: FormData) {
    if (!modal) return;
    const role = String(form.get("role"));
    const start = String(form.get("start"));
    const end = String(form.get("end"));
    const tones: Record<string, Shift["tone"]> = { "Compra / Procesos": "blue", "Certificaciones": "green", "Cierre": "orange", "Descanso": "yellow", "Vacaciones": "yellow", "Total": "blue" };
    const countsAsFree = role === "Descanso" || role === "Vacaciones";
    const next = countsAsFree ? shift("LIBRE", role, "yellow") : shift(`${start} — ${end}`, role, tones[role] ?? "blue");
    setPeople(list => list.map(p => p.id === modal.person.id ? { ...p, shifts: p.shifts.map((s, i) => i === modal.day ? next : s) } : p));
    const roleRow = data?.roles.find(r => r.name === role);
    if (roleRow) {
      const response = await apiFetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
        action:"saveAssignment",supervisorId:modal.person.id,workDate:dateKeys[modal.day],
        start:countsAsFree ? null : start,end:countsAsFree ? null : end,roleId:roleRow.id
      })});
      if (response.ok) {
        setNotice("✓ Turno guardado permanentemente");
        await loadData();
      } else {
        const problem = await response.json().catch(()=>({error:"No se pudo guardar"})) as {error?:string};
        setNotice(`Error: ${problem.error ?? "No se pudo guardar"}`);
      }
    }
    setModal(null);
  }

  function changeWeek(offset:number) {
    const d = new Date(`${weekStart}T12:00:00`);
    d.setDate(d.getDate()+offset*7);
    const min = new Date("2026-07-27T12:00:00"), max = new Date("2026-12-28T12:00:00");
    if (d < min || d > max) { setNotice("El calendario disponible va hasta el 31 de diciembre de 2026"); return; }
    setWeekStart(d.toISOString().slice(0,10));
  }

  async function createRecord(form: FormData) {
    if (!create) return;
    const payload = create === "location"
      ? {action:"addLocation",name:form.get("name"),city:form.get("city")}
      : create === "supervisor"
      ? {action:"addSupervisor",name:form.get("name"),locationId:Number(form.get("locationId"))}
      : {action:"addRole",name:form.get("name"),color:form.get("color")};
    const response = await apiFetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    if (response.ok) {
      setCreate(null);
      setNotice("✓ Registro creado y almacenado permanentemente");
      await loadData();
    } else {
      const problem = await response.json().catch(()=>({error:"No se pudo guardar"})) as {error?:string};
      setNotice(`Error: ${problem.error ?? "No se pudo guardar"}`);
    }
  }

  async function updateSupervisor(form: FormData) {
    if (!editSupervisor) return;
    const response = await apiFetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"updateSupervisor",
      id:editSupervisor.id,
      name:String(form.get("name") ?? "").trim(),
      locationId:Number(form.get("locationId")),
      active:Number(form.get("active"))
    })});
    if (response.ok) {
      setEditSupervisor(null);
      setNotice("✓ Supervisor actualizado y almacenado permanentemente");
      await loadData();
    } else {
      const problem = await response.json().catch(()=>({error:"No se pudo actualizar"})) as {error?:string};
      setNotice(`Error: ${problem.error ?? "No se pudo actualizar"}`);
    }
  }

  function openSupervisorEditor(person: Person) {
    const supervisor = data?.supervisors.find(s => s.id === person.id);
    if (supervisor) setEditSupervisor(supervisor);
  }

  async function removeSupervisorRow(person: Person) {
    const supervisor = data?.supervisors.find(s => s.id === person.id);
    if (!supervisor || !window.confirm(`¿Quitar a ${person.name} de los horarios activos? Su historial quedará guardado.`)) return;
    const response = await apiFetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"updateSupervisor",id:supervisor.id,name:supervisor.name,locationId:supervisor.location_id,active:0
    })});
    if (response.ok) {
      setNotice("✓ Fila retirada; el historial se mantiene almacenado");
      await loadData();
    } else {
      setNotice("Error: no se pudo quitar la fila");
    }
  }

  async function loadAccessUsers() {
    const response = await apiFetch("/api/access");
    if (!response.ok) return;
    const payload = await response.json() as {users:AccessUserRow[]};
    setAccessUsers(payload.users);
  }

  async function saveAccessUser(form: FormData) {
    const response = await apiFetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"save",name:form.get("name"),email:form.get("email"),locationId:Number(form.get("locationId"))
    })});
    if (response.ok) {
      setNotice("✓ Usuario registrado como supervisor");
      await loadAccessUsers();
    } else {
      const problem = await response.json().catch(()=>({error:"No se pudo registrar"})) as {error?:string};
      setNotice(`Error: ${problem.error ?? "No se pudo registrar"}`);
    }
  }

  async function toggleAccessUser(user:AccessUserRow) {
    const response = await apiFetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"toggle",id:user.id,active:user.active===1?0:1
    })});
    if (response.ok) {
      setNotice(user.active===1?"✓ Acceso bloqueado":"✓ Acceso reactivado");
      await loadAccessUsers();
    }
  }

  async function submitLogin(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoginError("");
    if (registering) {
      const {error} = await supabase.auth.signUp({email:loginEmail,password:loginPassword,options:{data:{full_name:loginName}}});
      setLoginError(error ? error.message : "Cuenta creada. Confirma tu correo y espera que el administrador active tu acceso.");
    } else {
      const {error} = await supabase.auth.signInWithPassword({email:loginEmail,password:loginPassword});
      if (error) setLoginError("Correo o contraseña incorrectos.");
    }
  }

  if (!sessionReady || accessState === "loading") return <main className="access-gate"><div className="gate-card"><span className="gate-mark">T</span><h1>Verificando acceso</h1><p>Estamos validando tu cuenta y permisos.</p></div></main>;
  if (accessState === "signin") return <main className="access-gate"><form className="gate-card login-form" onSubmit={submitLogin}><span className="gate-mark">T</span><h1>Acceso privado</h1><p>{registering?"Crea tu cuenta de supervisor":"Ingresa con tu correo y contraseña."}</p>{registering&&<label>Nombre completo<input value={loginName} onChange={e=>setLoginName(e.target.value)} required /></label>}<label>Correo<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required /></label><label>Contraseña<input type="password" minLength={8} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required /></label>{loginError&&<small className="login-error">{loginError}</small>}<button className="primary gate-action">{registering?"Crear cuenta":"Iniciar sesión"}</button><button type="button" className="secondary gate-action" onClick={()=>{setRegistering(!registering);setLoginError("")}}>{registering?"Ya tengo cuenta":"Crear cuenta"}</button></form></main>;
  if (accessState === "denied") return <main className="access-gate"><div className="gate-card denied"><span className="gate-mark">×</span><h1>Acceso no autorizado</h1><p>Tu cuenta todavía no fue activada o fue bloqueada.</p><button className="secondary gate-action" onClick={()=>supabase.auth.signOut()}>Cambiar de cuenta</button></div></main>;

  const isAdmin = data?.currentUser.role === "admin";
  const visibleNav = isAdmin ? adminNav : supervisorNav;

  return (
    <main className="app-shell">
      <button className="mobile-menu-toggle" aria-label="Abrir menú" onClick={()=>setMobileMenuOpen(true)}>☰ <span>Menú</span></button>
      {mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label="Cerrar menú" onClick={()=>setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen?"mobile-open":""}`}>
        <button className="mobile-menu-close" aria-label="Cerrar menú" onClick={()=>setMobileMenuOpen(false)}>×</button>
        <div className="brand"><span>TIPTI · OPERACIONES</span><strong>Región Intercity</strong></div>
        <nav>{visibleNav.map(([icon,label]) => <button key={label} className={active === label ? "active" : ""} onClick={() => {setActive(label);setMobileMenuOpen(false)}}><i>{icon}</i>{label}</button>)}</nav>
        <div className="profile"><div className="avatar admin">{data?.currentUser.name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div><div><strong>{data?.currentUser.name}</strong><span>{isAdmin?"Administrador total":"Supervisor de local"}</span></div></div>
        <button className="logout" onClick={() => {setMobileMenuOpen(false);void supabase.auth.signOut()}}>↪ Cerrar sesión</button>
        {isAdmin && <button className="settings" onClick={() => {setActive("Configuración");setMobileMenuOpen(false)}}>⚙ Configuración</button>}
      </aside>

      <section className="workspace">
        <header>
          <div><p className="eyebrow">CONTROL OPERATIVO REGIONAL</p><h1>{active}</h1><p>Planificación y control semanal de supervisión</p></div>
          <div className="header-actions"><button className="secondary" onClick={() => window.print()}>⇩ Exportar</button><button className="primary" onClick={() => {setActive("Horarios");setNotice("Selecciona una semana y agrega los turnos en las celdas vacías");}}>＋ Nuevo horario</button></div>
        </header>

        <section className="kpis">
          <article><span>Supervisores activos</span><strong>{data?.supervisors.filter(s=>s.active===1).length ?? people.length}</strong><small className="ok">● Nómina disponible</small></article>
          <article><span>Horas planificadas</span><strong>{displayHours(people.reduce((n,p) => n + hoursFor(p),0))} h</strong><small>Calculadas según cada rango</small></article>
          <article><span>Cobertura semanal</span><strong>96%</strong><div className="progress"><i /></div></article>
          <article><span>{isAdmin?"Locales registrados":"Local asignado"}</span><strong>{data?.locations.length ?? 0}</strong><small className="warn">{isAdmin?"Administrables":"Acceso limitado"}</small></article>
        </section>

        {(active === "Panel general" || active === "Horarios") && <section className="schedule-card">
          <div className="schedule-title"><div><h2>Horario semanal</h2><p>{isAdmin?"Haz clic en el nombre para editar al supervisor o en cualquier turno para modificarlo":"Puedes modificar únicamente los turnos del local que tienes asignado"}</p></div><div className="schedule-actions">{isAdmin && <button className="copy" onClick={() => setCreate("supervisor")}>＋ Agregar fila</button>}<button className="copy" onClick={() => setNotice("Usa la siguiente semana y completa o ajusta sus turnos")}>▣ Copiar semana</button></div></div>
          <div className="toolbar">
            <div className="week"><button aria-label="Semana anterior" onClick={() => changeWeek(-1)}>‹</button><strong>{weekLabel}</strong><button aria-label="Semana siguiente" onClick={() => changeWeek(1)}>›</button></div>
            <select value={location} disabled={!isAdmin} onChange={e => setLocation(e.target.value)}>{isAdmin && <option>Todos los locales</option>}{(data?.locations.map(l => l.name) ?? locations.slice(1)).map(l => <option key={l}>{l}</option>)}</select>
            <input aria-label="Buscar supervisor" placeholder="⌕  Buscar supervisor..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>Supervisor</th>{days.map(d => <th key={d}>{d}</th>)}<th>Horas</th></tr></thead>
            <tbody>{filtered.map(person => <tr key={person.id}>
              <td><div className="person"><span className="avatar">{person.initials}</span><div className="person-info"><button className="person-name" disabled={!isAdmin} onClick={() => isAdmin && openSupervisorEditor(person)}>{person.name} {isAdmin && <span>✎</span>}</button><small>{person.location}</small></div>{isAdmin && <button className="remove-row" aria-label={`Quitar fila de ${person.name}`} title="Quitar fila" onClick={() => void removeSupervisorRow(person)}>×</button>}</div></td>
              {person.shifts.map((item, day) => <td key={day}><button className={`shift ${item?.tone ?? "empty"}`} onClick={() => setModal({person,day})}>{item ? <><strong>{item.time}</strong><span>{item.role}</span></> : <><strong>＋ Agregar</strong><span>turno</span></>}</button></td>)}
              <td className="hours">{displayHours(hoursFor(person))} h</td>
            </tr>)}</tbody>
          </table></div>
        </section>}

        {active === "Locales" && <section className="management-card">
          <div className="management-head"><div><h2>Locales de la región</h2><p>Todos los puntos forman parte de la nómina regional.</p></div><button className="primary" onClick={() => setCreate("location")}>＋ Agregar local</button></div>
          <div className="cards-grid">{(data?.locations ?? []).map(l => <article key={l.id}><span className="entity-icon">⌂</span><div><strong>{l.name}</strong><p>{l.city}</p></div><span className="status">Activo</span></article>)}</div>
        </section>}

        {active === "Supervisores" && <section className="management-card">
          <div className="management-head"><div><h2>Nómina de supervisores</h2><p>Asigna cada supervisor al local donde opera.</p></div><button className="primary" onClick={() => setCreate("supervisor")}>＋ Agregar supervisor</button></div>
          <div className="directory">{(data?.supervisors ?? []).map(s => <article key={s.id}><span className="avatar">{s.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><div><strong>{s.name}</strong><p>{s.location_name} · {s.city}</p></div><span className={s.active===1?"status":"status inactive"}>{s.active===1?"Activo":"Inactivo"}</span><button className="edit-entity" onClick={()=>setEditSupervisor(s)}>✎ Editar</button></article>)}</div>
        </section>}

        {active === "Turnos y roles" && <section className="management-card">
          <div className="management-head"><div><h2>Turnos y roles</h2><p>Crea las actividades utilizadas en cada horario.</p></div><button className="primary" onClick={() => setCreate("role")}>＋ Crear rol</button></div>
          <div className="role-grid">{(data?.roles ?? []).map(r => <article key={r.id}><i className={`role-dot ${r.color}`} /><strong>{r.name}</strong><span className="status">Disponible</span></article>)}</div>
        </section>}

        {active === "Reportes" && <section className="management-card">
          <div className="management-head"><div><h2>Reporte de horarios por local</h2><p>Selecciona el local y cualquier rango de fechas para generar el archivo de Excel.</p></div><button className="primary" onClick={downloadExcelReport}>⇩ Generar Excel</button></div>
          <div className="report-filters">
            <label>Local<select value={reportLocation} disabled={!isAdmin} onChange={e=>setReportLocation(e.target.value)}>{isAdmin && <option value="">Seleccionar local</option>}{data?.locations.map(l=><option key={l.id} value={l.name}>{l.name} · {l.city}</option>)}</select></label>
            <label>Desde<input type="date" min="2026-07-27" max="2026-12-31" value={reportStart} onChange={e=>setReportStart(e.target.value)} /></label>
            <label>Hasta<input type="date" min="2026-07-27" max="2026-12-31" value={reportEnd} onChange={e=>setReportEnd(e.target.value)} /></label>
          </div>
          <div className="report-note"><strong>{reportRows.length}</strong><span>turnos encontrados</span><strong>{displayHours(reportSummary.reduce((sum,row)=>sum+row.hours,0))} h</strong><span>horas en el período</span></div>
          <div className="report-table"><div className="report-row report-head"><span>Supervisor</span><span>Local</span><span>Horas</span><span>Días</span></div>{reportSummary.length ? reportSummary.map(s => <div className="report-row" key={s.name}><strong>{s.name}</strong><span>{reportLocation}</span><strong>{displayHours(s.hours)} h</strong><span className="ok-pill">{s.worked} trabajados · {s.free} libres</span></div>) : <div className="empty-report">Selecciona un local y el rango de fechas para revisar el resumen antes de descargarlo.</div>}</div>
        </section>}

        {active === "Accesos" && isAdmin && <section className="management-card">
          <div className="management-head"><div><h2>Administración de accesos</h2><p>Registra previamente a cada supervisor y asígnalo a un solo local.</p></div><span className="admin-lock">Administrador: solo tú</span></div>
          <form className="access-form" onSubmit={e=>{e.preventDefault();void saveAccessUser(new FormData(e.currentTarget));e.currentTarget.reset();}}>
            <label>Nombre completo<input name="name" required placeholder="Nombre del supervisor" /></label>
            <label>Correo de acceso<input name="email" type="email" required placeholder="usuario@correo.com" /></label>
            <label>Local asignado<select name="locationId" required defaultValue=""><option value="" disabled>Seleccionar local</option>{data?.locations.map(l=><option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select></label>
            <button className="primary">＋ Registrar usuario</button>
          </form>
          <div className="access-list">
            <div className="access-row access-head"><span>Usuario</span><span>Correo</span><span>Local permitido</span><span>Acceso</span></div>
            {accessUsers.length ? accessUsers.map(user=><div className="access-row" key={user.id}>
              <strong>{user.name}</strong><span>{user.email}</span><span>{user.location_name}</span>
              <button className={user.active===1?"access-active":"access-blocked"} onClick={()=>void toggleAccessUser(user)}>{user.active===1?"Activo · Bloquear":"Bloqueado · Reactivar"}</button>
            </div>) : <div className="empty-report">Todavía no has registrado supervisores con acceso.</div>}
          </div>
        </section>}

        {active === "Configuración" && <section className="management-card"><div className="management-head"><div><h2>Configuración administrativa</h2><p>Tienes acceso total a los catálogos y a toda la información almacenada.</p></div></div><div className="settings-grid"><article><strong>Datos persistentes</strong><p>Los locales, supervisores, roles y horarios se guardan en la base del sistema.</p></article><article><strong>Acceso de administrador</strong><p>Daniel Castillo · Control total del sistema.</p></article><article><strong>Historial</strong><p>Las asignaciones permanecen disponibles para reportes y consultas futuras.</p></article></div></section>}
      </section>

      {notice && <button className="toast" onClick={() => setNotice("")}>{notice} ×</button>}
      {modal && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><form className="modal" onSubmit={e => {e.preventDefault(); saveShift(new FormData(e.currentTarget));}} onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="close" onClick={() => setModal(null)}>×</button>
        <span className="modal-kicker">EDITAR ASIGNACIÓN</span><h2>{modal.person.name}</h2><p>{days[modal.day]} · {modal.person.location}</p>
        <label>Rol<select name="role" defaultValue={modal.person.shifts[modal.day]?.role ?? "Compra / Procesos"}>{(data?.roles.map(r=>r.name) ?? ["Compra / Procesos","Certificaciones / Grupos","Cierre","Shopper","Descanso","Total","Vacaciones"]).map(r=><option key={r}>{r}</option>)}</select></label>
        <div className="time-row"><label>Entrada<input name="start" type="time" defaultValue={shiftTime(modal.person.shifts[modal.day],0,"06:00")} /></label><label>Salida<input name="end" type="time" defaultValue={shiftTime(modal.person.shifts[modal.day],1,"14:00")} /></label></div>
        <small className="hours-preview">Las horas se calculan automáticamente. Vacaciones se registra como libre y suma 0 horas.</small>
        <button className="primary save">Guardar turno</button>
      </form></div>}
      {create && <div className="modal-backdrop" onMouseDown={() => setCreate(null)}><form className="modal" onSubmit={e => {e.preventDefault(); void createRecord(new FormData(e.currentTarget));}} onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="close" onClick={() => setCreate(null)}>×</button>
        <span className="modal-kicker">NUEVO REGISTRO</span><h2>{create === "location" ? "Agregar local" : create === "supervisor" ? "Agregar supervisor" : "Crear rol"}</h2><p>La información quedará almacenada permanentemente.</p>
        <label>Nombre<input name="name" required placeholder={create === "location" ? "Ej. MX. Nuevo local" : create === "supervisor" ? "Nombre completo" : "Ej. Apertura"} /></label>
        {create === "location" && <label>Ciudad<input name="city" required placeholder="Ciudad" /></label>}
        {create === "supervisor" && <label>Local<select name="locationId" required defaultValue={data?.locations.find(l=>l.name===location)?.id}>{data?.locations.map(l=><option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select></label>}
        {create === "role" && <label>Color<select name="color"><option value="blue">Azul</option><option value="green">Verde</option><option value="orange">Naranja</option><option value="yellow">Amarillo</option><option value="purple">Morado</option></select></label>}
        <button className="primary save">Guardar</button>
      </form></div>}
      {editSupervisor && <div className="modal-backdrop" onMouseDown={() => setEditSupervisor(null)}><form className="modal" onSubmit={e => {e.preventDefault(); void updateSupervisor(new FormData(e.currentTarget));}} onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="close" onClick={() => setEditSupervisor(null)}>×</button>
        <span className="modal-kicker">EDITAR SUPERVISOR</span><h2>{editSupervisor.name}</h2><p>Los cambios conservarán todo su historial de horarios.</p>
        <label>Nombre completo<input name="name" required defaultValue={editSupervisor.name} /></label>
        <label>Local asignado<select name="locationId" required defaultValue={editSupervisor.location_id}>{data?.locations.map(l=><option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select></label>
        <label>Estado<select name="active" defaultValue={editSupervisor.active}><option value="1">Activo</option><option value="0">Inactivo</option></select></label>
        <button className="primary save">Guardar cambios</button>
      </form></div>}
    </main>
  );
}
