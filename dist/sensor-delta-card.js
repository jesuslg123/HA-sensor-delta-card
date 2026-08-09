const CARD_VERSION = "0.5.9";

const SENSOR_DELTA_I18N = {
  en: {
    compareWith:"Compare with",
    h24:"24 hours", h48:"48 hours", h72:"72 hours", d7:"7 days",
    history24:"History · last 24 hours", values:"Values", delta:"Δ Delta",
    differenceCurrent:"Difference from current value", loadingHistory:"Loading history…",
    noHistory:"Could not load history.", noGraph:"Could not load graph.",
    noNativeGraph:"Could not load Home Assistant native graph.", insufficientDelta:"Not enough data to calculate delta.",
    close:"Close", deltaVs:p=>`Δ vs ${p} · last 24 hours`
  },
  es: {
    compareWith:"Comparar con",
    h24:"24 horas", h48:"48 horas", h72:"72 horas", d7:"7 días",
    history24:"Histórico · últimas 24 horas", values:"Valores", delta:"Δ Delta",
    differenceCurrent:"Diferencia respecto al valor actual", loadingHistory:"Cargando histórico…",
    noHistory:"No se pudo cargar el histórico.", noGraph:"No se pudo cargar la gráfica.",
    noNativeGraph:"No se pudo cargar la gráfica nativa de Home Assistant.", insufficientDelta:"No hay suficientes datos para calcular el delta.",
    close:"Cerrar", deltaVs:p=>`Δ respecto a ${p} · últimas 24 horas`
  }
};
function sdTr(hass,key,...args){
  const lang=(hass?.locale?.language||"en").toLowerCase().split("-")[0];
  const dict=SENSOR_DELTA_I18N[lang]||SENSOR_DELTA_I18N.en;
  const value=dict[key]??SENSOR_DELTA_I18N.en[key]??key;
  return typeof value==="function"?value(...args):value;
}
function sdPeriod(hass,h){
  return h===168?sdTr(hass,"d7"):sdTr(hass,`h${h}`);
}


class SensorDeltaCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("sensor-delta-card-editor");
  }

  static getStubConfig() {
    return { entity: "", compare_hours: 24 };
  }

  setConfig(config) {
    if (!config) throw new Error("Configuration required");

    const previous = this._config;
    this._config = { compare_hours: 24, ...config };

    const comparisonChanged =
      !previous ||
      previous.entity !== this._config.entity ||
      Number(previous.compare_hours || 24) !== Number(this._config.compare_hours || 24);

    if (comparisonChanged) {
      this._cache = null;
      this._historyRequestId = (this._historyRequestId || 0) + 1;
      this._loadingKey = null;
    }

    this._render();
    if (comparisonChanged && this._hass && this._config.entity) {
      this._loadHistory();
    }
  }

  set hass(hass) {
    const entity = this._config?.entity;
    const before = this._hass?.states?.[entity];
    const after = hass.states?.[entity];

    const stateChanged = before?.state !== after?.state;
    const displayChanged =
      !this._hass ||
      stateChanged ||
      before?.attributes?.friendly_name !== after?.attributes?.friendly_name ||
      before?.attributes?.unit_of_measurement !== after?.attributes?.unit_of_measurement ||
      before?.attributes?.icon !== after?.attributes?.icon ||
      before?.attributes?.device_class !== after?.attributes?.device_class ||
      this._hass?.locale?.language !== hass.locale?.language;

    this._hass = hass;

    if (displayChanged) this._render();
    if (!this._cache || stateChanged) this._loadHistory();
  }

  getCardSize() { return 2; }
  getGridOptions() { return { rows: 2, columns: 6, min_rows: 1 }; }

  connectedCallback() { this._render(); }

  async _loadHistory() {
    if (!this._hass || !this._config?.entity) return;

    const entity = this._config.entity;
    const hours = Number(this._config.compare_hours || 24);
    const key = `${entity}:${hours}`;

    if (this._loadingKey === key) return;

    const requestId = (this._historyRequestId || 0) + 1;
    this._historyRequestId = requestId;
    this._loadingKey = key;

    try {
      const target = new Date(Date.now() - hours * 3600 * 1000);
      const start = new Date(target.getTime() - 30 * 60 * 1000);
      const end = new Date(target.getTime() + 30 * 60 * 1000);
      const url = `history/period/${encodeURIComponent(start.toISOString())}` +
        `?filter_entity_id=${encodeURIComponent(entity)}` +
        `&end_time=${encodeURIComponent(end.toISOString())}` +
        `&minimal_response&no_attributes&significant_changes_only`;

      const result = await this._hass.callApi("GET", url);

      if (
        requestId !== this._historyRequestId ||
        entity !== this._config?.entity ||
        hours !== Number(this._config?.compare_hours || 24)
      ) return;

      this._cache = { at: Date.now(), rows: (result && result[0]) || [], hours, entity };
    } catch (e) {
      if (requestId !== this._historyRequestId) return;
      console.error("sensor-delta-card comparison history error", e);
      this._cache = { at: Date.now(), rows: [], error: String(e), hours, entity };
    } finally {
      if (requestId === this._historyRequestId) {
        this._loadingKey = null;
        this._render();
      }
    }
  }

  async _loadDetailsHistory() {
    if (!this._hass || !this._config?.entity) return [];
    // Lazy-load details only when the user opens the card.
    const end = new Date();
    const compareHours = Number(this._config.compare_hours || 24);
    // For a 24 h delta chart we need the visible 24 h plus the comparison offset.
    // Keep at least 7 days because the summary boxes always include a 7-day delta.
    const historyHours = Math.max(7 * 24, compareHours + 24);
    const start = new Date(end.getTime() - historyHours * 3600 * 1000);
    const url = `history/period/${encodeURIComponent(start.toISOString())}` +
      `?filter_entity_id=${encodeURIComponent(this._config.entity)}` +
      `&end_time=${encodeURIComponent(end.toISOString())}` +
      `&minimal_response&no_attributes&significant_changes_only`;
    const result = await this._hass.callApi("GET", url);
    return (result && result[0]) || [];
  }

  _num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  _valueAt(hoursAgo) {
    const rows = this._cache?.rows || [];
    const target = Date.now() - hoursAgo * 3600 * 1000;
    let best = null, bestDist = Infinity;
    for (const row of rows) {
      const t = Date.parse(row.last_changed || row.last_updated);
      const v = this._num(row.state);
      if (!Number.isFinite(t) || v === null) continue;
      const d = Math.abs(t - target);
      if (d < bestDist) { bestDist = d; best = v; }
    }
    return best;
  }

  _fmt(value, decimals = 1) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return new Intl.NumberFormat(this._hass?.locale?.language || undefined, {
      maximumFractionDigits: decimals, minimumFractionDigits: decimals
    }).format(value);
  }

  _delta(hours) {
    const state = this._hass?.states?.[this._config?.entity];
    const now = this._num(state?.state);
    const old = this._valueAt(hours);
    return now === null || old === null ? null : now - old;
  }

  _deltaText(hours) {
    const d = this._delta(hours);
    if (d === null) return "—";
    const arrow = d > 0 ? "↑" : d < 0 ? "↓" : "→";
    const sign = d > 0 ? "+" : "";
    return `${arrow} ${sign}${this._fmt(d)}`;
  }

  _name(state) {
    if (this._config?.name) return this._config.name;
    try { return this._hass.formatEntityName(state); } catch (_) {}
    return state?.attributes?.friendly_name || this._config?.entity || "Sensor";
  }

  async _openDetails() {
    if (!this._config?.entity) return;
    const ev = new CustomEvent("sensor-delta-details", {
      bubbles: true, composed: true,
      detail: { entity: this._config.entity, hass: this._hass }
    });
    window.dispatchEvent(ev);

    const dialog = SensorDeltaDialog.openShell(this._hass, this._config.entity, this, Number(this._config.compare_hours || 24));
    try {
      const rows = await this._loadDetailsHistory();
      await SensorDeltaDialog.populate(dialog, this._hass, this._config.entity, rows, Number(this._config.compare_hours || 24));
    } catch (e) {
      console.error("sensor-delta-card details history error", e);
      SensorDeltaDialog.showError(dialog);
    }
  }

  _render() {
    if (!this.isConnected || !this._config) return;
    const state = this._hass?.states?.[this._config.entity];
    const unit = state?.attributes?.unit_of_measurement || "";
    const current = this._num(state?.state);
    const hours = Number(this._config.compare_hours || 24);

    this.innerHTML = `
      <style>
        ha-card { height:100%; cursor:pointer; padding:16px; box-sizing:border-box; }
        .top { display:flex; align-items:center; gap:10px; color:var(--primary-text-color); }
        ha-icon { color:var(--state-icon-color, var(--primary-color)); }
        .name { font-weight:500; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .body { display:flex; flex-direction:column; align-items:flex-start; margin-top:14px; gap:7px; }
        .current-line { display:flex; align-items:baseline; white-space:nowrap; }
        .current { font-size:28px; font-weight:500; line-height:1; }
        .unit { font-size:15px; opacity:.7; margin-left:4px; }
        .delta { font-size:15px; white-space:nowrap; line-height:1.2; }
        .delta .unit { margin-left:2px; }
        .period { opacity:.65; }
      </style>
      <ha-card tabindex="0">
        <div class="top">
          <ha-icon icon="${state?.attributes?.icon || this._defaultIcon(state)}"></ha-icon>
          <div class="name">${this._escape(this._name(state))}</div>
        </div>
        <div class="body">
          <div class="current-line"><span class="current">${current === null ? "—" : this._fmt(current)}</span><span class="unit">${this._escape(unit)}</span></div>
          <div class="delta">${this._deltaText(hours)} <span class="unit">${this._escape(unit)}</span> <span class="period">· ${this._period(hours)}</span></div>
        </div>
      </ha-card>`;
    const card = this.querySelector("ha-card");
    card?.addEventListener("click", () => this._openDetails());
    card?.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") this._openDetails(); });
  }

  _defaultIcon(state) {
    const dc = state?.attributes?.device_class;
    if (dc === "temperature") return "mdi:thermometer";
    if (dc === "humidity") return "mdi:water-percent";
    return "mdi:chart-line";
  }

  _period(h) {
    return sdPeriod(this._hass, h);
  }

  _escape(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }
}
if (!customElements.get("sensor-delta-card")) customElements.define("sensor-delta-card", SensorDeltaCard);

