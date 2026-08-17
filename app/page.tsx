"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { toPng } from "html-to-image";
import * as XLSX from "xlsx";

type Shift = { time: string; role: string; tone: "blue" | "green" | "orange" | "yellow" };
type Person = { id: number; name: string; location: string; initials: string; shifts: (Shift | null)[] };
type LocationRow = { id:number; name:string; city:string; active:number };
type RoleRow = { id:number; name:string; color:Shift["tone"] | "purple"; active:number };
type SupervisorRow = { id:number; name:string; location_id:number; location_name:string; city:string; active:number; active_from:string; active_until:string|null };
type AssignmentRow = { id:number; supervisor_id:number; work_date:string; start_time:string|null; end_time:string|null; role_id:number; role_name:string; color:Shift["tone"]; hours:number };
type CurrentUser = { email:string; name:string; role:"admin"|"supervisor"; locationId:number|null; locationIds:number[] };
type DataSet = { locations:LocationRow[]; roles:RoleRow[]; supervisors:SupervisorRow[]; assignments:AssignmentRow[]; currentUser:CurrentUser };
type AccessUserRow = { id:string; email:string; name:string; role:string; location_id:number; location_name:string; location_ids:number[]; location_names:string[]; requested_location_ids:number[]; requested_location_names:string[]; active:number };
type ShopperRow={id:number;name:string;shopper_external_id:string|null;category:"purchase"|"delivery";employment_type:string;location_id:number;location_name:string;active:number};
type ShopperTurnRow={id:number;staff_id:number;work_date:string;turn_code:string};
type ShopperShiftType={id:number;code:string;label:string;start_time:string|null;end_time:string|null;category:"purchase"|"delivery"|"both";location_id:number|null;counts_opening:boolean;counts_closing:boolean;is_free:boolean};
type PresenceType="supervisor"|"purchase"|"delivery";
type PresenceRow={key:string;name:string;initials:string;kind:PresenceType;role:string;start:string;end:string;active:boolean;minutesUntil:number};

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
  ["◫", "Turnos y roles"], ["♟", "Shoppers"], ["⌂", "Locales"], ["▥", "Reportes"], ["⚿", "Accesos"]
];
const supervisorNav = [["▣", "Horarios"],["♟", "Shoppers"],["▥", "Reportes"]];
const UI_STATE_KEY="regional-ops-ui-state";
const dataCacheKey=(email:string)=>`regional-ops-data-${email.toLowerCase()}`;
const SCHEDULE_MIN_DATE="2026-07-27";
const SCHEDULE_MAX_DATE=`${Math.max(new Date().getFullYear()+1,2027)}-12-31`;

function hoursFor(person: Person) {
  return Math.round(person.shifts.reduce((total, item) => total + shiftHours(item), 0) * 100) / 100;
}

