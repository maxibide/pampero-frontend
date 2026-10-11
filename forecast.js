/*
 * Load the forecast from data/forecast.json, unless window.FORECAST is provided first.
 * Expected data (3 to 14 days):
 * {
 *   location, model, program, generated (ISO 8601 with timezone),
 *   days: [{
 *     date: 'YYYY-MM-DD', tmax, tmin,
 *     precip: { p25, p50, p75 },
 *     periods: [{ temp, wind, gust, dir, pRain, pStorm, pSevere, pSnow, cloud,
 *       precip?: { p25, p50, p75 },
 *       hours?: [{ hour, temp, wind, gust, dir, pRain, pStorm, pSevere, pSnow, cloud }] }]
 *   }]
 * }
 * Daily precip quantiles are calculated from ensemble-member daily totals; daily pRain is the maximum period pRain.
 * tmin is optional and is only shown when all four periods are available.
 * The first day may contain fewer periods; missing periods are assumed to be at the start.
 * An incomplete final day is ignored.
 * The first three days require period.precip for the short-range chart.
 * Each optional period.hours array has six local-hour records; hour is 0-23.
 * Units: degrees Celsius, km/h, wind direction in degrees, mm, and percentages.
 */
let F;
const $=id=>document.getElementById(id);
const DIR=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSO','SO','OSO','O','ONO','NO','NNO'];
const PER=[['Madrugada','00 a 06 h'],['Mañana','06 a 12 h'],['Tarde','12 a 18 h'],['Noche','18 a 24 h']];
const HOUR_FIELDS=['temp','wind','gust','dir','pRain','pStorm','pSevere','pSnow','cloud'];
const dt=d=>new Date(d+'T12:00:00'),cap=s=>s[0].toUpperCase()+s.slice(1),mx=(d,k)=>Math.max(...d.periods.map(p=>p[k]));
let N=7,sel=0,shortSel=0;
const hm=d=>d.tmin!=null&&d.periods.length===4; /* A minimum temperature is meaningful only for a complete day. */
const mm=n=>String(Math.round(n));
const rainText=d=>{
  if(d.pRain<25||d.precip.p75===0)return'0 mm';
  const lo=mm(d.precip.p25),hi=mm(d.precip.p75);
  return lo===hi?`${hi} mm`:`${lo}–${hi} mm`;
};
function prevailingWind(d){
  let east=0,north=0,total=0;
  d.periods.forEach(p=>{
    const speed=Math.max(0,p.wind),angle=(p.dir+180)*Math.PI/180;
    east+=Math.sin(angle)*speed;north+=Math.cos(angle)*speed;total+=speed;
  });
  const strength=Math.hypot(east,north)/total;
  if(!total||strength<.25)return{variable:true};
  const angle=(Math.atan2(east,north)*180/Math.PI+360)%360,from=(angle+180)%360;
  return{angle,from:DIR[Math.round(from/22.5)%16],variable:false};
}

/* Return the dominant weather icon and matching hero theme for a day. */
function icon(d){
  const c=d.periods.reduce((a,p)=>a+p.cloud,0)/d.periods.length;
  if(mx(d,'pStorm')>=35)return['⛈️','storm'];
  if(mx(d,'pSnow')>=50)return['🌨️','rain'];
  if(mx(d,'pRain')>=50)return['🌧️','rain'];
  if(c>=70)return['☁️','cloud'];
  return c>=35?['⛅','sun']:['☀️','sun'];
}

function periodWeather(p){
  if(p.pStorm>=35)return['⛈️','Tormentoso'];
  if(p.pSnow>=50)return['🌨️','Nieve'];
  if(p.pRain>=50)return['🌧️','Lluvioso'];
  if(p.cloud>=70)return['☁️','Nublado'];
  return p.cloud>=35?['⛅','Parcialmente nublado']:['☀️','Despejado'];
}

/* Build the forecast-length controls. */
function seg(){
  $('seg').innerHTML=[3,7,10,14].filter(n=>n<=F.days.length).map(n=>`<button data-n="${n}" aria-pressed="${n==N}">${n} días</button>`).join('');
}