class SensorDeltaCardEditor extends HTMLElement {
  set hass(hass) {
    this._hass = hass;

    // Home Assistant pushes a new `hass` object very frequently. Rebuilding the
    // editor on every push closes an open entity dropdown while the user is
    // scrolling/searching. Render only when needed and otherwise update the
    // native entity picker in place.
    if (!this._rendered) {
      this._render();
    } else {
      const picker = this.querySelector("#entity");
      const hoursSelector = this.querySelector("#hours");
      const nameSelector = this.querySelector("#name");
      if (picker) picker.hass = hass;
      if (hoursSelector) hoursSelector.hass = hass;
      if (nameSelector) nameSelector.hass = hass;
    }
  }

  setConfig(config) {
    const next = { compare_hours: 24, ...config };
    const changed =
      !this._config ||
      this._config.entity !== next.entity ||
      Number(this._config.compare_hours) !== Number(next.compare_hours) ||
      this._config.name !== next.name;

    this._config = next;
    if (!this._rendered || changed) this._render();
  }

  _changed(patch, rerender = false) {
    this._config = { ...this._config, ...patch };
    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: this._config }, bubbles: true, composed: true
    }));
    if (rerender) this._render();
  }

  _render() {
    if (!this._config) return;

    this.innerHTML = `
      <style>
        .wrap{display:grid;gap:16px;padding:8px 0}
        ha-entity-picker,ha-selector{width:100%}
      </style>
      <div class="wrap">
        <ha-entity-picker id="entity"></ha-entity-picker>
        <ha-selector id="hours"></ha-selector>
        <ha-selector id="name"></ha-selector>
      </div>`;

    const picker = this.querySelector("#entity");
    if (picker) {
      picker.hass = this._hass;
      picker.value = this._config.entity || "";
      picker.allowCustomEntity = false;

      // Native HA searchable picker, restricted to numeric sensors.
      picker.includeDomains = ["sensor"];
      picker.entityFilter = stateObj =>
        !!stateObj && Number.isFinite(Number(stateObj.state));

      picker.addEventListener("value-changed", e => {
        const value = e.detail?.value || "";
        if (value !== (this._config.entity || "")) {
          this._changed({ entity: value });
        }
      });
    }

    const hoursSelector = this.querySelector("#hours");
    if (hoursSelector) {
      hoursSelector.hass = this._hass;
      hoursSelector.label = sdTr(this._hass, "compareWith");
      hoursSelector.selector = {
        select: {
          options: [
            { value: "24", label: sdTr(this._hass, "h24") },
            { value: "48", label: sdTr(this._hass, "h48") },
            { value: "72", label: sdTr(this._hass, "h72") },
            { value: "168", label: sdTr(this._hass, "d7") }
          ],
          mode: "dropdown"
        }
      };
      hoursSelector.value = String(Number(this._config.compare_hours || 24));
      hoursSelector.addEventListener("value-changed", e => {
        const value = Number(e.detail?.value);
        if (Number.isFinite(value) && value !== Number(this._config.compare_hours || 24)) {
          this._changed({ compare_hours: value });
        }
      });
    }

    const nameSelector = this.querySelector("#name");
    if (nameSelector) {
      nameSelector.hass = this._hass;
      nameSelector.label =
        this._hass?.localize?.("ui.panel.lovelace.editor.card.generic.name") ||
        this._hass?.localize?.("ui.components.entity.entity-picker.name") ||
        "Name";
      nameSelector.selector = { text: {} };
      nameSelector.value = this._config.name || "";
      nameSelector.addEventListener("value-changed", e => {
        const value = e.detail?.value ?? "";
        if (value !== (this._config.name || "")) {
          this._changed({ name: value || undefined });
        }
      });
    }

    this._rendered = true;
  }
}
if (!customElements.get("sensor-delta-card-editor")) customElements.define("sensor-delta-card-editor", SensorDeltaCardEditor);
class SensorDeltaDialog {
  static _findExisting(host) {
    const root = host?.getRootNode?.() || document;
    return root.querySelector("#sensor-delta-dialog-overlay");
  }

