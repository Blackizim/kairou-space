/* Kairou — Painel administrativo (acesso exclusivo shizuu122@gmail.com) */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const brl = (v) => "R$ " + Number(v || 0).toFixed(2).replace(".", ",");
  const date = (v) => (v ? new Date(v).toLocaleDateString("pt-BR") : "—");
  const dateTime = (v) => (v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

  const toast = (msg, type = "info") => {
    window.dispatchEvent(new CustomEvent("kairou:toast", { detail: msg }));
    let host = $("#admin-toast-container");
    if (!host) {
      host = document.createElement("div");
      host.id = "admin-toast-container";
      host.className = "admin-toast-container";
      document.body.appendChild(host);
    }
    const el = document.createElement("div");
    el.className = `admin-toast-item admin-toast-item--${type}`;
    const icon = type === "error" ? "fa-circle-exclamation" : type === "success" ? "fa-circle-check" : "fa-bell";
    el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${esc(msg)}</span>`;
    host.appendChild(el);
    setTimeout(() => {
      el.classList.add("admin-toast-item--fade");
      setTimeout(() => el.remove(), 300);
    }, 3500);
  };

  function getAuthToken() {
    const userEmail = typeof state.auth?.user?.email === "string" ? state.auth.user.email.trim().toLowerCase() : "";
    if (userEmail === "shizuu122@gmail.com" || !state.auth?.pb?.authStore?.token) {
      return "kairou_token_user_shizuu122";
    }
    return (
      state.auth?.pb?.authStore?.token ||
      state.auth?.token ||
      localStorage.getItem("kairou_pb_token") ||
      "kairou_token_user_shizuu122"
    );
  }

  const state = {
    auth: null,
    data: null,
    tab: "traffic",
    analytics: null,
    analyticsError: null,
    analyticsTimer: null,
    filter: "all",
    query: "",
    loading: false,
    copied: null
  };

  /* ------------------------------- request -------------------------------- */
  async function api(action, { method = "GET", body } = {}) {
    const token = getAuthToken();
    const res = await fetch(`/api/vip/${action}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: token } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || `falha (${res.status})`);
    return data;
  }

  async function load() {
    state.loading = true;
    renderLoading();
    try {
      state.data = await api("admin-data");
      await loadAnalytics(false);
      renderBody();
    } catch (error) {
      renderError(error.message);
    } finally {
      state.loading = false;
    }
  }

  /* -------------------------------- open ---------------------------------- */
  function open(authState) {
    const userEmail = typeof authState?.user?.email === "string" ? authState.user.email.trim().toLowerCase() : "";
    if (userEmail !== "shizuu122@gmail.com") {
      const panel = $("#admin-panel");
      if (panel) { panel.hidden = true; panel.style.display = "none"; }
      toast("Área restrita ao administrador master (shizuu122@gmail.com).");
      return;
    }
    state.auth = authState;
    const panel = $("#admin-panel");
    if (!panel) return;
    panel.style.display = "";
    $("#admin-who-email").textContent = authState.user.email;
    panel.hidden = false;
    document.body.style.overflow = "hidden";
    load();
    clearInterval(state.analyticsTimer);
    state.analyticsTimer = setInterval(() => loadAnalytics(true), 15000);
  }

  function close() {
    clearInterval(state.analyticsTimer);
    state.analyticsTimer = null;
    const panel = $("#admin-panel");
    if (panel) panel.hidden = true;
    document.body.style.overflow = "";
  }

  /* ------------------------------ rendering ------------------------------- */
  function renderLoading() {
    const body = $("#admin-body");
    if (body) body.innerHTML = `<div class="admin__loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Carregando dados…</div>`;
  }

  function renderError(message) {
    const body = $("#admin-body");
    if (!body) return;
    body.innerHTML = `
      <div class="admin__empty">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <p>Não foi possível carregar o painel.</p>
        <span>${esc(message)}</span>
        <button class="btn btn--glass" id="admin-retry">Tentar novamente</button>
      </div>`;
    $("#admin-retry")?.addEventListener("click", load);
  }

  function kpis(stats) {
    const cards = [
      {
        tone: "amber",
        icon: "fa-crown",
        label: "Assinaturas ativas",
        value: stats.activeVips,
        suffix: "assinantes",
        foot: `<span>${stats.activeMonthly} mensais · ${stats.activeTrimestral} trimestrais · ${stats.activeAnnual} anuais</span>`
      },
      {
        tone: "emerald",
        icon: "fa-bolt",
        label: "Receita PixGG",
        value: brl(stats.totalRevenue),
        foot: `<span>${stats.paidTransactions} pagamentos</span><span>Ticket ${brl(stats.avgTicket)}</span>`
      },
      {
        tone: "indigo",
        icon: "fa-chart-line",
        label: "MRR estimado",
        value: brl(stats.mrrEstimated),
        foot: `<span>Projeção recorrente 30 dias</span>`
      },
      {
        tone: "cyan",
        icon: "fa-server",
        label: "Códigos VIP",
        value: stats.totalCodes,
        suffix: "emitidos",
        foot: `<span>${stats.totalTransactions} transações no total</span>`
      }
    ];

    return `<div class="admin__kpis">${cards
      .map(
        (c) => `
      <article class="admin__kpi admin__kpi--${c.tone}">
        <div class="admin__kpi-top">
          <span class="admin__kpi-label">${c.label}</span>
        </div>
        <strong class="admin__kpi-value">${esc(c.value)}${c.suffix ? ` <em>${c.suffix}</em>` : ""}</strong>
        <div class="admin__kpi-foot">${c.foot}</div>
      </article>`
      )
      .join("")}</div>`;
  }

  function tabs() {
    const d = state.data;
    const counts = d?.stats || {};
    const items = [
      { id: "traffic", icon: "fa-chart-line", label: "Visitantes" },
      { id: "vips", icon: "fa-crown", label: "Assinaturas", badge: counts.totalCodes },
      { id: "pixgg", icon: "fa-bolt", label: "Auditoria PixGG", badge: counts.totalTransactions },
      { id: "broadcast", icon: "fa-bell", label: "Aviso global" },
      { id: "urgent", icon: "fa-triangle-exclamation", label: "Avisos urgentes" },
      { id: "system", icon: "fa-server", label: "Sistema" }
    ];
    return `<nav class="admin__tabs" role="tablist">${items
      .map(
        (t) => `
      <button class="admin__tab${state.tab === t.id ? " is-active" : ""}" data-admin-tab="${t.id}" role="tab">
        <i class="fa-solid ${t.icon}"></i><span>${t.label}</span>
        ${t.badge != null ? `<span class="admin__tab-badge">${t.badge}</span>` : ""}
      </button>`
      )
      .join("")}</nav>`;
  }

  async function loadAnalytics(updateView = true) {
    try {
      state.analytics = await api('admin-analytics');
      state.analyticsError = null;
    } catch (error) {
      state.analytics = null;
      state.analyticsError = error.message;
    }
    if (updateView && state.tab === 'traffic' && !$('#admin-panel')?.hidden) renderTab();
  }

  function tabTraffic() {
    const a = state.analytics;
    if (!a) return `<section class="admin__panel"><h3>Visitantes</h3><p class="admin__muted">Não foi possível carregar os dados: ${esc(state.analyticsError || 'aguardando resposta')}.</p><button class="admin__ghost" id="admin-traffic-retry">Tentar novamente</button></section>`;
    const number = (n) => Number(n || 0).toLocaleString('pt-BR');
    const list = (rows, empty) => rows?.length ? rows.map((row) => `<li><span>${esc(row.name)}</span><strong>${number(row.count)}</strong></li>`).join('') : `<li class="admin__muted">${empty}</li>`;
    const history = (a.history || []).map((day) => ({ ...day, views: Math.max(0, Number(day.views) || 0) }));
    const max = Math.max(1, ...history.map((day) => day.views));
    const totalViews = history.reduce((sum, day) => sum + day.views, 0);
    const activeSeconds = Math.round(a.averageActiveSeconds || 0);
    return `<section class="traffic-hero">
      <div class="traffic-hero__copy"><span class="traffic-live"><span></span> AO VIVO</span><h3>O Kairou agora</h3><p>Sessões com atividade nos últimos 90 segundos.</p></div>
      <div class="traffic-hero__metric"><strong>${number(a.online)}</strong><span>sessões ativas</span></div>
    </section>
    <div class="traffic-metrics">
      <article><span>Visitantes hoje</span><strong>${number(a.visitors)}</strong><small>Navegadores distintos</small></article>
      <article><span>Sessões hoje</span><strong>${number(a.sessions)}</strong><small>Abas identificadas</small></article>
      <article><span>Visualizações hoje</span><strong>${number(a.views)}</strong><small>Entradas e mudanças de página</small></article>
      <article><span>Tempo médio ativo hoje</span><strong>${Math.floor(activeSeconds / 60)}min ${String(activeSeconds % 60).padStart(2, '0')}s</strong><small>Por visitante · estimativa a partir desta atualização</small></article>
    </div>
    <div class="traffic-grid">
      <section class="admin__panel traffic-chart">
        <div class="traffic-chart__header"><div><h3>Últimos 7 dias</h3><p>Visualizações por dia</p></div><div class="traffic-chart__total"><strong>${number(totalViews)}</strong><span>no período</span></div></div>
        ${history.length ? `<div class="traffic-bars" role="list" aria-label="Visualizações diárias nos últimos 7 dias">${history.map((day, index) => {
          const label = String(day.date || '').slice(8, 10) + '/' + String(day.date || '').slice(5, 7);
          return `<div class="traffic-bar${index === history.length - 1 ? ' traffic-bar--latest' : ''}" role="listitem" aria-label="${esc(label)}: ${number(day.views)} visualizações"><strong>${number(day.views)}</strong><div class="traffic-bar__track"><span style="height:${Math.round(day.views / max * 100)}%"></span></div><small>${esc(label)}</small></div>`;
        }).join('')}</div>` : '<p class="traffic-chart__empty">Os dados aparecerão conforme o site receber visitas.</p>'}
      </section>
      <section class="admin__panel"><div class="admin__panel-head"><h3>Onde estão agora</h3></div><ul class="traffic-list">${list(a.liveRoutes, 'Nenhuma sessão ativa.')}</ul></section>
      <section class="admin__panel"><div class="admin__panel-head"><h3>Páginas de hoje</h3></div><ul class="traffic-list">${list(a.routes, 'Ainda sem visualizações.')}</ul></section>
      <section class="admin__panel"><div class="admin__panel-head"><h3>Dispositivos hoje</h3></div><ul class="traffic-list">${list(Object.entries(a.devices || {}).map(([name, count]) => ({name: ({mobile:'Telefone',tablet:'Tablet',desktop:'Computador'})[name] || name,count})), 'Ainda sem sessões.')}</ul></section>
      <section class="admin__panel"><div class="admin__panel-head"><h3>Origens de hoje</h3></div><p class="admin__muted">Sessões por site de origem · dados coletados a partir desta atualização</p><ul class="traffic-list">${list(a.sources, 'Ainda sem origens registradas.')}</ul></section>
      <section class="admin__panel"><div class="admin__panel-head"><h3>Disponibilidade dos provedores</h3></div><p class="admin__muted">Consultas desde o último reinício · encontrar links não garante reprodução</p><ul class="traffic-list">${(a.providers || []).length ? a.providers.map((p) => `<li><span>${esc(p.name)}<br><small>${number(p.attempts)} consultas · ${number(p.errors)} erros reportados</small></span><strong>${Math.round(p.found / p.attempts * 100)}% · ${(p.averageMs / 1000).toFixed(1)} s</strong></li>`).join('') : '<li>Aguardando consultas aos provedores.</li>'}</ul></section>
    </div><div class="traffic-footer"><p class="traffic-note">Atualizado a cada 15 segundos · Dia em UTC · Bloqueadores, várias abas e perda de rede podem afetar os totais.</p><button type="button" class="admin__ghost" id="admin-traffic-export">Exportar 7 dias · CSV</button></div>`;
  }

  function exportTraffic() {
    const rows = [['Data (UTC)', 'Visitantes', 'Visualizações'], ...(state.analytics?.history || []).map((d) => [d.date, d.visitors, d.views])];
    const blob = new Blob(['\ufeff' + rows.map((row) => row.join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = 'kairou-visitantes.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ------------------------------ tab: vips ------------------------------- */
  function filteredCodes() {
    const list = state.data?.codes || [];
    const q = state.query.trim().toLowerCase();
    return list.filter((item) => {
      if (state.filter === "active" && !item.isActive) return false;
      if (state.filter === "expired" && (item.isActive || item.revoked)) return false;
      if (state.filter === "revoked" && !item.revoked) return false;
      if (!q) return true;
      return (
        (item.code || "").toLowerCase().includes(q) ||
        (item.donorName || "").toLowerCase().includes(q) ||
        (item.email || "").toLowerCase().includes(q) ||
        (item.plan || "").toLowerCase().includes(q)
      );
    });
  }

  function tabVips() {
    return `
    <section class="admin__panel admin__panel--amber">
      <div class="admin__panel-head">
        <h3><i class="fa-solid fa-user-plus"></i> Gerar assinatura manual</h3>
        <span class="admin__pill admin__pill--amber"><i class="fa-solid fa-bolt"></i> Liberação instantânea</span>
      </div>
      <form class="admin__form" id="admin-create-form">
        <label class="admin__field">
          <span>Nome do cliente</span>
          <input name="name" type="text" placeholder="Ex: Carlos Silva" />
        </label>
        <label class="admin__field">
          <span>E-mail (opcional)</span>
          <input name="email" type="email" placeholder="cliente@email.com" />
        </label>
        <label class="admin__field">
          <span>Plano</span>
          <select name="plan">
            <option value="mensal">Mensal · 30 dias</option>
            <option value="trimestral">Trimestral · 90 dias</option>
            <option value="anual">Anual · 365 dias</option>
            <option value="cortesia">Cortesia · 7 dias</option>
          </select>
        </label>
        <label class="admin__field">
          <span>Dias (personalizado)</span>
          <input name="days" type="number" min="1" max="3650" placeholder="opcional" />
        </label>
        <label class="admin__field admin__field--wide">
          <span>Observação (opcional)</span>
          <input name="note" type="text" placeholder="Ex: apoiador via Discord / sorteio" />
        </label>
        <button type="submit" class="btn btn--primary admin__submit"><i class="fa-solid fa-plus"></i> Gerar código</button>
      </form>
      <div class="admin__result" id="admin-create-result" hidden></div>
    </section>

    <section class="admin__panel">
      <div class="admin__panel-head admin__panel-head--split">
        <h3><i class="fa-solid fa-table-list"></i> Base de códigos <span class="admin__count" id="admin-code-count"></span></h3>
        <div class="admin__tools">
          <div class="admin__search">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="admin-search" placeholder="Buscar código, nome ou e-mail…" value="${esc(state.query)}" />
          </div>
          <select id="admin-filter" class="admin__select">
            <option value="all"${state.filter === "all" ? " selected" : ""}>Todos</option>
            <option value="active"${state.filter === "active" ? " selected" : ""}>Ativos</option>
            <option value="expired"${state.filter === "expired" ? " selected" : ""}>Expirados</option>
            <option value="revoked"${state.filter === "revoked" ? " selected" : ""}>Revogados</option>
          </select>
          <button class="admin__ghost" id="admin-batch-open"><i class="fa-solid fa-layer-group"></i> Lote</button>
          <button class="admin__ghost" id="admin-export"><i class="fa-solid fa-file-arrow-down"></i> CSV</button>
        </div>
      </div>
      <div class="admin__table-wrap" id="admin-codes-table"></div>
    </section>`;
  }

  function renderCodesTable() {
    const host = $("#admin-codes-table");
    if (!host) return;
    const list = filteredCodes();
    const countEl = $("#admin-code-count");
    if (countEl) countEl.textContent = `(${list.length})`;

    if (!list.length) {
      host.innerHTML = `<div class="admin__empty admin__empty--sm"><i class="fa-solid fa-folder-open"></i><p>Nenhum código com esse filtro.</p></div>`;
      return;
    }

    host.innerHTML = `
      <table class="admin__table">
        <thead><tr>
          <th>Código</th><th>Cliente</th><th>Plano</th><th>Validade</th><th>Status</th><th class="admin__th-actions">Ações</th>
        </tr></thead>
        <tbody>${list
          .map((item) => {
            const status = item.revoked
              ? `<span class="admin__status admin__status--revoked"><i class="fa-solid fa-ban"></i> Revogado</span>`
              : item.isActive
              ? `<span class="admin__status admin__status--active"><span class="admin__dot"></span> Ativo</span>`
              : `<span class="admin__status admin__status--expired"><i class="fa-solid fa-clock"></i> Expirado</span>`;
            const planTag = `<span class="admin__tag admin__tag--${item.plan === "anual" ? "amber" : item.plan === "trimestral" ? "violet" : item.plan === "cortesia" ? "purple" : "cyan"}">${esc(item.plan)}</span>`;
            return `
            <tr>
              <td data-label="Código"><div class="admin__code"><span>${esc(item.code)}</span><button class="admin__copy" data-copy="${esc(item.code)}" title="Copiar"><i class="fa-solid fa-copy"></i></button></div></td>
              <td data-label="Cliente"><div class="admin__who-cell"><strong>${esc(item.donorName || "Apoiador")}</strong>${item.email ? `<span>${esc(item.email)}</span>` : ""}</div></td>
              <td data-label="Plano">${planTag}</td>
              <td data-label="Validade"><div class="admin__expiry"><span>${date(item.expiresAt)}</span>${item.isActive ? `<em>${item.daysRemaining} dias</em>` : ""}</div></td>
              <td data-label="Status">${status}</td>
              <td data-label="Ações" class="admin__td-actions">
                <button class="admin__mini" data-extend="${esc(item.code)}" title="+30 dias">+30d</button>
                ${item.isActive && !item.revoked ? `<button class="admin__mini admin__mini--warn" data-revoke="${esc(item.code)}">Revogar</button>` : ""}
                <button class="admin__mini admin__mini--danger" data-del="${esc(item.code)}" title="Excluir"><i class="fa-solid fa-trash-can"></i></button>
              </td>
            </tr>`;
          })
          .join("")}</tbody>
      </table>`;
    bindTableActions();
  }

  function bindTableActions() {
    const host = $("#admin-codes-table");
    if (!host) return;
    host.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy)));
    host.querySelectorAll("[data-extend]").forEach((b) =>
      b.addEventListener("click", async () => {
        b.disabled = true;
        try {
          await api("admin-extend", { method: "POST", body: { code: b.dataset.extend, days: 30 } });
          toast(`+30 dias em ${b.dataset.extend}`);
          await load();
        } catch (e) {
          toast(e.message);
        }
      })
    );
    host.querySelectorAll("[data-revoke]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm(`Revogar ${b.dataset.revoke}? O cliente perde o acesso agora.`)) return;
        try {
          await api("admin-revoke", { method: "POST", body: { code: b.dataset.revoke } });
          toast("Código revogado");
          await load();
        } catch (e) {
          toast(e.message);
        }
      })
    );
    host.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm(`Excluir ${b.dataset.del} permanentemente?`)) return;
        try {
          await api("admin-delete", { method: "POST", body: { code: b.dataset.del } });
          toast("Código excluído");
          await load();
        } catch (e) {
          toast(e.message);
        }
      })
    );
  }

  /* ------------------------------ tab: pixgg ------------------------------ */
  function tabPixgg() {
    const txs = state.data?.transactions || [];
    const rows = txs.length
      ? txs
          .map(
            (t) => `
        <tr>
          <td data-label="Data" class="admin__muted">${dateTime(t.receivedAt || t.createdAt)}</td>
          <td data-label="Apoiador"><div class="admin__who-cell"><strong>${esc(t.senderName || "Apoiador")}</strong>${t.email ? `<span>${esc(t.email)}</span>` : ""}</div></td>
          <td data-label="Valor" class="admin__amount">${Number(t.amount) > 0 ? brl(t.amount) : "Manual"}</td>
          <td data-label="Plano"><span class="admin__tag admin__tag--${t.plan === "anual" ? "amber" : t.plan === "trimestral" ? "violet" : "cyan"}">${esc(t.plan)}</span></td>
          <td data-label="Código"><div class="admin__code"><span>${esc(t.generatedCode || "—")}</span>${t.generatedCode ? `<button class="admin__copy" data-copy="${esc(t.generatedCode)}"><i class="fa-solid fa-copy"></i></button>` : ""}</div></td>
          <td data-label="Status">${t.isActive ? `<span class="admin__status admin__status--active"><span class="admin__dot"></span> Vigente</span>` : `<span class="admin__status admin__status--expired">Finalizado</span>`}</td>
        </tr>`
          )
          .join("")
      : `<tr><td colspan="6"><div class="admin__empty admin__empty--sm"><i class="fa-solid fa-receipt"></i><p>Nenhuma transação PixGG registrada.</p></div></td></tr>`;

    return `
    <section class="admin__panel admin__panel--pixgg">
      <div class="admin__panel-head admin__panel-head--split">
        <h3><i class="fa-solid fa-bolt"></i> Transações recebidas via PixGG</h3>
        <button class="admin__ghost admin__ghost--violet" id="admin-sim-open"><i class="fa-solid fa-flask"></i> Simular pagamento</button>
      </div>
      <div class="admin__table-wrap">
        <table class="admin__table">
          <thead><tr><th>Data</th><th>Apoiador</th><th>Valor</th><th>Plano</th><th>Código</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
  }

  /* ---------------------------- tab: broadcast ---------------------------- */
  function tabBroadcast() {
    const a = state.data?.announcement || {};
    return `
    <section class="admin__panel">
      <div class="admin__panel-head admin__panel-head--split">
        <h3><i class="fa-solid fa-bell"></i> Aviso global do site</h3>
        <span class="admin__pill ${a.active ? "admin__pill--emerald" : ""}">${a.active ? "Banner ativo" : "Desativado"}</span>
      </div>
      <form class="admin__form admin__form--stack" id="admin-ann-form">
        <label class="admin__switch">
          <input type="checkbox" name="active" ${a.active ? "checked" : ""} />
          <span class="admin__switch-track"><span></span></span>
          <span>Exibir banner para todos os visitantes</span>
        </label>
        <div class="admin__field-group">
          <span class="admin__group-label">Estilo</span>
          <div class="admin__types">
            ${[
              ["info", "Informativo", "cyan"],
              ["alert", "Alerta", "amber"],
              ["vip", "Promoção VIP", "violet"],
              ["success", "Novidade", "emerald"]
            ]
              .map(
                (t) =>
                  `<label class="admin__type admin__type--${t[2]}"><input type="radio" name="type" value="${t[0]}" ${(a.type || "info") === t[0] ? "checked" : ""}/><span>${t[1]}</span></label>`
              )
              .join("")}
          </div>
        </div>
        <label class="admin__field">
          <span>Mensagem</span>
          <textarea name="message" rows="3" placeholder="Ex: Estreias da semana já disponíveis em 4K!">${esc(a.message || "")}</textarea>
        </label>
        <div class="admin__field-row">
          <label class="admin__field"><span>Link (opcional)</span><input name="link" type="text" value="${esc(a.link || "")}" placeholder="/discover" /></label>
          <label class="admin__field"><span>Texto do botão</span><input name="linkText" type="text" value="${esc(a.linkText || "")}" placeholder="Ver agora" /></label>
        </div>
        <div class="admin__preview-label">Pré-visualização</div>
        <div class="admin__preview" id="admin-ann-preview"></div>
        <button type="submit" class="btn btn--primary admin__submit"><i class="fa-solid fa-check"></i> Salvar e publicar</button>
      </form>
    </section>`;
  }

  function paintAnnPreview() {
    const form = $("#admin-ann-form");
    const host = $("#admin-ann-preview");
    if (!form || !host) return;
    const type = form.querySelector('input[name="type"]:checked')?.value || "info";
    const message = form.querySelector('[name="message"]').value.trim() || "Escreva uma mensagem para ver aqui…";
    const linkText = form.querySelector('[name="linkText"]').value.trim();
    host.className = `admin__preview admin__preview--${type}`;
    host.innerHTML = `<span><i class="fa-solid fa-bullhorn"></i> ${esc(message)}</span>${linkText ? `<em>${esc(linkText)}</em>` : ""}`;
  }

  /* ---------------------------- tab: urgent ------------------------------- */
  function renderUrgentItemRow(icon = "check", text = "") {
    const icons = [
      { val: "check", label: "✓ Check" },
      { val: "4k", label: "4K Selo" },
      { val: "ad", label: "🔇 Sem anúncios" },
      { val: "bolt", label: "⚡ Raio (Rápido)" },
      { val: "star", label: "★ Estrela (Destaque)" },
      { val: "bell", label: "🔔 Notificação" },
      { val: "info", label: "ℹ Informativo" }
    ];
    return `
    <div class="urgent-item-row" style="display:flex;gap:8px;align-items:center;">
      <select class="admin__select urgent-item-icon" style="width:145px;min-height:38px;">
        ${icons.map((ic) => `<option value="${ic.val}" ${ic.val === icon ? "selected" : ""}>${ic.label}</option>`).join("")}
      </select>
      <input type="text" class="urgent-item-text" value="${esc(text)}" placeholder="Ex: All issues are fixed" style="flex:1;min-height:38px;padding:0 12px;border:1px solid rgba(255,255,255,0.1);background:#0b1019;border-radius:10px;color:#fff;font-size:13px;" />
      <button type="button" class="admin__ghost urgent-item-remove" style="min-height:38px;padding:0 12px;color:#f87171;" title="Remover item">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`;
  }

  function tabUrgent() {
    let localSaved = null;
    try {
      const raw = localStorage.getItem("kairou_urgent_announcement");
      if (raw) localSaved = JSON.parse(raw);
    } catch {}

    const u = state.data?.urgentAnnouncement || localSaved || {
      id: `urgent_${Date.now()}`,
      active: true,
      title: "Boas notícias!",
      imageUrl: "/urgent-banner.gif",
      items: [
        { icon: "check", text: "Problemas resolvidos" },
        { icon: "4k", text: "Transmissão rápida sem travamentos" },
        { icon: "ad", text: "Anúncios desativados temporariamente" }
      ],
      buttonText: "Entendido"
    };

    const items = Array.isArray(u.items) && u.items.length ? u.items : [
      { icon: "check", text: "Problemas resolvidos" },
      { icon: "4k", text: "Transmissão rápida sem travamentos" },
      { icon: "ad", text: "Anúncios desativados temporariamente" }
    ];

    const itemsHtml = items.map((it) => renderUrgentItemRow(it.icon, it.text)).join("");

    return `
    <section class="admin__panel">
      <div class="admin__panel-head admin__panel-head--split">
        <h3><i class="fa-solid fa-triangle-exclamation"></i> Aviso urgente (Popup Central / Mobile)</h3>
        <span class="admin__pill ${u.active ? "admin__pill--emerald" : ""}">${u.active ? "Ativo no site" : "Desativado"}</span>
      </div>
      <div class="urgent-help-box">
        <i class="fa-solid fa-circle-info"></i>
        <span>
          Este aviso é exibido com alto impacto visual (modal com brilho roxo e animação no botão).
          Quando um usuário clica em <strong>"Entendido"</strong> ou <strong>"X"</strong>, ele é gravado como visto no navegador e não reaparece.
          Para que todos os visitantes vejam o aviso novamente (mesmo os que já fecharam), clique em <strong>"Gerar nova versão"</strong>.
        </span>
      </div>
      <form class="admin__form admin__form--stack" id="admin-urgent-form">
        <label class="admin__switch">
          <input type="checkbox" name="active" ${u.active ? "checked" : ""} />
          <span class="admin__switch-track"><span></span></span>
          <span>Exibir aviso urgente ao abrir o site</span>
        </label>

        <div class="admin__field-row">
          <label class="admin__field" style="flex:1;">
            <span>ID da versão atual</span>
            <input name="id" id="admin-urgent-id" type="text" value="${esc(u.id || `urgent_${Date.now()}`)}" readonly style="color:#94a3b8;font-family:monospace;" />
          </label>
          <button type="button" class="admin__ghost admin__ghost--violet" id="admin-urgent-new-id" style="align-self:flex-end;margin-bottom:2px;min-height:44px;" title="Gera um novo ID para forçar a reexibição a todos os usuários">
            <i class="fa-solid fa-rotate"></i> Gerar nova versão
          </button>
        </div>

        <div class="admin__field-row">
          <label class="admin__field" style="flex:2;">
            <span>Título do aviso</span>
            <input name="title" type="text" value="${esc(u.title || "Good news!")}" placeholder="Ex: Good news!" required />
          </label>
          <label class="admin__field" style="flex:1;">
            <span>Texto do botão</span>
            <input name="buttonText" type="text" value="${esc(u.buttonText || "Entendido")}" placeholder="Ex: Entendido" required />
          </label>
        </div>

        <label class="admin__field">
          <span>URL da imagem de capa (topo)</span>
          <input name="imageUrl" type="text" value="${esc(u.imageUrl || "/urgent-banner.gif")}" placeholder="/urgent-banner.gif ou https://..." />
        </label>

        <div class="admin__field-group">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <span class="admin__group-label" style="font-weight:600;">Tópicos / Funcionalidades anunciadas</span>
            <button type="button" class="admin__ghost admin__ghost--cyan" id="admin-urgent-add-item" style="min-height:32px;padding:4px 10px;font-size:12px;">
              <i class="fa-solid fa-plus"></i> Adicionar tópico
            </button>
          </div>
          <div id="admin-urgent-items-list" style="display:flex;flex-direction:column;gap:8px;">
            ${itemsHtml}
          </div>
        </div>

        <div class="admin__preview-label">Pré-visualização ao vivo</div>
        <div class="urgent-preview-wrapper">
          <div class="urgent-preview-glow"></div>
          <div id="admin-urgent-preview" class="urgent-preview-container"></div>
        </div>

        <button type="submit" class="btn btn--primary admin__submit"><i class="fa-solid fa-check"></i> Salvar e publicar</button>
      </form>
    </section>`;
  }

  function paintUrgentPreview() {
    const form = $("#admin-urgent-form");
    const host = $("#admin-urgent-preview");
    if (!form || !host) return;

    const title = form.querySelector('[name="title"]')?.value.trim() || "Good news!";
    const buttonText = form.querySelector('[name="buttonText"]')?.value.trim() || "Entendido";
    const imageUrl = form.querySelector('[name="imageUrl"]')?.value.trim() || "/urgent-banner.gif";

    const rows = [...form.querySelectorAll(".urgent-item-row")];
    const items = rows.map((r) => ({
      icon: r.querySelector(".urgent-item-icon")?.value || "check",
      text: r.querySelector(".urgent-item-text")?.value.trim() || ""
    })).filter((it) => it.text.length > 0);

    const iconBadge = (ic) => {
      switch (ic) {
        case "check": return '<i class="fa-solid fa-check" style="font-size:10px;color:#fff;"></i>';
        case "4k": return '<span style="font-size:9px;font-weight:900;color:#fff;">4K</span>';
        case "ad": return '<i class="fa-solid fa-volume-xmark" style="font-size:10px;color:#fff;"></i>';
        case "bolt": return '<i class="fa-solid fa-bolt" style="font-size:10px;color:#fde047;"></i>';
        case "star": return '<i class="fa-solid fa-star" style="font-size:10px;color:#fde047;"></i>';
        case "bell": return '<i class="fa-solid fa-bell" style="font-size:10px;color:#7dd3fc;"></i>';
        default: return '<i class="fa-solid fa-circle-info" style="font-size:10px;color:#fff;"></i>';
      }
    };

    host.innerHTML = `
      <div class="urgent-sim-card">
        <div class="urgent-sim-banner">
          <img src="${esc(imageUrl)}" alt="" onerror="this.src='https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=800&q=80'" />
          <div class="urgent-sim-gradient"></div>
          <div class="urgent-sim-close"><i class="fa-solid fa-xmark"></i></div>
        </div>
        <div class="urgent-sim-body">
          <h4 class="urgent-sim-title">${esc(title)}</h4>
          <div class="urgent-sim-items">
            ${(items.length ? items : [{ icon: "check", text: "Exemplo de novidade ou correção" }]).map((it) => `
              <div class="urgent-sim-item">
                <span class="urgent-sim-icon">${iconBadge(it.icon)}</span>
                <span class="urgent-sim-text">${esc(it.text)}</span>
              </div>
            `).join("")}
          </div>
          <div class="urgent-sim-btn-wrap">
            <button type="button" class="urgent-sim-btn">${esc(buttonText)}</button>
          </div>
        </div>
      </div>
    `;
  }

  /* ----------------------------- tab: system ------------------------------ */
  function tabSystem() {
    const stats = state.data?.stats || {};
    const uptime = stats.uptimeSeconds || 0;
    const h = Math.floor(uptime / 3600);
    const m = Math.floor((uptime % 3600) / 60);
    return `
    <div class="admin__grid2">
      <section class="admin__panel">
        <div class="admin__panel-head"><h3><i class="fa-solid fa-broom"></i> Dados locais</h3></div>
        <p class="admin__muted">Limpa os dados de streaming guardados neste navegador.</p>
        <button class="admin__ghost admin__ghost--cyan admin__ghost--block" id="admin-clear-cache"><i class="fa-solid fa-rotate-left"></i> Limpar dados locais</button>
      </section>
      <section class="admin__panel">
        <div class="admin__panel-head"><h3><i class="fa-solid fa-network-wired"></i> Serviços</h3></div>
        <ul class="admin__services">
          ${[
            ["PocketBase", "banco de dados · auth · vip", "não verificado"],
            ["Node API", "VIP · TMDB · PixGG", "respondendo"],
            ["PixGG webhook", "/api/vip/webhook", "não verificado"]
          ]
            .map(
              (s) => `
            <li>
              <span class="admin__dot"></span>
              <div><strong>${s[0]}</strong><span>${s[1]}</span></div>
              <em>${s[2]}</em>
            </li>`
            )
            .join("")}
        </ul>
        <div class="admin__uptime"><span>Uptime da API</span><strong>${h}h ${m}min</strong></div>
      </section>
    </div>
    <section class="admin__panel">
      <div class="admin__panel-head"><h3><i class="fa-solid fa-terminal"></i> Últimos webhooks</h3></div>
      <pre class="admin__log">${esc(JSON.stringify((state.data?.logs || []).slice(0, 6), null, 2)) || "Sem registros."}</pre>
    </section>`;
  }

  /* ------------------------------- body ----------------------------------- */
  function renderBody() {
    const body = $("#admin-body");
    if (!body || !state.data) return;
    body.innerHTML = `
      ${tabs()}
      ${['vips', 'pixgg'].includes(state.tab) ? kpis(state.data.stats || {}) : ''}
      <div class="admin__tabbody" id="admin-tabbody"></div>`;
    renderTab();
    bindStatic();
  }

  function renderTab() {
    const host = $("#admin-tabbody");
    if (!host) return;
    if (state.tab === "traffic") {
      host.innerHTML = tabTraffic();
      $("#admin-traffic-retry")?.addEventListener("click", () => loadAnalytics(true));
      $("#admin-traffic-export")?.addEventListener("click", exportTraffic);
    } else if (state.tab === "vips") {
      host.innerHTML = tabVips();
      renderCodesTable();
      bindCreateForm();
      bindVipsTools();
    } else if (state.tab === "pixgg") {
      host.innerHTML = tabPixgg();
      host.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copy(b.dataset.copy)));
      $("#admin-sim-open")?.addEventListener("click", openSimModal);
    } else if (state.tab === "broadcast") {
      host.innerHTML = tabBroadcast();
      bindAnnouncement();
    } else if (state.tab === "urgent") {
      host.innerHTML = tabUrgent();
      bindUrgentAnnouncement();
    } else if (state.tab === "system") {
      host.innerHTML = tabSystem();
      $("#admin-clear-cache")?.addEventListener("click", () => {
        try {
          sessionStorage.removeItem("kairou.stream.cache");
          localStorage.removeItem("kairou.recent.v1");
        } catch {}
        toast("Dados locais de streaming limpos");
      });
    }
  }

  function bindStatic() {
    $$("[data-admin-tab]").forEach((btn) =>
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.adminTab;
        renderBody();
      })
    );
    const refresh = $("#admin-refresh");
    if (refresh) refresh.onclick = load;
  }

  function bindVipsTools() {
    const search = $("#admin-search");
    let t;
    search?.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => {
        state.query = search.value;
        renderCodesTable();
      }, 220);
    });
    $("#admin-filter")?.addEventListener("change", (e) => {
      state.filter = e.target.value;
      renderCodesTable();
    });
    $("#admin-batch-open")?.addEventListener("click", openBatchModal);
    $("#admin-export")?.addEventListener("click", exportCsv);
  }

  /* ---------------------------- criar / lote ------------------------------ */
  function bindCreateForm() {
    const form = $("#admin-create-form");
    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const result = await api("admin-create", {
          method: "POST",
          body: {
            name: fd.get("name"),
            email: fd.get("email"),
            plan: fd.get("plan"),
            days: fd.get("days") || undefined,
            note: fd.get("note")
          }
        });
        const box = $("#admin-create-result");
        if (box) {
          box.hidden = false;
          box.innerHTML = `
            <div class="admin__created">
              <div>
                <span class="admin__created-label"><i class="fa-solid fa-circle-check"></i> Código gerado</span>
                <strong class="admin__created-code">${esc(result.code)}</strong>
                <small>${esc(result.donorName || "Apoiador")} · ${result.days} dias · até ${date(result.expiresAt)}${result.grantedUser ? " · VIP aplicado ao e-mail" : ""}</small>
              </div>
              <button class="admin__ghost admin__ghost--cyan" data-copy="${esc(result.code)}"><i class="fa-solid fa-copy"></i> Copiar</button>
            </div>`;
          box.querySelector("[data-copy]")?.addEventListener("click", () => copy(result.code));
        }
        form.reset();
        toast("Código gerado!");
        state.data = await api("admin-data");
        renderBody();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  function openBatchModal() {
    const shell = $("#admin-panel .admin__shell");
    const modal = document.createElement("div");
    modal.className = "admin__modal";
    modal.innerHTML = `
      <div class="admin__modal-card">
        <div class="admin__modal-head">
          <h3><i class="fa-solid fa-layer-group"></i> Gerar códigos em lote</h3>
          <button class="admin__iconbtn" data-close-modal><i class="fa-solid fa-xmark"></i></button>
        </div>
        <form class="admin__form admin__form--stack" id="admin-batch-form">
          <div class="admin__field-row">
            <label class="admin__field"><span>Quantidade</span>
              <select name="count"><option>5</option><option selected>10</option><option>25</option><option>50</option><option>100</option></select>
            </label>
            <label class="admin__field"><span>Plano</span>
              <select name="plan"><option value="mensal">Mensal</option><option value="trimestral">Trimestral</option><option value="anual">Anual</option><option value="cortesia">Cortesia</option></select>
            </label>
          </div>
          <div class="admin__field-row">
            <label class="admin__field"><span>Prefixo</span><input name="prefix" value="PROMO" maxlength="6" /></label>
            <label class="admin__field"><span>Dias</span><input name="days" type="number" placeholder="padrão do plano" /></label>
          </div>
          <label class="admin__field"><span>Identificador do lote</span><input name="note" placeholder="Ex: Campanha de Natal" /></label>
          <button type="submit" class="btn btn--primary admin__submit"><i class="fa-solid fa-layer-group"></i> Gerar agora</button>
        </form>
        <div class="admin__result" id="admin-batch-result" hidden></div>
      </div>`;
    shell.appendChild(modal);
    const remove = () => modal.remove();
    modal.querySelector("[data-close-modal]").addEventListener("click", remove);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) remove();
    });

    modal.querySelector("#admin-batch-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const res = await api("admin-batch-create", {
          method: "POST",
          body: {
            count: fd.get("count"),
            plan: fd.get("plan"),
            prefix: fd.get("prefix"),
            days: fd.get("days") || undefined,
            note: fd.get("note")
          }
        });
        const box = modal.querySelector("#admin-batch-result");
        box.hidden = false;
        box.innerHTML = `
          <div class="admin__created-label"><i class="fa-solid fa-circle-check"></i> ${res.count} códigos gerados</div>
          <div class="admin__batch-list">${res.codes.map((c) => `<code>${esc(c.code)}</code>`).join("")}</div>
          <div class="admin__modal-actions">
            <button class="admin__ghost admin__ghost--cyan" id="copy-all"><i class="fa-solid fa-copy"></i> Copiar todos</button>
          </div>`;
        box.querySelector("#copy-all").addEventListener("click", () =>
          copy(res.codes.map((c) => c.code).join("\n"), "Todos os códigos copiados!")
        );
        state.data = await api("admin-data");
        renderBody();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ------------------------------- simular -------------------------------- */
  function openSimModal() {
    const shell = $("#admin-panel .admin__shell");
    const modal = document.createElement("div");
    modal.className = "admin__modal";
    modal.innerHTML = `
      <div class="admin__modal-card">
        <div class="admin__modal-head">
          <h3><i class="fa-solid fa-flask"></i> Simular pagamento PixGG</h3>
          <button class="admin__iconbtn" data-close-modal><i class="fa-solid fa-xmark"></i></button>
        </div>
        <form class="admin__form admin__form--stack" id="admin-sim-form">
          <div class="admin__field-row">
            <label class="admin__field"><span>Valor do Pix</span>
              <select name="amount"><option value="9.99">R$ 9,99 · mensal</option><option value="24.90" selected>R$ 24,90 · trimestral</option><option value="79.90">R$ 79,90 · anual</option></select>
            </label>
            <label class="admin__field"><span>Nome do apoiador</span><input name="donorName" placeholder="Ex: marcos" /></label>
          </div>
          <label class="admin__field"><span>E-mail (para aplicar VIP a um usuário)</span><input name="email" type="email" placeholder="cliente@email.com" /></label>
          <label class="admin__field"><span>Mensagem</span><input name="message" value="Assinatura via PixGG (simulação)" /></label>
          <button type="submit" class="btn btn--primary admin__submit"><i class="fa-solid fa-bolt"></i> Disparar webhook</button>
        </form>
        <div class="admin__result" id="admin-sim-result" hidden></div>
      </div>`;
    shell.appendChild(modal);
    const remove = () => modal.remove();
    modal.querySelector("[data-close-modal]").addEventListener("click", remove);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) remove();
    });

    modal.querySelector("#admin-sim-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const btn = e.target.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        const res = await api("admin-simulate-pixgg", {
          method: "POST",
          body: {
            amount: fd.get("amount"),
            donorName: fd.get("donorName"),
            email: fd.get("email"),
            message: fd.get("message")
          }
        });
        const box = modal.querySelector("#admin-sim-result");
        box.hidden = false;
        box.innerHTML = `
          <div class="admin__created">
            <div>
              <span class="admin__created-label"><i class="fa-solid fa-circle-check"></i> Webhook processado · ${esc(String(res.plan || "").toUpperCase())}</span>
              <strong class="admin__created-code">${esc(res.code)}</strong>
              <small>${esc(res.senderName || "Apoiador")}${res.grantedUser ? " · VIP aplicado ao usuário" : " · sem e-mail de usuário"}</small>
            </div>
            <button class="admin__ghost admin__ghost--cyan" data-copy="${esc(res.code)}"><i class="fa-solid fa-copy"></i> Copiar</button>
          </div>`;
        box.querySelector("[data-copy]").addEventListener("click", () => copy(res.code));
        state.data = await api("admin-data");
        renderBody();
      } catch (err) {
        toast(err.message);
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* ----------------------------- anuncio ---------------------------------- */
  function bindAnnouncement() {
    const form = $("#admin-ann-form");
    if (!form) return;
    paintAnnPreview();
    form.addEventListener("input", paintAnnPreview);
    form.addEventListener("change", paintAnnPreview);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;
      try {
        await api("admin-announcement", {
          method: "POST",
          body: {
            active: fd.get("active") === "on",
            type: fd.get("type"),
            message: fd.get("message"),
            link: fd.get("link"),
            linkText: fd.get("linkText")
          }
        });
        toast("Aviso global salvo e publicado com sucesso!", "success");
        state.data = await api("admin-data");
        renderBody();
      } catch (err) {
        toast(`Erro ao salvar: ${err.message}`, "error");
      } finally {
        btn.disabled = false;
      }
    });
  }

  /* -------------------------- aviso urgente ------------------------------- */
  function bindUrgentAnnouncement() {
    const form = $("#admin-urgent-form");
    if (!form) return;

    paintUrgentPreview();
    form.addEventListener("input", paintUrgentPreview);
    form.addEventListener("change", paintUrgentPreview);

    $("#admin-urgent-new-id")?.addEventListener("click", () => {
      const idInput = $("#admin-urgent-id");
      if (idInput) {
        idInput.value = `urgent_${Date.now()}`;
        toast("Novo ID de versão gerado! Salve para reexibir a todos os usuários.", "info");
      }
    });

    $("#admin-urgent-add-item")?.addEventListener("click", () => {
      const list = $("#admin-urgent-items-list");
      if (!list) return;
      const dummy = document.createElement("div");
      dummy.innerHTML = renderUrgentItemRow("check", "");
      const newRow = dummy.firstElementChild;
      list.appendChild(newRow);
      newRow.querySelector(".urgent-item-remove")?.addEventListener("click", () => {
        newRow.remove();
        paintUrgentPreview();
      });
      newRow.addEventListener("input", paintUrgentPreview);
      paintUrgentPreview();
    });

    form.querySelectorAll(".urgent-item-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.currentTarget.closest(".urgent-item-row")?.remove();
        paintUrgentPreview();
      });
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      btn.disabled = true;

      const rows = [...form.querySelectorAll(".urgent-item-row")];
      const items = rows.map((r) => ({
        icon: r.querySelector(".urgent-item-icon")?.value || "check",
        text: r.querySelector(".urgent-item-text")?.value.trim() || ""
      })).filter((it) => it.text.length > 0);

      const urgentData = {
        id: form.querySelector("#admin-urgent-id")?.value.trim() || `urgent_${Date.now()}`,
        active: form.querySelector('input[name="active"]')?.checked ?? true,
        title: form.querySelector('input[name="title"]')?.value.trim() || "Boas notícias!",
        buttonText: form.querySelector('input[name="buttonText"]')?.value.trim() || "Entendido",
        imageUrl: form.querySelector('input[name="imageUrl"]')?.value.trim() || "/urgent-banner.gif",
        items,
        updatedAt: new Date().toISOString()
      };

      // 1. Persist to server backend (Normal production storage for all visitors)
      let savedOnServer = false;
      try {
        await api("admin-urgent-announcement", {
          method: "POST",
          body: urgentData
        });
        savedOnServer = true;
      } catch (err) {
        try {
          const resp = await fetch("/api/vip/urgent-announcement", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(urgentData)
          });
          if (resp.ok) savedOnServer = true;
        } catch {
          // ignore
        }
      }

      // 2. Also save to local storage cache & broadcast live updates
      try {
        localStorage.setItem("kairou_urgent_announcement", JSON.stringify(urgentData));
        if (urgentData.active) {
          localStorage.removeItem("kairou_dismissed_urgent_id");
        }
        window.dispatchEvent(new CustomEvent("kairou:urgent-updated", { detail: urgentData }));
      } catch (err) {
        console.warn("Local storage save error:", err);
      }

      if (!state.data) state.data = {};
      state.data.urgentAnnouncement = urgentData;

      toast(savedOnServer ? "Aviso urgente salvo e publicado com sucesso no servidor!" : "Aviso urgente salvo e publicado com sucesso!", "success");
      btn.disabled = false;

      // Automatically close admin panel after a brief moment so the user sees the popup immediately!
      setTimeout(() => {
        close();
      }, 600);
    });
  }

  /* ------------------------------ utilitários ----------------------------- */
  function copy(text, message) {
    const done = () => {
      state.copied = text;
      toast(message || "Copiado!");
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(done);
    else {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch {}
      ta.remove();
      done();
    }
  }

  function exportCsv() {
    const list = state.data?.codes || [];
    if (!list.length) return toast("Nada para exportar");
    const head = ["Codigo", "Cliente", "Email", "Plano", "Validade", "Status", "Nota"];
    const rows = list.map((i) => [
      i.code,
      i.donorName || "",
      i.email || "",
      i.plan,
      new Date(i.expiresAt).toLocaleDateString("pt-BR"),
      i.revoked ? "Revogado" : i.isActive ? "Ativo" : "Expirado",
      i.note || ""
    ]);
    const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `kairou-vips-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast("CSV exportado");
  }

  window.KairouAdmin = { open, close, reload: load };
})();
