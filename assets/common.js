// Shared helpers for index.html and admin.html.
(function(){
  var C = window.HUB_CONFIG;
  var SITE_HOST = C.owner.toLowerCase() + ".github.io";
  var SITE = "https://" + SITE_HOST;
  var onSite = location.hostname.toLowerCase() === SITE_HOST;

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // Route urls are stored as site paths ("/agentic/v2/"). On the live site they
  // stay relative; anywhere else (a local preview) they point at the real site.
  function href(url){
    if(/^https?:\/\//i.test(url)) return url;
    return onSite ? url : SITE + url;
  }

  function store(kind){
    try{ return kind === "local" ? window.localStorage : window.sessionStorage; }catch(e){ return null; }
  }
  function get(key, kind){ var s = store(kind); try{ return s ? s.getItem(key) : null; }catch(e){ return null; } }
  function set(key, val, kind){ var s = store(kind); try{ if(s){ val == null ? s.removeItem(key) : s.setItem(key, val); } }catch(e){} }

  function initTheme(btn){
    var root = document.documentElement;
    var saved = get("hub-theme", "local");
    if(saved) root.setAttribute("data-theme", saved);
    if(btn) btn.addEventListener("click", function(){
      var next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
      root.setAttribute("data-theme", next);
      set("hub-theme", next, "local");
    });
  }

  function loadRoutes(){
    return fetch("routes.json?ts=" + Date.now(), {cache:"no-store"}).then(function(r){
      if(!r.ok) throw new Error("routes.json: HTTP " + r.status);
      return r.json();
    });
  }

  // HEAD-check each route. Every project site shares the *.github.io origin, so
  // this works from the live hub; elsewhere the dots simply stay grey.
  function checkStatus(routes, onResult){
    if(!onSite){ return; }
    var queue = routes.filter(function(r){ return !/^https?:/i.test(r.url); }).slice();
    function next(){
      var r = queue.shift(); if(!r) return;
      fetch(r.url, {method:"HEAD", cache:"no-store"})
        .then(function(res){ onResult(r, res.ok ? "ok" : "bad", res.status); })
        .catch(function(){ onResult(r, "bad", 0); })
        .then(next);
    }
    for(var i = 0; i < 6; i++) next();
  }

  function toast(msg, kind, ms){
    var t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, ms || 3800);
  }

  window.Hub = {config:C, SITE:SITE, onSite:onSite, esc:esc, href:href, get:get, set:set,
                initTheme:initTheme, loadRoutes:loadRoutes, checkStatus:checkStatus, toast:toast};
})();