/* Update the selected day's headline conditions. */
function head(){
  const d=F.days[sel],[ic,sky]=icon(d),wind=prevailingWind(d);$('hero').dataset.sky=sky;
  $('loc').textContent=F.location;const g=new Date(F.generated),gs=isNaN(g)?'':g.toLocaleDateString('es-AR',{day:'numeric',month:'short'}).replace('.','')+', '+g.toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false})+' h';
  $('meta').textContent=`${F.model}${gs?', generado el '+gs:''}${F.program?' por '+F.program:''}`;
  const lab=cap(dt(d.date).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'}));
  $('now').innerHTML=`<div class="big"><span class="ico" aria-hidden="true">${ic}</span><div><div class="dayl">${lab}</div>
  <div class="temps">${d.tmax}°${hm(d)?`<span>${d.tmin}°</span>`:''}</div></div></div>
  <ul class="chips"><li>${rainText(d)}<small>Acumulado</small></li><li>${d.pRain} %<small>Prob. de lluvia</small></li>
  <li>${mx(d,'wind')} km/h<small>Viento máximo</small></li><li>${mx(d,'gust')} km/h<small>Ráfaga máxima</small></li>
  <li><span class="wind-dir"${wind.variable?'':' style="transform:rotate('+wind.angle+'deg)"'} aria-hidden="true">${wind.variable?'↻':'↑'}</span> ${wind.variable?'Variable':'del '+wind.from}<small>Dirección predominante</small></li></ul>`;
  $('dtitle').textContent=lab;
}

/* Draw the interactive temperature and precipitation chart. */
function chart(){
  const D=F.days.slice(0,N),cw=64,W=N*cw,H=260,top=62,bot=108,base=212;
  const hi=Math.max(...D.map(d=>d.tmax))+2,lo=Math.min(...D.map(d=>hm(d)?d.tmin:d.tmax))-2,mp=Math.max(10,...D.map(d=>d.precip.p75));
  const y=t=>top+(hi-t)/(hi-lo)*(H-top-bot),x=i=>i*cw+cw/2;
  const pts=k=>D.map((d,i)=>(k=='tmin'&&!hm(d))?'':x(i)+','+y(d[k])).filter(Boolean).join(' ');
  let s=`<polyline points="${pts('tmax')}" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>
  <polyline points="${pts('tmin')}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="2" stroke-dasharray="1 5" stroke-linecap="round"/>`;
  D.forEach((d,i)=>{
    const wd=i==0?'Hoy':cap(dt(d.date).toLocaleDateString('es-AR',{weekday:'short'}).replace('.',''))+' '+dt(d.date).getDate();
    const h25=d.precip.p25/mp*34,h50=d.precip.p50/mp*34,h75=d.precip.p75/mp*34,rainOn=d.pRain>=25&&d.precip.p75>0;
    s+=`<g class="col${i==sel?' on':''}" data-i="${i}" tabindex="0" role="button" aria-label="${wd}"><rect x="${i*cw+2}" y="2" width="${cw-4}" height="${H-4}" rx="16"/>
    <text x="${x(i)}" y="36" font-size="22">${icon(d)[0]}</text>
    <circle cx="${x(i)}" cy="${y(d.tmax)}" r="4" fill="#fff"/>${hm(d)?`<circle cx="${x(i)}" cy="${y(d.tmin)}" r="3" fill="#fff" fill-opacity=".7"/>`:''}
    <text class="tx" x="${x(i)}" y="${y(d.tmax)-11}">${d.tmax}°</text>${hm(d)?`<text class="tn" x="${x(i)}" y="${y(d.tmin)+19}">${d.tmin}°</text>`:''}
    ${rainOn?`<rect x="${x(i)-7}" y="${base-h75}" width="14" height="${Math.max(2,h75-h25)}" rx="4" style="fill:rgba(255,255,255,.55)"/><line x1="${x(i)-10}" y1="${base-h50}" x2="${x(i)+10}" y2="${base-h50}" stroke="#fff" stroke-width="2"/>`:''}
    <text class="pn" x="${x(i)}" y="${base+16}">${rainText(d)}</text><text class="dn" x="${x(i)}" y="${H-12}">${wd}</text></g>`;
  });
  const c=$('chart');c.setAttribute('aria-label','Temperatura máxima y rango P25–P75 de precipitación por día');c.setAttribute('viewBox',`0 0 ${W} ${H}`);c.style.minWidth=W+'px';c.innerHTML=s;
}

function shortPeriods(){
  return F.days.slice(0,3).flatMap((d,dayIndex)=>d.periods.map((p,j,a)=>({d,p,dayIndex,k:j+4-a.length})));
}

