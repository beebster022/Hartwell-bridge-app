'use strict';

const state = {
  settings: { version:'3.1', fullPool:660, boatHeight:7.83, safetyBuffer:1, cautionMargin:2, staleAfterMinutes:180, lakeLevelEndpoint:'/.netlify/functions/lake-level', directUsgsEndpoint:'https://waterservices.usgs.gov/nwis/iv/?format=json&sites=02187010&parameterCd=00062&siteStatus=all', googleMapsApiKey:'', googleMapsMapId:'' },
  bridges: [],
  user: null,
  heading: null,
  watchId: null,
  soundEnabled: false,
  map: null,
  mapProvider: '',
  googleInfoWindow: null,
  userMarker: null,
  bridgeMarkers: new Map(),
  latestRows: [],
  expandedBridgeIds: new Set()
};

const $ = id => document.getElementById(id);
const fmt = n => Number.isFinite(n) ? n.toFixed(2) : '--';
const feetIn = ft => {
  if (!Number.isFinite(ft) || ft < 0) return '--';
  const totalInches = Math.round(ft * 12);
  const feet = Math.floor(totalInches / 12);
  const inches = Math.abs(totalInches % 12);
  return `${feet}'${inches}"`;
};

async function init(){
  await loadSettings();
  await loadBridges();
  bindEvents();
  await initMap();
  restoreLastKnown();
  calculate();
  if(location.protocol !== 'https:' && location.hostname !== 'localhost'){ $('gpsNote').textContent='GPS requires HTTPS. Upload this folder to Netlify, then open the Netlify URL on your iPhone.'; }
  fetchLakeLevel();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(()=>{});
}

async function loadSettings(){
  try { state.settings = {...state.settings, ...(await (await fetch('/data/settings.json', {cache:'no-cache'})).json())}; } catch {}
  $('boat').value = state.settings.boatHeight;
  $('buffer').value = state.settings.safetyBuffer;
  $('caution').value = state.settings.cautionMargin;
}

async function loadBridges(){
  const cached = localStorage.getItem('bridges_v3_cache');
  try {
    const res = await fetch('/data/bridges.json', {cache:'no-cache'});
    state.bridges = normalizeBridges(await res.json());
    localStorage.setItem('bridges_v3_cache', JSON.stringify(state.bridges));
  } catch {
    if (cached) state.bridges = normalizeBridges(JSON.parse(cached));
  }
}

function normalizeBridges(bridges){
  return bridges.map(b => ({
    ...b,
    bridgeName: b.bridgeName || b.name,
    roadName: b.roadName || b.road,
    lakeArm: b.lakeArm || b.waterway,
    name: b.name || b.bridgeName,
    road: b.road || b.roadName,
    waterway: b.waterway || b.lakeArm
  }));
}

function bindEvents(){
  ['lake','boat','buffer','caution'].forEach(id=>$(id).addEventListener('input',()=>{ if(id==='lake') markManual(); calculate(); }));
  $('refreshLake').addEventListener('click', fetchLakeLevel);
  $('lastKnown').addEventListener('click', useLastKnown);
  $('gpsBtn').addEventListener('click', useGps);
  $('watchBtn').addEventListener('click', toggleWatch);
  $('manualLocation').addEventListener('click', useManualLocation);
  $('sortMode').addEventListener('change', calculate);
  $('centerMap').addEventListener('click', centerOnMe);
  $('fitMap').addEventListener('click', fitMap);
  $('soundBtn').addEventListener('click', enableSound);
  $('list').addEventListener('click', handleBridgeToggle);
  window.addEventListener('resize', refreshMapLayout);
  window.addEventListener('orientationchange', refreshMapLayout);
  window.addEventListener('scroll', refreshMapLayout, {passive:true});
}

function markManual(){
  const level = Number($('lake').value);
  setBadge('manual','Manual lake level');
  setSource(`Manual level: ${fmt(level)} ft MSL.`);
}