  static _mount(host, overlay) {
    ((host && host.parentElement) || host || document.body).appendChild(overlay);
  }

  static openShell(hass, entity, host, compareHours) {
    const old = this._findExisting(host);
    old?.remove();

    const state = hass.states[entity];
    const unit = state?.attributes?.unit_of_measurement || "";
    const now = Number(state?.state);
    const name = state?.attributes?.friendly_name || entity;
    const fmt = n => Number.isFinite(n)
      ? new Intl.NumberFormat(hass.locale?.language || undefined, {
          maximumFractionDigits: 1, minimumFractionDigits: 1
        }).format(n)
      : "—";

    const overlay = document.createElement("div");
    overlay.id = "sensor-delta-dialog-overlay";
    overlay.innerHTML = `
      <style>
        #sensor-delta-dialog-overlay{
          position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.45);
          display:grid;place-items:center;padding:16px
        }
        .dlg{
          width:min(920px,100%);max-height:92vh;overflow:auto;
          background:var(--card-background-color,#fff);color:var(--primary-text-color,#111);
          border-radius:18px;box-shadow:0 12px 40px rgba(0,0,0,.3);
          padding:20px;box-sizing:border-box
        }
        .head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
        .title{font-size:20px;font-weight:600}
        button{border:0;background:transparent;color:inherit;font-size:28px;cursor:pointer}
        .now{font-size:30px;margin:14px 0 4px}
        .lab{opacity:.65;font-size:13px}
        .graph-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px}
        .segmented{display:inline-flex;padding:3px;border-radius:10px;background:var(--secondary-background-color,rgba(127,127,127,.10));gap:2px}
        .segmented button{font-size:13px;line-height:1;border:0;border-radius:8px;padding:8px 12px;cursor:pointer;color:var(--primary-text-color);background:transparent}
        .segmented button.active{background:var(--card-background-color,#fff);box-shadow:0 1px 4px rgba(0,0,0,.18);font-weight:600}
        .chart{margin:10px 0 16px;min-height:260px}
        .loading{
          min-height:260px;display:grid;place-items:center;opacity:.65;
          background:var(--secondary-background-color,rgba(127,127,127,.08));
          border-radius:12px
        }
        .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}
        .box{padding:12px;border-radius:12px;background:var(--secondary-background-color,rgba(127,127,127,.08))}
        .val{font-size:18px;margin-top:3px}
        .hidden{display:none}
      </style>
      <div class="dlg" role="dialog" aria-modal="true">
        <div class="head">
          <div class="title" id="dialog-title"></div>
          <button type="button" data-dialog-close aria-label="${sdTr(hass,"close")}">×</button>
        </div>
        <div class="now" id="dialog-now"></div>
        <div class="graph-head">
          <div class="lab" id="graph-label">${sdTr(hass,"history24")}</div>
          <div class="segmented" role="group" aria-label="Tipo de gráfica">
            <button type="button" class="active" data-graph-mode="values">${sdTr(hass,"values")}</button>
            <button type="button" data-graph-mode="delta">${sdTr(hass,"delta")}</button>
          </div>
        </div>
        <div class="chart">
          <div id="history-loading" class="loading">${sdTr(hass,"loadingHistory")}</div>
          <div id="native-history"></div>
        </div>
        <div class="lab">${sdTr(hass,"differenceCurrent")}</div>
        <div class="grid">
          ${[24,48,72,168].map(h=>`
            <div class="box">
              <div class="lab">${sdPeriod(hass,h)}</div>
              <div class="val" data-delta-hours="${h}">—</div>
            </div>`).join("")}
        </div>
      </div>`;

    overlay._sensorDeltaCompareHours = compareHours;
    overlay._sensorDeltaHass = hass;
    this._mount(host, overlay);

    const titleEl = overlay.querySelector("#dialog-title");
    const nowEl = overlay.querySelector("#dialog-now");
    if (titleEl) titleEl.textContent = name;
    if (nowEl) nowEl.textContent = `${fmt(now)} ${unit}`;

    const close = () => overlay.remove();
    const closeButton = overlay.querySelector("[data-dialog-close]");
    if (closeButton) closeButton.onclick = close;
    overlay.onclick = e => { if (e.target === overlay) close(); };

    return overlay;
  }

