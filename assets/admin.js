// Admin console: GitHub sign-in, route registry editing, page publishing, discovery.
(function(){
  var H = window.Hub, C = H.config, esc = H.esc;
  var API = "https://api.github.com";
  var TOKEN_KEY = "hub-gh-token";
  var token = null, me = null;
  var routes = [], routesSha = null;   // routes.json as last read from the branch
  var $ = function(id){ return document.getElementById(id); };

  H.initTheme($("theme"));
  $("repoName").textContent = C.owner + "/" + C.repo;
  $("patLink").href = "https://github.com/settings/personal-access-tokens/new";
  $("pagesPath").textContent = "pages/<slug>/";

  // ---------- GitHub API ----------
  function gh(path, opts){
    opts = opts || {};
    var headers = {"Accept":"application/vnd.github+json", "X-GitHub-Api-Version":"2022-11-28"};
    if(token) headers.Authorization = "Bearer " + token;
    if(opts.body) headers["Content-Type"] = "application/json";
    return fetch(path.indexOf("http") === 0 ? path : API + path, {
      method: opts.method || "GET", headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store"
    }).then(function(r){
      if(r.status === 204) return null;
      return r.json().catch(function(){ return null; }).then(function(j){
        if(!r.ok){
          var e = new Error((j && j.message) || ("HTTP " + r.status));
          e.status = r.status; throw e;
        }
        return j;
      });
    });
  }
  function repoPath(p){ return "/repos/" + C.owner + "/" + C.repo + p; }

  // ---------- encoding ----------
  function bytesToB64(bytes){
    var s = "", CH = 0x8000;
    for(var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  function textToB64(t){ return bytesToB64(new TextEncoder().encode(t)); }
  function b64ToText(b){
    var bin = atob(b.replace(/\s/g, "")), u = new Uint8Array(bin.length);
    for(var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(u);
  }

  // ---------- one atomic commit for many files ----------
  // changes: [{path, b64}] to write, [{path, remove:true}] to delete.
  function commitFiles(changes, message){
    var head, baseTree;
    return gh(repoPath("/git/ref/heads/" + C.branch)).then(function(ref){
      head = ref.object.sha;
      return gh(repoPath("/git/commits/" + head));
    }).then(function(commit){
      baseTree = commit.tree.sha;
      // Refuse to overwrite a routes.json someone else changed since we loaded it.
      return gh(repoPath("/contents/routes.json?ref=" + head)).then(function(f){
        if(routesSha && f.sha !== routesSha){
          var e = new Error("routes.json changed on GitHub since this page loaded. Reload and try again.");
          e.stale = true; throw e;
        }
      });
    }).then(function(){
      return sequential(changes, function(c){
        if(c.remove) return Promise.resolve({path:c.path, mode:"100644", type:"blob", sha:null});
        return gh(repoPath("/git/blobs"), {method:"POST", body:{content:c.b64, encoding:"base64"}})
          .then(function(b){ return {path:c.path, mode:"100644", type:"blob", sha:b.sha}; });
      });
    }).then(function(tree){
      return gh(repoPath("/git/trees"), {method:"POST", body:{base_tree:baseTree, tree:tree}});
    }).then(function(t){
      return gh(repoPath("/git/commits"), {method:"POST", body:{message:message, tree:t.sha, parents:[head]}});
    }).then(function(c){
      return gh(repoPath("/git/refs/heads/" + C.branch), {method:"PATCH", body:{sha:c.sha}}).then(function(){ return c; });
    });
  }
  function sequential(items, fn){
    var out = [];
    return items.reduce(function(p, it){
      return p.then(function(){ return fn(it).then(function(v){ out.push(v); }); });
    }, Promise.resolve()).then(function(){ return out; });
  }
  function routesChange(list){
    return {path:"routes.json", b64:textToB64(JSON.stringify({version:1, routes:list}, null, 2) + "\n")};
  }
  // Commit, then re-read routes.json so the next edit starts from the new state.
  function save(changes, message, okMsg){
    return commitFiles(changes, message).then(function(c){
      H.toast(okMsg || "Saved.", "ok");
      return loadRoutes().then(function(){ return c; });
    }).catch(function(e){
      H.toast(e.message, "err", 6000);
      throw e;
    });
  }

  // ---------- sign-in ----------
  function show(view){
    $("loginView").hidden = view !== "login";
    $("appView").hidden = view !== "app";
  }
  function signOut(){
    H.set(TOKEN_KEY, null, "session"); H.set(TOKEN_KEY, null, "local");
    token = null; me = null; $("who").innerHTML = ""; show("login");
  }
  function useToken(t, remember){
    token = t;
    $("loginErr").textContent = "Checking…";
    return gh("/user").then(function(u){
      var ok = C.allowedUsers.some(function(a){ return a.toLowerCase() === u.login.toLowerCase(); });
      if(!ok) throw new Error("@" + u.login + " is not on this hub's admin list.");
      me = u;
      return gh(repoPath(""));
    }).then(function(repo){
      if(!repo.permissions || !repo.permissions.push) throw new Error("This sign-in can't push to " + C.owner + "/" + C.repo + ".");
      H.set(TOKEN_KEY, t, remember ? "local" : "session");
      $("loginErr").textContent = "";
      $("who").innerHTML = '<img alt="" src="' + esc(me.avatar_url) + '"/><span class="hide-sm">@' + esc(me.login) +
        '</span><button class="btn sm" id="out">Sign out</button>';
      $("out").onclick = signOut;
      show("app");
      return loadRoutes();
    }).catch(function(e){
      token = null;
      H.set(TOKEN_KEY, null, "session"); H.set(TOKEN_KEY, null, "local");
      show("login");
      $("loginErr").textContent = e.status === 401 ? "GitHub rejected that token (expired or revoked)." : e.message;
    });
  }

  if(C.oauthWorkerUrl){
    $("ghLogin").onclick = function(){
      var state = Array.from(crypto.getRandomValues(new Uint8Array(16)), function(b){ return b.toString(16).padStart(2, "0"); }).join("");
      H.set("hub-oauth-state", state, "session");
      H.set("hub-oauth-remember", $("remember").checked ? "1" : "", "session");
      location.href = C.oauthWorkerUrl.replace(/\/$/, "") + "/login?state=" + state;
    };
  } else {
    $("oauthBox").hidden = true;
  }
  $("tokGo").onclick = function(){
    var t = $("tok").value.trim();
    if(!t){ $("loginErr").textContent = "Paste a token first."; return; }
    $("tok").value = "";
    useToken(t, $("remember").checked);
  };
  $("tok").addEventListener("keydown", function(e){ if(e.key === "Enter") $("tokGo").click(); });

  // Returning from the OAuth worker: #access_token=…&state=…  or  #error=…
  (function boot(){
    var h = new URLSearchParams(location.hash.slice(1));
    if(h.has("access_token") || h.has("error")){
      history.replaceState(null, "", location.pathname + location.search);
      var expected = H.get("hub-oauth-state", "session");
      var remember = H.get("hub-oauth-remember", "session") === "1";
      H.set("hub-oauth-state", null, "session"); H.set("hub-oauth-remember", null, "session");
      if(h.has("error")){ show("login"); $("loginErr").textContent = "GitHub sign-in failed: " + h.get("error"); return; }
      if(!expected || h.get("state") !== expected){ show("login"); $("loginErr").textContent = "Sign-in state didn't match. Try again."; return; }
      useToken(h.get("access_token"), remember);
      return;
    }
    var saved = H.get(TOKEN_KEY, "session") || H.get(TOKEN_KEY, "local");
    if(saved) useToken(saved, !!H.get(TOKEN_KEY, "local")); else show("login");
  })();

  // ---------- tabs ----------
  document.querySelector(".tabs").addEventListener("click", function(e){
    var b = e.target.closest(".tab"); if(!b) return;
    document.querySelectorAll(".tab").forEach(function(t){ t.classList.toggle("on", t === b); });
    document.querySelectorAll("[data-pane]").forEach(function(p){ p.hidden = p.getAttribute("data-pane") !== b.getAttribute("data-tab"); });
  });

  // ---------- all pages ----------
  function loadRoutes(){
    return gh(repoPath("/contents/routes.json?ref=" + C.branch)).then(function(f){
      routesSha = f.sha;
      routes = (JSON.parse(b64ToText(f.content)).routes) || [];
      renderRows(); fillGroups(); updateSlugHint();
    }).catch(function(e){
      $("rows").innerHTML = '<tr><td colspan="5" class="empty">Could not load routes.json: ' + esc(e.message) + '</td></tr>';
    });
  }
  var status = {};
  function renderRows(){
    var s = $("aq").value.trim().toLowerCase();
    var list = routes.filter(function(r){
      return !s || [r.title, r.url, r.repo, r.group, (r.tags || []).join(" ")].join(" ").toLowerCase().indexOf(s) !== -1;
    });
    $("rows").innerHTML = list.map(function(r){
      var vis = r.visibility === "hidden" ? '<span class="tag hid">hidden</span>' : '<span class="tag">public</span>';
      if(r.status === "pending") vis += ' <span class="tag pend">pending</span>';
      if(r.managed) vis += ' <span class="tag">hosted here</span>';
      return '<tr><td><span class="dot ' + (status[r.id] || "") + '" data-dot="' + esc(r.id) + '"></span></td>' +
        '<td><b>' + esc(r.title) + '</b><div class="u">' + esc(r.url) + '</div></td>' +
        '<td>' + esc(r.repo) + '<div class="u">' + esc(r.group) + '</div></td>' +
        '<td>' + vis + '</td>' +
        '<td><div class="actions">' +
          '<a class="btn sm" target="_blank" rel="noopener" href="' + esc(H.href(r.url)) + '">Open</a>' +
          '<button class="btn sm" data-edit="' + esc(r.id) + '">Edit</button>' +
          '<button class="btn sm danger" data-del="' + esc(r.id) + '">Delete</button>' +
        '</div></td></tr>';
    }).join("") || '<tr><td colspan="5" class="empty">No pages.</td></tr>';
    H.checkStatus(list.filter(function(r){ return r.status !== "pending" && !status[r.id]; }), function(r, st){
      status[r.id] = st;
      var d = document.querySelector('[data-dot="' + CSS.escape(r.id) + '"]');
      if(d) d.className = "dot " + st;
    });
  }
  $("aq").addEventListener("input", renderRows);
  $("reload").onclick = function(){ status = {}; loadRoutes(); };
  $("rows").addEventListener("click", function(e){
    var ed = e.target.closest("[data-edit]"), del = e.target.closest("[data-del]");
    if(ed) editRoute(find(ed.getAttribute("data-edit")));
    if(del) deleteRoute(find(del.getAttribute("data-del")));
  });
  function find(id){ return routes.filter(function(r){ return r.id === id; })[0]; }

  function modal(html){
    $("modalHost").innerHTML = '<div class="modal"><div class="panel">' + html + '</div></div>';
    var m = $("modalHost").firstChild;
    m.addEventListener("click", function(e){ if(e.target === m || e.target.closest("[data-close]")) close(); });
    function close(){ $("modalHost").innerHTML = ""; }
    return {el:m, close:close};
  }

  function editRoute(r){
    if(!r) return;
    var m = modal(
      '<h3>Edit page</h3><p class="sub">' + esc(r.id) + '</p>' +
      '<div class="field"><label>Title</label><input id="eTitle" value="' + esc(r.title) + '"/></div>' +
      '<div class="field"><label>Description</label><input id="eDesc" value="' + esc(r.description || "") + '"/></div>' +
      '<div class="row"><div class="field"><label>Group</label><input id="eGroup" list="groups" value="' + esc(r.group || "") + '"/></div>' +
      '<div class="field"><label>Tags</label><input id="eTags" value="' + esc((r.tags || []).join(", ")) + '"/></div></div>' +
      '<div class="row"><div class="field"><label>Visibility</label><select id="eVis"><option value="public">Listed on hub</option><option value="hidden">Hidden</option></select></div>' +
      '<div class="field"><label>Status</label><select id="eStatus"><option value="live">Live</option><option value="pending">Pending (coming soon)</option></select></div></div>' +
      (r.managed ? '' : '<div class="field"><label>URL</label><input id="eUrl" value="' + esc(r.url) + '"/></div>') +
      '<div class="actions"><button class="btn primary" id="eSave">Save</button><button class="btn" data-close>Cancel</button></div>');
    $("eVis").value = r.visibility || "public";
    $("eStatus").value = r.status || "live";
    $("eSave").onclick = function(){
      var next = routes.map(function(x){
        if(x.id !== r.id) return x;
        var y = Object.assign({}, x, {
          title: $("eTitle").value.trim() || x.title, description: $("eDesc").value.trim(),
          group: $("eGroup").value.trim() || "Other", tags: splitTags($("eTags").value),
          visibility: $("eVis").value, status: $("eStatus").value
        });
        if(!x.managed) y.url = $("eUrl").value.trim() || x.url;
        return y;
      });
      $("eSave").disabled = true;
      save([routesChange(next)], "Edit page: " + r.title, "Saved " + r.title + ".").then(m.close, function(){ $("eSave").disabled = false; });
    };
  }

  function deleteRoute(r){
    if(!r) return;
    var m = modal('<h3>Delete “' + esc(r.title) + '”?</h3>' +
      '<p class="sub">' + (r.managed ? 'This removes the entry <b>and deletes its files</b> under <code>pages/' + esc(r.id) + '/</code>. Git history keeps a copy.' :
        'This removes the entry from the hub. The page itself lives in <b>' + esc(r.repo) + '</b> and stays online.') + '</p>' +
      '<div class="actions"><button class="btn danger" id="dGo">Delete</button><button class="btn" data-close>Cancel</button></div>');
    $("dGo").onclick = function(){
      $("dGo").disabled = true;
      var next = routes.filter(function(x){ return x.id !== r.id; });
      var files = r.managed ? managedFiles(r.id) : Promise.resolve([]);
      files.then(function(paths){
        var changes = paths.map(function(p){ return {path:p, remove:true}; });
        changes.push(routesChange(next));
        return save(changes, "Delete page: " + r.title, "Deleted " + r.title + ".");
      }).then(m.close, function(){ $("dGo").disabled = false; });
    };
  }
  function managedFiles(slug){
    return gh(repoPath("/git/trees/" + C.branch + "?recursive=1")).then(function(t){
      return t.tree.filter(function(n){ return n.type === "blob" && n.path.indexOf("pages/" + slug + "/") === 0; })
                   .map(function(n){ return n.path; });
    });
  }

  // ---------- add page ----------
  var src = "upload", picked = [];   // picked: [{path, file}]
  function slugify(s){ return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64); }
  function splitTags(s){ return s.split(",").map(function(t){ return t.trim(); }).filter(Boolean); }
  function fillGroups(){
    var g = {}; routes.forEach(function(r){ g[r.group] = 1; });
    $("groups").innerHTML = Object.keys(g).map(function(n){ return '<option value="' + esc(n) + '">'; }).join("");
  }
  var slugTouched = false;
  $("fTitle").addEventListener("input", function(){ if(!slugTouched){ $("fSlug").value = slugify($("fTitle").value); updateSlugHint(); } });
  $("fSlug").addEventListener("input", function(){ slugTouched = true; updateSlugHint(); });
  function updateSlugHint(){
    var slug = $("fSlug").value.trim(), ex = find(slug);
    var url = "/" + C.repo + "/pages/" + (slug || "<slug>") + "/";
    $("slugHint").innerHTML = "Lives at <code>" + esc(url) + "</code>" +
      (ex ? (ex.managed ? " · <b>replaces</b> the existing “" + esc(ex.title) + "” entry" : " · <span style=\"color:var(--bad)\">id taken by a linked page</span>") : "");
    if(ex && ex.managed && !$("fTitle").value){
      $("fTitle").value = ex.title; $("fDesc").value = ex.description || ""; $("fGroup").value = ex.group || "";
      $("fTags").value = (ex.tags || []).join(", "); $("fVis").value = ex.visibility || "public";
    }
  }

  $("srcSeg").addEventListener("click", function(e){
    var b = e.target.closest("button"); if(!b) return;
    src = b.getAttribute("data-src");
    $("srcSeg").querySelectorAll("button").forEach(function(x){ x.classList.toggle("on", x === b); });
    document.querySelectorAll("[data-src-pane]").forEach(function(p){ p.hidden = p.getAttribute("data-src-pane") !== src; });
  });

  var drop = $("drop");
  drop.onclick = function(e){ if(e.target.closest("a")) return; $("fileIn").click(); };
  $("pickDir").onclick = function(e){ e.preventDefault(); $("dirIn").click(); };
  $("fileIn").onchange = function(){ setPicked(Array.from(this.files).map(function(f){ return {path:f.name, file:f}; })); this.value = ""; };
  $("dirIn").onchange = function(){
    setPicked(Array.from(this.files).map(function(f){
      return {path:(f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name, file:f};
    }));
    this.value = "";
  };
  drop.addEventListener("dragover", function(e){ e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", function(){ drop.classList.remove("over"); });
  drop.addEventListener("drop", function(e){
    e.preventDefault(); drop.classList.remove("over");
    var items = Array.from(e.dataTransfer.items || []);
    var entries = items.map(function(i){ return i.webkitGetAsEntry && i.webkitGetAsEntry(); }).filter(Boolean);
    if(entries.length === 1 && entries[0].isDirectory){
      readDir(entries[0], "").then(setPicked);
    } else {
      setPicked(Array.from(e.dataTransfer.files).map(function(f){ return {path:f.name, file:f}; }));
    }
  });
  function readDir(dir, prefix){
    return new Promise(function(res){
      var reader = dir.createReader(), all = [];
      (function more(){
        reader.readEntries(function(batch){
          if(!batch.length) return res(all);
          all = all.concat(batch); more();
        });
      })();
    }).then(function(entries){
      return Promise.all(entries.map(function(en){
        if(en.isDirectory) return readDir(en, prefix + en.name + "/");
        return new Promise(function(r){ en.file(function(f){ r([{path:prefix + en.name, file:f}]); }); });
      }));
    }).then(function(lists){ return [].concat.apply([], lists); });
  }
  function setPicked(list){
    list = list.filter(function(p){ return !/(^|\/)(\.DS_Store|Thumbs\.db)$/.test(p.path) && !/(^|\/)\./.test(p.path); });
    var htmls = list.filter(function(p){ return /\.html?$/i.test(p.path); });
    if(list.length === 1 && htmls.length === 1) list[0].path = "index.html";
    picked = list;
    var size = list.reduce(function(a, p){ return a + p.file.size; }, 0);
    $("fileList").innerHTML = list.length ? list.slice(0, 60).map(function(p){ return esc(p.path) + " · " + kb(p.file.size); }).join("<br>") +
      (list.length > 60 ? "<br>… " + (list.length - 60) + " more" : "") + "<br><b>" + list.length + " file(s), " + kb(size) + "</b>" : "";
    if(list.length === 1 && !$("fTitle").value){
      var base = (list[0].file.name || "").replace(/\.html?$/i, "");
      // Slug first: if it matches an existing hosted entry, its title wins.
      if(!slugTouched){ $("fSlug").value = slugify(base); updateSlugHint(); }
      if(!$("fTitle").value) $("fTitle").value = base.replace(/[_-]+/g, " ").replace(/\b\w/g, function(c){ return c.toUpperCase(); });
    }
  }
  function kb(n){ return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  function readFile(f){
    return new Promise(function(res, rej){
      var r = new FileReader();
      r.onload = function(){ res(bytesToB64(new Uint8Array(r.result))); };
      r.onerror = function(){ rej(r.error); };
      r.readAsArrayBuffer(f);
    });
  }

  $("publish").onclick = function(){
    var err = $("addErr"); err.textContent = "";
    var title = $("fTitle").value.trim(), slug = $("fSlug").value.trim();
    if(!title){ err.textContent = "Give it a title."; return; }
    if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)){ err.textContent = "Slug: lowercase letters, digits and dashes."; return; }
    var existing = find(slug);
    if(existing && !existing.managed){ err.textContent = "That slug is already used by a linked page."; return; }

    var entry = {
      id: slug, title: title, url: "/" + C.repo + "/pages/" + slug + "/", repo: C.repo,
      group: $("fGroup").value.trim() || "Other", description: $("fDesc").value.trim(),
      tags: splitTags($("fTags").value), visibility: $("fVis").value, status: "live", managed: true
    };
    var filesP;
    if(src === "upload"){
      if(!picked.length){ err.textContent = "Choose a file to upload."; return; }
      if(!picked.some(function(p){ return p.path === "index.html"; })){ err.textContent = "The upload needs an index.html at its top level."; return; }
      if(picked.some(function(p){ return p.path.split("/").indexOf("..") !== -1; })){ err.textContent = "Bad file path in upload."; return; }
      var big = picked.filter(function(p){ return p.file.size > 95 * 1048576; });
      if(big.length){ err.textContent = big[0].path + " is over GitHub's 100 MB per-file limit."; return; }
      filesP = sequential(picked, function(p){
        return readFile(p.file).then(function(b){ return {path:"pages/" + slug + "/" + p.path, b64:b}; });
      });
    } else if(src === "paste"){
      var html = $("fHtml").value;
      if(!html.trim()){ err.textContent = "Paste some HTML."; return; }
      filesP = Promise.resolve([{path:"pages/" + slug + "/index.html", b64:textToB64(html)}]);
    } else {
      var url = $("fUrl").value.trim();
      if(!url){ err.textContent = "Enter the URL or site path."; return; }
      entry.url = /^https?:\/\//i.test(url) || url.charAt(0) === "/" ? url : "/" + url;
      entry.repo = $("fRepo").value.trim() || "external";
      entry.managed = false;
      if(existing){ err.textContent = "That slug is already taken."; return; }
      filesP = Promise.resolve([]);
    }

    $("publish").disabled = true; $("publish").textContent = "Publishing…";
    // Replacing a managed page: drop its old files first so stale assets don't linger.
    var oldP = existing && existing.managed && src !== "link" ? managedFiles(slug) : Promise.resolve([]);
    Promise.all([filesP, oldP]).then(function(res){
      var files = res[0], keep = {};
      files.forEach(function(f){ keep[f.path] = 1; });
      var changes = res[1].filter(function(p){ return !keep[p]; }).map(function(p){ return {path:p, remove:true}; }).concat(files);
      var next = existing ? routes.map(function(r){ return r.id === slug ? entry : r; }) : routes.concat([entry]);
      changes.push(routesChange(next));
      return save(changes, (existing ? "Update page: " : "Add page: ") + title,
        (existing ? "Updated " : "Published ") + title + ". Live in about a minute.");
    }).then(function(){
      ["fTitle", "fSlug", "fGroup", "fDesc", "fTags", "fHtml", "fUrl", "fRepo"].forEach(function(id){ $(id).value = ""; });
      picked = []; $("fileList").innerHTML = ""; slugTouched = false; updateSlugHint();
    }).catch(function(e){ err.textContent = e.message; })
      .then(function(){ $("publish").disabled = false; $("publish").textContent = "Publish"; });
  };

  // ---------- discover ----------
  var found = [];
  $("scan").onclick = function(){
    var msg = $("scanMsg"); $("scan").disabled = true; $("addFound").disabled = true;
    $("found").innerHTML = ""; found = [];
    msg.textContent = "Listing repos…";
    pageAll("/user/repos?per_page=100&affiliation=owner&sort=pushed").then(function(repos){
      repos = repos.filter(function(r){ return r.owner.login.toLowerCase() === C.owner.toLowerCase(); });
      var done = 0, sites = [];
      msg.textContent = "Checking " + repos.length + " repos for Pages…";
      return pool(repos, 6, function(r){
        return gh("/repos/" + r.full_name + "/pages").then(function(p){ sites.push({repo:r, pages:p}); }, function(){})
          .then(function(){ done++; msg.textContent = "Checked " + done + " / " + repos.length + " repos, " + sites.length + " Pages sites…"; });
      }).then(function(){ return sites; });
    }).then(function(sites){
      msg.textContent = "Reading files on " + sites.length + " Pages sites…";
      return pool(sites, 4, function(s){
        return siteRoutes(s).then(function(list){ s.routes = list; });
      }).then(function(){ return sites; });
    }).then(function(sites){
      renderFound(sites);
      var n = found.length, fresh = found.filter(function(f){ return !f.known; }).length;
      msg.textContent = sites.length + " Pages sites, " + n + " routes, " + fresh + " not yet in the hub.";
    }).catch(function(e){
      msg.textContent = e.status === 403 ? "GitHub refused: the token needs Pages: read and Metadata: read on all repos." : e.message;
    }).then(function(){ $("scan").disabled = false; });
  };
  function pageAll(path){
    var out = [];
    function step(p){
      return gh(path + "&page=" + p).then(function(list){
        out = out.concat(list);
        return list.length === 100 ? step(p + 1) : out;
      });
    }
    return step(1);
  }
  function pool(items, n, fn){
    var q = items.slice();
    function worker(){ var it = q.shift(); return it ? fn(it).then(worker, worker) : Promise.resolve(); }
    var ws = []; for(var i = 0; i < n; i++) ws.push(worker());
    return Promise.all(ws);
  }
  // Each .html file a site serves. Sites built by a workflow publish build output
  // that isn't in the tree, so those list just their root.
  function siteRoutes(s){
    var base = new URL(s.pages.html_url), root = base.pathname.replace(/\/?$/, "/");
    var abs = !!s.pages.cname;   // custom domain: keep full URLs
    function url(rel){ return abs ? base.origin + root + rel : root + rel; }
    var srcInfo = s.pages.source || {};
    if(s.pages.build_type === "workflow" || !srcInfo.branch){
      return Promise.resolve([{url:url(""), file:"(built by workflow)"}]);
    }
    var dir = (srcInfo.path || "/").replace(/^\/|\/$/g, "");
    return gh("/repos/" + s.repo.full_name + "/git/trees/" + encodeURIComponent(srcInfo.branch) + "?recursive=1").then(function(t){
      return t.tree.filter(function(n){
        return n.type === "blob" && /\.html?$/i.test(n.path) && (!dir || n.path.indexOf(dir + "/") === 0) &&
               !/(^|\/)(node_modules|\.git|vendor)\//.test(n.path);
      }).map(function(n){
        var rel = dir ? n.path.slice(dir.length + 1) : n.path;
        return {url:url(rel.replace(/(^|\/)index\.html?$/i, "$1")), file:n.path};
      });
    }, function(){ return [{url:url(""), file:"(could not read tree)"}]; });
  }
  function renderFound(sites){
    var known = {}; routes.forEach(function(r){ known[r.url.replace(/index\.html$/, "")] = 1; });
    $("found").innerHTML = sites.map(function(s){
      var rows = s.routes.map(function(r){
        var k = !!known[r.url];
        var i = found.push({repo:s.repo.name, url:r.url, file:r.file, known:k}) - 1;
        return '<label class="check" style="margin:0 0 6px"><input type="checkbox" data-f="' + i + '"' + (k ? " disabled checked" : "") + '/> ' +
          '<code>' + esc(r.url) + '</code>' + (k ? ' <span class="tag">in hub</span>' : '') + '</label>';
      }).join("");
      return '<div class="panel"><h3>' + esc(s.repo.name) + ' <span class="tag">' + esc(s.pages.build_type || "legacy") + '</span>' +
        (s.repo.private ? ' <span class="tag hid">private repo</span>' : '') + '</h3>' +
        '<p class="sub"><a target="_blank" rel="noopener" href="' + esc(s.pages.html_url) + '">' + esc(s.pages.html_url) + '</a> · ' + s.routes.length + ' route(s)' +
        ' · <a href="#" data-all="' + esc(s.repo.name) + '">select all new</a></p>' +
        '<div style="max-height:320px;overflow:auto">' + rows + '</div></div>';
    }).join("") || '<div class="empty">No Pages sites found.</div>';
  }
  $("found").addEventListener("change", function(){
    $("addFound").disabled = !$("found").querySelector("input[data-f]:checked:not(:disabled)");
  });
  $("found").addEventListener("click", function(e){
    var a = e.target.closest("[data-all]"); if(!a) return;
    e.preventDefault();
    a.closest(".panel").querySelectorAll("input[data-f]:not(:disabled)").forEach(function(c){ c.checked = true; });
    $("addFound").disabled = false;
  });
  $("addFound").onclick = function(){
    var pick = Array.from($("found").querySelectorAll("input[data-f]:checked:not(:disabled)")).map(function(c){ return found[+c.getAttribute("data-f")]; });
    if(!pick.length) return;
    var ids = {}; routes.forEach(function(r){ ids[r.id] = 1; });
    var add = pick.map(function(f){
      var name = f.file.replace(/\.html?$/i, "").split("/").pop();
      var id = slugify(f.repo + "-" + f.file.replace(/\.html?$/i, "")) || slugify(f.repo);
      while(ids[id]) id += "-x";
      ids[id] = 1;
      var title = /^index$/i.test(name) || name.charAt(0) === "(" ? f.repo : f.repo + ": " + name.replace(/[_-]+/g, " ");
      return {id:id, title:title, url:f.url, repo:f.repo, group:f.repo, description:"", tags:[], visibility:"public", status:"live", managed:false};
    });
    $("addFound").disabled = true;
    save([routesChange(routes.concat(add))], "Add " + add.length + " discovered route(s)", "Added " + add.length + " route(s).")
      .then(function(){ $("scan").click(); }, function(){ $("addFound").disabled = false; });
  };
})();