async function fetchLakeLevel(){
  setBadge('manual','Fetching live lake level...');
  setSource('Checking Hartwell lake level...');
  try{
    let data = null;
    try {
      const res = await fetch(state.settings.lakeLevelEndpoint, {cache:'no-cache'});
      data = await res.json();
      if(!res.ok || !data.ok || !Number.isFinite(Number(data.level))) throw new Error(data.error || 'Function did not return a lake level');
      data.source = data.source || 'Netlify function / USGS Hartwell gauge';
    } catch (functionError) {
      const res = await fetch(state.settings.directUsgsEndpoint, {cache:'no-cache'});
      if(!res.ok) throw new Error(`Direct USGS returned ${res.status}`);
      const json = await res.json();
      data = extractLakeLevel(json);
      data.source = 'Direct USGS Hartwell gauge fallback';
    }
    const level = Number(data.level);
    $('lake').value = level.toFixed(2);
    const payload = {level, observed:data.observed, source:data.source, saved:new Date().toISOString()};
    localStorage.setItem('hartwell_lake_level_v3', JSON.stringify(payload));
    const age = ageMinutes(data.observed);
    const stale = Number.isFinite(age) && age > state.settings.staleAfterMinutes;
    setBadge(stale?'stale':'live', stale?'Live source stale':'Live lake level');
    setSource(`${data.source}. Observed ${formatTime(data.observed)}${stale ? ' - stale, use caution.' : '.'}`);
    calculate();
  }catch(err){
    const last = getLastKnown();
    if(last){
      $('lake').value = Number(last.level).toFixed(2);
      setBadge('fallback','Using last known level');
      setSource(`Live fetch failed. Using last known ${fmt(Number(last.level))} ft from ${formatTime(last.observed || last.saved)}.`);
      calculate();
    }else{
      setBadge('manual','Manual level required');
      setSource(`Live fetch failed: ${err.message}. Enter lake level manually.`);
    }
  }
}

function extractLakeLevel(json){
  const series = json?.value?.timeSeries || [];
  let best = null;
  for (const ts of series) {
    const variable = ts?.variable?.variableName || '';
    const values = ts?.values?.[0]?.value || [];
    for (const v of values) {
      const level = Number(v.value);
      if (!Number.isFinite(level)) continue;
      const observed = v.dateTime;
      const item = { ok:true, level, observed, variable };
      if (!best || new Date(observed) > new Date(best.observed)) best = item;
    }
  }
  if (!best) throw new Error('No reservoir elevation value found in USGS response');
  return best;
}

function getLastKnown(){ try{return JSON.parse(localStorage.getItem('hartwell_lake_level_v3')||'null')}catch{return null} }
function restoreLastKnown(){ const last=getLastKnown(); if(last && Number.isFinite(Number(last.level))) $('lake').value=Number(last.level).toFixed(2); }
function useLastKnown(){ const last=getLastKnown(); if(!last){setSource('No last known lake level saved yet.'); return;} $('lake').value=Number(last.level).toFixed(2); setBadge('fallback','Using last known level'); setSource(`Using last known ${fmt(Number(last.level))} ft from ${formatTime(last.observed || last.saved)}.`); calculate(); }
function setBadge(cls,text){ $('sourceBadge').innerHTML = `<span class="badge ${cls}">${escapeHtml(text)}</span>`; }
function setSource(text){ $('lakeSource').textContent=text; $('footerSource').textContent=text; }

function useGps(){
  if(!navigator.geolocation){ $('gpsNote').textContent='This browser does not support GPS.'; return; }
  $('gpsNote').textContent='Requesting GPS...';
  navigator.geolocation.getCurrentPosition(pos=>setPosition(pos), err=>{
    $('gpsNote').textContent = `GPS failed: ${err.message}. On iPhone, open the Netlify HTTPS link in Safari and allow Location.`;
  }, {enableHighAccuracy:true, timeout:15000, maximumAge:30000});
}

function toggleWatch(){
  if(state.watchId){ navigator.geolocation.clearWatch(state.watchId); state.watchId=null; $('watchBtn').textContent='Start Live Tracking'; return; }
  if(!navigator.geolocation){ $('gpsNote').textContent='This browser does not support GPS.'; return; }
  state.watchId = navigator.geolocation.watchPosition(pos=>setPosition(pos), err=>{
    $('gpsNote').textContent=`Live tracking failed: ${err.message}`;
  }, {enableHighAccuracy:true, timeout:20000, maximumAge:5000});
  $('watchBtn').textContent='Stop Live Tracking';
}

