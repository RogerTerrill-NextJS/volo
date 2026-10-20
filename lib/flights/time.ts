import type {Database} from '../supabase/database.types';

type WallTime={year:number;month:number;day:number;hour:number;minute:number;second:number};
export type DepartureInput={localDate:unknown;localTime:unknown;timeZone:unknown;occurrence?:unknown};
export type DepartureValue=Pick<Database['public']['Tables']['flights']['Insert'],
  'departure_at'|'departure_timezone'|'departure_local_date'>;
export type DepartureCode='invalid_date'|'invalid_time'|'invalid_timezone'|'invalid_occurrence'|'nonexistent_time'|'ambiguous_time';
export type DepartureResult={ok:true;value:DepartureValue}|{ok:false;code:DepartureCode};
export type DepartureDisplay={localDate:string;localTime:string;timeZone:string;utcOffset:string;label:string;occurrence?:'earlier'|'later'};
const hour=3600000;
const pad=(n:number,width=2)=>String(n).padStart(width,'0');
const dateLabel=(p:WallTime)=>`${pad(p.year,4)}-${pad(p.month)}-${pad(p.day)}`;
const timeLabel=(p:WallTime)=>`${pad(p.hour)}:${pad(p.minute)}${p.second?':'+pad(p.second):''}`;

// Date.UTC treats years 0–99 specially; explicit setters preserve the actual year.
function wallUtc(p:WallTime):number {
  const date=new Date(0);date.setUTCFullYear(p.year,p.month-1,p.day);
  date.setUTCHours(p.hour,p.minute,p.second,0);return date.getTime();
}
function parseDate(raw:unknown):Pick<WallTime,'year'|'month'|'day'>|null {
  if(typeof raw!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw))return null;
  const [year,month,day]=raw.split('-').map(Number);
  if(year<1||month<1||month>12||day<1||day>31)return null;
  const date=new Date(wallUtc({year,month,day,hour:0,minute:0,second:0}));
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?{year,month,day}:null;
}
function parseTime(raw:unknown):Pick<WallTime,'hour'|'minute'|'second'>|null {
  if(typeof raw!=='string')return null;
  const match=/^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(raw);if(!match)return null;
  const hour=Number(match[1]),minute=Number(match[2]),second=Number(match[3]??0);
  return hour<=23&&minute<=59&&second<=59?{hour,minute,second}:null;
}
function zoneContext(raw:unknown):{zone:string;formatter:Intl.DateTimeFormat}|null {
  if(typeof raw!=='string')return null;
  const value=raw.trim();
  if(!/^(?:UTC|[a-z_]+\/[a-z0-9_+./-]+)$/i.test(value)||/^(?:Etc|posix|right)\//i.test(value))return null;
  try{
    const formatter=new Intl.DateTimeFormat('en-GB',{calendar:'iso8601',numberingSystem:'latn',
      timeZone:value,era:'short',year:'numeric',month:'2-digit',day:'2-digit',
      hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'});
    return {zone:formatter.resolvedOptions().timeZone,formatter};
  }catch{return null;}
}
function wallParts(formatter:Intl.DateTimeFormat,instant:number):WallTime {
  const parts=Object.fromEntries(formatter.formatToParts(instant).map(p=>[p.type,p.value]));
  const year=Number(parts.year);
  return {year:parts.era==='BC'?1-year:year,month:Number(parts.month),day:Number(parts.day),
    hour:Number(parts.hour),minute:Number(parts.minute),second:Number(parts.second)};
}
function matchingInstants(wall:WallTime,formatter:Intl.DateTimeFormat):number[] {
  const target=wallUtc(wall),offsets=new Set<number>();
  // Sample surrounding IANA offset regimes, including the dates on both sides
  // of a transition. Offsets may contain seconds and transitions need not be 1h.
  for(let delta=-48;delta<=48;delta++){
    const probe=target+delta*hour;offsets.add(wallUtc(wallParts(formatter,probe))-probe);
  }
  return [...offsets].map(offset=>target-offset)
    .filter(instant=>wallUtc(wallParts(formatter,instant))===target).sort((a,b)=>a-b);
}

/** Interpret a departure wall clock only in its explicit departure zone. */
export function resolveDeparture(input:DepartureInput):DepartureResult {
  const date=parseDate(input.localDate);if(!date)return {ok:false,code:'invalid_date'};
  const time=parseTime(input.localTime);if(!time)return {ok:false,code:'invalid_time'};
  const context=zoneContext(input.timeZone);if(!context)return {ok:false,code:'invalid_timezone'};
  if(input.occurrence!==undefined&&input.occurrence!==''&&input.occurrence!=='earlier'&&input.occurrence!=='later')return {ok:false,code:'invalid_occurrence'};
  const matches=matchingInstants({...date,...time},context.formatter);
  if(!matches.length)return {ok:false,code:'nonexistent_time'};
  if(matches.length>1&&!input.occurrence)return {ok:false,code:'ambiguous_time'};
  const instant=matches[input.occurrence==='later'?matches.length-1:0],utc=new Date(instant);
  if(utc.getUTCFullYear()<1||utc.getUTCFullYear()>9999)return {ok:false,code:'invalid_date'};
  return {ok:true,value:{departure_at:utc.toISOString(),departure_timezone:context.zone,departure_local_date:dateLabel({...date,...time})}};
}

/** Departure-zone display/edit values, including an offset and repeat choice. */
export function formatDeparture(instant:string,timeZone:string):DepartureDisplay|null {
  const match=/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(instant);
  if(!match||!parseDate(match[1])||!parseTime(match[2]))return null;
  const value=Date.parse(instant),context=zoneContext(timeZone);
  // Input helpers operate at second precision; do not silently truncate stored sub-seconds.
  if(!Number.isFinite(value)||value%1000!==0||!context)return null;
  const parts=wallParts(context.formatter,value);if(parts.year<1||parts.year>9999)return null;
  const matches=matchingInstants(parts,context.formatter),index=matches.indexOf(value);
  if(index<0||(matches.length>2&&index!==0&&index!==matches.length-1))return null;
  const occurrence=matches.length>1?(index===0?'earlier':'later'):undefined;
  const offset=context.formatter.formatToParts(value).find(p=>p.type==='timeZoneName')?.value;
  if(!offset)return null;
  const utcOffset=offset.replace(/^GMT/,'UTC'),localDate=dateLabel(parts),localTime=timeLabel(parts);
  return {localDate,localTime,timeZone:context.zone,utcOffset,
    label:`${localDate} ${localTime} ${context.zone} (${utcOffset})`,...(occurrence?{occurrence}:{} )};
}