/* Show temperature and cloud cover for each selectable six-hour period. */
function periodChart(){
  const items=shortPeriods(),cw=80,W=items.length*cw,H=276,top=90,base=220;
  const hi=Math.max(...items.map(({p})=>p.temp))+2,lo=Math.min(...items.map(({p})=>p.temp))-2;
  const maxRain=Math.max(1,...items.map(({p})=>p.precip.p75));
  const x=i=>i*cw+cw/2,y=t=>top+(hi-t)/(hi-lo)*66;
  let s='',offset=0;
  F.days.slice(0,3).forEach((d,dayIndex)=>{
    const count=d.periods.length,label=dayIndex===0?'Hoy':cap(dt(d.date).toLocaleDateString('es-AR',{weekday:'short'}).replace('.',''))+' '+dt(d.date).getDate();
    s+=`<text class="period-day" x="${offset+count*cw/2}" y="23">${label}</text>`;
    if(offset)s+=`<line class="period-divider" x1="${offset}" y1="34" x2="${offset}" y2="${H-8}"/>`;
    offset+=count*cw;
  });
  items.forEach(({d,p,dayIndex,k},i)=>{
    const dateLabel=dayIndex===0?'Hoy':cap(dt(d.date).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'}));
    const periodName=PER[k][0],[weatherIcon,weather]=periodWeather(p),rainOn=p.pRain>=25&&p.precip.p75>0;
    const h25=p.precip.p25/maxRain*36,h50=p.precip.p50/maxRain*36,h75=p.precip.p75/maxRain*36;
    s+=`<g class="col${i===shortSel?' on':''}" data-i="${i}" tabindex="0" role="button" aria-label="${dateLabel}, ${periodName}, ${weather}, ${Math.round(p.temp)} grados, acumulado ${rainText(p)}">
      <rect x="${i*cw+2}" y="34" width="${cw-4}" height="${H-40}" rx="12"/>
      ${rainOn?`<rect class="rain-range" x="${x(i)-8}" y="${base-h75}" width="16" height="${Math.max(2,h75-h25)}" rx="4"/><line x1="${x(i)-11}" y1="${base-h50}" x2="${x(i)+11}" y2="${base-h50}" stroke="#fff" stroke-width="2"/>`:''}
      <text class="period-icon" x="${x(i)}" y="${y(p.temp)-35}" aria-hidden="true">${weatherIcon}</text>
      <circle cx="${x(i)}" cy="${y(p.temp)}" r="4" fill="#fff"/>
      <text class="tx" x="${x(i)}" y="${y(p.temp)-10}">${Math.round(p.temp)}°</text>
      <text class="pn" x="${x(i)}" y="${base+15}">${rainText(p)}</text>
      <text class="period-name" x="${x(i)}" y="${H-12}">${periodName}</text></g>`;
  });
  let offsetForLine=0;
  F.days.slice(0,3).forEach(d=>{
    const points=d.periods.map((p,j)=>`${x(offsetForLine+j)},${y(p.temp)}`).join(' ');
    if(d.periods.length>1)s+=`<polyline points="${points}" fill="none" stroke="#fff" stroke-width="2.5" stroke-linejoin="round" style="pointer-events:none"/>`;
    offsetForLine+=d.periods.length;
  });
  const c=$('chart');c.setAttribute('aria-label','Temperatura y acumulado de precipitación P25–P75 por periodo de 6 horas');
  c.setAttribute('viewBox',`0 0 ${W} ${H}`);c.style.minWidth=W+'px';c.innerHTML=s;
}

/* Render a probability row and bar when the probability is nonzero. */
function prob(l,v,c){if(!v)return '';return `<div class="row"><span>${l}</span><b>${v} %</b></div><div class="bar" style="--c:${c}"><i style="width:${v}%"></i></div>`}

function periodDetails(p,k){
  return `<article class="per"><h3>${PER[k][0]}</h3><small>${PER[k][1]} · pronóstico agregado</small>
  <div class="pt">${p.temp}°</div>
  <div class="row"><span>Nubosidad</span><b>${p.cloud} %</b></div><div class="bar" style="--c:#8a97ad"><i style="width:${p.cloud}%"></i></div>
  <div class="wind"><div class="arr" style="transform:rotate(${(p.dir+180)%360}deg)" aria-hidden="true">↑</div>
  <div><b>${p.wind} km/h</b> del ${DIR[Math.round(p.dir/22.5)%16]}<br><span>Ráfagas de ${p.gust} km/h</span></div></div>
  ${prob('Lluvia',p.pRain,'var(--rain)')+prob('Tormenta',p.pStorm,'var(--storm)')+prob('Tormenta fuerte',p.pSevere,'var(--sev)')+prob('Nieve',p.pSnow,'var(--snow)')||'<div class="row"><span>Sin precipitación prevista</span></div>'}</article>`;
}

function hourlyDetails(item){
  const hours=item.p.hours||[],rows=hours.map(hour=>`<div class="hourly-row"><b>${String(hour.hour).padStart(2,'0')} h</b><span>${hour.temp}°</span><span>${hour.cloud}%</span><span class="hourly-wind"><b>${hour.wind} km/h</b><small><i style="transform:rotate(${(hour.dir+180)%360}deg)" aria-hidden="true">↑</i> del ${DIR[Math.round(hour.dir/22.5)%16]}</small></span><span>${hour.pRain}%</span></div>`).join('');
  return `<section class="hourly"><h3>Pronóstico horario</h3>
    ${hours.length?`<div class="hourly-table"><div class="hourly-row hourly-head"><span>Hora</span><span>Temp.</span><span>Nubes</span><span>Viento</span><span>Lluvia</span></div>${rows}</div>`:'<p>No hay datos horarios disponibles para este periodo.</p>'}
  </section>`;
}

/* Render the selected day's morning, afternoon, evening, and night details. */
function detail(){
  if(N===3){
    const items=shortPeriods(),index=Math.min(shortSel,items.length-1),selected=items[index];
    $('detail').classList.add('period-selected');
    $('detail').style.setProperty('--n',1);$('dtitle').hidden=false;
    const date=cap(dt(selected.d.date).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'long'}));
    $('dtitle').textContent=`${date} · ${PER[selected.k][0]}`;
    $('detail').innerHTML=periodDetails(selected.p,selected.k)+hourlyDetails(selected);
    return;
  }
  $('dtitle').hidden=false;
  $('detail').classList.remove('period-selected');
  const P=F.days[sel].periods;$('detail').style.setProperty('--n',P.length);
  $('detail').innerHTML=P.map((p,j,a)=>periodDetails(p,j+4-a.length)).join('');
}