function setPosition(pos){
  const c = pos.coords;
  state.user = {lat:c.latitude, lon:c.longitude, accuracy:c.accuracy, speed:c.speed, heading:Number.isFinite(c.heading)?c.heading:null};
  if(state.user.heading !== null) state.heading = state.user.heading;
  $('gpsNote').textContent = `GPS on. Accuracy about ${Math.round(c.accuracy)} m. ${state.heading!==null?'Heading '+Math.round(state.heading)+'°.':'Move a little for heading.'}`;
  updateUserMarker();
  calculate();
}

function useManualLocation(){
  const lat=Number($('manualLat').value), lon=Number($('manualLon').value);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)){ $('gpsNote').textContent='Enter both latitude and longitude.'; return; }
  state.user={lat, lon, accuracy:null, heading:null};
  $('gpsNote').textContent='Manual location active.';
  updateUserMarker(); calculate();
}

function enableSound(){
  state.soundEnabled = true;
  $('soundBtn').textContent='Warning Sound Enabled';
  beep(120, 660);
}

function beep(ms=160, freq=520){
  if(!state.soundEnabled) return;
  try{
    const ctx = new (window.AudioContext||window.webkitAudioContext)();
    const osc = ctx.createOscillator(); const gain = ctx.createGain();
    osc.frequency.value=freq; osc.connect(gain); gain.connect(ctx.destination); gain.gain.value=.06; osc.start();
    setTimeout(()=>{osc.stop(); ctx.close();}, ms);
  }catch{}
}

function calculate(){
  const lake=Number($('lake').value), boat=Number($('boat').value), buffer=Number($('buffer').value), caution=Number($('caution').value);
  const inputError = validateInputs({lake, boat, buffer, caution});
  if(inputError){
    setBadge('manual','Check inputs');
    setSource(inputError);
    $('passCount').textContent='0'; $('cautionCount').textContent='0'; $('nogoCount').textContent='0';
    $('list').innerHTML = `<div class="warning">${escapeHtml(inputError)}</div>`;
    updateFooter([],lake,boat,buffer,NaN);
    updateSortNote();
    return;
  }
  const required=boat+buffer;
  let pass=0,caut=0,nogo=0;
  const rows = state.bridges.map(b=>{
    const available = b.elev - lake;
    const margin = available - required;
    const status = margin < 0 ? 'nogo' : margin <= caution ? 'caution' : 'pass';
    if(status==='pass') pass++; else if(status==='caution') caut++; else nogo++;
    const distance = state.user ? distanceMiles(state.user.lat,state.user.lon,b.lat,b.lon) : null;
    const bearing = state.user ? bearingDegrees(state.user.lat,state.user.lon,b.lat,b.lon) : null;
    const aheadScore = bearing!==null && state.heading!==null ? angleDiff(state.heading,bearing) : null;
    const ahead = aheadScore!==null && aheadScore <= 70;
    return {...b, available, margin, status, distance, bearing, aheadScore, ahead};
  });
  sortRows(rows);
  state.latestRows=rows;
  $('passCount').textContent=pass; $('cautionCount').textContent=caut; $('nogoCount').textContent=nogo;
  renderList(rows); updateMapMarkers(rows); updateFooter(rows,lake,boat,buffer,required); warnIfNeeded(rows); updateSortNote();
}

function validateInputs({lake, boat, buffer, caution}){
  if(!Number.isFinite(lake)) return 'Enter a valid lake level before checking bridge clearance.';
  if(!Number.isFinite(boat) || boat < 0) return 'Enter a valid boat height before checking bridge clearance.';
  if(!Number.isFinite(buffer) || buffer < 0) return 'Enter a valid safety buffer before checking bridge clearance.';
  if(!Number.isFinite(caution) || caution < 0) return 'Enter a valid caution margin before checking bridge clearance.';
  return '';
}

