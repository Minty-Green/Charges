(() => {
  const MONTH_END_TAB = 'monthEnd';
  const state = {
    month: '',
    rows: [],
    search: '',
    filter: 'all',
    loading: false,
    lastBranchId: null,
    entriesByResident: new Map(),
    recurringByResident: new Map()
  };

  const byId = id => document.getElementById(id);
  const isAllowed = () => currentUserRole === 'admin' || currentUserRole === 'super_admin';
  const money = value => new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR'
  }).format(Number(value || 0)).replace('MYR', 'RM');

  function currentMonth() {
    return byId('monthEndMonth')?.value || byId('monthPicker')?.value || todayMonth();
  }

  function branchName() {
    return typeof getActiveBranchName === 'function' ? getActiveBranchName() : 'Branch';
  }

  function periodText(month) {
    const cycle = getBillingCycle(month);
    if (!cycle) return '-';
    return `${formatShortDate(cycle.startDate)} - ${formatShortDate(cycle.endDate)}`;
  }

  function safeFilePart(value) {
    return String(value || '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '') || 'item';
  }

  function recurringCoversMonth(charge, month) {
    const cycle = getBillingCycle(month);
    if (!cycle || !charge?.start_date) return false;
    const startsBeforeCycleEnds = charge.start_date <= cycle.end;
    const endsAfterCycleStarts = !charge.end_date || charge.end_date >= cycle.start;
    return startsBeforeCycleEnds && endsAfterCycleStarts;
  }

  function median(values) {
    const sorted = values.filter(v => Number(v) > 0).map(Number).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function buildAlerts(row, branchMedian) {
    const alerts = [];

    if (!row.locked) {
      alerts.push({ code: 'OPEN', level: 'warning', text: 'Billing cycle is still open' });
    }

    if (row.total <= 0) {
      alerts.push({ code: 'ZERO', level: 'warning', text: 'No charges for this billing cycle' });
    }

    if (row.recurringExpected && row.recurringTotal <= 0) {
      alerts.push({ code: 'RECURRING', level: 'danger', text: 'Recurring charge exists but billed amount is RM 0.00' });
    }

    if (branchMedian > 0 && row.total > Math.max(branchMedian * 2.5, branchMedian + 500)) {
      alerts.push({ code: 'HIGH', level: 'info', text: 'Total is unusually high compared with this branch' });
    }

    if (branchMedian > 0 && row.total > 0 && row.total < branchMedian * 0.2) {
      alerts.push({ code: 'LOW', level: 'info', text: 'Total is unusually low compared with this branch' });
    }

    return alerts;
  }

  function ensureMonthEndUI() {
    if (byId('monthEndTab')) return;

    const tabs = document.querySelector('.wrap > .tabs');
    const main = document.querySelector('main.wrap');
    if (!tabs || !main) return;

    const button = document.createElement('button');
    button.id = 'monthEndNavBtn';
    button.type = 'button';
    button.className = 'btn tab admin-only hidden';
    button.dataset.tab = MONTH_END_TAB;
    button.textContent = 'Month-End';

    const financeButton = tabs.querySelector('[data-tab="financeSummary"]');
    const recurringButton = tabs.querySelector('[data-tab="recurring"]');
    if (financeButton?.nextSibling) tabs.insertBefore(button, financeButton.nextSibling);
    else tabs.insertBefore(button, recurringButton || null);

    const section = document.createElement('section');
    section.id = 'monthEndTab';
    section.className = 'hidden';
    section.innerHTML = `
      <div class="page-heading month-end-heading">
        <div class="page-heading-copy">
          <div class="page-heading-kicker">Finance Control</div>
          <h1>Month-End Closing</h1>
          <p>Review every resident before finance submission, spot unusual charges and prepare the complete finance pack.</p>
        </div>
        <div class="month-end-heading-actions">
          <button id="monthEndFinanceSummaryBtn" class="btn btn-light" style="border:1px solid var(--border)">Finance Summary</button>
          <button id="monthEndFinancePackBtn" class="btn btn-primary">Download Finance Pack</button>
        </div>
      </div>

      <div class="card month-end-toolbar">
        <div class="tfield">
          <label>Billing Cycle</label>
          <input id="monthEndMonth" type="month">
          <small id="monthEndPeriod" class="month-end-period"></small>
        </div>
        <div class="tfield month-end-search-field">
          <label>Search Resident</label>
          <input id="monthEndSearch" type="search" placeholder="Name or room / ref" autocomplete="off">
        </div>
        <div class="tfield">
          <label>Review Filter</label>
          <select id="monthEndFilter">
            <option value="all">All Residents</option>
            <option value="review">Needs Review</option>
            <option value="open">Open Cycles</option>
            <option value="locked">Locked Cycles</option>
            <option value="ready">Ready / No Alerts</option>
          </select>
        </div>
        <button id="monthEndRefreshBtn" class="btn btn-primary">Refresh</button>
      </div>

      <div class="month-end-stat-grid">
        <div class="card month-end-stat"><span>Residents</span><strong id="monthEndResidentCount">0</strong><small>Selected branch</small></div>
        <div class="card month-end-stat month-end-stat-locked"><span>Locked</span><strong id="monthEndLockedCount">0</strong><small>Closed for billing</small></div>
        <div class="card month-end-stat month-end-stat-open"><span>Still Open</span><strong id="monthEndOpenCount">0</strong><small>Needs closing review</small></div>
        <div class="card month-end-stat month-end-stat-alert"><span>Needs Review</span><strong id="monthEndAlertCount">0</strong><small>Automated checks</small></div>
      </div>

      <div class="card month-end-checks-card">
        <div class="month-end-checks-head">
          <div>
            <h3>Finance Reconciliation Checks</h3>
            <p class="note">Warnings help you review unusual records. They never change billing amounts automatically.</p>
          </div>
          <div id="monthEndCheckSummary" class="month-end-check-summary"></div>
        </div>
      </div>

      <div class="card month-end-table-card">
        <div class="month-end-table-head">
          <div>
            <h3>Resident Closing Dashboard</h3>
            <p id="monthEndMeta" class="note">Select a billing cycle to review.</p>
          </div>
          <div id="monthEndPackStatus" class="month-end-pack-status"></div>
        </div>
        <div id="monthEndLoading" class="month-end-loading hidden">Loading month-end controls…</div>
        <div class="table-wrap month-end-table-wrap">
          <table class="month-end-table">
            <thead>
              <tr>
                <th>Resident</th>
                <th>Room / Ref</th>
                <th class="num">Usage</th>
                <th class="num">Recurring</th>
                <th class="num">Total</th>
                <th>Status</th>
                <th>Checks</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="monthEndTableBody"></tbody>
          </table>
        </div>
        <div id="monthEndEmpty" class="month-end-empty hidden">No residents match the current filter.</div>
      </div>`;

    const financeSection = byId('financeSummaryTab');
    if (financeSection?.nextSibling) main.insertBefore(section, financeSection.nextSibling);
    else main.appendChild(section);

    const initialMonth = byId('monthPicker')?.value || todayMonth();
    byId('monthEndMonth').value = initialMonth;
    state.month = initialMonth;
    updatePeriod();

    button.addEventListener('click', openMonthEndTab);
    byId('monthEndRefreshBtn')?.addEventListener('click', loadMonthEndData);
    byId('monthEndMonth')?.addEventListener('change', () => {
      state.month = currentMonth();
      updatePeriod();
      loadMonthEndData();
    });
    byId('monthEndSearch')?.addEventListener('input', event => {
      state.search = String(event.target.value || '').trim().toLowerCase();
      renderRows();
    });
    byId('monthEndFilter')?.addEventListener('change', event => {
      state.filter = event.target.value || 'all';
      renderRows();
    });
    byId('monthEndFinancePackBtn')?.addEventListener('click', downloadFinancePack);
    byId('monthEndFinanceSummaryBtn')?.addEventListener('click', () => {
      document.querySelector('.wrap > .tabs .tab[data-tab="financeSummary"]')?.click();
    });

    section.addEventListener('click', event => {
      const reviewButton = event.target.closest('[data-month-end-review]');
      if (!reviewButton) return;
      openResidentBilling(reviewButton.dataset.monthEndReview);
    });

    document.querySelectorAll('.wrap > .tabs .tab').forEach(tab => {
      if (tab === button) return;
      tab.addEventListener('click', () => {
        section.classList.add('hidden');
        button.classList.remove('active');
      });
    });

    const roleNode = byId('userRole');
    if (roleNode) new MutationObserver(syncVisibility).observe(roleNode, { childList: true, subtree: true, characterData: true });

    const branchNode = byId('branchSwitcherLabel') || byId('activeBranchChip');
    if (branchNode) {
      new MutationObserver(() => {
        if (state.lastBranchId !== currentBranchId) {
          state.lastBranchId = currentBranchId;
          state.rows = [];
          state.entriesByResident = new Map();
          state.recurringByResident = new Map();
          if (!section.classList.contains('hidden') && isAllowed()) loadMonthEndData();
        }
      }).observe(branchNode, { childList: true, subtree: true, characterData: true });
    }

    syncVisibility();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function syncVisibility() {
    const button = byId('monthEndNavBtn');
    const section = byId('monthEndTab');
    if (!button || !section) return;

    const allowed = !!currentUser && isAllowed();
    button.classList.toggle('hidden', !allowed);

    if (!allowed && !section.classList.contains('hidden')) {
      section.classList.add('hidden');
      button.classList.remove('active');
      document.querySelector('.wrap > .tabs .tab[data-tab="charges"]')?.click();
    }

    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function openMonthEndTab() {
    if (!isAllowed()) return;

    document.querySelectorAll('.wrap > .tabs .tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('main.wrap > section').forEach(section => section.classList.add('hidden'));

    byId('monthEndNavBtn')?.classList.add('active');
    byId('monthEndTab')?.classList.remove('hidden');

    const mainMonth = byId('monthPicker')?.value;
    if (mainMonth && state.month !== mainMonth) {
      state.month = mainMonth;
      byId('monthEndMonth').value = mainMonth;
    }

    updatePeriod();
    loadMonthEndData();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function updatePeriod() {
    const month = currentMonth();
    const node = byId('monthEndPeriod');
    if (node) node.textContent = `Period: ${periodText(month)}`;
  }

  async function loadMonthEndData() {
    if (!isAllowed() || !currentBranchId) return;

    const month = currentMonth();
    const cycle = getBillingCycle(month);
    if (!cycle) return;

    state.month = month;
    state.loading = true;
    setLoading(true);

    try {
      if (typeof loadRecurringPricingData === 'function') await loadRecurringPricingData();
      const [entryResult, cycleResult, recurringResult] = await Promise.all([
        sb.from('charge_entries')
          .select('resident_id,item_id,quantity,unit_price,charge_date')
          .eq('branch_id', currentBranchId)
          .gte('charge_date', cycle.start)
          .lte('charge_date', cycle.end),
        sb.from('billing_cycles')
          .select('resident_id,is_locked')
          .eq('branch_id', currentBranchId)
          .eq('billing_month', month),
        sb.from('recurring_charges')
          .select('*')
          .eq('branch_id', currentBranchId)
          .lte('start_date', cycle.end)
          .or(`end_date.is.null,end_date.gte.${cycle.start}`)
      ]);

      if (entryResult.error) throw entryResult.error;
      if (cycleResult.error) throw cycleResult.error;
      if (recurringResult.error) throw recurringResult.error;

      const entryRows = entryResult.data || [];
      const recurringRows = recurringResult.data || [];
      const lockMap = new Map((cycleResult.data || []).map(row => [row.resident_id, !!row.is_locked]));
      const entriesByResident = new Map();
      const recurringByResident = new Map();

      entryRows.forEach(entry => {
        const rows = entriesByResident.get(entry.resident_id) || [];
        rows.push(entry);
        entriesByResident.set(entry.resident_id, rows);
      });

      recurringRows.forEach(charge => {
        const rows = recurringByResident.get(charge.resident_id) || [];
        rows.push(charge);
        recurringByResident.set(charge.resident_id, rows);
      });

      const baseRows = (residents || []).map(resident => {
        const residentEntries = entriesByResident.get(resident.id) || [];
        const residentRecurring = recurringByResident.get(resident.id) || [];
        const usageTotal = residentEntries.reduce(
          (sum, entry) => sum + Number(entry.quantity || 0) * Number(entry.unit_price || 0), 0
        );
        const recurringTotal = residentRecurring.reduce(
          (sum, charge) => sum + Number(getRecurringAmountForMonth(charge, month) || 0), 0
        );
        const recurringExpected = residentRecurring.some(charge => recurringCoversMonth(charge, month));

        return {
          id: resident.id,
          resident,
          name: resident.name || '',
          room: resident.room_ref || '',
          usageTotal,
          recurringTotal,
          total: usageTotal + recurringTotal,
          locked: lockMap.get(resident.id) === true,
          recurringExpected,
          alerts: []
        };
      });

      const branchMedian = median(baseRows.map(row => row.total));
      baseRows.forEach(row => {
        row.alerts = buildAlerts(row, branchMedian);
      });

      state.rows = baseRows.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      state.entriesByResident = entriesByResident;
      state.recurringByResident = recurringByResident;
      state.lastBranchId = currentBranchId;
      renderRows();
    } catch (error) {
      console.error('Month-end control load failed:', error);
      state.rows = [];
      state.entriesByResident = new Map();
      state.recurringByResident = new Map();
      renderRows();
      if (typeof toast === 'function') toast(error?.message || 'Unable to load month-end controls');
    } finally {
      state.loading = false;
      setLoading(false);
    }
  }

  function filteredRows() {
    return state.rows.filter(row => {
      const alertsText = row.alerts.map(alert => `${alert.code} ${alert.text}`).join(' ');
      const haystack = `${row.name} ${row.room} ${alertsText}`.toLowerCase();
      if (state.search && !haystack.includes(state.search)) return false;

      if (state.filter === 'review') return row.alerts.length > 0;
      if (state.filter === 'open') return !row.locked;
      if (state.filter === 'locked') return row.locked;
      if (state.filter === 'ready') return row.locked && row.alerts.length === 0;
      return true;
    });
  }

  function alertBadges(row) {
    if (!row.alerts.length) return '<span class="month-end-check-ok">No alerts</span>';
    return row.alerts.map(alert => `
      <span class="month-end-check month-end-check-${alert.level}" title="${esc(alert.text)}">${esc(alert.code)}</span>`).join(' ');
  }

  function renderRows() {
    const body = byId('monthEndTableBody');
    if (!body) return;

    const rows = filteredRows();
    body.innerHTML = rows.map(row => `
      <tr class="${row.alerts.length ? 'month-end-row-review' : ''}">
        <td><strong>${esc(row.name)}</strong></td>
        <td>${esc(row.room || '-')}</td>
        <td class="num">${money(row.usageTotal)}</td>
        <td class="num">${money(row.recurringTotal)}</td>
        <td class="num month-end-row-total">${money(row.total)}</td>
        <td><span class="badge ${row.locked ? 'month-end-locked' : 'month-end-open'}">${row.locked ? 'LOCKED' : 'OPEN'}</span></td>
        <td class="month-end-check-cell">${alertBadges(row)}</td>
        <td><button class="btn btn-light btn-compact" style="border:1px solid var(--border)" data-month-end-review="${esc(row.id)}">Review</button></td>
      </tr>`).join('');

    const lockedCount = state.rows.filter(row => row.locked).length;
    const openCount = state.rows.length - lockedCount;
    const alertCount = state.rows.filter(row => row.alerts.length > 0).length;
    const alertTypeCounts = new Map();
    state.rows.forEach(row => row.alerts.forEach(alert => alertTypeCounts.set(alert.code, (alertTypeCounts.get(alert.code) || 0) + 1)));

    byId('monthEndResidentCount').textContent = String(state.rows.length);
    byId('monthEndLockedCount').textContent = String(lockedCount);
    byId('monthEndOpenCount').textContent = String(openCount);
    byId('monthEndAlertCount').textContent = String(alertCount);
    byId('monthEndMeta').textContent = `${branchName()} · ${state.month || currentMonth()} · ${periodText(state.month || currentMonth())} · Showing ${rows.length} of ${state.rows.length}`;
    byId('monthEndEmpty').classList.toggle('hidden', rows.length > 0 || state.loading);

    const labels = [
      ['OPEN', 'open'],
      ['ZERO', 'zero charge'],
      ['RECURRING', 'recurring RM0'],
      ['HIGH', 'high total'],
      ['LOW', 'low total']
    ];
    byId('monthEndCheckSummary').innerHTML = labels
      .filter(([code]) => alertTypeCounts.get(code))
      .map(([code, label]) => `<span><strong>${alertTypeCounts.get(code)}</strong> ${label}</span>`)
      .join('') || '<span><strong>0</strong> alerts</span>';
  }

  function setLoading(loading) {
    byId('monthEndLoading')?.classList.toggle('hidden', !loading);
    const refresh = byId('monthEndRefreshBtn');
    if (refresh) {
      refresh.disabled = loading;
      refresh.textContent = loading ? 'Loading…' : 'Refresh';
    }
    byId('monthEndFinancePackBtn')?.toggleAttribute('disabled', loading);
  }

  async function openResidentBilling(residentId) {
    if (!residentId) return;
    const month = currentMonth();
    const residentSelect = byId('residentSelect');
    const monthPicker = byId('monthPicker');
    if (residentSelect) residentSelect.value = residentId;
    if (monthPicker) monthPicker.value = month;
    document.querySelector('.wrap > .tabs .tab[data-tab="charges"]')?.click();
    if (typeof loadMonth === 'function') await loadMonth();
  }

  function buildSummaryWorkbook(rows, month) {
    // Take a numeric snapshot before building the workbook. This keeps the
    // Excel summary aligned with the dashboard even while resident PDFs are
    // generated from the same month-end state.
    const exportRows = rows.map(row => {
      const usageTotal = Number(row.usageTotal || 0);
      const recurringTotal = Number(row.recurringTotal || 0);
      return {
        ...row,
        usageTotal,
        recurringTotal,
        total: usageTotal + recurringTotal
      };
    });
    const lockedCount = exportRows.filter(row => row.locked).length;
    const openCount = exportRows.length - lockedCount;
    const reviewCount = exportRows.filter(row => row.alerts.length > 0).length;
    const usage = exportRows.reduce((sum, row) => sum + row.usageTotal, 0);
    const recurringTotal = exportRows.reduce((sum, row) => sum + row.recurringTotal, 0);
    const grand = usage + recurringTotal;

    const data = [
      ['Mintygreen Healthcare'],
      [branchName()],
      ['Month-End Finance Pack Summary'],
      ['Billing Cycle', month],
      ['Period', periodText(month)],
      ['Residents', exportRows.length, 'Locked', lockedCount, 'Open', openCount, 'Needs Review', reviewCount],
      [],
      ['Resident', 'Room / Ref', 'Usage', 'Recurring', 'Total', 'Status', 'Checks'],
      ...exportRows.map(row => [
        row.name,
        row.room || '',
        row.usageTotal,
        row.recurringTotal,
        row.total,
        row.locked ? 'LOCKED' : 'OPEN',
        row.alerts.map(alert => `${alert.code}: ${alert.text}`).join(' | ') || 'No alerts'
      ]),
      [],
      ['TOTAL', '', usage, recurringTotal, grand, '', '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 30 }, { wch: 16 }, { wch: 17 }, { wch: 18 }, { wch: 17 }, { wch: 14 }, { wch: 58 }, { wch: 12 }];
    ws['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 20 }, { hpt: 19 }, { hpt: 19 }, { hpt: 22 }, { hpt: 8 }, { hpt: 24 }];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 6 } }
    ];

    const thinBorder = { bottom: { style: 'thin', color: { rgb: 'D7E3E0' } } };
    const headerStyle = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '176B5B' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: thinBorder };
    const titleStyle = { font: { name: 'Arial', bold: true, sz: 16, color: { rgb: '176B5B' } }, alignment: { vertical: 'center' } };
    const branchStyle = { font: { name: 'Arial', bold: true, sz: 11, color: { rgb: '38534E' } } };
    const reportStyle = { font: { name: 'Arial', bold: true, sz: 12, color: { rgb: '163B34' } } };
    const metaLabelStyle = { font: { name: 'Arial', bold: true, color: { rgb: '38534E' } }, fill: { patternType: 'solid', fgColor: { rgb: 'EEF7F5' } }, alignment: { vertical: 'center' } };
    const metaValueStyle = { font: { name: 'Arial', color: { rgb: '163B34' } }, alignment: { vertical: 'center' } };
    const kpiLabelStyle = { font: { name: 'Arial', sz: 9, bold: true, color: { rgb: '56726C' } }, fill: { patternType: 'solid', fgColor: { rgb: 'EAF6F3' } }, alignment: { horizontal: 'center', vertical: 'center' } };
    const kpiValueStyle = { font: { name: 'Arial', sz: 11, bold: true, color: { rgb: '0B5F9A' } }, fill: { patternType: 'solid', fgColor: { rgb: 'EAF6F3' } }, alignment: { horizontal: 'center', vertical: 'center' } };
    const bodyStyle = { font: { name: 'Arial', sz: 10, color: { rgb: '263D39' } }, alignment: { vertical: 'center' }, border: thinBorder };
    const alternateStyle = { ...bodyStyle, fill: { patternType: 'solid', fgColor: { rgb: 'F7FAF9' } } };
    const totalStyle = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: '163B34' } }, fill: { patternType: 'solid', fgColor: { rgb: 'DDEFEA' } }, alignment: { vertical: 'center' }, border: { top: { style: 'medium', color: { rgb: '176B5B' } } } };
    if (ws.A1) ws.A1.s = titleStyle;
    if (ws.A2) ws.A2.s = branchStyle;
    if (ws.A3) ws.A3.s = reportStyle;
    for (const row of [3, 4]) {
      const label = XLSX.utils.encode_cell({ r: row, c: 0 });
      const value = XLSX.utils.encode_cell({ r: row, c: 1 });
      if (ws[label]) ws[label].s = metaLabelStyle;
      if (ws[value]) ws[value].s = metaValueStyle;
    }
    for (const c of [0, 2, 4, 6]) {
      const label = XLSX.utils.encode_cell({ r: 5, c });
      const value = XLSX.utils.encode_cell({ r: 5, c: c + 1 });
      if (ws[label]) ws[label].s = kpiLabelStyle;
      if (ws[value]) ws[value].s = kpiValueStyle;
    }
    for (let c = 0; c < 7; c++) {
      const headerAddress = XLSX.utils.encode_cell({ r: 7, c });
      if (ws[headerAddress]) ws[headerAddress].s = headerStyle;
    }
    const totalRow = data.length - 1;
    for (let c = 0; c < 7; c++) {
      const totalAddress = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[totalAddress]) ws[totalAddress].s = totalStyle;
    }
    const currencyFormat = '"RM" #,##0.00;[Red]-"RM" #,##0.00;-';
    for (let r = 8; r < 8 + exportRows.length; r++) {
      ws['!rows'][r] = { hpt: 21 };
      for (let c = 0; c < 7; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        if (ws[address]) ws[address].s = r % 2 === 0 ? bodyStyle : alternateStyle;
      }
      for (const c of [2, 3, 4]) {
        const address = XLSX.utils.encode_cell({ r, c });
        if (ws[address]) {
          ws[address].z = currencyFormat;
          ws[address].s = { ...ws[address].s, alignment: { horizontal: 'right', vertical: 'center' } };
        }
      }
      const statusAddress = XLSX.utils.encode_cell({ r, c: 5 });
      if (ws[statusAddress]) ws[statusAddress].s = { ...ws[statusAddress].s, font: { ...ws[statusAddress].s.font, bold: true, color: { rgb: ws[statusAddress].v === 'LOCKED' ? '176B5B' : 'B26A00' } }, alignment: { horizontal: 'center', vertical: 'center' } };
      const checksAddress = XLSX.utils.encode_cell({ r, c: 6 });
      if (ws[checksAddress]) ws[checksAddress].s = { ...ws[checksAddress].s, alignment: { horizontal: 'left', vertical: 'center', wrapText: true } };
    }
    for (const c of [2, 3, 4]) {
      const address = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[address]) ws[address].z = currencyFormat;
    }
    ws['!rows'][totalRow] = { hpt: 23 };
    ws['!autofilter'] = { ref: `A8:G${8 + exportRows.length}` };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Month-End Summary');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  }

  function buildSummaryPdf(rows, month) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const width = doc.internal.pageSize.getWidth();
    const usage = rows.reduce((sum, row) => sum + row.usageTotal, 0);
    const recurringTotal = rows.reduce((sum, row) => sum + row.recurringTotal, 0);
    const grand = usage + recurringTotal;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Mintygreen Healthcare', 14, 15);
    doc.setFontSize(10);
    doc.text(branchName(), 14, 21);
    doc.setFontSize(14);
    doc.text('Month-End Finance Summary', width - 14, 15, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Billing Cycle: ${month}`, width - 14, 21, { align: 'right' });
    doc.text(`Period: ${periodText(month)}`, width - 14, 27, { align: 'right' });

    doc.autoTable({
      startY: 35,
      head: [['Resident', 'Room / Ref', 'Usage', 'Recurring', 'Total', 'Status', 'Checks']],
      body: rows.map(row => [
        row.name,
        row.room || '-',
        money(row.usageTotal),
        money(row.recurringTotal),
        money(row.total),
        row.locked ? 'LOCKED' : 'OPEN',
        row.alerts.map(alert => alert.code).join(', ') || 'OK'
      ]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7.5, cellPadding: 2.2 },
      headStyles: { fillColor: [23, 107, 91], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'center' }
      }
    });

    const y = (doc.lastAutoTable?.finalY || 35) + 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Usage Charges: ${money(usage)}`, width - 14, y, { align: 'right' });
    doc.text(`Recurring Charges: ${money(recurringTotal)}`, width - 14, y + 6, { align: 'right' });
    doc.setFontSize(11);
    doc.text(`Grand Total: ${money(grand)}`, width - 14, y + 13, { align: 'right' });

    const pages = doc.internal.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      const height = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text('Mintygreen Healthcare - Month-End Finance Summary', 14, height - 8);
      doc.text(`${branchName()} · Page ${page} of ${pages}`, width - 14, height - 8, { align: 'right' });
    }

    return doc.output('blob');
  }

  async function downloadFinancePack() {
    if (!isAllowed()) return;
    if (!state.rows.length) {
      if (typeof toast === 'function') toast('Load the month-end dashboard before creating the finance pack');
      return;
    }
    if (typeof JSZip !== 'function') {
      if (typeof toast === 'function') toast('Finance Pack library is unavailable. Please refresh the page.');
      return;
    }
    if (typeof renderFinancePdfPage !== 'function') {
      if (typeof toast === 'function') toast('Resident finance PDF renderer is unavailable');
      return;
    }

    const button = byId('monthEndFinancePackBtn');
    const status = byId('monthEndPackStatus');
    const originalLabel = button?.textContent || 'Download Finance Pack';
    if (button) button.disabled = true;

    try {
      const month = currentMonth();
      const cycle = getBillingCycle(month);
      const packRows = [...state.rows];
      const zip = new JSZip();
      const branchPart = safeFilePart(branchName());
      const root = `Mintygreen-Healthcare_${branchPart}_${month}`;
      const summaryFolder = zip.folder(`${root}/Summary`);
      const residentFolder = zip.folder(`${root}/Resident-PDFs`);

      if (status) status.textContent = 'Preparing summary files…';
      summaryFolder.file(`Month-End-Summary_${branchPart}_${month}.xlsx`, buildSummaryWorkbook(packRows, month));
      summaryFolder.file(`Month-End-Summary_${branchPart}_${month}.pdf`, buildSummaryPdf(packRows, month));

      const { jsPDF } = window.jspdf;
      const period = periodText(month);
      for (let index = 0; index < packRows.length; index++) {
        const row = packRows[index];
        if (status) status.textContent = `Preparing resident PDFs ${index + 1}/${packRows.length}…`;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        renderFinancePdfPage(
          doc,
          row.resident,
          month,
          cycle,
          period,
          state.entriesByResident.get(row.id) || [],
          state.recurringByResident.get(row.id) || []
        );
        const prefix = String(index + 1).padStart(2, '0');
        residentFolder.file(`${prefix}_${safeFilePart(row.name)}_${month}.pdf`, doc.output('blob'));
      }

      const lockedCount = packRows.filter(row => row.locked).length;
      const reviewCount = packRows.filter(row => row.alerts.length > 0).length;
      zip.file(`${root}/README.txt`, [
        'Mintygreen Healthcare',
        branchName(),
        `Billing Cycle: ${month}`,
        `Period: ${period}`,
        `Residents: ${packRows.length}`,
        `Locked: ${lockedCount}`,
        `Open: ${packRows.length - lockedCount}`,
        `Needs Review: ${reviewCount}`,
        '',
        'Finance reconciliation warnings are review prompts only and do not alter billing amounts.'
      ].join('\n'));

      if (status) status.textContent = 'Compressing finance pack…';
      const blob = await zip.generateAsync(
        { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
        metadata => {
          if (status && metadata?.percent != null) status.textContent = `Compressing finance pack… ${Math.round(metadata.percent)}%`;
        }
      );

      const anchor = document.createElement('a');
      anchor.href = URL.createObjectURL(blob);
      anchor.download = `${root}_Finance-Pack.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);

      if (status) status.textContent = 'Finance pack ready';
      if (typeof toast === 'function') toast('Finance pack downloaded');
    } catch (error) {
      console.error('Finance pack generation failed:', error);
      if (status) status.textContent = 'Finance pack failed';
      if (typeof toast === 'function') toast(error?.message || 'Unable to create finance pack');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = originalLabel;
      }
    }
  }

  ensureMonthEndUI();
  document.addEventListener('DOMContentLoaded', ensureMonthEndUI, { once: true });
  window.addEventListener('load', () => {
    syncVisibility();
    state.lastBranchId = currentBranchId;
  }, { once: true });
})();