  static async populate(overlay, hass, entity, rows, compareHours) {
    if (!overlay?.isConnected) return;

    const state = hass.states[entity];
    const unit = state?.attributes?.unit_of_measurement || "";
    const now = Number(state?.state);
    const vals = rows.map(r => ({
      t: Date.parse(r.last_changed || r.last_updated),
      v: Number(r.state)
    }))
      .filter(x => Number.isFinite(x.t) && Number.isFinite(x.v))
      .sort((a, b) => a.t - b.t);

    const valueAt = h => {
      const target = Date.now() - h * 3600000;
      let best = null, dist = Infinity;
      vals.forEach(x => {
        const d = Math.abs(x.t - target);
        if (d < dist) { dist = d; best = x.v; }
      });
      return best;
    };

    const fmt = n => Number.isFinite(n)
      ? new Intl.NumberFormat(hass.locale?.language || undefined, {
          maximumFractionDigits: 1, minimumFractionDigits: 1
        }).format(n)
      : "—";

    const deltaText = h => {
      const old = valueAt(h);
      if (!Number.isFinite(now) || old === null) return "—";
      const d = now - old;
      return `${d>0?"↑ +":d<0?"↓ ":"→ "}${fmt(d)} ${unit}`;
    };

    for (const h of [24,48,72,168]) {
      const el = overlay.querySelector(`[data-delta-hours="${h}"]`);
      if (el) el.textContent = deltaText(h);
    }

    const graphHost = overlay.querySelector("#native-history");
    const loading = overlay.querySelector("#history-loading");
    const graphLabel = overlay.querySelector("#graph-label");
    const modeButtons = [...overlay.querySelectorAll("[data-graph-mode]")];
    let graphRenderSeq = 0;

    const setActiveButton = mode => {
      modeButtons.forEach(btn => btn.classList.toggle("active", btn.dataset.graphMode === mode));
    };

    const clearGraph = () => {
      while (graphHost.firstChild) graphHost.firstChild.remove();
    };

    const renderValuesGraph = async () => {
      if (!overlay.isConnected) return;
      const seq = ++graphRenderSeq;

      setActiveButton("values");
      if (graphLabel) graphLabel.textContent = sdTr(hass,"history24");
      clearGraph();

      const helpers = await window.loadCardHelpers();
      if (seq !== graphRenderSeq || !overlay.isConnected) return;

      const graph = await helpers.createCardElement({
        type: "history-graph",
        hours_to_show: 24,
        entities: [entity]
      });
      if (seq !== graphRenderSeq || !overlay.isConnected) return;

      graphHost.appendChild(graph);
      graph.hass = hass;
      if (graph.updateComplete) {
        await graph.updateComplete;
      } else {
        await new Promise(resolve => requestAnimationFrame(resolve));
      }
      if (seq === graphRenderSeq && overlay.isConnected) graph.hass = hass;
    };

    const valueAtTime = target => {
      if (!vals.length) return null;

      let lo = 0;
      let hi = vals.length - 1;
      let idx = -1;

      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (vals[mid].t <= target) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      return idx >= 0 ? vals[idx].v : vals[0].v;
    };

    const buildDeltaStates = hours => {
      const end = Date.now();
      const start = end - 24 * 3600000;
      const offset = hours * 3600000;

      const timestamps = new Set([start, end]);

      for (const x of vals) {
        if (x.t >= start && x.t <= end) timestamps.add(x.t);

        const shifted = x.t + offset;
        if (shifted >= start && shifted <= end) timestamps.add(shifted);
      }

      const points = [];
      for (const t of [...timestamps].sort((a, b) => a - b)) {
        const current = t === end && Number.isFinite(now) ? now : valueAtTime(t);
        const reference = valueAtTime(t - offset);
        if (current === null || reference === null) continue;

        points.push({
          state: String(current - reference),
          last_changed: t,
          attributes: {}
        });
      }

      return points;
    };

    const renderDeltaGraph = async () => {
      if (!overlay.isConnected) return;
      const seq = ++graphRenderSeq;
      setActiveButton("delta");
      if (graphLabel) {
        graphLabel.textContent = sdTr(hass,"deltaVs",sdPeriod(hass,compareHours));
      }
      clearGraph();

      // state-history-chart-line is Home Assistant's own numeric history chart.
      // The normal history-graph loads/registers it; wait for that native
      // component instead of drawing a graph ourselves.
      await customElements.whenDefined("state-history-chart-line");
      if (seq !== graphRenderSeq || !overlay.isConnected) return;

      const deltaStates = buildDeltaStates(compareHours);
      if (deltaStates.length < 2) {
        graphHost.innerHTML = `<div class="loading">${sdTr(hass,"insufficientDelta")}</div>`;
        return;
      }

      // Use a frontend-only synthetic entity for the delta chart.
      // We never mutate Home Assistant's real hass object or create anything
      // in the backend/Recorder.
      const currentReference = valueAtTime(Date.now() - compareHours * 3600000);
      const currentDelta = Number.isFinite(now) && currentReference !== null
        ? now - currentReference
        : Number(deltaStates[deltaStates.length - 1]?.state);

      const safeObjectId = entity
        .replace(/^sensor\./, "")
        .replace(/[^a-zA-Z0-9_]/g, "_")
        .toLowerCase();
      const deltaEntity = `sensor.sensor_delta_card_${safeObjectId}_${compareHours}h`;
      const timestamp = new Date().toISOString();
      const realState = hass.states[entity];

      const syntheticState = {
        ...(realState || {}),
        entity_id: deltaEntity,
        state: String(currentDelta),
        attributes: {
          ...(realState?.attributes || {}),
          friendly_name: "Delta",
          unit_of_measurement: unit
        },
        last_changed: timestamp,
        last_updated: timestamp
      };

      const deltaHass = {
        ...hass,
        states: {
          ...hass.states,
          [deltaEntity]: syntheticState
        }
      };

      const chart = document.createElement("state-history-chart-line");
      chart.hass = deltaHass;
      chart.data = [{
        domain: "sensor",
        name: "Delta",
        entity_id: deltaEntity,
        states: deltaStates
      }];
      chart.unit = unit;
      chart.startTime = new Date(Date.now() - 24 * 3600000);
      chart.endTime = new Date();
      chart.showNames = false;
      chart.clickForMoreInfo = false;
      chart.fitYData = true;
      chart.height = "260px";
      if (seq === graphRenderSeq && overlay.isConnected) graphHost.appendChild(chart);
    };

    modeButtons.forEach(btn => {
      btn.onclick = async ev => {
        ev.stopPropagation();
        const mode = btn.dataset.graphMode;
        try {
          if (mode === "delta") await renderDeltaGraph();
          else await renderValuesGraph();
        } catch (e) {
          console.error("sensor-delta-card graph mode error", e);
          clearGraph();
          graphHost.innerHTML = `<div class="loading">${sdTr(hass,"noGraph")}</div>`;
        }
      };
    });

    try {
      await renderValuesGraph();
      loading?.remove();
    } catch (e) {
      console.error("sensor-delta-card native history graph error", e);
      if (loading) loading.textContent = sdTr(hass,"noNativeGraph");
    }
  }

  static showError(overlay) {
    if (!overlay?.isConnected) return;
    const loading = overlay.querySelector("#history-loading");
    if (loading) loading.textContent = sdTr(overlay?._sensorDeltaHass,"noHistory");
  }
}

window.customCards = window.customCards || [];
if (!window.customCards.some(card => card.type === "sensor-delta-card")) {
  window.customCards.push({
    type: "sensor-delta-card",
    name: "Sensor Delta",
    description: "Valor actual y diferencia frente a 24 h, 48 h, 72 h o 7 días.",
    preview: true,
    getEntitySuggestion: (hass, entityId) => {
      const s = hass.states[entityId];
      if (!entityId.startsWith("sensor.") || !s || !Number.isFinite(Number(s.state))) return null;
      return { config: { type:"custom:sensor-delta-card", entity:entityId, compare_hours:24 } };
    }
  });
}
console.info(`%c SENSOR-DELTA-CARD %c v${CARD_VERSION} `,"background:#03a9f4;color:white;font-weight:bold","background:#ddd;color:#333");
