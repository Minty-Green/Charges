(() => {
  const FINANCE_TAB = 'financeSummary';
  const state = {
    month: '',
    rows: [],
    search: '',
    status: 'all',
    loading: false,
    lastBranchId: null
  };

  const byId = id => document.getElementById(id);
  const isAllowed = () => currentUserRole === 'admin' || currentUserRole === 'super_admin';
  const formatMoney = value => new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR'
  }).format(Number(value || 0)).replace('MYR', 'RM');

  function currentFinanceMonth() {
    return byId('financeMonth')?.value || byId('monthPicker')?.value || todayMonth();
  }

  function branchName() {
    return typeof getActiveBranchName === 'function' ? getActiveBranchName() : 'Branch';
  }

  function periodLabel(month) {
    const cycle = getBillingCycle(month);
    if (!cycle) return '-';
    return `${formatShortDate(cycle.startDate)} - ${formatShortDate(cycle.endDate)}`;
  }

  function ensureFinanceUI() {
    if (byId('financeSummaryTab')) return;

    const tabs = document.querySelector('.wrap > .tabs');
    const main = document.querySelector('main.wrap');
    if (!tabs || !main) return;

    const button = document.createElement('button');
    button.id = 'financeSummaryNavBtn';
    button.type = 'button';
    button.className = 'btn tab admin-only hidden';
    button.dataset.tab = FINANCE_TAB;
    button.textContent = 'Finance Summary';

    const recurringButton = tabs.querySelector('[data-tab="recurring"]');
    tabs.insertBefore(button, recurringButton || null);

    const section = document.createElement('section');
    section.id = 'financeSummaryTab';
    section.className = 'hidden';
    section.innerHTML = `
      <div class="page-heading finance-heading">
        <div class="page-heading-copy">
          <div class="page-heading-kicker">Finance</div>
          <h1>Finance Summary</h1>
          <p>Review branch billing totals by resident for the selected billing cycle.</p>
        </div>
      </div>

      <div class="card finance-toolbar">
        <div class="tfield">
          <label>Billing Cycle</label>
          <input id="financeMonth" type="month">
          <small id="financePeriod" class="finance-period"></small>
        </div>
        <div class="tfield finance-search-field">
          <label>Search Resident</label>
          <input id="financeSearch" type="search" placeholder="Name or room / ref" autocomplete="off">
        </div>
        <div class="tfield">
          <label>Cycle Status</label>
          <select id="financeStatusFilter">
            <option value="all">All</option>
            <option value="locked">Locked</option>
            <option value="open">Open</option>
          </select>
        </div>
        <button id="financeReloadBtn" class="btn btn-primary">Refresh</button>
      </div>

      <div class="finance-summary-grid">
        <div class="card finance-stat"><span>Residents</span><strong id="financeResidentCount">0</strong><small id="financeLockCount">0 locked</small></div>
        <div class="card finance-stat"><span>Usage Charges</span><strong id="financeUsageTotal">RM 0.00</strong><small>Stock / daily usage</small></div>
        <div class="card finance-stat"><span>Recurring Charges</span><strong id="financeRecurringTotal">RM 0.00</strong><small>Packages / services / rentals</small></div>
        <div class="card finance-stat finance-stat-total"><span>Grand Total</span><strong id="financeGrandTotal">RM 0.00</strong><small id="financeBranchName">Branch total</small></div>
      </div>

      <div class="card finance-report-card">
        <div class="finance-report-head">
          <div>
            <h3>Resident Billing Summary</h3>
            <p id="financeReportMeta" class="note">Select a billing cycle to begin.</p>
          </div>
          <div class="finance-export-actions">
            <button id="financeSummaryExcelBtn" class="btn btn-light" style="border:1px solid var(--border)">Export Summary Excel</button>
            <button id="financeSummaryPdfBtn" class="btn btn-light" style="border:1px solid var(--border)">Export Summary PDF</button>
          </div>
        </div>
        <div id="financeLoading" class="finance-loading hidden">Loading finance summary…</div>
        <div class="table-wrap finance-table-wrap">
          <table class="finance-table">
            <thead>
              <tr>
                <th>Resident</th>
                <th>Room / Ref</th>
                <th class="num">Usage</th>
                <th class="num">Recurring</th>
                <th class="num">Total</th>
                <th>Cycle Status</th>
              </tr>
            </thead>
            <tbody id="financeTableBody"></tbody>
            <tfoot id="financeTableFoot"></tfoot>
          </table>
        </div>
        <div id="financeEmpty" class="finance-empty hidden">No residents match the current filters.</div>
      </div>`;

    const chargesSection = byId('chargesTab');
    if (chargesSection?.nextSibling) main.insertBefore(section, chargesSection.nextSibling);
    else main.appendChild(section);

    const initialMonth = byId('monthPicker')?.value || todayMonth();
    byId('financeMonth').value = initialMonth;
    state.month = initialMonth;
    updateFinancePeriod();

    button.addEventListener('click', openFinanceTab);
    byId('financeReloadBtn')?.addEventListener('click', loadFinanceSummary);
    byId('financeMonth')?.addEventListener('change', () => {
      state.month = currentFinanceMonth();
      updateFinancePeriod();
      loadFinanceSummary();
    });
    byId('financeSearch')?.addEventListener('input', e => {
      state.search = String(e.target.value || '').trim().toLowerCase();
      renderFinanceRows();
    });
    byId('financeStatusFilter')?.addEventListener('change', e => {
      state.status = e.target.value || 'all';
      renderFinanceRows();
    });
    byId('financeSummaryExcelBtn')?.addEventListener('click', exportFinanceSummaryExcel);
    byId('financeSummaryPdfBtn')?.addEventListener('click', exportFinanceSummaryPdf);

    document.querySelectorAll('.wrap > .tabs .tab').forEach(tab => {
      if (tab === button) return;
      tab.addEventListener('click', () => {
        section.classList.add('hidden');
        button.classList.remove('active');
      });
    });

    const roleNode = byId('userRole');
    if (roleNode) new MutationObserver(syncFinanceVisibility).observe(roleNode, { childList: true, subtree: true, characterData: true });

    const branchNode = byId('branchSwitcherLabel') || byId('activeBranchChip');
    if (branchNode) {
      new MutationObserver(() => {
        if (state.lastBranchId !== currentBranchId) {
          state.lastBranchId = currentBranchId;
          if (!section.classList.contains('hidden') && isAllowed()) loadFinanceSummary();
        }
      }).observe(branchNode, { childList: true, subtree: true, characterData: true });
    }

    syncFinanceVisibility();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function syncFinanceVisibility() {
    const button = byId('financeSummaryNavBtn');
    const section = byId('financeSummaryTab');
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

  function openFinanceTab() {
    if (!isAllowed()) return;

    document.querySelectorAll('.wrap > .tabs .tab').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('main.wrap > section').forEach(section => section.classList.add('hidden'));

    byId('financeSummaryNavBtn')?.classList.add('active');
    byId('financeSummaryTab')?.classList.remove('hidden');

    const mainMonth = byId('monthPicker')?.value;
    if (mainMonth && !state.month) {
      state.month = mainMonth;
      byId('financeMonth').value = mainMonth;
    }

    updateFinancePeriod();
    loadFinanceSummary();
    if (typeof syncMobileNav === 'function') setTimeout(syncMobileNav, 0);
  }

  function updateFinancePeriod() {
    const month = currentFinanceMonth();
    const period = byId('financePeriod');
    if (period) period.textContent = `Period: ${periodLabel(month)}`;
  }

  async function loadFinanceSummary() {
    if (!isAllowed() || !currentBranchId) return;

    const month = currentFinanceMonth();
    const cycle = getBillingCycle(month);
    if (!cycle) return;

    state.month = month;
    state.loading = true;
    setLoading(true);

    try {
      // Refresh special-month overrides and permanent price history before recurring totals.
      if (typeof loadRecurringPricingData === 'function') await loadRecurringPricingData();
      const [entriesResult, cyclesResult, recurringResult] = await Promise.all([
        sb.from('charge_entries')
          .select('resident_id,quantity,unit_price,charge_date')
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

      if (entriesResult.error) throw entriesResult.error;
      if (cyclesResult.error) throw cyclesResult.error;
      if (recurringResult.error) throw recurringResult.error;

      const entryRows = entriesResult.data || [];
      const recurringRows = recurringResult.data || [];
      const lockMap = new Map((cyclesResult.data || []).map(row => [row.resident_id, !!row.is_locked]));
      const usageByResident = new Map();

      entryRows.forEach(entry => {
        const amount = Number(entry.quantity || 0) * Number(entry.unit_price || 0);
        usageByResident.set(entry.resident_id, (usageByResident.get(entry.resident_id) || 0) + amount);
      });

      state.rows = (residents || []).map(resident => {
        const usageTotal = Number(usageByResident.get(resident.id) || 0);
        const recurringTotal = recurringRows
          .filter(charge => charge.resident_id === resident.id)
          .reduce((sum, charge) => sum + Number(getRecurringAmountForMonth(charge, month) || 0), 0);

        return {
          id: resident.id,
          name: resident.name || '',
          room: resident.room_ref || '',
          usageTotal,
          recurringTotal,
          total: usageTotal + recurringTotal,
          locked: lockMap.get(resident.id) === true
        };
      }).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

      state.lastBranchId = currentBranchId;
      renderFinanceRows();
    } catch (error) {
      console.error('Finance summary load failed:', error);
      state.rows = [];
      renderFinanceRows();
      if (typeof toast === 'function') toast(error?.message || 'Unable to load finance summary');
    } finally {
      state.loading = false;
      setLoading(false);
    }
  }

  function filteredRows() {
    return state.rows.filter(row => {
      const haystack = `${row.name} ${row.room}`.toLowerCase();
      const searchMatch = !state.search || haystack.includes(state.search);
      const statusMatch = state.status === 'all' || (state.status === 'locked' ? row.locked : !row.locked);
      return searchMatch && statusMatch;
    });
  }

  function renderFinanceRows() {
    const tbody = byId('financeTableBody');
    const tfoot = byId('financeTableFoot');
    if (!tbody || !tfoot) return;

    const rows = filteredRows();
    const usage = rows.reduce((sum, row) => sum + row.usageTotal, 0);
    const recurringTotal = rows.reduce((sum, row) => sum + row.recurringTotal, 0);
    const grand = usage + recurringTotal;
    const lockedCount = rows.filter(row => row.locked).length;

    tbody.innerHTML = rows.map(row => `
      <tr>
        <td><strong>${esc(row.name)}</strong></td>
        <td>${esc(row.room || '-')}</td>
        <td class="num">${formatMoney(row.usageTotal)}</td>
        <td class="num">${formatMoney(row.recurringTotal)}</td>
        <td class="num finance-row-total">${formatMoney(row.total)}</td>
        <td><span class="badge ${row.locked ? 'finance-locked' : 'finance-open'}">${row.locked ? 'LOCKED' : 'OPEN'}</span></td>
      </tr>`).join('');

    tfoot.innerHTML = rows.length ? `
      <tr>
        <th colspan="2">Filtered Total</th>
        <th class="num">${formatMoney(usage)}</th>
        <th class="num">${formatMoney(recurringTotal)}</th>
        <th class="num">${formatMoney(grand)}</th>
        <th></th>
      </tr>` : '';

    byId('financeResidentCount').textContent = String(rows.length);
    byId('financeLockCount').textContent = `${lockedCount} locked · ${Math.max(0, rows.length - lockedCount)} open`;
    byId('financeUsageTotal').textContent = formatMoney(usage);
    byId('financeRecurringTotal').textContent = formatMoney(recurringTotal);
    byId('financeGrandTotal').textContent = formatMoney(grand);
    byId('financeBranchName').textContent = `${branchName()} total`;
    byId('financeReportMeta').textContent = `${branchName()} · ${state.month || currentFinanceMonth()} · ${periodLabel(state.month || currentFinanceMonth())}`;
    byId('financeEmpty').classList.toggle('hidden', rows.length > 0 || state.loading);
  }

  function setLoading(loading) {
    byId('financeLoading')?.classList.toggle('hidden', !loading);
    const reload = byId('financeReloadBtn');
    if (reload) {
      reload.disabled = loading;
      reload.textContent = loading ? 'Loading…' : 'Refresh';
    }
    byId('financeSummaryExcelBtn')?.toggleAttribute('disabled', loading);
    byId('financeSummaryPdfBtn')?.toggleAttribute('disabled', loading);
  }

  function exportRowsOrWarn() {
    const rows = filteredRows();
    if (!rows.length) {
      if (typeof toast === 'function') toast('No finance summary rows to export');
      return null;
    }
    return rows;
  }

  function buildFinanceSummaryWorkbook(rows, month) {
    const exportRows = rows.map(row => {
      const usageTotal = Number(row.usageTotal || 0);
      const recurringTotal = Number(row.recurringTotal || 0);
      return { ...row, usageTotal, recurringTotal, total: usageTotal + recurringTotal };
    });
    const usage = exportRows.reduce((sum, row) => sum + row.usageTotal, 0);
    const recurringTotal = exportRows.reduce((sum, row) => sum + row.recurringTotal, 0);
    const grand = usage + recurringTotal;
    const lockedCount = exportRows.filter(row => row.locked).length;
    const openCount = exportRows.length - lockedCount;
    const data = [
      ['Mintygreen Healthcare'],
      [branchName()],
      ['Finance Summary'],
      ['Billing Cycle', month],
      ['Period', periodLabel(month)],
      ['Residents', exportRows.length, 'Locked', lockedCount, 'Open', openCount],
      [],
      ['Resident', 'Room / Ref', 'Usage Charges', 'Recurring Charges', 'Grand Total', 'Cycle Status'],
      ...exportRows.map(row => [row.name, row.room || '', row.usageTotal, row.recurringTotal, row.total, row.locked ? 'LOCKED' : 'OPEN']),
      [],
      ['TOTAL', '', usage, recurringTotal, grand, '']
    ];

    const ws = XLSX.utils.aoa_to_sheet(data);
    ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 19 }, { wch: 21 }, { wch: 19 }, { wch: 16 }];
    ws['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 20 }, { hpt: 19 }, { hpt: 19 }, { hpt: 22 }, { hpt: 8 }, { hpt: 24 }];
    ws['!merges'] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 5 } }
    ];

    const thinBorder = { bottom: { style: 'thin', color: { rgb: 'D7E3E0' } } };
    const headerStyle = { font: { name: 'Arial', sz: 10, bold: true, color: { rgb: 'FFFFFF' } }, fill: { patternType: 'solid', fgColor: { rgb: '176B5B' } }, alignment: { horizontal: 'center', vertical: 'center' }, border: thinBorder };
    const titleStyle = { font: { name: 'Arial', bold: true, sz: 16, color: { rgb: '176B5B' } }, alignment: { horizontal: 'left', vertical: 'center' } };
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
    for (const c of [0, 2, 4]) {
      const label = XLSX.utils.encode_cell({ r: 5, c });
      const value = XLSX.utils.encode_cell({ r: 5, c: c + 1 });
      if (ws[label]) ws[label].s = kpiLabelStyle;
      if (ws[value]) ws[value].s = kpiValueStyle;
    }
    for (let c = 0; c < 6; c++) {
      const address = XLSX.utils.encode_cell({ r: 7, c });
      if (ws[address]) ws[address].s = headerStyle;
    }
    const totalRow = data.length - 1;
    for (let c = 0; c < 6; c++) {
      const address = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[address]) ws[address].s = totalStyle;
    }
    const currencyFormat = '"RM" #,##0.00;[Red]-"RM" #,##0.00;-';
    for (let r = 8; r < 8 + exportRows.length; r++) {
      ws['!rows'][r] = { hpt: 21 };
      for (let c = 0; c < 6; c++) {
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
    }
    for (const c of [2, 3, 4]) {
      const address = XLSX.utils.encode_cell({ r: totalRow, c });
      if (ws[address]) ws[address].z = currencyFormat;
    }
    ws['!rows'][totalRow] = { hpt: 23 };
    ws['!autofilter'] = { ref: `A8:F${8 + exportRows.length}` };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Finance Summary');
    return XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  }

  function exportFinanceSummaryExcel() {
    const rows = exportRowsOrWarn();
    if (!rows) return;

    const month = currentFinanceMonth();
    const safeBranch = branchName().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'branch';
    const workbook = buildFinanceSummaryWorkbook(rows, month);
    const blob = new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const anchor = document.createElement('a');
    anchor.href = URL.createObjectURL(blob);
    anchor.download = `Finance-Summary-${safeBranch}-${month}.xlsx`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 1500);
  }

  function exportFinanceSummaryPdf() {
    const rows = exportRowsOrWarn();
    if (!rows) return;

    const month = currentFinanceMonth();
    const usage = rows.reduce((sum, row) => sum + row.usageTotal, 0);
    const recurringTotal = rows.reduce((sum, row) => sum + row.recurringTotal, 0);
    const grand = usage + recurringTotal;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('Mintygreen Healthcare', 14, 15);
    doc.setFontSize(10);
    doc.text(branchName(), 14, 21);

    doc.setFontSize(14);
    doc.text('Finance Summary', pageWidth - 14, 15, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Billing Cycle: ${month}`, pageWidth - 14, 21, { align: 'right' });
    doc.text(`Period: ${periodLabel(month)}`, pageWidth - 14, 27, { align: 'right' });

    doc.autoTable({
      startY: 35,
      head: [['Resident', 'Room / Ref', 'Usage', 'Recurring', 'Total', 'Status']],
      body: rows.map(row => [
        row.name,
        row.room || '-',
        formatMoney(row.usageTotal),
        formatMoney(row.recurringTotal),
        formatMoney(row.total),
        row.locked ? 'LOCKED' : 'OPEN'
      ]),
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 2.5 },
      headStyles: { fillColor: [23, 107, 91], textColor: 255, fontStyle: 'bold' },
      columnStyles: {
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'center' }
      }
    });

    const y = (doc.lastAutoTable?.finalY || 35) + 8;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`Usage Charges: ${formatMoney(usage)}`, pageWidth - 14, y, { align: 'right' });
    doc.text(`Recurring Charges: ${formatMoney(recurringTotal)}`, pageWidth - 14, y + 6, { align: 'right' });
    doc.setFontSize(11);
    doc.text(`Grand Total: ${formatMoney(grand)}`, pageWidth - 14, y + 13, { align: 'right' });

    const pages = doc.internal.getNumberOfPages();
    for (let page = 1; page <= pages; page++) {
      doc.setPage(page);
      const pageHeight = doc.internal.pageSize.getHeight();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100);
      doc.text('Mintygreen Healthcare - Finance Summary', 14, pageHeight - 8);
      doc.text(`${branchName()} · Page ${page} of ${pages}`, pageWidth - 14, pageHeight - 8, { align: 'right' });
    }

    const safeBranch = branchName().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'branch';
    doc.save(`Finance-Summary-${safeBranch}-${month}.pdf`);
  }

  ensureFinanceUI();
  document.addEventListener('DOMContentLoaded', ensureFinanceUI, { once: true });
  window.addEventListener('load', () => {
    syncFinanceVisibility();
    state.lastBranchId = currentBranchId;
  }, { once: true });
})();