function sortRows(rows){
  const mode=$('sortMode').value;
  if(mode==='distance') rows.sort((a,b)=>(a.distance??9999)-(b.distance??9999));
  else if(mode==='ahead') rows.sort((a,b)=>(a.ahead?0:1)-(b.ahead?0:1) || (a.aheadScore??999)-(b.aheadScore??999) || (a.distance??9999)-(b.distance??9999));
  else if(mode==='margin') rows.sort((a,b)=>a.margin-b.margin);
  else if(mode==='clearance') rows.sort((a,b)=>a.available-b.available);
  else if(mode==='name') rows.sort((a,b)=>a.bridgeName.localeCompare(b.bridgeName));
  else rows.sort((a,b)=> state.user ? ((a.ahead?0:1)-(b.ahead?0:1) || (a.distance??9999)-(b.distance??9999)) : a.margin-b.margin);
}

function renderList(rows){
  $('list').innerHTML = rows.map(r=>`
    <article class="bridge ${state.expandedBridgeIds.has(r.id)?'expanded':''}" data-bridge-id="${escapeHtml(r.id)}">
      <button class="bridge-toggle" type="button" data-bridge-id="${escapeHtml(r.id)}" aria-expanded="${state.expandedBridgeIds.has(r.id)}" aria-controls="bridge-details-${escapeHtml(r.id)}">
        <span class="bridge-name">${escapeHtml(r.bridgeName)}</span>
        <span class="bridge-summary">
          <span class="tag ${r.status}">${r.status==='pass'?'PASS':r.status==='caution'?'CAUTION':'NO-GO'}</span>
          ${r.ahead?'<span class="tag caution">NEXT AHEAD</span>':''}
          <span class="summary-metric">${fmt(r.margin)} ft margin</span>
          ${r.distance!==null?`<span class="summary-metric">${fmt(r.distance)} mi</span>`:''}
          <span class="chevron" aria-hidden="true">⌄</span>
        </span>
      </button>
      <div class="bridge-details" id="bridge-details-${escapeHtml(r.id)}" ${state.expandedBridgeIds.has(r.id)?'':'hidden'}>
        <div class="meta">
          <div><span class="small">Available</span><div class="value">${fmt(r.available)} ft</div></div>
          <div><span class="small">Margin</span><div class="value">${fmt(r.margin)} ft</div></div>
          <div><span class="small">Bridge elev.</span><div class="value">${fmt(r.elev)}</div></div>
          <div><span class="small">Full-pool clearance</span><div class="value">${fmt(r.full)}</div></div>
        </div>
        <p class="small">${escapeHtml(r.lakeArm)} • ${escapeHtml(r.roadName)}${r.bearing!==null?' • Bearing '+Math.round(r.bearing)+'°':''}</p>
      </div>
    </article>`).join('');
}

function handleBridgeToggle(event){
  const button = event.target.closest('.bridge-toggle');
  if(!button) return;
  const id = button.dataset.bridgeId;
  if(!id) return;
  setBridgeExpanded(id, !state.expandedBridgeIds.has(id), {scroll:false});
}

function setBridgeExpanded(id, expanded=true, {scroll=false}={}){
  if(expanded) state.expandedBridgeIds.add(id);
  else state.expandedBridgeIds.delete(id);
  const article = document.querySelector(`.bridge[data-bridge-id="${cssEscape(id)}"]`);
  const button = article?.querySelector('.bridge-toggle');
  const details = article?.querySelector('.bridge-details');
  button?.setAttribute('aria-expanded', String(expanded));
  article?.classList.toggle('expanded', expanded);
  if(details) details.hidden = !expanded;
  if(scroll && article){
    article.scrollIntoView({behavior:'smooth', block:'center'});
    article.classList.add('highlight');
    setTimeout(()=>article.classList.remove('highlight'), 1300);
  }
}

