(() => {
  const state = { month: '', months: 12, monthList: [], rows: [], categories: [], residentRows: [], entries: [], recurring: [], items: [], itemUsage: null, packageUsage: null, loading: false, lastBranchId: null };
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

  function billingMonthForDate(date, months) {
    return months.find(month => {
      const cycle = getBillingCycle(month);
      return cycle && date >= cycle.start && date <= cycle.end;
    }) || '';
  }

  function aggregateItemUsage(months, residentsList, entries, itemId) {
    const residentMap = new Map(residentsList.map(resident => [resident.id, { residentId: resident.id, name: resident.name || '', room: resident.room_ref || '', quantity: 0, total: 0, entryDays: new Set(), lastUsed: '' }]));
    const monthlyMap = new Map(months.map(month => [month, { month, quantity: 0, total: 0 }]));
    entries.filter(entry => entry.item_id === itemId).forEach(entry => {
      const month = billingMonthForDate(entry.charge_date, months);
      if (!month) return;
      const quantity = Number(entry.quantity || 0);
      const total = quantity * Number(entry.unit_price || 0);
      const monthly = monthlyMap.get(month);
      monthly.quantity += quantity;
      monthly.total += total;
      const resident = residentMap.get(entry.resident_id);
      if (!resident) return;
      resident.quantity += quantity;
      resident.total += total;
      resident.entryDays.add(entry.charge_date);
      if (!resident.lastUsed || entry.charge_date > resident.lastUsed) resident.lastUsed = entry.charge_date;
    });
    return { monthlyRows: [...monthlyMap.values()], residentRows: [...residentMap.values()].map(row => ({ ...row, entryDays: row.entryDays.size })) };
  }

  function aggregatePackageUsage(months, residentsList, recurringRows, itemId) {
    const monthlyRows = months.map(month => ({ month, residents: 0, total: 0 }));
    const residentRows = residentsList.map(resident => {
      let cyclesBilled = 0;
      let total = 0;
      let latestAmount = 0;
      months.forEach((month, index) => {
        const amount = recurringRows.filter(charge => charge.item_id === itemId && charge.resident_id === resident.id).reduce((sum, charge) => sum + Number(getRecurringAmountForMonth(charge, month) || 0), 0);
        if (amount > 0) { cyclesBilled += 1; total += amount; latestAmount = amount; monthlyRows[index].residents += 1; monthlyRows[index].total += amount; }
      });
      const finalCycle = getBillingCycle(months.at(-1));
      const current = recurringRows.some(charge => charge.item_id === itemId && charge.resident_id === resident.id && charge.start_date <= finalCycle.end && (!charge.end_date || charge.end_date >= finalCycle.start));
      return { residentId: resident.id, name: resident.name || '', room: resident.room_ref || '', cyclesBilled, latestAmount, total, current };
    });
    return { monthlyRows, residentRows };
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
      const month = billingMonthForDate(entry.charge_date, months);
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

  function buildItemUsageWorkbook(item, rows, months) {
    const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const totalAmount = rows.reduce((sum, row) => sum + row.total, 0);
    const data = [
      ['Mintygreen Healthcare'], [branchName()], ['Item Usage Analysis'],
      ['Item', item?.name || 'Item'],
      ['Period', `${monthLabel(months[0])} – ${monthLabel(months.at(-1))}`],
      ['Residents', rows.length, 'Residents With Usage', rows.filter(row => row.quantity > 0).length, 'Total Quantity', totalQuantity],
      [],
      ['Resident', 'Room / Ref', 'Quantity Used', 'Usage Days', 'Last Used', 'Total Charge'],
      ...rows.map(row => [row.name, row.room, row.quantity, row.entryDays, row.lastUsed || 'No usage', row.total]),
      [], ['TOTAL', '', totalQuantity, '', '', totalAmount]
    ];
    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 17 }, { wch: 14 }, { wch: 17 }, { wch: 18 }];
    ws['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 20 }, { hpt: 19 }, { hpt: 19 }, { hpt: 22 }, { hpt: 8 }, { hpt: 24 }];
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }, { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } }, { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }];
    const thinBorder = { bottom: { style: 'thin', color: { rgb: 'D7E3E0' } } };
    const headerStyle = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '176B5B' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: thinBorder };
    const bodyStyle = { font: { name: 'Arial', sz: 10, color: { rgb: '263D39' } }, alignment: { vertical: 'center' }, border: thinBorder };
    const alternateStyle = { ...bodyStyle, fill: { patternType: 'solid', fgColor: { rgb: 'F7FAF9' } } };
    const totalStyle = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '163B34' } }, fill: { patternType: 'solid', fgColor: { rgb: 'DDEFEA' } }, border: { top: { style: 'medium', color: { rgb: '176B5B' } } } };
    if (ws.A1) ws.A1.s = { font: { name: 'Arial', bold: true, sz: 16, color: { rgb: '176B5B' } } };
    if (ws.A2) ws.A2.s = { font: { name: 'Arial', bold: true, sz: 11, color: { rgb: '38534E' } } };
    if (ws.A3) ws.A3.s = { font: { name: 'Arial', bold: true, sz: 12, color: { rgb: '163B34' } } };
    for (let c = 0; c < 6; c++) { const address = XLSX.utils.encode_cell({ r: 7, c }); if (ws[address]) ws[address].s = headerStyle; }
    for (let r = 8; r < 8 + rows.length; r++) {
      ws['!rows'][r] = { hpt: 21 };
      for (let c = 0; c < 6; c++) { const address = XLSX.utils.encode_cell({ r, c }); if (ws[address]) ws[address].s = r % 2 === 0 ? bodyStyle : alternateStyle; }
    }
    const totalRow = data.length - 1;
    for (let c = 0; c < 6; c++) { const address = XLSX.utils.encode_cell({ r: totalRow, c }); if (ws[address]) ws[address].s = totalStyle; }
    const currencyFormat = '"RM" #,##0.00;[Red]-"RM" #,##0.00;-';
    for (let r = 8; r < 8 + rows.length; r++) { const address = XLSX.utils.encode_cell({ r, c: 5 }); if (ws[address]) ws[address].z = currencyFormat; }
    const totalAddress = XLSX.utils.encode_cell({ r: totalRow, c: 5 });
    if (ws[totalAddress]) ws[totalAddress].z = currencyFormat;
    ws['!autofilter'] = { ref: `A8:F${8 + rows.length}` };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Item Usage');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
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
        <div class="tfield"><label>Trend Period</label><select id="analyticsRange"><option value="12">Last 12 cycles</option><option value="6">Last 6 cycles</option></select></div>
        <button id="analyticsExcelBtn" class="btn btn-light" type="button">Export Report Excel</button>
        <button id="analyticsPdfBtn" class="btn btn-light" type="button">Export Report PDF</button>
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
      <div class="card analytics-panel analytics-item-panel">
        <div class="analytics-panel-head analytics-item-head"><div><h3>Item Usage Analysis</h3><p>Check one stock item across all residents for the selected billing cycles.</p></div><div class="analytics-item-controls"><div class="tfield"><label>Item</label><select id="analyticsItem"></select></div><div class="tfield"><label>Sort Residents</label><select id="analyticsItemSort"><option value="highest">Highest usage first</option><option value="name">Resident name</option></select></div><button id="analyticsItemExcelBtn" class="btn btn-light" type="button">Export Item Excel</button></div></div>
        <div class="analytics-item-summary"><div><span>Total Quantity</span><strong id="analyticsItemQuantity">0</strong></div><div><span>Total Charge</span><strong id="analyticsItemCharge">RM 0.00</strong></div><div><span>Residents With Usage</span><strong id="analyticsItemResidents">0</strong></div><div><span>Residents With No Usage</span><strong id="analyticsItemZero">0</strong></div></div>
        <div class="analytics-item-layout"><div><h4>Monthly Item Trend</h4><div id="analyticsItemTrend" class="analytics-item-trend"></div></div><div class="table-wrap"><table class="analytics-table analytics-item-table"><thead><tr><th>Resident</th><th>Room / Ref</th><th class="num">Quantity</th><th class="num">Usage Days</th><th>Last Used</th><th class="num">Charge</th></tr></thead><tbody id="analyticsItemBody"></tbody><tfoot id="analyticsItemFoot"></tfoot></table></div></div>
      </div>
      <div class="card analytics-panel analytics-item-panel">
        <div class="analytics-panel-head analytics-item-head"><div><h3>Recurring Package Analysis</h3><p>Review each recurring package, service or rental across all residents.</p></div><div class="analytics-item-controls analytics-package-controls"><div class="tfield"><label>Recurring Package</label><select id="analyticsPackage"></select></div><div class="tfield"><label>Sort Residents</label><select id="analyticsPackageSort"><option value="highest">Highest charge first</option><option value="name">Resident name</option></select></div><button id="analyticsPackageExcelBtn" class="btn btn-light" type="button">Export Package Excel</button></div></div>
        <div class="analytics-item-summary"><div><span>Total Package Charges</span><strong id="analyticsPackageTotal">RM 0.00</strong></div><div><span>Currently Billed</span><strong id="analyticsPackageCurrent">0</strong></div><div><span>Billed During Period</span><strong id="analyticsPackageResidents">0</strong></div><div><span>Not Billed</span><strong id="analyticsPackageZero">0</strong></div></div>
        <div class="analytics-item-layout"><div><h4>Monthly Package Trend</h4><div id="analyticsPackageTrend" class="analytics-item-trend"></div></div><div class="table-wrap"><table class="analytics-table analytics-item-table"><thead><tr><th>Resident</th><th>Room / Ref</th><th class="num">Cycles Billed</th><th class="num">Latest Amount</th><th class="num">Period Total</th><th>Status</th></tr></thead><tbody id="analyticsPackageBody"></tbody><tfoot id="analyticsPackageFoot"></tfoot></table></div></div>
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
    byId('analyticsExcelBtn').addEventListener('click', exportManagementExcel);
    byId('analyticsPdfBtn').addEventListener('click', exportManagementPdf);
    byId('analyticsMonth').addEventListener('change', loadAnalytics);
    byId('analyticsRange').addEventListener('change', loadAnalytics);
    byId('analyticsResident').addEventListener('change', renderResidentHistory);
    byId('analyticsItem').addEventListener('change', renderItemUsage);
    byId('analyticsItemSort').addEventListener('change', renderItemUsage);
    byId('analyticsItemExcelBtn').addEventListener('click', exportItemUsageExcel);
    byId('analyticsPackage').addEventListener('change', renderPackageUsage);
    byId('analyticsPackageSort').addEventListener('change', renderPackageUsage);
    byId('analyticsPackageExcelBtn').addEventListener('click', exportPackageUsageExcel);

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
      state.monthList = months;
      state.entries = entriesResult.data || [];
      state.recurring = recurringResult.data || [];
      state.items = itemsResult.data || [];
      state.lastBranchId = currentBranchId;
      populateResidentSelect();
      populateItemSelect();
      populatePackageSelect();
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

  function populateItemSelect() {
    const select = byId('analyticsItem');
    const previous = select.value;
    const usedIds = new Set(state.entries.map(entry => entry.item_id));
    const options = state.items.filter(item => usedIds.has(item.id)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
    select.innerHTML = options.map(item => `<option value="${esc(item.id)}">${esc(item.name || 'Unnamed item')}</option>`).join('');
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
  }

  function populatePackageSelect() {
    const select = byId('analyticsPackage');
    const previous = select.value;
    const recurringIds = new Set(state.recurring.map(charge => charge.item_id));
    const options = state.items.filter(item => recurringIds.has(item.id)).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true, sensitivity: 'base' }));
    select.innerHTML = options.map(item => `<option value="${esc(item.id)}">${esc(item.name || 'Unnamed package')}</option>`).join('');
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
    renderItemUsage();
    renderPackageUsage();
    renderResidentHistory();
  }

  function renderItemUsage() {
    const itemId = byId('analyticsItem')?.value || '';
    const item = state.items.find(row => row.id === itemId);
    const usage = aggregateItemUsage(state.monthList, residents || [], state.entries, itemId);
    const sort = byId('analyticsItemSort')?.value || 'highest';
    const rows = [...usage.residentRows].sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : (a, b) => b.quantity - a.quantity || b.total - a.total || a.name.localeCompare(b.name));
    state.itemUsage = { item, rows, monthlyRows: usage.monthlyRows };
    const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
    const totalCharge = rows.reduce((sum, row) => sum + row.total, 0);
    const withUsage = rows.filter(row => row.quantity > 0).length;
    byId('analyticsItemQuantity').textContent = totalQuantity.toLocaleString('en-MY');
    byId('analyticsItemCharge').textContent = money(totalCharge);
    byId('analyticsItemResidents').textContent = String(withUsage);
    byId('analyticsItemZero').textContent = String(rows.length - withUsage);
    byId('analyticsItemExcelBtn').disabled = !item;
    renderItemTrend(usage.monthlyRows);
    byId('analyticsItemBody').innerHTML = item ? rows.map(row => `<tr class="${row.quantity ? '' : 'analytics-zero-row'}"><td><strong>${esc(row.name)}</strong></td><td>${esc(row.room || '-')}</td><td class="num">${row.quantity.toLocaleString('en-MY')}</td><td class="num">${row.entryDays}</td><td>${row.lastUsed ? esc(formatShortDate(new Date(`${row.lastUsed}T00:00:00`))) : '<span class="analytics-no-usage">No usage</span>'}</td><td class="num analytics-row-total">${money(row.total)}</td></tr>`).join('') : '<tr><td colspan="6" class="analytics-empty">No item usage is available for this period.</td></tr>';
    byId('analyticsItemFoot').innerHTML = item ? `<tr><th colspan="2">Total</th><th class="num">${totalQuantity.toLocaleString('en-MY')}</th><th></th><th></th><th class="num">${money(totalCharge)}</th></tr>` : '';
  }

  function renderItemTrend(rows) {
    const target = byId('analyticsItemTrend');
    const max = Math.max(...rows.map(row => row.quantity), 1);
    target.innerHTML = rows.map(row => `<div class="analytics-item-month"><span>${esc(monthLabel(row.month))}</span><div class="analytics-item-month-track"><i style="width:${row.quantity ? Math.max(4, row.quantity / max * 100) : 0}%"></i></div><strong>${row.quantity.toLocaleString('en-MY')}</strong></div>`).join('');
  }

  function exportItemUsageExcel() {
    if (!state.itemUsage?.item) { if (typeof toast === 'function') toast('Select an item to export'); return; }
    const workbook = buildItemUsageWorkbook(state.itemUsage.item, state.itemUsage.rows, state.monthList);
    const blob = new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    const safeItem = String(state.itemUsage.item.name || 'Item').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Item';
    anchor.download = `Item-Usage_${safeItem}_${state.monthList[0]}_to_${state.monthList.at(-1)}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
  }

  function renderPackageUsage() {
    const itemId = byId('analyticsPackage')?.value || '';
    const item = state.items.find(row => row.id === itemId);
    const usage = aggregatePackageUsage(state.monthList, residents || [], state.recurring, itemId);
    const sort = byId('analyticsPackageSort')?.value || 'highest';
    const rows = [...usage.residentRows].sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : (a, b) => b.total - a.total || b.cyclesBilled - a.cyclesBilled || a.name.localeCompare(b.name));
    state.packageUsage = { item, rows, monthlyRows: usage.monthlyRows };
    const total = rows.reduce((sum, row) => sum + row.total, 0);
    const billed = rows.filter(row => row.cyclesBilled > 0).length;
    byId('analyticsPackageTotal').textContent = money(total);
    byId('analyticsPackageCurrent').textContent = String(rows.filter(row => row.current).length);
    byId('analyticsPackageResidents').textContent = String(billed);
    byId('analyticsPackageZero').textContent = String(rows.length - billed);
    byId('analyticsPackageExcelBtn').disabled = !item;
    const max = Math.max(...usage.monthlyRows.map(row => row.total), 1);
    byId('analyticsPackageTrend').innerHTML = usage.monthlyRows.map(row => `<div class="analytics-item-month"><span>${esc(monthLabel(row.month))}</span><div class="analytics-item-month-track package"><i style="width:${row.total ? Math.max(4, row.total / max * 100) : 0}%"></i></div><strong>${row.residents}</strong></div>`).join('');
    byId('analyticsPackageBody').innerHTML = item ? rows.map(row => `<tr class="${row.cyclesBilled ? '' : 'analytics-zero-row'}"><td><strong>${esc(row.name)}</strong></td><td>${esc(row.room || '-')}</td><td class="num">${row.cyclesBilled}</td><td class="num">${money(row.latestAmount)}</td><td class="num analytics-row-total">${money(row.total)}</td><td><span class="badge ${row.current ? 'analytics-locked' : 'analytics-open'}">${row.current ? 'CURRENT' : row.cyclesBilled ? 'ENDED' : 'NOT BILLED'}</span></td></tr>`).join('') : '<tr><td colspan="6" class="analytics-empty">No recurring packages are available for this period.</td></tr>';
    byId('analyticsPackageFoot').innerHTML = item ? `<tr><th colspan="2">Period Total</th><th></th><th></th><th class="num">${money(total)}</th><th></th></tr>` : '';
  }

  function exportPackageUsageExcel() {
    if (!state.packageUsage?.item) { if (typeof toast === 'function') toast('Select a recurring package to export'); return; }
    const rows = state.packageUsage.rows.map(row => ({ name: row.name, room: row.room, quantity: row.cyclesBilled, entryDays: row.current ? 'CURRENT' : row.cyclesBilled ? 'ENDED' : 'NOT BILLED', lastUsed: money(row.latestAmount), total: row.total }));
    const workbook = buildItemUsageWorkbook({ name: `${state.packageUsage.item.name} (Recurring)` }, rows, state.monthList);
    const blob = new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    const safeItem = String(state.packageUsage.item.name || 'Package').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'Package';
    anchor.download = `Recurring-Package_${safeItem}_${state.monthList[0]}_to_${state.monthList.at(-1)}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
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

  function downloadArray(data, filename, type) {
    const blob = new Blob([data], { type });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
  }

  function exportManagementExcel() {
    if (!state.rows.length) { if (typeof toast === 'function') toast('Load analytics before exporting'); return; }
    const wb = XLSX.utils.book_new();
    const overview = [
      ['Mintygreen Healthcare'], [branchName()], ['Management Analytics Report'],
      ['Period', `${monthLabel(state.monthList[0])} – ${monthLabel(state.monthList.at(-1))}`], [],
      ['Billing Cycle', 'Usage Charges', 'Recurring Charges', 'Total Charges'],
      ...state.rows.map(row => [monthLabel(row.month), row.usage, row.recurring, row.total]), [],
      ['TOTAL', state.rows.reduce((s, r) => s + r.usage, 0), state.rows.reduce((s, r) => s + r.recurring, 0), state.rows.reduce((s, r) => s + r.total, 0)]
    ];
    const categories = [['Category', 'Total Charges', 'Share'], ...state.categories.map(row => [row.name, row.total, state.categories.reduce((s, r) => s + r.total, 0) ? row.total / state.categories.reduce((s, r) => s + r.total, 0) : 0])];
    const ws = XLSX.utils.aoa_to_sheet(overview);
    const categoryWs = XLSX.utils.aoa_to_sheet(categories);
    ws['!cols'] = [{ wch: 24 }, { wch: 19 }, { wch: 21 }, { wch: 19 }];
    categoryWs['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 14 }];
    const currency = '"RM" #,##0.00;[Red]-"RM" #,##0.00;-';
    for (let r = 6; r < overview.length; r++) for (let c = 1; c < 4; c++) { const cell = ws[XLSX.utils.encode_cell({ r, c })]; if (cell) cell.z = currency; }
    for (let r = 1; r < categories.length; r++) { if (categoryWs[`B${r + 1}`]) categoryWs[`B${r + 1}`].z = currency; if (categoryWs[`C${r + 1}`]) categoryWs[`C${r + 1}`].z = '0%'; }
    const header = { font: { name: 'Arial', bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '176B5B' } }, alignment: { horizontal: 'center' } };
    ['A6', 'B6', 'C6', 'D6'].forEach(address => { if (ws[address]) ws[address].s = header; });
    ['A1', 'B1', 'C1'].forEach(address => { if (categoryWs[address]) categoryWs[address].s = header; });
    if (ws.A1) ws.A1.s = { font: { name: 'Arial', bold: true, sz: 16, color: { rgb: '176B5B' } } };
    XLSX.utils.book_append_sheet(wb, ws, 'Monthly Overview');
    XLSX.utils.book_append_sheet(wb, categoryWs, 'Category Spending');
    const output = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    downloadArray(output, `Management-Analytics_${state.monthList[0]}_to_${state.monthList.at(-1)}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  }

  function exportManagementPdf() {
    if (!state.rows.length) { if (typeof toast === 'function') toast('Load analytics before exporting'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setTextColor(23, 107, 91); doc.setFontSize(18); doc.text('Mintygreen Healthcare', 14, 16);
    doc.setTextColor(35, 58, 53); doc.setFontSize(12); doc.text(`${branchName()} · Management Analytics`, 14, 24);
    doc.setFontSize(9); doc.text(`${monthLabel(state.monthList[0])} – ${monthLabel(state.monthList.at(-1))}`, 14, 30);
    doc.autoTable({ startY: 36, head: [['Billing Cycle', 'Usage', 'Recurring', 'Total']], body: state.rows.map(row => [monthLabel(row.month), money(row.usage), money(row.recurring), money(row.total)]), foot: [['Total', money(state.rows.reduce((s, r) => s + r.usage, 0)), money(state.rows.reduce((s, r) => s + r.recurring, 0)), money(state.rows.reduce((s, r) => s + r.total, 0))]], theme: 'grid', headStyles: { fillColor: [23, 107, 91] } });
    const nextY = doc.lastAutoTable.finalY + 8;
    doc.autoTable({ startY: nextY, head: [['Category', 'Charges']], body: state.categories.map(row => [row.name, money(row.total)]), theme: 'striped', headStyles: { fillColor: [40, 126, 171] } });
    doc.save(`Management-Analytics_${state.monthList[0]}_to_${state.monthList.at(-1)}.pdf`);
  }

  ensureUI();
  document.addEventListener('DOMContentLoaded', ensureUI, { once: true });
  window.addEventListener('load', () => { syncVisibility(); state.lastBranchId = currentBranchId; }, { once: true });
})();