/* Refresh every forecast section after a selection or range change. */
function render(){
  seg();head();
  const periodsOnly=N===3;$('hero').dataset.view=periodsOnly?'periods':'forecast';
  $('hint').textContent=periodsOnly?'Línea: temperatura; banda: acumulado P25–P75; marca: mediana. Los iconos indican el estado del periodo.':'Banda: P25–P75; línea: mediana. Tocá un día para ver el detalle por periodo.';
  if(periodsOnly)periodChart();else chart();
  detail();
}
$('seg').onclick=e=>{const b=e.target.closest('button');if(!b)return;N=+b.dataset.n;if(sel>=N)sel=0;render()};
const pick=e=>{const g=e.target.closest('.col');if(g&&(e.type=='click'||e.key=='Enter'||e.key==' ')){e.preventDefault();if(N===3){shortSel=+g.dataset.i;sel=shortPeriods()[shortSel].dayIndex}else sel=+g.dataset.i;render()}};
$('chart').addEventListener('click',pick);$('chart').addEventListener('keydown',pick);

/* Load and validate the forecast before rendering the page. */
async function init(){
  try{
    if(window.FORECAST)F=window.FORECAST;
    else{const r=await fetch('data/forecast.json',{cache:'no-store'});if(!r.ok)throw new Error(r.status);F=await r.json()}
    if(!F.days||F.days.length<1)throw new Error('sin días');
    const last=F.days[F.days.length-1];
    if(F.days.length>1&&last.periods?.length<4)F={...F,days:F.days.slice(0,-1)};
    F={...F,days:F.days.map(d=>({...d,pRain:Math.max(...(d.periods||[]).map(p=>p.pRain))}))};
    F.days.forEach((d,i)=>{const L=d.periods?d.periods.length:0;
      const q=d.precip;
      if(!q||![q.p25,q.p50,q.p75,d.pRain].every(Number.isFinite)||q.p25<0||q.p25>q.p50||q.p50>q.p75||d.pRain<0||d.pRain>100)
        throw new Error(`El día ${i+1} (${d.date}) tiene cuantiles o probabilidad diaria inválidos`);
      if(L<1||L>4||(i>0&&L!==4))throw new Error(`El día ${i+1} (${d.date}) tiene ${L} periodos; se esperaban ${i>0?'4':'de 1 a 4'}`);
      d.periods.forEach((p,j,a)=>{
        if(i<3&&(!p.precip||![p.precip.p25,p.precip.p50,p.precip.p75].every(Number.isFinite)||p.precip.p25<0||p.precip.p25>p.precip.p50||p.precip.p50>p.precip.p75))
          throw new Error(`El periodo ${j+1} del día ${i+1} tiene acumulados inválidos`);
        if(p.hours===undefined)return;
        const startHour=(j+4-a.length)*6;
        if(!Array.isArray(p.hours)||p.hours.length!==6)throw new Error(`El periodo ${j+1} del día ${i+1} debe tener 6 horas`);
        p.hours.forEach((hour,h)=>{
          const valid=hour&&hour.hour===startHour+h&&HOUR_FIELDS.every(key=>Number.isFinite(hour[key]));
          if(!valid||hour.pRain<0||hour.pRain>100||hour.pStorm<0||hour.pStorm>100||hour.pSevere<0||hour.pSevere>100||hour.pSnow<0||hour.pSnow>100||hour.cloud<0||hour.cloud>100)
            throw new Error(`La hora ${h+1} del periodo ${j+1}, día ${i+1}, es inválida`);
        });
      });
    });
    N=Math.min(7,F.days.length);render();
  }catch(e){
    console.error('Error al cargar data/forecast.json:',e);
    $('loc').textContent='Pronóstico no disponible';
    $('meta').textContent='No se pudo cargar data/forecast.json. Probá de nuevo en unos minutos.';
  }
}
init();