function updateFooter(rows,lake,boat,buffer,required){
  const worst = rows.slice().sort((a,b)=>a.margin-b.margin)[0];
  const nearest = state.user ? rows.slice().filter(r=>r.distance!==null).sort((a,b)=>a.distance-b.distance)[0] : null;
  const nearbyRisk = state.user ? rows.slice().filter(r=>r.distance!==null && r.distance < .5 && (r.status==='nogo' || r.status==='caution')).sort((a,b)=>a.distance-b.distance)[0] : null;
  const key = nearbyRisk || nearest || worst;
  $('footerLake').textContent=`🌊 Lake ${fmt(lake)}'`;
  $('footerDetails').textContent=`Boat ${feetIn(boat)} • Buffer ${feetIn(buffer)} • Required ${feetIn(required)}`;
  const f=$('footerStatus'); f.className='sticky-status '+(key?.status||'');
  f.textContent = key ? `${key.status==='pass'?'PASS':key.status==='caution'?'CAUTION':'NO-GO'} • ${key.name} • ${fmt(key.margin)}' margin` : 'Checking...';
}

let lastAlertBridge = '';
function warnIfNeeded(rows){
  const target = rows.find(r=>r.distance!==null && r.distance < .5 && (r.status==='nogo' || r.status==='caution'));
  if(target && target.id!==lastAlertBridge){ lastAlertBridge=target.id; beep(220, target.status==='nogo'?360:520); }
}
function updateSortNote(){
  const mode=$('sortMode').value;
  const labels = {
    smart: state.user ? 'Smart sort: next or nearest bridge first.' : 'Smart sort: tightest margin first until GPS is enabled.',
    ahead: state.user ? 'Sorted by next bridge ahead.' : 'Next-ahead sorting needs GPS heading.',
    distance: state.user ? 'Sorted by nearest GPS distance.' : 'Distance sorting needs GPS or manual location.',
    margin: 'Sorted by tightest margin.',
    clearance: 'Sorted by lowest available clearance.',
    name: 'Sorted by bridge name.'
  };
  $('sortNote').textContent = labels[mode] || 'Sorted bridges.';
}

async function initMap(){
  const googleKey = String(state.settings.googleMapsApiKey || '').trim();
  if(googleKey){
    try{
      window.gm_authFailure = () => useBackupMap('Google Maps key was rejected. Using the backup map.');
      await loadGoogleMaps(googleKey);
      initGoogleMap();
      return;
    }catch(err){
      useBackupMap('Google Maps could not load. Using the backup map.');
      return;
    }
  }
  initLeafletMap();
}

function loadGoogleMaps(key){
  if(window.google?.maps) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const callbackName = `initHartwellGoogleMap_${Date.now()}`;
    let settled = false;
    const fail = error => {
      if(settled) return;
      settled = true;
      delete window[callbackName];
      reject(error);
    };
    window[callbackName] = () => {
      if(settled) return;
      settled = true;
      delete window[callbackName];
      resolve();
    };
    const script = document.createElement('script');
    const params = new URLSearchParams({key, callback:callbackName, v:'weekly'});
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.defer = true;
    script.onerror = () => fail(new Error('Google Maps script failed to load'));
    document.head.appendChild(script);
  });
}

function useBackupMap(note){
  $('mapNote').textContent = note;
  $('map').innerHTML = '';
  state.map = null;
  state.mapProvider = '';
  state.googleInfoWindow = null;
  state.userMarker = null;
  state.bridgeMarkers = new Map();
  initLeafletMap();
  if(state.user) updateUserMarker();
  if(state.latestRows.length) updateMapMarkers(state.latestRows);
}

function initGoogleMap(){
  if(!window.google?.maps){
    initLeafletMap();
    return;
  }
  const options = {
    center:{lat:34.55,lng:-82.95},
    zoom:10,
    mapTypeId:'roadmap',
    gestureHandling:'greedy',
    streetViewControl:false,
    fullscreenControl:true,
    mapTypeControl:true
  };
  if(state.settings.googleMapsMapId) options.mapId = state.settings.googleMapsMapId;
  state.mapProvider = 'google';
  state.map = new google.maps.Map($('map'), options);
  state.googleInfoWindow = new google.maps.InfoWindow();
  state.googleInfoWindow.addListener('domready', bindPopupDetailsButton);
  $('mapNote').textContent = 'Google Maps active. Tap a bridge marker for details.';
  fitMap();
}