function shiftHours(item: Shift | null) {
  if (!item || item.time === "LIBRE" || ["Libre","Descanso","Vacaciones"].includes(item.role)) return 0;
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

function durationLabel(minutes:number){
  const hours=Math.floor(minutes/60),rest=minutes%60;
  if(hours&&rest)return `${hours} h ${rest} min`;
  if(hours)return `${hours} h`;
  return `${rest} min`;
}

function shiftTime(item: Shift | null, position: 0 | 1, fallback: string) {
  if (!item || item.time === "LIBRE" || ["Libre","Descanso","Vacaciones"].includes(item.role)) return fallback;
  return item.time.match(/\d{2}:\d{2}/g)?.[position] ?? fallback;
}

function excelEscape(value: unknown) {
  return String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

async function downloadWorkbook97(workbook:XLSX.WorkBook,filename:string) {
  const bytes=XLSX.write(workbook,{bookType:"biff8",type:"array"});
  const blob=new Blob([bytes],{type:"application/vnd.ms-excel"});
  const file=new File([blob],filename,{type:"application/vnd.ms-excel"});
  if(navigator.share&&navigator.canShare?.({files:[file]})){
    try{
      await navigator.share({files:[file],title:"Reporte de horarios"});
      return;
    }catch(error){
      if(error instanceof DOMException&&error.name==="AbortError")throw error;
      console.warn("El navegador no permitió compartir el Excel; se usará la descarga directa.",error);
    }
  }
  const url=URL.createObjectURL(blob);
  const link=document.createElement("a");
  link.href=url;
  link.download=filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

export default function Home() {
  const [mobileMenuOpen,setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed,setSidebarCollapsed] = useState(false);
  const [sessionReady,setSessionReady] = useState(false);
  const [loginEmail,setLoginEmail] = useState("");
  const [loginPassword,setLoginPassword] = useState("");
  const [registering,setRegistering] = useState(false);
  const [recoveringPassword,setRecoveringPassword] = useState(false);
  const [sendingRecovery,setSendingRecovery] = useState(false);
  const [loginName,setLoginName] = useState("");
  const [loginError,setLoginError] = useState("");
  const [mustChangePassword,setMustChangePassword] = useState(false);
  const [changingPassword,setChangingPassword] = useState(false);
  const [requestedLocationNames,setRequestedLocationNames] = useState<string[]>([]);
  const [active, setActive] = useState("Panel general");
  const [location, setLocation] = useState("Todos los locales");
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [modal, setModal] = useState<{ person: Person; day: number } | null>(null);
  const [data, setData] = useState<DataSet | null>(null);
  const [create, setCreate] = useState<"location" | "supervisor" | "role" | null>(null);
  const [editSupervisor, setEditSupervisor] = useState<SupervisorRow | null>(null);
  const [notice, setNotice] = useState("");
  const [weekStart, setWeekStart] = useState(SCHEDULE_MIN_DATE);
  const [reportLocation, setReportLocation] = useState("");
  const [reportStart, setReportStart] = useState(SCHEDULE_MIN_DATE);
  const [reportEnd, setReportEnd] = useState("2026-07-31");
  const [accessState, setAccessState] = useState<"loading"|"authorized"|"signin"|"denied">("loading");
  const [accessUsers, setAccessUsers] = useState<AccessUserRow[]>([]);
  const [editAccessUser, setEditAccessUser] = useState<AccessUserRow | null>(null);
  const [editAccessLocations, setEditAccessLocations] = useState<number[]>([]);
  const [resettingAccessId,setResettingAccessId]=useState<string|null>(null);
  const [temporaryAccess,setTemporaryAccess]=useState<{name:string;email:string;password:string}|null>(null);
  const scheduleRef=useRef<HTMLElement|null>(null);
  const [shopperCategory,setShopperCategory]=useState<"purchase"|"delivery">("purchase");
  const [shopperView,setShopperView]=useState<"schedule"|"directory">("schedule");
  const [shopperImageChoice,setShopperImageChoice]=useState(false);
  const [shopperStaff,setShopperStaff]=useState<ShopperRow[]>([]);
  const [shopperDirectory,setShopperDirectory]=useState<ShopperRow[]>([]);
  const [shopperDirectoryQuery,setShopperDirectoryQuery]=useState("");
  const [shopperTurns,setShopperTurns]=useState<ShopperTurnRow[]>([]);
  const [shopperShiftTypes,setShopperShiftTypes]=useState<ShopperShiftType[]>([]);
  const [shopperModal,setShopperModal]=useState<{staff:ShopperRow;date:string}|null>(null);
  const [shopperTurnInput,setShopperTurnInput]=useState("");
  const [addShopper,setAddShopper]=useState(false);
  const [editShopper,setEditShopper]=useState<ShopperRow|null>(null);
  const [deleteShopper,setDeleteShopper]=useState<ShopperRow|null>(null);
  const [deletingShopper,setDeletingShopper]=useState(false);
  const [addShopperShift,setAddShopperShift]=useState(false);
  const [reportType,setReportType]=useState<"supervisor"|"shopper">("supervisor");
  const shopperScheduleRef=useRef<HTMLElement|null>(null);
  const currentLocalDate=()=>new Date().toLocaleDateString("en-CA");
  const currentLocalTime=()=>new Date().toTimeString().slice(0,5);
  const [presenceLocation,setPresenceLocation]=useState("");
  const [presenceDate,setPresenceDate]=useState(currentLocalDate);
  const [presenceTime,setPresenceTime]=useState(currentLocalTime);
  const [presenceTypes,setPresenceTypes]=useState<PresenceType[]>(["supervisor","purchase","delivery"]);
  const [presenceSearched,setPresenceSearched]=useState(false);
  const [uiStateReady,setUiStateReady]=useState(false);

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

  async function signOutSafely(){
    try{
      if(data?.currentUser.email)window.localStorage.removeItem(dataCacheKey(data.currentUser.email));
    }catch{}
    setMobileMenuOpen(false);
    await supabase.auth.signOut();
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
      try{window.localStorage.setItem(dataCacheKey(payload.currentUser.email),JSON.stringify(payload));}catch{}
      setPresenceLocation(current=>current||payload.locations[0]?.name||"");
      if (payload.currentUser.role === "supervisor" && payload.locations[0]) {
        setLocation(current=>payload.locations.some(item=>item.name===current)?current:payload.locations[0].name);
        setReportLocation(current=>payload.locations.some(item=>item.name===current)?current:payload.locations[0].name);
        setActive(current=>supervisorNav.some(([,label])=>label===current)?current:"Horarios");
      }
    } catch { setNotice("No se pudo conectar con el almacenamiento. Intenta nuevamente."); }
  }

  useEffect(() => {
    try{
      const saved=JSON.parse(window.localStorage.getItem(UI_STATE_KEY)||"{}") as {
        active?:string;location?:string;weekStart?:string;shopperCategory?:"purchase"|"delivery";
        shopperView?:"schedule"|"directory";reportType?:"supervisor"|"shopper";
        reportLocation?:string;reportStart?:string;reportEnd?:string;
      };
      if(saved.active)setActive(saved.active);
      if(saved.location)setLocation(saved.location);
      if(saved.weekStart)setWeekStart(saved.weekStart);
      if(saved.shopperCategory)setShopperCategory(saved.shopperCategory);
      if(saved.shopperView)setShopperView(saved.shopperView);
      if(saved.reportType)setReportType(saved.reportType);
      if(saved.reportLocation)setReportLocation(saved.reportLocation);
      if(saved.reportStart)setReportStart(saved.reportStart);
      if(saved.reportEnd)setReportEnd(saved.reportEnd);
    }catch{}
    setUiStateReady(true);
    supabase.auth.getSession().then(({data:{session}}) => {
      setSessionReady(true);
      setMustChangePassword(Boolean(session?.user.app_metadata?.must_change_password));
      if(session){
        try{
          const cached=window.localStorage.getItem(dataCacheKey(session.user.email||""));
          if(cached){setData(JSON.parse(cached) as DataSet);setAccessState("authorized");}
        }catch{}
        void loadData();
      }else setAccessState("signin");
    });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((event,session) => {
      setSessionReady(true);
      setMustChangePassword(event==="PASSWORD_RECOVERY"||Boolean(session?.user.app_metadata?.must_change_password));
      if(session){
        try{
          const cached=window.localStorage.getItem(dataCacheKey(session.user.email||""));
          if(cached){setData(JSON.parse(cached) as DataSet);setAccessState("authorized");}
          else setAccessState("loading");
        }catch{setAccessState("loading");}
        void loadData();
      }
      else { setData(null); setAccessState("signin"); }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(()=>{
    if(!uiStateReady)return;
    try{window.localStorage.setItem(UI_STATE_KEY,JSON.stringify({
      active,location,weekStart,shopperCategory,shopperView,reportType,reportLocation,reportStart,reportEnd
    }));}catch{}
  },[uiStateReady,active,location,weekStart,shopperCategory,shopperView,reportType,reportLocation,reportStart,reportEnd]);
  useEffect(() => {
    setSidebarCollapsed(window.localStorage.getItem("regional-sidebar-collapsed") === "true");
  }, []);
  useEffect(() => {
    if (active === "Accesos" && data?.currentUser.role === "admin") void loadAccessUsers();
  },[active,data?.currentUser.role]);
  useEffect(()=>{
    if(active==="Shoppers"&&shopperView==="directory")void loadShopperDirectory();
    else if(active==="Panel general"||active==="Shoppers"||(active==="Reportes"&&reportType==="shopper"))void loadShoppers();
  },[active,shopperCategory,reportType,shopperView]);
  useEffect(() => {
    if (!data) return;
    const weekFirst=dateKeys[0],weekLast=dateKeys[6];
    setPeople(data.supervisors.filter(s => {
      const startsInTime=!s.active_from||s.active_from<=weekLast;
      const hasNotEnded=!s.active_until||s.active_until>=weekFirst;
      return startsInTime&&hasNotEnded;
    }).map(s => ({
      id:s.id, name:s.name, location:s.location_name,
      initials:s.name.split(" ").map(x => x[0]).join("").slice(0,2).toUpperCase(),
      shifts:dateKeys.map(date => {
        const a = data.assignments.find(x => x.supervisor_id === s.id && x.work_date === date);
        if (!a) return null;
        const isRest = ["Libre","Descanso","Vacaciones"].includes(a.role_name);
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
      const isFree = ["Libre","Descanso"].includes(assignment.role_name) || isVacation;
      current.hours += isFree ? 0 : Number(assignment.hours ?? 0);
      if (isFree) current.free += 1; else current.worked += 1;
      if (isVacation) current.vacations += 1;
      summary.set(supervisor.id,current);
    });
    return [...summary.values()].sort((a,b) => a.name.localeCompare(b.name));
  },[reportRows]);

  const presenceResults=useMemo(()=>{
    if(!data||!presenceLocation||!presenceDate||!presenceTime)return {active:[] as PresenceRow[],upcoming:[] as PresenceRow[]};
    const selectedLocation=data.locations.find(item=>item.name===presenceLocation);
    if(!selectedLocation)return {active:[] as PresenceRow[],upcoming:[] as PresenceRow[]};
    const [selectedHour,selectedMinute]=presenceTime.split(":").map(Number);
    const nowMinutes=selectedHour*60+selectedMinute;
    const previousDate=new Date(`${presenceDate}T12:00:00`);
    previousDate.setDate(previousDate.getDate()-1);
    const previousKey=previousDate.toISOString().slice(0,10);
    const rows:PresenceRow[]=[];
    const addRow=(row:Omit<PresenceRow,"active"|"minutesUntil">,workDate:string)=>{
      const parse=(value:string)=>{const [h,m]=value.slice(0,5).split(":").map(Number);return h*60+m};
      const start=parse(row.start),end=parse(row.end);
      const overnight=end<=start;
      let active=false;
      if(workDate===presenceDate)active=overnight?nowMinutes>=start:nowMinutes>=start&&nowMinutes<end;
      if(workDate===previousKey&&overnight)active=nowMinutes<end;
      const minutesUntil=workDate===presenceDate&&start>nowMinutes?start-nowMinutes:Number.POSITIVE_INFINITY;
      if(active||Number.isFinite(minutesUntil))rows.push({...row,active,minutesUntil});
    };
    if(presenceTypes.includes("supervisor")){
      data.assignments
        .filter(item=>item.work_date===presenceDate||item.work_date===previousKey)
        .forEach(item=>{
          const supervisor=data.supervisors.find(person=>person.id===item.supervisor_id&&person.active===1&&person.location_id===selectedLocation.id);
          if(!supervisor||!item.start_time||!item.end_time||["Libre","Descanso","Vacaciones"].includes(item.role_name))return;
          addRow({key:`supervisor-${item.id}`,name:supervisor.name,initials:supervisor.name.split(" ").map(part=>part[0]).join("").slice(0,2).toUpperCase(),kind:"supervisor",role:"Supervisor",start:item.start_time,end:item.end_time},item.work_date);
        });
    }
    shopperTurns
      .filter(item=>item.work_date===presenceDate||item.work_date===previousKey)
      .forEach(item=>{
        const staff=shopperStaff.find(person=>person.id===item.staff_id&&person.active===1&&person.location_id===selectedLocation.id);
        if(!staff||!presenceTypes.includes(staff.category))return;
        const shiftType=shopperShiftTypes.find(type=>type.code===item.turn_code&&type.location_id===staff.location_id&&(type.category===staff.category||type.category==="both"))
          ??shopperShiftTypes.find(type=>type.code===item.turn_code&&type.location_id===null&&(type.category===staff.category||type.category==="both"));
        if(!shiftType||shiftType.is_free||!shiftType.start_time||!shiftType.end_time)return;
        addRow({key:`${staff.category}-${item.id}`,name:staff.name,initials:staff.name.split(" ").map(part=>part[0]).join("").slice(0,2).toUpperCase(),kind:staff.category,role:staff.category==="purchase"?"Asesor de compra":"Repartidor",start:shiftType.start_time,end:shiftType.end_time},item.work_date);
      });
    return {
      active:rows.filter(item=>item.active).sort((a,b)=>a.role.localeCompare(b.role)||a.name.localeCompare(b.name)),
      upcoming:rows.filter(item=>!item.active).sort((a,b)=>a.minutesUntil-b.minutesUntil).slice(0,8)
    };
  },[data,presenceLocation,presenceDate,presenceTime,presenceTypes,shopperStaff,shopperTurns,shopperShiftTypes]);

  async function downloadExcelReport() {
    if (!reportLocation) { setNotice("Selecciona el local del reporte"); return; }
    if (!reportStart || !reportEnd || reportStart > reportEnd) { setNotice("Selecciona un rango de fechas válido"); return; }
    if (!reportRows.length) { setNotice("No existen horarios guardados para ese local y rango"); return; }
    const detailRows = reportRows.map(({assignment,supervisor}) => {
      const free = ["Libre","Descanso","Vacaciones"].includes(assignment.role_name);
      return [assignment.work_date,supervisor?.name,reportLocation,assignment.role_name,free?"":assignment.start_time,free?"":assignment.end_time,free?0:Number(assignment.hours ?? 0),free?"Libre":"Trabajado"];
    });
    const summaryData=[
      ["Supervisor","Local","Horas totales","Días trabajados","Días libres","Vacaciones"],
      ...reportSummary.map(s=>[s.name,reportLocation,s.hours,s.worked,s.free,s.vacations])
    ];
    const detailData=[
      ["Fecha","Supervisor","Local","Rol","Entrada","Salida","Horas","Estado"],
      ...detailRows
    ];
    const summarySheet=XLSX.utils.aoa_to_sheet(summaryData);
    const detailSheet=XLSX.utils.aoa_to_sheet(detailData);
    summarySheet["!cols"]=[{wch:26},{wch:28},{wch:14},{wch:16},{wch:13},{wch:12}];
    detailSheet["!cols"]=[{wch:13},{wch:26},{wch:28},{wch:24},{wch:11},{wch:11},{wch:10},{wch:13}];
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,summarySheet,"Resumen");
    XLSX.utils.book_append_sheet(workbook,detailSheet,"Detalle diario");
    try{
      await downloadWorkbook97(workbook,`Horario_${reportLocation.replace(/[^a-z0-9]+/gi,"_")}_${reportStart}_${reportEnd}.xls`);
      setNotice("✓ Reporte Excel 97-2003 generado correctamente");
    }catch(error){
      if(!(error instanceof DOMException&&error.name==="AbortError"))setNotice("Error: no se pudo generar el reporte");
    }
  }

  async function saveShift(form: FormData) {
    if (!modal) return;
    const role = String(form.get("role"));
    const start = String(form.get("start"));
    const end = String(form.get("end"));
    const tones: Record<string, Shift["tone"]> = { "Compra / Procesos": "blue", "Certificaciones": "green", "Cierre": "orange", "Libre": "yellow", "Descanso": "yellow", "Vacaciones": "yellow", "Total": "blue" };
    const countsAsFree = ["Libre","Descanso","Vacaciones"].includes(role);
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

  async function copyWeek() {
    const selectedLocation=data?.locations.find(l=>l.name===location);
    if(!selectedLocation){setNotice("Selecciona un local antes de copiar la semana");return;}
    const target=new Date(`${weekStart}T12:00:00`);
    target.setDate(target.getDate()+7);
    if(target>new Date(`${SCHEDULE_MAX_DATE}T12:00:00`)){setNotice(`No se puede copiar después del ${SCHEDULE_MAX_DATE}`);return;}
    if(!window.confirm(`¿Copiar todos los turnos de ${location} a la semana siguiente?`))return;
    const response=await apiFetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"copyWeek",locationId:selectedLocation.id,sourceStart:weekStart,targetStart:target.toISOString().slice(0,10)
    })});
    const result=await response.json().catch(()=>({error:"No se pudo copiar la semana"})) as {ok?:boolean;copied?:number;error?:string};
    if(!response.ok){setNotice(`Error: ${result.error??"No se pudo copiar la semana"}`);return;}
    setWeekStart(target.toISOString().slice(0,10));
    setNotice(`✓ Semana copiada correctamente (${result.copied??0} turnos)`);
    await loadData();
  }

  async function downloadScheduleImage() {
    const node=scheduleRef.current;
    if(!node){setNotice("No se encontró el horario para generar la imagen");return;}
    const tableWrap=node.querySelector<HTMLElement>(".table-wrap");
    const table=node.querySelector<HTMLElement>("table");
    const originalWidth=node.style.width;
    const originalMaxWidth=node.style.maxWidth;
    const originalOverflow=tableWrap?.style.overflow??"";
    try{
      setNotice("Generando imagen del horario...");
      const exportWidth=Math.max(1200,(table?.scrollWidth??0)+44);
      node.style.width=`${exportWidth}px`;
      node.style.maxWidth="none";
      if(tableWrap)tableWrap.style.overflow="visible";
      await new Promise(resolve=>requestAnimationFrame(()=>resolve(null)));
      const dataUrl=await toPng(node,{
        cacheBust:true,pixelRatio:3,backgroundColor:"#ffffff",
        width:node.scrollWidth,height:node.scrollHeight,
        filter:element=>!(element instanceof HTMLElement&&element.classList.contains("schedule-actions"))
      });
      const filename=`Horario_${location.replace(/[^a-z0-9]+/gi,"_")}_${weekStart}.png`;
      const blob=await fetch(dataUrl).then(response=>response.blob());
      const file=new File([blob],filename,{type:"image/png"});
      if(navigator.share&&navigator.canShare?.({files:[file]})){
        try {
          await navigator.share({files:[file],title:"Horario semanal"});
          setNotice("✓ Imagen lista para guardar o compartir");
        } catch(error) {
          if(error instanceof DOMException&&error.name==="AbortError") setNotice("Se canceló el guardado de la imagen");
          else throw error;
        }
      } else {
        const url=URL.createObjectURL(blob);
        const link=document.createElement("a");
        link.download=filename;
        link.href=url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(()=>URL.revokeObjectURL(url),1000);
        setNotice("✓ Imagen del horario descargada correctamente");
      }
    }catch{
      setNotice("Error: no se pudo generar la imagen del horario");
    }finally{
      node.style.width=originalWidth;
      node.style.maxWidth=originalMaxWidth;
      if(tableWrap)tableWrap.style.overflow=originalOverflow;
    }
  }

  function changeWeek(offset:number) {
    const d = new Date(`${weekStart}T12:00:00`);
    d.setDate(d.getDate()+offset*7);
    const min = new Date(`${SCHEDULE_MIN_DATE}T12:00:00`), max = new Date(`${SCHEDULE_MAX_DATE}T12:00:00`);
    if (d < min || d > max) { setNotice(`El calendario disponible va desde ${SCHEDULE_MIN_DATE} hasta ${SCHEDULE_MAX_DATE}`); return; }
    setWeekStart(d.toISOString().slice(0,10));
  }

  async function createRecord(form: FormData) {
    if (!create) return;
    const payload = create === "location"
      ? {action:"addLocation",name:form.get("name"),city:form.get("city")}
      : create === "supervisor"
      ? {action:"addSupervisor",name:form.get("name"),locationId:Number(form.get("locationId")),weekStart,weekEnd:dateKeys[6]}
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
      locationId:Number(form.get("locationId"))
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
    if (!supervisor || !window.confirm(`¿Quitar a ${person.name} desde esta semana? Los horarios de semanas anteriores quedarán guardados.`)) return;
    const response = await apiFetch("/api/data",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"removeSupervisorFromWeek",id:supervisor.id,weekStart
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
    if (!response.ok) {
      const problem=await response.json().catch(()=>({error:"No se pudo cargar la lista"})) as {error?:string};
      setNotice(`Error al cargar usuarios: ${problem.error ?? "No disponible"}`);
      return;
    }
    const payload = await response.json() as {users:AccessUserRow[]};
    setAccessUsers(payload.users);
  }

  async function loadShoppers(){
    const categories:("purchase"|"delivery")[]=active==="Panel general"?["purchase","delivery"]:[shopperCategory];
    const responses=await Promise.all(categories.map(category=>apiFetch(`/api/shoppers?category=${category}`)));
    const failed=responses.find(response=>!response.ok);
    if(failed){const p=await failed.json().catch(()=>({error:"No disponible"}));setNotice(`Error: ${p.error}`);return;}
    const payloads=await Promise.all(responses.map(response=>response.json() as Promise<{staff:ShopperRow[];turns:ShopperTurnRow[];shiftTypes:ShopperShiftType[]}>));
    const uniqueById=<T extends {id:number}>(rows:T[])=>[...new Map(rows.map(row=>[row.id,row])).values()];
    setShopperStaff(uniqueById(payloads.flatMap(payload=>payload.staff)));
    setShopperTurns(uniqueById(payloads.flatMap(payload=>payload.turns)));
    setShopperShiftTypes(uniqueById(payloads.flatMap(payload=>payload.shiftTypes)));
  }

  async function loadShopperDirectory(){
    const response=await apiFetch("/api/shoppers?directory=1");
    const result=await response.json().catch(()=>({error:"No se pudo cargar el repositorio"})) as {staff?:ShopperRow[];error?:string};
    if(!response.ok){setNotice(`Error: ${result.error??"No se pudo cargar el repositorio"}`);return;}
    setShopperDirectory(result.staff??[]);
  }

  async function createShopper(form:FormData){
    const selected=data?.locations.find(l=>l.name===location)??data?.locations[0];
    if(!selected){setNotice("Selecciona un local");return;}
    const response=await apiFetch("/api/shoppers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"addStaff",name:form.get("name"),shopperId:form.get("shopperId"),employmentType:form.get("employmentType"),category:shopperCategory,locationId:selected.id
    })});
    const result=await response.json().catch(()=>({error:"No se pudo guardar"}));
    if(!response.ok){setNotice(`Error: ${result.error}`);return;}
    setAddShopper(false);setNotice("✓ Persona agregada al horario");await loadShoppers();
  }

  async function updateShopper(form:FormData){
    if(!editShopper)return;
    const response=await apiFetch("/api/shoppers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"updateStaff",id:editShopper.id,name:form.get("name"),shopperId:form.get("shopperId"),locationId:Number(form.get("locationId"))
    })});
    const result=await response.json().catch(()=>({error:"No se pudo guardar"}));
    if(!response.ok){setNotice(`Error: ${result.error}`);return;}
    setEditShopper(null);setNotice("✓ Datos y local actualizados");
    if(shopperView==="directory")await loadShopperDirectory();else await loadShoppers();
  }

  async function confirmDeleteShopper(){
    if(!deleteShopper||deletingShopper)return;
    setDeletingShopper(true);
    const response=await apiFetch("/api/shoppers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"deleteStaff",id:deleteShopper.id
    })});
    const result=await response.json().catch(()=>({error:"No se pudo eliminar"}));
    setDeletingShopper(false);
    if(!response.ok){setNotice(`Error al eliminar: ${result.error}`);return;}
    setDeleteShopper(null);
    setEditShopper(null);
    setNotice("✓ Shopper eliminado del horario");
    await loadShoppers();
  }

  async function createShopperShift(form:FormData){
    const selected=data?.locations.find(l=>l.id===Number(form.get("locationId")));
    if(!selected){setNotice("Selecciona un local");return;}
    const response=await apiFetch("/api/shoppers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"addShiftType",code:form.get("code"),label:form.get("label"),start:form.get("start"),end:form.get("end"),
      category:form.get("category"),locationId:selected.id,countsOpening:form.get("countsOpening")==="on",
      countsClosing:form.get("countsClosing")==="on",isFree:form.get("isFree")==="on"
    })});
    const result=await response.json().catch(()=>({error:"No se pudo crear el turno"}));
    if(!response.ok){setNotice(`Error: ${result.error}`);return;}
    setAddShopperShift(false);setNotice(result.updated?"✓ Turno actualizado para este local":"✓ Nuevo turno creado para este local");await loadShoppers();
  }

  function shopperShiftFor(code:string,locationId?:number){
    return shopperShiftTypes.find(s=>s.code===code&&s.location_id===locationId)
      ?? shopperShiftTypes.find(s=>s.code===code&&s.location_id===null)
      ?? shopperShiftTypes.find(s=>s.code===code);
  }

  function shopperShiftLabel(shiftType:ShopperShiftType|undefined){
    if(!shiftType)return "";
    if(shiftType.is_free)return shiftType.code==="V"?"Vacaciones":"Libre";
    if(shiftType.counts_opening&&shiftType.counts_closing)return "Apertura y cierre";
    if(shiftType.counts_opening)return "Apertura";
    if(shiftType.counts_closing)return "Cierre";
    return "Intermedio";
  }

  function shopperShiftHours(shiftType:ShopperShiftType|undefined){
    if(!shiftType||shiftType.is_free||!shiftType.start_time||!shiftType.end_time)return 0;
    const minutes=(value:string)=>{const [hours,rest]=value.slice(0,5).split(":").map(Number);return hours*60+rest;};
    let difference=minutes(shiftType.end_time)-minutes(shiftType.start_time);
    if(difference<0)difference+=24*60;
    return difference/60;
  }

  async function saveShopperTurn(code:string){
    if(!shopperModal)return;
    const response=await apiFetch("/api/shoppers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"saveTurn",staffId:shopperModal.staff.id,workDate:shopperModal.date,turnCode:code
    })});
    const result=await response.json().catch(()=>({error:"No se pudo guardar"}));
    if(!response.ok){setNotice(`Error: ${result.error}`);return;}
    setShopperModal(null);setNotice("✓ Turno guardado");await loadShoppers();
  }

  function openShopperTurnModal(staff:ShopperRow,date:string){
    setShopperTurnInput("");
    setShopperModal({staff,date});
  }

  async function copyShopperWeek(){
    const selected=data?.locations.find(l=>l.name===location)??data?.locations[0];
    if(!selected){setNotice("Selecciona un local");return;}
    const response=await apiFetch("/api/shoppers",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"copyWeek",category:shopperCategory,locationId:selected.id,sourceStart:weekStart
    })});
    const result=await response.json().catch(()=>({error:"No se pudo copiar"}));
    if(!response.ok){setNotice(`Error: ${result.error}`);return;}
    changeWeek(1);setNotice(`✓ ${result.copied} turnos copiados`);await loadShoppers();
  }

  async function downloadShopperImage(parts:1|2){
    const selected=data?.locations.find(l=>l.name===location);
    if(!selected){setNotice("Selecciona un local antes de generar la imagen");return;}
    const visible=shopperStaff.filter(s=>s.location_id===selected.id);
    if(!visible.length){setNotice("No existen personas en el local seleccionado");return;}
    const size=Math.ceil(visible.length/parts);
    const groups=Array.from({length:parts},(_,index)=>visible.slice(index*size,(index+1)*size)).filter(group=>group.length);
    const tableFor=(staffRows:ShopperRow[])=>`<table><thead><tr><th>Shopper · ID</th>${days.map(day=>`<th>${day}</th>`).join("")}</tr></thead><tbody>${staffRows.map(staff=>`<tr><td><b>${excelEscape(staff.name)} · ID ${excelEscape(staff.shopper_external_id||"—")}</b></td>${dateKeys.map(date=>{const code=shopperTurns.find(turn=>turn.staff_id===staff.id&&turn.work_date===date)?.turn_code||"";const type=shopperShiftFor(code,staff.location_id);const tone=!type?"empty":type.is_free?(type.code==="V"?"vacation":"free"):type.counts_opening&&type.counts_closing?"closing":type.counts_opening?"opening":type.counts_closing?"closing":"middle";return `<td class="export-turn ${tone}"><b>${excelEscape(code||"—")}</b></td>`}).join("")}</tr>`).join("")}</tbody></table>`;
    const files:File[]=[];
    try{
      for(let index=0;index<groups.length;index++){
        const node=document.createElement("section");
        node.className="shopper-export-sheet whatsapp-poster single-horizontal";
        node.innerHTML=`<div class="shopper-export-head"><div><h2>${shopperCategory==="purchase"?"Asesores de compra":"Repartidores"}</h2><p>${selected.name} · ${weekLabel} · ${visible.length} personas${parts===2?` · Parte ${index+1} de 2`:""}</p></div><div class="shopper-export-legend"><span class="opening">A/A2/I/N Apertura</span><span class="middle">B Intermedio</span><span class="closing">T Apertura y cierre</span><span class="free">L Libre</span><span class="vacation">V Vacaciones</span></div></div><div class="shopper-export-grid">${tableFor(groups[index])}</div>`;
        document.body.appendChild(node);
        try{
          await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
          const dataUrl=await toPng(node,{cacheBust:true,pixelRatio:2,backgroundColor:"#ffffff",width:node.scrollWidth,height:node.scrollHeight});
          const blob=await fetch(dataUrl).then(response=>response.blob());
          const suffix=parts===2?`_Parte_${index+1}`:"";
          const filename=`Horario_${shopperCategory==="purchase"?"Compra":"Repartidores"}_${selected.name.replace(/[^a-z0-9]+/gi,"_")}_${weekStart}${suffix}.png`;
          files.push(new File([blob],filename,{type:"image/png"}));
        }finally{node.remove();}
      }
      if(navigator.share&&navigator.canShare?.({files})){
        try{await navigator.share({files,title:"Horario de shoppers"});}
        catch(error){
          if(error instanceof DOMException&&error.name==="AbortError")throw error;
          files.forEach(file=>{const url=URL.createObjectURL(file);const link=document.createElement("a");link.href=url;link.download=file.name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
        }
      }else{files.forEach(file=>{const url=URL.createObjectURL(file);const link=document.createElement("a");link.href=url;link.download=file.name;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
      setShopperImageChoice(false);
      setNotice(parts===1?"✓ Imagen horizontal generada correctamente":"✓ Dos imágenes del horario generadas correctamente");
    }catch(error){
      if(!(error instanceof DOMException&&error.name==="AbortError"))setNotice("Error: no se pudo generar la imagen");
    }
  }

  async function downloadShopperReport(){
    const selected=data?.locations.find(l=>l.name===reportLocation);
    if(!selected){setNotice("Selecciona el local del reporte");return;}
    if(!reportStart||!reportEnd||reportStart>reportEnd){setNotice("Selecciona un rango de fechas válido");return;}
    const staff=shopperStaff.filter(s=>s.location_id===selected.id);
    if(!staff.length){setNotice("No existen shoppers para ese local");return;}
    const dates:string[]=[];const cursor=new Date(`${reportStart}T12:00:00`),last=new Date(`${reportEnd}T12:00:00`);
    while(cursor<=last){dates.push(cursor.toISOString().slice(0,10));cursor.setDate(cursor.getDate()+1);}
    const rows:(string|number)[][]=staff.flatMap(person=>dates.map(date=>{
      const assigned=shopperTurns.find(t=>t.staff_id===person.id&&t.work_date===date);
      const type=assigned?shopperShiftFor(assigned.turn_code,person.location_id):undefined;
      const free=!assigned||!type||type.is_free;
      const d=new Date(`${date}T12:00:00`);
      const shopperId=Number(person.shopper_external_id);
      return [Number.isFinite(shopperId)?shopperId:"",d.getMonth()+1,d.getDate(),String(free?"":type.start_time?.slice(0,5)||""),String(free?"":type.end_time?.slice(0,5)||""),String(free?"SI":"NO")];
    }));
    const sheet=XLSX.utils.aoa_to_sheet([["ID_SHOPPER","MES","DIA","HORA_INICIO","HORA_FIN","DIA_LIBRE"],...rows]);
    sheet["!cols"]=[{wch:14},{wch:8},{wch:8},{wch:15},{wch:13},{wch:12}];
    const workbook=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook,sheet,"HORARIO");
    try{
      await downloadWorkbook97(workbook,`Horario_Shoppers_${selected.name.replace(/[^a-z0-9]+/gi,"_")}_${reportStart}_${reportEnd}.xls`);
      setNotice("✓ Libro Excel 97-2003 generado correctamente");
    }catch(error){
      if(!(error instanceof DOMException&&error.name==="AbortError"))setNotice("Error: no se pudo generar el reporte");
    }
  }

  async function saveAccessUser(form: FormData) {
    const response = await apiFetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"save",name:form.get("name"),email:form.get("email"),locationIds:form.getAll("locationIds").map(Number)
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

  async function updateAccessUser(form:FormData) {
    if (!editAccessUser) return;
    const response = await apiFetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      action:"update",
      id:editAccessUser.id,
      name:String(form.get("name") ?? "").trim(),
      locationIds:editAccessLocations,
      active:Number(form.get("active"))
    })});
    if (response.ok) {
      setEditAccessUser(null);
      setNotice("✓ Usuario y local actualizados correctamente");
      await loadAccessUsers();
    } else {
      const problem = await response.json().catch(()=>({error:"No se pudo actualizar"})) as {error?:string};
      setNotice(`Error: ${problem.error ?? "No se pudo actualizar"}`);
    }
  }

  async function resetAccessPassword(user:AccessUserRow) {
    if(resettingAccessId)return;
    if(!window.confirm(`¿Generar una contraseña temporal para ${user.name}? La contraseña actual dejará de funcionar.`))return;
    setResettingAccessId(user.id);
    const response=await apiFetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"resetPassword",id:user.id})});
    const result=await response.json().catch(()=>({error:"No se pudo restablecer la contraseña"})) as {error?:string;temporaryPassword?:string};
    setResettingAccessId(null);
    if(!response.ok||!result.temporaryPassword){setNotice(`Error: ${result.error??"No se pudo restablecer la contraseña"}`);return;}
    setTemporaryAccess({name:user.name,email:user.email,password:result.temporaryPassword});
  }

  async function changeTemporaryPassword(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form=new FormData(event.currentTarget);
    const password=String(form.get("password")||""),confirmation=String(form.get("confirmation")||"");
    setLoginError("");
    if(password.length<8){setLoginError("La nueva contraseña debe tener al menos 8 caracteres.");return;}
    if(password!==confirmation){setLoginError("Las contraseñas no coinciden.");return;}
    setChangingPassword(true);
    const response=await apiFetch("/api/access",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"changeOwnPassword",password})});
    const result=await response.json().catch(()=>({error:"No se pudo cambiar la contraseña"})) as {error?:string};
    setChangingPassword(false);
    if(!response.ok){setLoginError(result.error??"No se pudo cambiar la contraseña.");return;}
    await supabase.auth.refreshSession();
    setMustChangePassword(false);
    setNotice("✓ Contraseña personal guardada correctamente");
  }

  async function submitLogin(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLoginError("");
    if (registering) {
      if (!requestedLocationNames.length) { setLoginError("Selecciona al menos un local para solicitar acceso."); return; }
      const {error} = await supabase.auth.signUp({
        email:loginEmail,
        password:loginPassword,
        options:{data:{full_name:loginName,requested_location_names:requestedLocationNames}}
      });
      setLoginError(error ? error.message : "Solicitud enviada. Confirma tu correo y espera la aprobación del administrador.");
    } else {
      const {error} = await supabase.auth.signInWithPassword({email:loginEmail,password:loginPassword});
      if (error) setLoginError("Correo o contraseña incorrectos.");
    }
  }

  async function requestPasswordRecovery(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    if(!loginEmail){setLoginError("Escribe el correo de tu cuenta.");return;}
    setSendingRecovery(true);
    const {error}=await supabase.auth.resetPasswordForEmail(loginEmail,{redirectTo:window.location.origin});
    setSendingRecovery(false);
    if(error){setLoginError(error.message.includes("rate limit")?"Se enviaron demasiadas solicitudes. Espera unos minutos e inténtalo nuevamente.":"No se pudo enviar el enlace. Revisa el correo e inténtalo nuevamente.");return;}
    setLoginError("✓ Si el correo está registrado, recibirás un enlace para crear una contraseña nueva.");
  }

  if (!sessionReady || accessState === "loading") return <main className="access-gate"><div className="gate-card"><span className="gate-mark">T</span><h1>Verificando acceso</h1><p>Estamos validando tu cuenta y permisos.</p></div></main>;
  if (accessState === "signin") return <main className="access-gate">{recoveringPassword?<form className="gate-card login-form recovery-form" onSubmit={requestPasswordRecovery}><span className="gate-mark">⚿</span><h1>Recuperar contraseña</h1><p>Escribe el correo de tu cuenta y te enviaremos un enlace para crear una contraseña nueva.</p><label>Correo<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} autoComplete="email" required /></label>{loginError&&<small className={loginError.startsWith("✓")?"login-success":"login-error"}>{loginError}</small>}<button className="primary gate-action" disabled={sendingRecovery}>{sendingRecovery?"Enviando…":"Enviar enlace de recuperación"}</button><button type="button" className="secondary gate-action" onClick={()=>{setRecoveringPassword(false);setLoginError("")}}>Volver a iniciar sesión</button></form>:<form className="gate-card login-form" onSubmit={submitLogin}><span className="gate-mark">T</span><h1>Acceso privado</h1><p>{registering?"Crea tu cuenta y solicita tus locales":"Ingresa con tu correo y contraseña."}</p>{registering&&<><label>Nombre completo<input value={loginName} onChange={e=>setLoginName(e.target.value)} required /></label><fieldset className="signup-locations"><legend>Locales solicitados</legend>{locations.slice(1).map(local=><label key={local}><input type="checkbox" checked={requestedLocationNames.includes(local)} onChange={e=>setRequestedLocationNames(names=>e.target.checked?[...names,local]:names.filter(name=>name!==local))} /><span>{local}</span></label>)}</fieldset></>}<label>Correo<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required /></label><label>Contraseña<input type="password" minLength={8} value={loginPassword} onChange={e=>setLoginPassword(e.target.value)} required /></label>{!registering&&<button type="button" className="forgot-password" onClick={()=>{setRecoveringPassword(true);setLoginError("")}}>¿Olvidaste tu contraseña?</button>}{loginError&&<small className="login-error">{loginError}</small>}<button className="primary gate-action">{registering?"Enviar solicitud":"Iniciar sesión"}</button><button type="button" className="secondary gate-action" onClick={()=>{setRegistering(!registering);setLoginError("");setRequestedLocationNames([])}}>{registering?"Ya tengo cuenta":"Crear cuenta"}</button></form>}</main>;
  if (accessState === "denied") return <main className="access-gate"><div className="gate-card denied"><span className="gate-mark">×</span><h1>Acceso no autorizado</h1><p>Tu cuenta todavía no fue activada o fue bloqueada.</p><button className="secondary gate-action" onClick={()=>void signOutSafely()}>Cambiar de cuenta</button></div></main>;
  if (mustChangePassword) return <main className="access-gate"><form className="gate-card login-form password-change-card" onSubmit={changeTemporaryPassword}><span className="gate-mark">🔒</span><h1>Crea tu contraseña</h1><p>Ingresaste con una contraseña temporal. Por seguridad, debes reemplazarla antes de continuar.</p><label>Nueva contraseña<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label><label>Confirmar contraseña<input name="confirmation" type="password" minLength={8} autoComplete="new-password" required /></label>{loginError&&<small className="login-error">{loginError}</small>}<button className="primary gate-action" disabled={changingPassword}>{changingPassword?"Guardando…":"Guardar y continuar"}</button><button type="button" className="secondary gate-action" onClick={()=>void signOutSafely()}>Cambiar de cuenta</button></form></main>;

  const isAdmin = data?.currentUser.role === "admin";
  const visibleNav = isAdmin ? adminNav : supervisorNav;

  return (
    <main className={`app-shell ${sidebarCollapsed?"sidebar-collapsed":""}`}>
      <button className="mobile-menu-toggle" aria-label="Abrir menú" onClick={()=>setMobileMenuOpen(true)}>☰ <span>Menú</span></button>
      {mobileMenuOpen && <button className="mobile-menu-backdrop" aria-label="Cerrar menú" onClick={()=>setMobileMenuOpen(false)} />}
      <aside className={`sidebar ${mobileMenuOpen?"mobile-open":""}`}>
        <button className="mobile-menu-close" aria-label="Cerrar menú" onClick={()=>setMobileMenuOpen(false)}>×</button>
        <button
          className="desktop-menu-toggle"
          aria-label={sidebarCollapsed?"Expandir menú":"Contraer menú"}
          title={sidebarCollapsed?"Expandir menú":"Contraer menú"}
          onClick={() => setSidebarCollapsed(value => {
            const next = !value;
            window.localStorage.setItem("regional-sidebar-collapsed",String(next));
            return next;
          })}
        >{sidebarCollapsed?"›":"‹"}</button>
        <div className="brand"><span>TIPTI · OPERACIONES</span><strong>Región Intercity</strong></div>
        <nav>{visibleNav.map(([icon,label]) => <button key={label} title={sidebarCollapsed?label:undefined} className={active === label ? "active" : ""} onClick={() => {setActive(label);setMobileMenuOpen(false)}}><i>{icon}</i><span>{label}</span></button>)}</nav>
        <div className="profile"><div className="avatar admin">{data?.currentUser.name.split(" ").map(x=>x[0]).join("").slice(0,2).toUpperCase()}</div><div><strong>{data?.currentUser.name}</strong><span>{isAdmin?"Administrador total":"Supervisor de local"}</span></div></div>
        <button className="logout" onClick={() => void signOutSafely()}>↪ Cerrar sesión</button>
        {isAdmin && <button className="settings" onClick={() => {setActive("Configuración");setMobileMenuOpen(false)}}>⚙ Configuración</button>}
      </aside>

      <section className="workspace">
        <header>
          <div><p className="eyebrow">CONTROL OPERATIVO REGIONAL</p><h1>{active}</h1><p>Planificación y control semanal de supervisión</p></div>
          <div className="header-actions"><button className="secondary" onClick={() => window.print()}>⇩ Exportar</button><button className="primary" onClick={() => {setActive("Horarios");if(!people.length)setCreate("supervisor");else setNotice("Selecciona una celda para crear o modificar un turno");}}>＋ Nuevo horario</button></div>
        </header>

        {active==="Panel general"&&<section className="presence-card">
          <div className="presence-heading"><div><span className="presence-live-dot" /><div><h2>¿Quién está de turno?</h2><p>Consulta el personal programado por local, fecha y hora.</p></div></div><span className="presence-now">Consulta operativa</span></div>
          <div className="presence-filters">
            <label>Local<select value={presenceLocation} onChange={event=>{setPresenceLocation(event.target.value);setPresenceSearched(false)}}>{data?.locations.map(item=><option key={item.id} value={item.name}>{item.name} · {item.city}</option>)}</select></label>
            <label>Fecha<input type="date" value={presenceDate} onChange={event=>{setPresenceDate(event.target.value);setPresenceSearched(false)}} /></label>
            <label>Hora<input type="time" value={presenceTime} onChange={event=>{setPresenceTime(event.target.value);setPresenceSearched(false)}} /></label>
          </div>
          <fieldset className="presence-types"><legend>Personal que deseas consultar</legend>{([
            ["supervisor","Supervisores"],["purchase","Asesores de compra"],["delivery","Repartidores"]
          ] as [PresenceType,string][]).map(([value,label])=><label key={value}><input type="checkbox" checked={presenceTypes.includes(value)} onChange={event=>{setPresenceTypes(current=>event.target.checked?[...current,value]:current.filter(item=>item!==value));setPresenceSearched(false)}} /><span>{label}</span></label>)}</fieldset>
          <button className="primary presence-search" disabled={!presenceTypes.length||!presenceLocation} onClick={()=>setPresenceSearched(true)}>⌕ Buscar personal</button>
          {presenceSearched&&<div className="presence-results">
            <div className="presence-result-section"><div className="presence-result-title"><span className="presence-live-dot" /><strong>EN TURNO AHORA</strong><b>{presenceResults.active.length}</b></div>
              {presenceResults.active.length?<div className="presence-people">{presenceResults.active.map(person=><article key={person.key}><span className={`presence-avatar ${person.kind}`}>{person.initials}</span><div><strong>{person.name}</strong><span>{person.role} · {person.start.slice(0,5)}–{person.end.slice(0,5)}</span><small>Activo ahora</small></div></article>)}</div>:<div className="presence-empty"><strong>Sin personal en turno</strong><span>No existe un horario activo para los filtros seleccionados.</span></div>}
            </div>
            <div className="presence-result-section upcoming"><div className="presence-result-title"><strong>Próximos turnos</strong><b>{presenceResults.upcoming.length}</b></div>
              {presenceResults.upcoming.length?<div className="presence-people">{presenceResults.upcoming.map(person=><article key={person.key}><span className={`presence-avatar ${person.kind}`}>{person.initials}</span><div><strong>{person.name}</strong><span>{person.role} · {person.start.slice(0,5)}–{person.end.slice(0,5)}</span></div><small className="starts-in">En {durationLabel(person.minutesUntil)}</small></article>)}</div>:<div className="presence-empty compact"><span>No hay más turnos programados para ese día.</span></div>}
            </div>
          </div>}
        </section>}

        <section className="kpis">
          <article><span>Supervisores activos</span><strong>{data?.supervisors.filter(s=>s.active===1).length ?? people.length}</strong><small className="ok">● Nómina disponible</small></article>
          <article><span>Horas planificadas</span><strong>{displayHours(people.reduce((n,p) => n + hoursFor(p),0))} h</strong><small>Calculadas según cada rango</small></article>
          <article><span>Cobertura semanal</span><strong>96%</strong><div className="progress"><i /></div></article>
          <article><span>{isAdmin?"Locales registrados":"Local asignado"}</span><strong>{data?.locations.length ?? 0}</strong><small className="warn">{isAdmin?"Administrables":"Acceso limitado"}</small></article>
        </section>

        {(active === "Panel general" || active === "Horarios") && <section className="schedule-card" ref={scheduleRef}>
          <div className="schedule-title"><div><h2>Horario semanal</h2><p>Puedes editar nombres, quitar filas y modificar los turnos de tus locales asignados. Las semanas anteriores conservan su historial.</p></div><div className="schedule-actions"><button className="schedule-action-button" onClick={() => setCreate("supervisor")}>＋ Agregar fila</button><button className="schedule-action-button" onClick={()=>void copyWeek()}>▣ Copiar semana</button><button className="schedule-action-button image-action" onClick={()=>void downloadScheduleImage()}>▧ Descargar imagen</button></div></div>
          <div className="toolbar">
            <div className="week"><button aria-label="Semana anterior" onClick={() => changeWeek(-1)}>‹</button><strong>{weekLabel}</strong><button aria-label="Semana siguiente" onClick={() => changeWeek(1)}>›</button></div>
            <select value={location} onChange={e => setLocation(e.target.value)}>{isAdmin && <option>Todos los locales</option>}{(data?.locations.map(l => l.name) ?? locations.slice(1)).map(l => <option key={l}>{l}</option>)}</select>
            <input aria-label="Buscar supervisor" placeholder="⌕  Buscar supervisor..." value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <div className="table-wrap"><table>
            <thead><tr><th>Supervisor</th>{days.map(d => <th key={d}>{d}</th>)}<th>Horas</th></tr></thead>
            <tbody>{filtered.map(person => <tr key={person.id}>
              <td><div className="person"><span className="avatar">{person.initials}</span><div className="person-info"><button className="person-name" onClick={() => openSupervisorEditor(person)}>{person.name} <span>✎</span></button><small>{person.location}</small></div><button className="remove-row" aria-label={`Quitar fila de ${person.name}`} title="Quitar desde esta semana" onClick={() => void removeSupervisorRow(person)}>×</button></div></td>
              {person.shifts.map((item, day) => <td key={day}><button className={`shift ${item?.tone ?? "empty"}`} onClick={() => setModal({person,day})}>{item ? <><strong>{item.time}</strong><span>{item.role}</span></> : <><strong>＋ Agregar</strong><span>turno</span></>}</button></td>)}
              <td className="hours">{displayHours(hoursFor(person))} h</td>
            </tr>)}</tbody>
          </table></div>
        </section>}

        {active==="Shoppers"&&<section className="schedule-card shopper-schedule" ref={shopperScheduleRef}>
          <div className="shopper-view-tabs"><button className={shopperView==="schedule"?"active":""} onClick={()=>setShopperView("schedule")}><i>▦</i><span><strong>Horarios</strong><small>Programación semanal</small></span></button><button className={shopperView==="directory"?"active":""} onClick={()=>setShopperView("directory")}><i>⌕</i><span><strong>Repositorio de shoppers</strong><small>Buscar IDs y cambiar locales</small></span></button></div>
          {shopperView==="schedule"?<>
          <div className="schedule-title"><div><h2>Horario de shoppers</h2><p>Programación por turnos del personal de tus locales asignados.</p></div><div className="schedule-actions shopper-actions"><button className="schedule-action-button" onClick={()=>setAddShopper(true)}>＋ Agregar fila</button><button className="schedule-action-button" onClick={()=>setAddShopperShift(true)}>＋ Crear turno</button><button className="schedule-action-button" onClick={()=>void copyShopperWeek()}>▣ Copiar semana</button><button className="schedule-action-button image-action" onClick={()=>setShopperImageChoice(true)}>▧ Descargar imagen</button></div></div>
          <div className="shopper-submenu"><button className={shopperCategory==="purchase"?"active":""} onClick={()=>setShopperCategory("purchase")}>Asesores de compra</button><button className={shopperCategory==="delivery"?"active":""} onClick={()=>setShopperCategory("delivery")}>Repartidores</button></div>
          <div className="toolbar"><div className="week"><button onClick={()=>changeWeek(-1)}>‹</button><strong>{weekLabel}</strong><button onClick={()=>changeWeek(1)}>›</button></div><select value={location} onChange={e=>setLocation(e.target.value)}>{isAdmin&&<option>Todos los locales</option>}{data?.locations.map(l=><option key={l.id}>{l.name}</option>)}</select></div>
          {(()=>{
            const visible=shopperStaff.filter(s=>location==="Todos los locales"||s.location_name===location);
            const types=visible.flatMap(s=>dateKeys.map(d=>{const code=shopperTurns.find(t=>t.staff_id===s.id&&t.work_date===d)?.turn_code||"";return shopperShiftFor(code,s.location_id)}).filter(Boolean) as ShopperShiftType[]);
            const daily=dateKeys.map((date,index)=>{
              const dayTypes=visible.map(s=>{const code=shopperTurns.find(t=>t.staff_id===s.id&&t.work_date===date)?.turn_code||"";return shopperShiftFor(code,s.location_id)}).filter(Boolean) as ShopperShiftType[];
              return {date,label:days[index],opening:dayTypes.filter(t=>t.counts_opening).length,intermediate:dayTypes.filter(t=>!t.is_free&&!t.counts_opening&&!t.counts_closing).length,closing:dayTypes.filter(t=>t.counts_closing).length,free:dayTypes.filter(t=>t.is_free).length};
            });
            return <><div className="turn-kpis"><article><strong>{visible.length}</strong><span>Personal</span></article><article><strong>{types.filter(t=>t.counts_opening).length}</strong><span>Aperturas</span></article><article><strong>{types.filter(t=>!t.is_free&&!t.counts_opening&&!t.counts_closing).length}</strong><span>Intermedios</span></article><article><strong>{types.filter(t=>t.counts_closing).length}</strong><span>Cierres</span></article><article><strong>{types.filter(t=>t.is_free).length}</strong><span>Libres</span></article></div>
            <div className="daily-coverage"><div className="daily-coverage-head"><div><strong>Cobertura diaria</strong><span>Personal asignado por tipo de turno cada día</span></div><small>{shopperCategory==="purchase"?"Asesores de compra":"Repartidores"}</small></div><div className="daily-coverage-scroll">{daily.map(day=><article className="daily-card" key={day.date}><strong>{day.label}</strong><div><span>Apertura</span><b className="opening">{day.opening}</b></div><div><span>Intermedio</span><b className="intermediate">{day.intermediate}</b></div><div><span>Cierre</span><b className="closing">{day.closing}</b></div><div><span>Libre / Vac.</span><b className="free">{day.free}</b></div></article>)}</div></div>
            <div className={`table-wrap shopper-scalable${visible.length>20?" shopper-table-compact":""}`}><table><thead><tr><th>{shopperCategory==="purchase"?"Asesor de compra":"Repartidor"}</th>{days.map(d=><th key={d}>{d}</th>)}<th>Aperturas</th><th>Cierres</th>{isAdmin&&<th>Horas</th>}</tr></thead><tbody>{visible.map(staff=>{const weekly=dateKeys.map(d=>shopperTurns.find(t=>t.staff_id===staff.id&&t.work_date===d)?.turn_code||"");const weeklyTypes=weekly.map(code=>shopperShiftFor(code,staff.location_id));const weeklyHours=weeklyTypes.reduce((total,type)=>total+shopperShiftHours(type),0);return <tr key={staff.id}><td><div className="person"><span className="avatar">{staff.name.split(" ").map(x=>x[0]).join("").slice(0,2)}</span><div className="person-info"><div className="shopper-name-line"><strong className="shopper-name-text">{staff.name}</strong><div className="shopper-row-actions"><button className="shopper-action edit" onClick={()=>setEditShopper(staff)} title={`Editar a ${staff.name}`} aria-label={`Editar a ${staff.name}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11-4-4L4 16v4Zm12.2-16.2 4 4 1.1-1.1a1.4 1.4 0 0 0 0-2l-2-2a1.4 1.4 0 0 0-2 0l-1.1 1.1Z"/></svg></button><button className="shopper-action delete" onClick={()=>setDeleteShopper(staff)} title={`Eliminar a ${staff.name}`} aria-label={`Eliminar a ${staff.name}`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l1 2h4v2H3V5h4l1-2Zm-2 6h12l-1 12H7L6 9Zm4 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg></button></div></div><small>{staff.employment_type} · {staff.location_name} <span className="shopper-inline-id">ID {staff.shopper_external_id||"—"}</span></small></div></div></td>{dateKeys.map((d,i)=><td key={d}><button className={`turn-code turn-${weekly[i]||"empty"}`} onClick={()=>openShopperTurnModal(staff,d)}>{weekly[i]||"＋"}</button></td>)}<td className="hours">{weeklyTypes.filter(t=>t?.counts_opening).length}</td><td className="hours">{weeklyTypes.filter(t=>t?.counts_closing).length}</td>{isAdmin&&<td className="hours shopper-hours">{displayHours(weeklyHours)} h</td>}</tr>})}</tbody></table></div></>
          })()}</>:<div className="shopper-directory">
            <div className="directory-heading"><div><h2>Repositorio de shoppers</h2><p>Busca por ID o nombre y administra el local asignado.</p></div><span>{shopperDirectory.length} registros</span></div>
            <label className="shopper-id-search"><span>⌕</span><input value={shopperDirectoryQuery} onChange={event=>setShopperDirectoryQuery(event.target.value)} placeholder="Buscar por ID de shopper o nombre…" /></label>
            <div className="shopper-directory-list">{shopperDirectory.filter(person=>{const term=shopperDirectoryQuery.trim().toLowerCase();return !term||person.name.toLowerCase().includes(term)||String(person.shopper_external_id||"").toLowerCase().includes(term)}).map(person=><article key={person.id}><span className="directory-avatar">{person.name.split(" ").map(part=>part[0]).join("").slice(0,2).toUpperCase()}</span><div className="directory-person"><strong>{person.name}</strong><span>{person.category==="purchase"?"Asesor de compra":"Repartidor"} · {person.employment_type}</span></div><div className="directory-id"><small>ID SHOPPER</small><strong>{person.shopper_external_id||"Sin ID"}</strong></div><div className="directory-location"><small>LOCAL ACTUAL</small><strong>{person.location_name}</strong></div><span className={person.active===1?"directory-status active":"directory-status archived"}>{person.active===1?"Activo":"Archivado"}</span><button className="directory-edit" onClick={()=>setEditShopper(person)}>✎ Cambiar local</button></article>)}</div>
          </div>}
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
          <div className="report-type-tabs"><button className={reportType==="supervisor"?"active":""} onClick={()=>setReportType("supervisor")}><i>♙</i><span><strong>Supervisores</strong><small>Horas y roles por local</small></span></button><button className={reportType==="shopper"?"active":""} onClick={()=>setReportType("shopper")}><i>♟</i><span><strong>Shoppers</strong><small>Turnos de compra y entrega</small></span></button></div>
          <div className="management-head"><div><h2>{reportType==="supervisor"?"Reporte de horarios por local":"Reporte de shoppers"}</h2><p>{reportType==="supervisor"?"Selecciona el local y cualquier rango de fechas para generar el archivo de Excel.":"Genera el libro Excel 97-2003 con ID, mes, día, horas y día libre."}</p></div><button className="primary" onClick={reportType==="supervisor"?downloadExcelReport:downloadShopperReport}>⇩ Generar Excel</button></div>
          {reportType==="shopper"&&<div className="shopper-submenu report-shopper-type"><button className={shopperCategory==="purchase"?"active":""} onClick={()=>setShopperCategory("purchase")}>Asesores de compra</button><button className={shopperCategory==="delivery"?"active":""} onClick={()=>setShopperCategory("delivery")}>Repartidores</button></div>}
          <div className="report-filters">
            <label>Local<select value={reportLocation} onChange={e=>setReportLocation(e.target.value)}>{isAdmin && <option value="">Seleccionar local</option>}{data?.locations.map(l=><option key={l.id} value={l.name}>{l.name} · {l.city}</option>)}</select></label>
            <label>Desde<input type="date" min={SCHEDULE_MIN_DATE} max={SCHEDULE_MAX_DATE} value={reportStart} onChange={e=>setReportStart(e.target.value)} /></label>
            <label>Hasta<input type="date" min={SCHEDULE_MIN_DATE} max={SCHEDULE_MAX_DATE} value={reportEnd} onChange={e=>setReportEnd(e.target.value)} /></label>
          </div>
          {reportType==="supervisor"?<><div className="report-note"><strong>{reportRows.length}</strong><span>turnos encontrados</span><strong>{displayHours(reportSummary.reduce((sum,row)=>sum+row.hours,0))} h</strong><span>horas en el período</span></div>
          <div className="report-table"><div className="report-row report-head"><span>Supervisor</span><span>Local</span><span>Horas</span><span>Días</span></div>{reportSummary.length ? reportSummary.map(s => <div className="report-row" key={s.name}><strong>{s.name}</strong><span>{reportLocation}</span><strong>{displayHours(s.hours)} h</strong><span className="ok-pill">{s.worked} trabajados · {s.free} libres</span></div>) : <div className="empty-report">Selecciona un local y el rango de fechas para revisar el resumen antes de descargarlo.</div>}</div></>:<div className="report-format-preview"><strong>Columnas del archivo</strong><span>ID_SHOPPER</span><span>MES</span><span>DIA</span><span>HORA_INICIO</span><span>HORA_FIN</span><span>DIA_LIBRE</span></div>}
        </section>}

        {active === "Accesos" && isAdmin && <section className="management-card">
          <div className="management-head"><div><h2>Administración de accesos</h2><p>Registra previamente a cada supervisor y asígnalo a un solo local.</p></div><span className="admin-lock">Administrador: solo tú</span></div>
          <form className="access-form" onSubmit={e=>{e.preventDefault();void saveAccessUser(new FormData(e.currentTarget));e.currentTarget.reset();}}>
            <label>Nombre completo<input name="name" required placeholder="Nombre del supervisor" /></label>
            <label>Correo de acceso<input name="email" type="email" required placeholder="usuario@correo.com" /></label>
            <label>Locales permitidos<select name="locationIds" required multiple size={4}>{data?.locations.map(l=><option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select><small>Usa Ctrl para elegir varios</small></label>
            <button className="primary">＋ Registrar usuario</button>
          </form>
          <div className="access-list">
            <div className="access-row access-head"><span>Usuario</span><span>Correo</span><span>Local permitido</span><span>Acciones</span></div>
            {accessUsers.length ? accessUsers.map(user=>{const pending=user.active===0&&!user.location_ids.length;return <div className={`access-row ${pending?"pending-access":""}`} key={user.id}>
              <strong>{user.name}{pending&&<small className="pending-badge">Pendiente</small>}</strong><span>{user.email}</span><span>{pending&&user.requested_location_names.length ? `Solicita: ${user.requested_location_names.join(", ")}` : user.location_names.length ? user.location_names.join(", ") : "Sin asignar"}</span>
              <div className="access-actions">
                <button className="access-edit" onClick={()=>{setEditAccessUser(user);setEditAccessLocations(user.location_ids.length?user.location_ids:user.requested_location_ids)}}>{pending?"Revisar solicitud":"Editar"}</button>
                {!pending&&<button className="access-reset" disabled={resettingAccessId===user.id} onClick={()=>void resetAccessPassword(user)}>{resettingAccessId===user.id?"Generando…":"Restablecer clave"}</button>}
                {!pending&&<button className={user.active===1?"access-active":"access-blocked"} onClick={()=>void toggleAccessUser(user)}>{user.active===1?"Bloquear":"Reactivar"}</button>}
              </div>
            </div>}) : <div className="empty-report">Todavía no has registrado supervisores con acceso.</div>}
          </div>
        </section>}

        {active === "Configuración" && <section className="management-card"><div className="management-head"><div><h2>Configuración administrativa</h2><p>Tienes acceso total a los catálogos y a toda la información almacenada.</p></div></div><div className="settings-grid"><article><strong>Datos persistentes</strong><p>Los locales, supervisores, roles y horarios se guardan en la base del sistema.</p></article><article><strong>Acceso de administrador</strong><p>Daniel Castillo · Control total del sistema.</p></article><article><strong>Historial</strong><p>Las asignaciones permanecen disponibles para reportes y consultas futuras.</p></article></div></section>}
      </section>

      {notice && <button className="toast" onClick={() => setNotice("")}>{notice} ×</button>}
      {shopperImageChoice&&<div className="modal-backdrop" onMouseDown={()=>setShopperImageChoice(false)}><div className="modal image-choice-modal" role="dialog" aria-modal="true" aria-labelledby="image-choice-title" onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setShopperImageChoice(false)}>×</button><span className="modal-kicker">DESCARGAR HORARIO</span><h2 id="image-choice-title">¿Cómo quieres generar la imagen?</h2><p>Elige una sola imagen horizontal o divide los equipos grandes en dos archivos legibles.</p><div className="image-choice-grid"><button type="button" onClick={()=>void downloadShopperImage(1)}><span>▭</span><strong>Una imagen</strong><small>Todo el equipo en una tabla horizontal compacta.</small></button><button type="button" onClick={()=>void downloadShopperImage(2)}><span>▭ ▭</span><strong>Dos imágenes</strong><small>Divide el equipo en dos partes equilibradas.</small></button></div></div></div>}
      {addShopper&&<div className="modal-backdrop" onMouseDown={()=>setAddShopper(false)}><form className="modal" onSubmit={e=>{e.preventDefault();void createShopper(new FormData(e.currentTarget));}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setAddShopper(false)}>×</button><span className="modal-kicker">AGREGAR FILA</span><h2>{shopperCategory==="purchase"?"Nuevo asesor de compra":"Nuevo repartidor"}</h2><p>Se agregará al local seleccionado en el horario.</p><label>Nombre completo<input name="name" required /></label><label>ID de shopper<input name="shopperId" inputMode="numeric" required placeholder="Ej. 1692" /></label><label>Tipo<select name="employmentType"><option>Interno</option><option>Externo</option><option>Full service</option>{shopperCategory==="purchase"&&<option>Shopper cobrador</option>}</select></label><button className="primary save">Guardar</button></form></div>}
      {editShopper&&<div className="modal-backdrop" onMouseDown={()=>setEditShopper(null)}><form className="modal" onSubmit={e=>{e.preventDefault();void updateShopper(new FormData(e.currentTarget));}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setEditShopper(null)}>×</button><span className="modal-kicker">DATOS INTERNOS</span><h2>{editShopper.name}</h2><p>El ID aparece de forma compacta junto a sus datos y también se conserva en el reporte.</p><label>Nombre completo<input name="name" required defaultValue={editShopper.name} /></label><label>ID de shopper<input name="shopperId" inputMode="numeric" required defaultValue={editShopper.shopper_external_id||""} /></label><label>Local asignado<select name="locationId" required defaultValue={editShopper.location_id}>{data?.locations.map(item=><option key={item.id} value={item.id}>{item.name} · {item.city}</option>)}</select></label><button className="primary save">Guardar cambios</button></form></div>}
      {deleteShopper&&<div className="modal-backdrop" onMouseDown={()=>!deletingShopper&&setDeleteShopper(null)}><div className="modal confirm-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-shopper-title" onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" disabled={deletingShopper} onClick={()=>setDeleteShopper(null)}>×</button><span className="delete-warning-icon">!</span><span className="modal-kicker">ELIMINAR DEL HORARIO</span><h2 id="delete-shopper-title">¿Eliminar a {deleteShopper.name}?</h2><p>¿Estás seguro de que quieres eliminar a este shopper del horario? Se eliminará toda su fila y los turnos asignados. Esta acción no elimina usuarios de acceso ni otros locales.</p><div className="confirm-actions"><button type="button" className="secondary" disabled={deletingShopper} onClick={()=>setDeleteShopper(null)}>Cancelar</button><button type="button" className="danger-button" disabled={deletingShopper} onClick={()=>void confirmDeleteShopper()}>{deletingShopper?"Eliminando…":"Sí, eliminar shopper"}</button></div></div></div>}
      {addShopperShift&&<div className="modal-backdrop" onMouseDown={()=>setAddShopperShift(false)}><form className="modal shift-type-editor" onSubmit={e=>{e.preventDefault();void createShopperShift(new FormData(e.currentTarget));}} onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setAddShopperShift(false)}>×</button><span className="modal-kicker">NUEVO TURNO</span><h2>Crear turno de shoppers</h2><p>La misma sigla puede tener horarios diferentes en cada local.</p><label>Local<select name="locationId" required defaultValue={data?.locations.find(l=>l.name===location)?.id??""}><option value="" disabled>Selecciona el local</option>{data?.locations.map(l=><option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}</select></label><div className="time-row"><label>Código<input name="code" required maxLength={6} placeholder="A" /></label><label>Nombre<input name="label" required placeholder="Apertura" /></label></div><div className="time-row"><label>Hora de inicio<input name="start" type="time" defaultValue="06:00" /></label><label>Hora de fin<input name="end" type="time" defaultValue="14:00" /></label></div><label>Disponible para<select name="category" defaultValue={shopperCategory}><option value="purchase">Asesores de compra</option><option value="delivery">Repartidores</option><option value="both">Ambos</option></select></label><fieldset className="shift-flags"><legend>Clasificación</legend><label><input type="checkbox" name="countsOpening" /> Cuenta como apertura</label><label><input type="checkbox" name="countsClosing" /> Cuenta como cierre</label><label><input type="checkbox" name="isFree" /> Es libre o vacaciones</label></fieldset><button className="primary save">Crear o actualizar turno</button></form></div>}
      {shopperModal&&<div className="modal-backdrop" onMouseDown={()=>setShopperModal(null)}><div className="modal turn-modal shopper-turn-combo" onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setShopperModal(null)}>×</button><span className="modal-kicker">ASIGNAR TURNO</span><h2>{shopperModal.staff.name}</h2><p>{shopperModal.date} · {shopperModal.staff.location_name}</p><label className="turn-search-label">Escribe o selecciona el turno<div className="turn-search-input"><input autoFocus value={shopperTurnInput} onChange={e=>setShopperTurnInput(e.target.value.toUpperCase())} onKeyDown={e=>{if(e.key!=="Enter")return;e.preventDefault();const code=shopperTurnInput.trim().toUpperCase();const valid=shopperShiftTypes.some(type=>(type.location_id===null||type.location_id===shopperModal.staff.location_id)&&(type.category==="both"||type.category===shopperModal.staff.category)&&type.code.toUpperCase()===code);if(valid)void saveShopperTurn(code);else setNotice("Turno no registrado para este local");}} placeholder="Escribe A, T, L…" maxLength={6}/><kbd>↵</kbd></div></label><small className="turn-search-help">Escribe el código y presiona Enter, o toca una opción.</small><div className="turn-options">{shopperShiftTypes.filter(type=>(type.location_id===null||type.location_id===shopperModal.staff.location_id)&&(type.category==="both"||type.category===shopperModal.staff.category)&&(!shopperTurnInput.trim()||type.code.toLowerCase().includes(shopperTurnInput.trim().toLowerCase())||type.label.toLowerCase().includes(shopperTurnInput.trim().toLowerCase()))).map(type=><button key={`${type.id}-${type.code}`} onClick={()=>void saveShopperTurn(type.code)}><strong>{type.code}</strong><span>{type.start_time&&type.end_time?`${type.start_time.slice(0,5)}–${type.end_time.slice(0,5)} · `:""}{shopperShiftLabel(type)}</span></button>)}</div>{shopperShiftTypes.filter(type=>(type.location_id===null||type.location_id===shopperModal.staff.location_id)&&(type.category==="both"||type.category===shopperModal.staff.category)&&(!shopperTurnInput.trim()||type.code.toLowerCase().includes(shopperTurnInput.trim().toLowerCase())||type.label.toLowerCase().includes(shopperTurnInput.trim().toLowerCase()))).length===0&&<div className="turn-search-empty"><strong>Turno no registrado</strong><span>Prueba con otro código disponible para este local.</span></div>}</div></div>}
      {editAccessUser && <div className="modal-backdrop" onMouseDown={()=>setEditAccessUser(null)}><form className="modal access-editor" onSubmit={e=>{e.preventDefault();void updateAccessUser(new FormData(e.currentTarget));}} onMouseDown={e=>e.stopPropagation()}>
        <button type="button" className="close" onClick={()=>setEditAccessUser(null)}>×</button>
        <span className="modal-kicker">EDITAR ACCESO</span>
        <h2>{editAccessUser.name}</h2>
        <p>{editAccessUser.email}</p>
        <label>Nombre completo<input name="name" required defaultValue={editAccessUser.name} /></label>
        <fieldset className="location-checks"><legend>Locales permitidos</legend>{data?.locations.map(l=><label key={l.id}><input type="checkbox" checked={editAccessLocations.includes(l.id)} onChange={e=>setEditAccessLocations(ids=>e.target.checked?[...ids,l.id]:ids.filter(id=>id!==l.id))} /> <span>{l.name} · {l.city}</span></label>)}</fieldset>
        <label>Estado<select name="active" defaultValue={editAccessUser.active===0&&!editAccessUser.location_ids.length?1:editAccessUser.active}><option value={1}>Activo</option><option value={0}>Bloqueado</option></select></label>
        <button className="primary save" disabled={!editAccessLocations.length}>{editAccessUser.active===0&&!editAccessUser.location_ids.length?"Aprobar acceso":"Guardar cambios"}</button>
      </form></div>}
      {temporaryAccess&&<div className="modal-backdrop" onMouseDown={()=>setTemporaryAccess(null)}><div className="modal temporary-password-modal" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title" onMouseDown={e=>e.stopPropagation()}><button type="button" className="close" onClick={()=>setTemporaryAccess(null)}>×</button><span className="temporary-key-icon">⚿</span><span className="modal-kicker">CONTRASEÑA TEMPORAL</span><h2 id="temporary-password-title">{temporaryAccess.name}</h2><p>Comparte estos datos de forma privada. La contraseña se mostrará únicamente en esta ventana y el usuario deberá cambiarla al ingresar.</p><div className="temporary-credential"><small>Correo</small><strong>{temporaryAccess.email}</strong></div><div className="temporary-credential password"><small>Contraseña temporal</small><code>{temporaryAccess.password}</code><button type="button" onClick={async()=>{await navigator.clipboard.writeText(temporaryAccess.password);setNotice("✓ Contraseña temporal copiada")}}>Copiar</button></div><button type="button" className="primary save" onClick={()=>setTemporaryAccess(null)}>Entendido, cerrar</button></div></div>}
      {modal && <div className="modal-backdrop" onMouseDown={() => setModal(null)}><form className="modal" onSubmit={e => {e.preventDefault(); saveShift(new FormData(e.currentTarget));}} onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="close" onClick={() => setModal(null)}>×</button>
        <span className="modal-kicker">EDITAR ASIGNACIÓN</span><h2>{modal.person.name}</h2><p>{days[modal.day]} · {modal.person.location}</p>
        <label>Rol<select name="role" defaultValue={modal.person.shifts[modal.day]?.role ?? "Compra / Procesos"}>{(data?.roles.map(r=>r.name) ?? ["Compra / Procesos","Certificaciones / Grupos","Cierre","Shopper","Descanso","Total","Vacaciones"]).map(r=><option key={r}>{r}</option>)}</select></label>
        <div className="time-row"><label>Entrada<input name="start" type="time" defaultValue={shiftTime(modal.person.shifts[modal.day],0,"06:00")} /></label><label>Salida<input name="end" type="time" defaultValue={shiftTime(modal.person.shifts[modal.day],1,"14:00")} /></label></div>
        <small className="hours-preview">Las horas se calculan automáticamente. Libre, Descanso y Vacaciones suman 0 horas.</small>
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
        <button className="primary save">Guardar cambios</button>
      </form></div>}
    </main>
  );
}
