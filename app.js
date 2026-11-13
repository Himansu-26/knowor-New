const $ = (s) => document.querySelector(s);
let imgB64 = null, imgMime = "image/jpeg", stream = null, lastResult = null;

// escape text so AI output can never inject HTML
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- navigation ----------
$("#menuBtn").onclick = () => $("#menu").classList.toggle("open");
$("#menu").onclick = () => $("#menu").classList.remove("open");

// ---------- image handling (resized to keep uploads small) ----------
function setImage(file) {
  if (!file || !file.type.startsWith("image/")) return showError("Please choose an image file.");
  const img = new Image();
  img.onload = () => {
    const max = 1024, k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = img.width * k; c.height = img.height * k;
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    const url = c.toDataURL("image/jpeg", 0.85);
    imgB64 = url.split(",")[1]; imgMime = "image/jpeg";
    $("#preview").src = url; $("#preview").hidden = false; $("#dropText").hidden = true;
    $("#goBtn").disabled = false;
  };
  img.src = URL.createObjectURL(file);
}
$("#fileInput").onchange = (e) => setImage(e.target.files[0]);
$("#camInput").onchange = (e) => setImage(e.target.files[0]);
const drop = $("#drop");
["dragover", "dragenter"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => setImage(e.dataTransfer.files[0]));

// ---------- live camera ----------
$("#liveBtn").onclick = async () => {
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    $("#video").srcObject = stream; $("#camModal").hidden = false;
  } catch { showError("Camera not available. Use 'Take photo' instead (camera needs HTTPS or localhost)."); }
};
const stopCam = () => { stream?.getTracks().forEach((t) => t.stop()); $("#camModal").hidden = true; };
$("#closeCam").onclick = stopCam;
$("#snapBtn").onclick = () => {
  const v = $("#video"), c = document.createElement("canvas");
  c.width = v.videoWidth; c.height = v.videoHeight;
  c.getContext("2d").drawImage(v, 0, 0);
  c.toBlob((b) => setImage(b), "image/jpeg", 0.9); stopCam();
};

// ---------- calling the backend ----------
$("#goBtn").onclick = () => identify({ image: imgB64, mime: imgMime }, $("#preview").src);
$("#searchForm").onsubmit = (e) => { e.preventDefault(); identify({ query: $("#searchInput").value.trim() }); };

// ONE request per photo. A double-click guard stops accidental extra calls.
let busy = false;
async function identify(body, thumb) {
  if (busy) return;
  busy = true;
  showError(""); $("#result").hidden = true; $("#loader").hidden = false;
  speechSynthesis.cancel();
  try {
    const r = await fetch("/api/identify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Something went wrong");
    render(data, thumb); loadHistory();
    $("#result").scrollIntoView({ behavior: "smooth" });
  } catch (e) { showError(e.message); }
  $("#loader").hidden = true;
  busy = false;
}
function showError(m) { const e = $("#error"); e.textContent = m; e.hidden = !m; }

// ---------- show the answer ----------
const list = (a) => (a?.length ? `<ul>${a.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
const block = (t, body) => (body ? `<div class="block"><h3>${t}</h3>${body}</div>` : "");
const para = (s) => (s ? `<p>${esc(s)}</p>` : "");

function render(r, thumb) {
  lastResult = r;
  const q = encodeURIComponent(r.name || "");
  const living = r.living || ["animal", "bird", "plant"].includes(r.category);
  $("#result").innerHTML = `
    <div class="rhead">
      ${thumb ? `<img src="${thumb}" alt="">` : ""}
      <div>
        <h2>${esc(r.name)}</h2>
        <span class="tag">${esc(r.category)}</span><span class="tag alt">${esc(r.confidence)} confidence</span>
        ${r.scientificName ? `<div class="sci">${esc(r.scientificName)}</div>` : ""}
      </div>
    </div>
    <p>${esc(r.summary)}</p>
    <button class="voice" id="voiceBtn">🔊 Listen</button>
    ${(r.details || []).map((d) => block(esc(d.title), para(d.text))).join("")}
    ${living ? block("Wild or domestic?", para(r.wildOrDomestic)) + block("Habitat", para(r.habitat)) + block("Food", para(r.diet)) : ""}
    ${block("How it works", para(r.howItWorks))}${block("How to use it", para(r.howToUse))}
    ${block("Types", list(r.types))}
    ${block("Interesting facts", list(r.facts))}
    ${block("Conservation", (r.conservationStatus ? `<p><span class="tag alt">${esc(r.conservationStatus)}</span></p>` : "") + para(r.conservationInfo))}
    ${r.buyable ? block("Approximate price", para(r.priceRange)) + `<div class="block pills shop">
        <a target="_blank" rel="noopener" href="https://www.amazon.in/s?k=${q}">🛒 Amazon</a>
        <a target="_blank" rel="noopener" href="https://www.flipkart.com/search?q=${q}">🛍️ Flipkart</a>
        <a target="_blank" rel="noopener" href="https://www.google.com/search?tbm=shop&q=${q}">🔎 Google Shopping</a></div>` : ""}
    ${r.similar?.length ? block("Similar things", `<div class="pills">${r.similar.map((s) => `<button data-q="${esc(s)}">${esc(s)}</button>`).join("")}</div>`) : ""}`;
  $("#result").hidden = false;
  $("#voiceBtn").onclick = speak;
  $("#result").querySelectorAll("[data-q]").forEach((b) => (b.onclick = () => { $("#searchInput").value = b.dataset.q; identify({ query: b.dataset.q }); }));
}

// ---------- voice explanation ----------
function speak() {
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); $("#voiceBtn").textContent = "🔊 Listen"; return; }
  const r = lastResult;
  const u = new SpeechSynthesisUtterance([r.name + ".", r.summary, ...(r.facts || []).slice(0, 3).map((f) => "Fun fact: " + f)].join(" "));
  u.onend = () => ($("#voiceBtn").textContent = "🔊 Listen");
  $("#voiceBtn").textContent = "⏹ Stop";
  speechSynthesis.speak(u);
}

// ---------- history (from the database) ----------
async function loadHistory() {
  try {
    const items = await (await fetch("/api/history")).json();
    $("#historyList").innerHTML = items.length
      ? items.map((h, i) => `<button data-i="${i}"><b>${esc(h.result.name)}</b><br><small>${esc(h.result.category)} · ${new Date(h.time).toLocaleDateString()}</small></button>`).join("")
      : "<p>Nothing yet. Identify something!</p>";
    $("#historyList").querySelectorAll("[data-i]").forEach((b) => (b.onclick = () => { render(items[b.dataset.i].result); $("#result").scrollIntoView({ behavior: "smooth" }); }));
  } catch {}
}
$("#clearBtn").onclick = async () => { await fetch("/api/history", { method: "DELETE" }); loadHistory(); };
loadHistory();
