(() => {
  const state = { month: '', months: 6, rows: [], categories: [], residentRows: [], loading: false, lastBranchId: null };
  const byId = id => document.getElementById(id);
  const allowed = () => currentUserRole === 'admin' || currentUserRole === 'super_admin';
  const money = value => new Intl.NumberFormat('en-MY', { style: 'currency', currency: 'MYR' }).format(Number(value || 0)).replace('MYR', 'RM');
  const monthLabel = month => new Date(`${month}-01T00:00:00`).toLocaleDateString('en-MY', { month: 'short', year: 'numeric' });
  const branchName = () => typeof getActiveBranchName === 'function' ? getActiveBranchName() : 'Branch';
  const billingPeriodLabel = month => {
    const cycle = getBillingCycle(month);
    return cycle ? `${formatShortDate(cycle.startDate)} – ${formatShortDate(cycle.endDate)}` : '-';
  };

  function shiftMonth(month, offset) {
    const [year, value] = month.split('-').map(Number);
    const date = new Date(Date.UTC(year, value - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function analyticsMonthRange(endMonth, count) {
    return Array.from({ length: count }, (_, index) => shiftMonth(endMonth, index - count + 1));
  }

  function aggregateAnalytics(months, residentsList, entries, recurringRows, itemsList, cycles) {
    const itemMap = new Map(itemsList.map(item => [item.id, item]));
    const cycleMap = new Map(cycles.map(row => [`${row.resident_id}:${row.billing_month}`, !!row.is_locked]));
    const monthRows = months.map(month => ({ month, usage: 0, recurring: 0, total: 0 }));
    const monthMap = new Map(monthRows.map(row => [row.month, row]));
    const categoryMap = new Map();
    const residentMonthMap = new Map();

    const addResidentAmount = (residentId, month, key, amount) => {
      const mapKey = `${residentId}:${month}`;
      const row = residentMonthMap.get(mapKey) || { residentId, month, usage: 0, recurring: 0, total: 0, locked: cycleMap.get(mapKey) === true };
      row[key] += amount;
      row.total = row.usage + row.recurring;
      residentMonthMap.set(mapKey, row);
    };
    const addCategory = (name, amount) => categoryMap.set(name, (categoryMap.get(name) || 0) + amount);

    entries.forEach(entry => {
      const month = months.find(key => {
        const cycle = getBillingCycle(key);
        return cycle && entry.charge_date >= cycle.start && entry.charge_date <= cycle.end;
      });
      if (!month) return;
      const amount = Number(entry.quantity || 0) * Number(entry.unit_price || 0);
      const monthRow = monthMap.get(month);
      monthRow.usage += amount;
      monthRow.total += amount;
      addResidentAmount(entry.resident_id, month, 'usage', amount);
      addCategory(itemMap.get(entry.item_id)?.category || 'Other Usage', amount);
    });

    recurringRows.forEach(charge => {
      months.forEach(month => {
        const amount = Number(getRecurringAmountForMonth(charge, month) || 0);
        if (!amount) return;
        const monthRow = monthMap.get(month);
        monthRow.recurring += amount;
        monthRow.total += amount;
        addResidentAmount(charge.resident_id, month, 'recurring', amount);
        addCategory(itemMap.get(charge.item_id)?.category || 'Recurring Charges', amount);
      });
    });

    const categories = [...categoryMap.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);
    const residentRows = residentsList.flatMap(resident => months.map(month => {
      const key = `${resident.id}:${month}`;
      return residentMonthMap.get(key) || { residentId: resident.id, month, usage: 0, recurring: 0, total: 0, locked: cycleMap.get(key) === true };
    }));
    return { monthRows, categories, residentRows };
  }

  function ensureUI() {
    if (byId('managementAnalyticsTab')) return;
    const tabs = document.querySelector('.wrap > .tabs');
    const main = document.querySelector('main.wrap');
    if (!tabs || !main) return;

    const button = document.createElement('button');
    button.id = 'managementAnalyticsNavBtn';
    button.type = 'button';
    button.className = 'btn tab admin-only hidden';
    button.dataset.tab = 'managementAnalytics';
    button.textContent = 'Management Analytics';
    const recurringButton = tabs.querySelector('[data-tab="recurring"]');
    tabs.insertBefore(button, recurringButton || null);

    const section = document.createElement('section');
    section.id = 'managementAnalyticsTab';
    section.className = 'hidden';
    section.innerHTML = `
      <div class="page-heading analytics-heading"><div class="page-heading-copy">
        <div class="page-heading-kicker">Management Reporting</div>
        <h1>Management Analytics</h1>
        <p>Review billing trends, category spending and resident charge history without changing billing data.</p>
      </div></div>
      <div class="card analytics-toolbar">
        <div class="tfield"><label>Ending Billing Cycle</label><input id="analyticsMonth" type="month"></div>
        <div class="tfield"><label>Trend Period</label><select id="analyticsRange"><option value="6">Last 6 cycles</option><option value="12">Last 12 cycles</option></select></div>
        <button id="analyticsRefreshBtn" class="btn btn-primary" type="button">Refresh Analytics</button>
      </div>
      <div id="analyticsLoading" class="card analytics-loading hidden">Loading management analytics…</div>
      <div class="analytics-kpis">
        <div class="card analytics-kpi"><span>Total Charges</span><strong id="analyticsTotal">RM 0.00</strong><small id="analyticsPeriodLabel">Selected period</small></div>
        <div class="card analytics-kpi"><span>Usage Charges</span><strong id="analyticsUsage">RM 0.00</strong><small>Stock and daily usage</small></div>
        <div class="card analytics-kpi"><span>Recurring Charges</span><strong id="analyticsRecurring">RM 0.00</strong><small>Packages, services and rentals</small></div>
        <div class="card analytics-kpi"><span>Average per Cycle</span><strong id="analyticsAverage">RM 0.00</strong><small id="analyticsCycleCount">0 billing cycles</small></div>
      </div>
      <div class="analytics-grid">
        <div class="card analytics-panel analytics-trend-panel"><div class="analytics-panel-head"><div><h3>Monthly Charge Trend</h3><p>Usage and recurring totals by billing cycle.</p></div><div class="analytics-legend"><span><i class="usage"></i>Usage</span><span><i class="recurring"></i>Recurring</span></div></div><div id="analyticsTrendChart" class="analytics-chart"></div></div>
        <div class="card analytics-panel"><div class="analytics-panel-head"><div><h3>Category Spending</h3><p id="analyticsCategoryMeta">Selected period.</p></div></div><div id="analyticsCategoryChart" class="analytics-category-list"></div></div>
      </div>
      <div class="card analytics-panel analytics-history-panel">
        <div class="analytics-panel-head analytics-history-head"><div><h3>Resident Charge History</h3><p>Compare usage, recurring and total charges across billing cycles.</p></div><div class="tfield"><label>Resident</label><select id="analyticsResident"></select></div></div>
        <div class="table-wrap"><table class="analytics-table"><thead><tr><th>Billing Cycle</th><th class="num">Usage</th><th class="num">Recurring</th><th class="num">Total</th><th>Status</th></tr></thead><tbody id="analyticsResidentBody"></tbody><tfoot id="analyticsResidentFoot"></tfoot></table></div>
        <div id="analyticsEmpty" class="analytics-empty hidden">No billing data is available for this selection.</div>
      </div>`;
    main.appendChild(section);

    const initialMonth = byId('monthPicker')?.value || todayMonth();
    state.month = initialMonth;
    byId('analyticsMonth').value = initialMonth;
    button.addEventListener('click', openTab);
    byId('analyticsRefreshBtn').addEventListener('click', loadAnalytics);
    byId('analyticsMonth').addEventListener('change', loadAnalytics);
    byId('analyticsRange').addEventListener('change', loadAnalytics);
    byId('analyticsResident').addEventListener('change', renderResidentHistory);

    document.querySelectorAll('.wrap > .tabs .tab').forEach(tab => {
      if (tab === button) return;
      tab.addEventListener('click', () => { section.classList.add('hidden'); button.classList.remove('active'); });
    });
    const roleNode = byId('userRole');
    if (roleNode) new MutationObserver(syncVisibility).observe(roleNode, { childList: true, subtree: true, characterData: true });
    const branchNode = byId('branchSwitcherLabel') || byId('activeBranchChip');
    if (branchNode) new MutationObserver(() => {
      if (state.lastBranchId !== currentBranchId && !section.classList.contains('hidden') && allowed()) loadAnalytics();
    }).observe(branchNode, { childList: true, subtree: true, characterData: true });
    syncVisibility();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function syncVisibility() {
    const button = byId('managementAnalyticsNavBtn');
    const section = byId('managementAnalyticsTab');
    if (!button || !section) return;
    const visible = !!currentUser && allowed();
    button.classList.toggle('hidden', !visible);
    if (!visible && !section.classList.contains('hidden')) document.querySelector('.wrap > .tabs .tab[data-tab="charges"]')?.click();
    if (typeof refreshSidebarGroupVisibility === 'function') refreshSidebarGroupVisibility();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function openTab() {
    if (!allowed()) return;
    document.querySelectorAll('.wrap > .tabs .tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('main.wrap > section').forEach(section => section.classList.add('hidden'));
    byId('managementAnalyticsNavBtn').classList.add('active');
    byId('managementAnalyticsTab').classList.remove('hidden');
    const mainMonth = byId('monthPicker')?.value;
    if (mainMonth) byId('analyticsMonth').value = mainMonth;
    loadAnalytics();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  async function loadAnalytics() {
    if (!allowed() || !currentBranchId || state.loading) return;
    const endMonth = byId('analyticsMonth').value || todayMonth();
    const count = Number(byId('analyticsRange').value || 6);
    const months = analyticsMonthRange(endMonth, count);
    const firstCycle = getBillingCycle(months[0]);
    const lastCycle = getBillingCycle(months.at(-1));
    if (!firstCycle || !lastCycle) return;
    state.loading = true;
    byId('analyticsLoading').classList.remove('hidden');
    byId('analyticsRefreshBtn').disabled = true;

    try {
      if (typeof loadRecurringPricingData === 'function') await loadRecurringPricingData();
      const [entriesResult, recurringResult, itemsResult, cyclesResult] = await Promise.all([
        sb.from('charge_entries').select('resident_id,item_id,quantity,unit_price,charge_date').eq('branch_id', currentBranchId).gte('charge_date', firstCycle.start).lte('charge_date', lastCycle.end),
        sb.from('recurring_charges').select('*').eq('branch_id', currentBranchId).lte('start_date', lastCycle.end).or(`end_date.is.null,end_date.gte.${firstCycle.start}`),
        sb.from('items').select('id,name,category').eq('branch_id', currentBranchId),
        sb.from('billing_cycles').select('resident_id,billing_month,is_locked').eq('branch_id', currentBranchId).in('billing_month', months)
      ]);
      for (const result of [entriesResult, recurringResult, itemsResult, cyclesResult]) if (result.error) throw result.error;
      const result = aggregateAnalytics(months, residents || [], entriesResult.data || [], recurringResult.data || [], itemsResult.data || [], cyclesResult.data || []);
      state.month = endMonth;
      state.months = count;
      state.rows = result.monthRows;
      state.categories = result.categories;
      state.residentRows = result.residentRows;
      state.lastBranchId = currentBranchId;
      populateResidentSelect();
      renderAll();
    } catch (error) {
      console.error('Management analytics load failed:', error);
      if (typeof toast === 'function') toast(error?.message || 'Unable to load management analytics');
    } finally {
      state.loading = false;
      byId('analyticsLoading').classList.add('hidden');
      byId('analyticsRefreshBtn').disabled = false;
    }
  }

  function populateResidentSelect() {
    const select = byId('analyticsResident');
    const previous = select.value || byId('residentSelect')?.value || '';
    select.innerHTML = (residents || []).map(resident => `<option value="${esc(resident.id)}">${esc(resident.name)}${resident.room_ref ? ` · ${esc(resident.room_ref)}` : ''}</option>`).join('');
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  function renderAll() {
    const total = state.rows.reduce((sum, row) => sum + row.total, 0);
    const usage = state.rows.reduce((sum, row) => sum + row.usage, 0);
    const recurring = state.rows.reduce((sum, row) => sum + row.recurring, 0);
    byId('analyticsTotal').textContent = money(total);
    byId('analyticsUsage').textContent = money(usage);
    byId('analyticsRecurring').textContent = money(recurring);
    byId('analyticsAverage').textContent = money(state.rows.length ? total / state.rows.length : 0);
    byId('analyticsCycleCount').textContent = `${state.rows.length} billing cycles`;
    byId('analyticsPeriodLabel').textContent = state.rows.length ? `${monthLabel(state.rows[0].month)} – ${monthLabel(state.rows.at(-1).month)}` : 'Selected period';
    byId('analyticsCategoryMeta').textContent = `${branchName()} · ${state.months} billing cycles`;
    renderTrend();
    renderCategories();
    renderResidentHistory();
  }

  function renderTrend() {
    const target = byId('analyticsTrendChart');
    if (!state.rows.length) { target.innerHTML = '<div class="analytics-empty">No monthly data.</div>'; return; }
    const width = 760, height = 260, top = 24, bottom = 46, left = 62, right = 20;
    const chartHeight = height - top - bottom;
    const max = Math.max(...state.rows.map(row => row.total), 1);
    const groupWidth = (width - left - right) / state.rows.length;
    const barWidth = Math.min(28, groupWidth * 0.28);
    const grid = [0, .25, .5, .75, 1].map(ratio => {
      const y = top + chartHeight * (1 - ratio);
      return `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" class="analytics-gridline"/><text x="${left - 8}" y="${y + 4}" text-anchor="end" class="analytics-axis-label">${ratio ? Math.round(max * ratio).toLocaleString('en-MY') : '0'}</text>`;
    }).join('');
    const bars = state.rows.map((row, index) => {
      const center = left + groupWidth * index + groupWidth / 2;
      const usageHeight = row.usage / max * chartHeight;
      const recurringHeight = row.recurring / max * chartHeight;
      return `<g><rect x="${center - barWidth - 2}" y="${top + chartHeight - usageHeight}" width="${barWidth}" height="${usageHeight}" rx="3" class="analytics-bar-usage"><title>${monthLabel(row.month)} usage: ${money(row.usage)}</title></rect><rect x="${center + 2}" y="${top + chartHeight - recurringHeight}" width="${barWidth}" height="${recurringHeight}" rx="3" class="analytics-bar-recurring"><title>${monthLabel(row.month)} recurring: ${money(row.recurring)}</title></rect><text x="${center}" y="${height - 20}" text-anchor="middle" class="analytics-axis-label">${monthLabel(row.month).replace(' ', '\n')}</text></g>`;
    }).join('');
    target.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Monthly usage and recurring charge trend">${grid}${bars}</svg>`;
  }

  function renderCategories() {
    const target = byId('analyticsCategoryChart');
    const max = Math.max(...state.categories.map(row => row.total), 1);
    const total = state.categories.reduce((sum, row) => sum + row.total, 0);
    target.innerHTML = state.categories.length ? state.categories.map(row => `<div class="analytics-category-row"><div class="analytics-category-copy"><strong>${esc(row.name)}</strong><span>${money(row.total)} · ${total ? Math.round(row.total / total * 100) : 0}%</span></div><div class="analytics-category-track"><span style="width:${Math.max(2, row.total / max * 100)}%"></span></div></div>`).join('') : '<div class="analytics-empty">No category spending in this period.</div>';
  }

  function renderResidentHistory() {
    const residentId = byId('analyticsResident')?.value;
    const rows = state.residentRows.filter(row => row.residentId === residentId);
    const body = byId('analyticsResidentBody');
    const foot = byId('analyticsResidentFoot');
    if (!body || !foot) return;
    body.innerHTML = rows.map(row => `<tr><td><strong>${esc(monthLabel(row.month))}</strong><small>${esc(billingPeriodLabel(row.month))}</small></td><td class="num">${money(row.usage)}</td><td class="num">${money(row.recurring)}</td><td class="num analytics-row-total">${money(row.total)}</td><td><span class="badge ${row.locked ? 'analytics-locked' : 'analytics-open'}">${row.locked ? 'LOCKED' : 'OPEN'}</span></td></tr>`).join('');
    const usage = rows.reduce((sum, row) => sum + row.usage, 0);
    const recurring = rows.reduce((sum, row) => sum + row.recurring, 0);
    foot.innerHTML = rows.length ? `<tr><th>Period Total</th><th class="num">${money(usage)}</th><th class="num">${money(recurring)}</th><th class="num">${money(usage + recurring)}</th><th></th></tr>` : '';
    byId('analyticsEmpty').classList.toggle('hidden', rows.length > 0);
  }

  ensureUI();
  document.addEventListener('DOMContentLoaded', ensureUI, { once: true });
  window.addEventListener('load', () => { syncVisibility(); state.lastBranchId = currentBranchId; }, { once: true });
})();