function initLeafletMap(){
  if(!window.L){
    $('mapNote').textContent = 'Map library could not load. Bridge list and clearance calculations still work.';
    $('map').innerHTML = '<div class="map-fallback">Map unavailable. Use the bridge list below for bridge details.</div>';
    return;
  }
  state.mapProvider = 'leaflet';
  state.map = L.map('map', {scrollWheelZoom:false}).setView([34.55,-82.95], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom:18, attribution:'&copy; OpenStreetMap contributors'}).addTo(state.map);
  state.map.on('popupopen', event => {
    bindPopupDetailsButton(event.popup.getElement());
  });
  fitMap();
  refreshMapLayout();
}
function bindPopupDetailsButton(root=document){
  const button = root?.querySelector?.('.popup-details-btn') || document.querySelector('.popup-details-btn');
  if(!button || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';
  button.addEventListener('click', () => setBridgeExpanded(button.dataset.bridgeId, true, {scroll:true}));
}
function markerColor(status){ return status==='pass'?'#2e8b57':status==='caution'?'#c39122':'#b03a2e'; }
function bridgeIcon(status){ return L.divIcon({className:'', html:`<div style="width:18px;height:18px;border-radius:50%;background:${markerColor(status)};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`, iconSize:[18,18], iconAnchor:[9,9]}); }
function googleBridgeIcon(status){ return {path:google.maps.SymbolPath.CIRCLE, fillColor:markerColor(status), fillOpacity:1, strokeColor:'#fff', strokeWeight:3, scale:8}; }
function userIcon(){ return L.divIcon({className:'', html:'<div class="dot"></div>', iconSize:[16,16], iconAnchor:[8,8]}); }
function googleUserIcon(){ return {path:google.maps.SymbolPath.CIRCLE, fillColor:'#1775ff', fillOpacity:1, strokeColor:'#fff', strokeWeight:3, scale:8}; }
function updateMapMarkers(rows){
  if(!state.map) return;
  for(const r of rows){
    const popup = bridgePopupHtml(r);
    const existing=state.bridgeMarkers.get(r.id);
    if(state.mapProvider === 'google'){
      const position = {lat:r.lat, lng:r.lon};
      if(existing){
        existing.setPosition(position);
        existing.setIcon(googleBridgeIcon(r.status));
      } else {
        const marker = new google.maps.Marker({position, map:state.map, icon:googleBridgeIcon(r.status), title:r.bridgeName});
        marker.addListener('click', () => {
          const latest = state.latestRows.find(row => row.id === r.id) || r;
          zoomToBridge(latest);
          state.googleInfoWindow.setContent(bridgePopupHtml(latest));
          state.googleInfoWindow.open({anchor:marker, map:state.map});
        });
        state.bridgeMarkers.set(r.id, marker);
      }
    }
    else if(window.L && existing){ existing.setIcon(bridgeIcon(r.status)); existing.setPopupContent(popup); }
    else {
      const marker = L.marker([r.lat,r.lon], {icon:bridgeIcon(r.status)}).addTo(state.map).bindPopup(popup, {className:'bridge-popup'});
      marker.on('click', () => zoomToBridge(r));
      state.bridgeMarkers.set(r.id, marker);
    }
  }
  refreshMapLayout();
}
function bridgePopupHtml(r){
  return `
    <div class="map-popup-card">
      <div class="popup-title">${escapeHtml(r.bridgeName)}</div>
      <div class="popup-subtitle">${escapeHtml(r.lakeArm)} • ${escapeHtml(r.roadName)}</div>
      <div class="popup-status ${r.status}">${r.status==='pass'?'PASS':r.status==='caution'?'CAUTION':'NO-GO'}</div>
      <div class="popup-grid">
        <div><span>Available</span><b>${fmt(r.available)} ft</b></div>
        <div><span>Margin</span><b>${fmt(r.margin)} ft</b></div>
        <div><span>Bridge elev.</span><b>${fmt(r.elev)}</b></div>
        <div><span>Full pool</span><b>${fmt(r.full)}</b></div>
      </div>
      ${r.distance!==null?`<div class="popup-distance">${fmt(r.distance)} mi away</div>`:''}
      <button class="popup-details-btn" type="button" data-bridge-id="${escapeHtml(r.id)}">More details</button>
    </div>`;
}
function zoomToBridge(r){
  if(!state.map) return;
  if(state.mapProvider === 'google'){
    state.map.setCenter({lat:r.lat, lng:r.lon});
    state.map.setZoom(Math.max(state.map.getZoom() || 10, 15));
  } else {
    state.map.setView([r.lat,r.lon], Math.max(state.map.getZoom(), 15), {animate:true});
  }
}
function updateUserMarker(){
  if(!state.map || !state.user) return;
  if(state.mapProvider === 'google'){
    const position = {lat:state.user.lat, lng:state.user.lon};
    if(state.userMarker) state.userMarker.setPosition(position);
    else state.userMarker = new google.maps.Marker({position, map:state.map, icon:googleUserIcon(), title:'Your location', zIndex:1000});
  } else if(window.L){
    const ll=[state.user.lat,state.user.lon];
    if(state.userMarker) state.userMarker.setLatLng(ll);
    else state.userMarker=L.marker(ll,{icon:userIcon(), zIndexOffset:1000}).addTo(state.map).bindPopup('Your location');
  }
}
function centerOnMe(){
  if(state.map && state.user){
    if(state.mapProvider === 'google'){
      state.map.setCenter({lat:state.user.lat, lng:state.user.lon});
      state.map.setZoom(14);
    } else {
      state.map.setView([state.user.lat,state.user.lon], 14);
    }
  } else useGps();
}
function fitMap(){
  if(!state.map || !state.bridges.length) return;
  if(state.mapProvider === 'google'){
    const bounds = new google.maps.LatLngBounds();
    state.bridges.forEach(b => bounds.extend({lat:b.lat, lng:b.lon}));
    if(state.user) bounds.extend({lat:state.user.lat, lng:state.user.lon});
    state.map.fitBounds(bounds, 24);
  } else if(window.L) {
    const pts=state.bridges.map(b=>[b.lat,b.lon]);
    if(state.user) pts.push([state.user.lat,state.user.lon]);
    state.map.fitBounds(L.latLngBounds(pts), {padding:[24,24]});
  }
  refreshMapLayout();
}

let mapRefreshTimer = null;
function refreshMapLayout(){
  if(!state.map || state.mapProvider === 'google' || !window.L) return;
  if(mapRefreshTimer) clearTimeout(mapRefreshTimer);
  const redraw = () => {
    const el = $('map');
    if(!el || !el.offsetWidth || !el.offsetHeight) return;
    state.map.invalidateSize({pan:false});
  };
  requestAnimationFrame(redraw);
  mapRefreshTimer = setTimeout(redraw, 250);
}

function distanceMiles(lat1,lon1,lat2,lon2){
  const R=3958.7613, dLat=rad(lat2-lat1), dLon=rad(lon2-lon1);
  const a=Math.sin(dLat/2)**2+Math.cos(rad(lat1))*Math.cos(rad(lat2))*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function bearingDegrees(lat1,lon1,lat2,lon2){
  const y=Math.sin(rad(lon2-lon1))*Math.cos(rad(lat2));
  const x=Math.cos(rad(lat1))*Math.sin(rad(lat2))-Math.sin(rad(lat1))*Math.cos(rad(lat2))*Math.cos(rad(lon2-lon1));
  return (deg(Math.atan2(y,x))+360)%360;
}
const rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
function angleDiff(a,b){ return Math.abs(((b-a+540)%360)-180); }
function ageMinutes(iso){ const t=new Date(iso).getTime(); return Number.isFinite(t)?(Date.now()-t)/60000:null; }
function formatTime(iso){ try{return new Date(iso).toLocaleString([], {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'});}catch{return iso||'unknown time'} }
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function cssEscape(s){ return String(s).replace(/["\\]/g, '\\$&'); }

document.addEventListener('DOMContentLoaded', init);
